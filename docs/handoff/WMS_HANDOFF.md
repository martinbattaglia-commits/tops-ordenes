# WMS — Handoff completo (Sprint 1 + Sprint 2)

> Generado 2026-06-02. Estado verificado contra migraciones `0020`–`0027` y Supabase `arsksytgdnzukbmfgkju`.

## 0. Resumen
El WMS de TOPS Nexus gestiona el **depósito de terceros** (cliente + SKU + lote + posición física), con un **modelo físico de 6 niveles**, un **gemelo digital** que deriva ocupación del stock, y un **núcleo transaccional append-only** (recepciones, movimientos, ledger inmutable). Sprint 1 (commit `e1c29c9`) está productivo; Sprint 2 (sin commitear) está construido y con el **Caso 1 validado**.

## 1. Modelo físico (migraciones 0020–0023 — APLICADAS)
Jerarquía congelada de 6 niveles:
`warehouses` → `warehouse_zones` → `warehouse_aisles` → `warehouse_racks` → `warehouse_levels` → `warehouse_positions`.
- **Sedes:** `MAGALDI_1765` y `PEDRO_LUJAN_3159` (s/ planos GCABA).
- **Cubículo = `warehouse_position`** (decisión de modelado). `0023_lujan_cubiculos.sql` cargó los cubículos de Luján.
- RBAC WMS: `0021_wms_permission_module.sql` (+ enum `permission_module_t` extendido) y `0022_wms_rbac_seed.sql`.
- Estado verificado previamente: ~13 sectores, ~24 posiciones sembradas.

## 2. Inventario (migración 0024 — APLICADA)
- **`inventory_items`**: identidad = (`client_name`, `sku`, `position_id`). Campos `stock_available`, `stock_reserved`, `active`.
- **`inventory_lots`**: identidad = (`inventory_item_id`, `lot_number`, `expiration_date`); `quantity` se **acumula**.
- Regla de **ocupación del Digital Twin** = `(stock_available + stock_reserved) > 0` (unificada Dashboard ↔ Twin).

## 3. Digital Twin (Sprint 1 — commit e1c29c9)
- Ruta: **Mapa Inteligente** (dominio Cockpit). Render esquemático CSS (no canvas) de la grilla de posiciones, coloreadas por ocupación derivada del inventario.
- Constitución: `docs/digital-twin-blueprint.md`.
- **Digital Twin v2** (espacios operativos `facility_space`, business_unit, cubículos clasificados): **diseñado y congelado, EN ESPERA** del relevamiento (matriz maestra) de Dirección. Será `0028_facility_spaces.sql`. NO construir hasta recibir la matriz.

## 4. Sprint 1 — Dashboard + Inventario (PRODUCTIVO, commit e1c29c9)
- `/wms` dashboard (KPIs ocupación), `/wms/inventario` (listado items+lotes), Mapa Inteligente.
- Capa: `src/lib/wms/data.ts` (`getWmsDashboard`, `listInventory`, `listPositionOptions`).

## 5. Sprint 2 — Recepciones + Movimientos + Ledger (CONSTRUIDO, sin commitear)

### 5.1 Migraciones (APLICADAS en DEV)
- **`0025_wms_receptions.sql`** — `receptions` + `reception_items`; enums:
  - `business_unit_t` (`GENERAL`,`ANMAT`), `reception_status_t` (`borrador`,`pendiente`,`en_recepcion`,`cuarentena`,`recibida`,`anulada`), `reception_item_status_t`.
  - `requires_quarantine boolean` (decisión operativa, NO automático por ANMAT).
  - CHECK `reception_items_anmat_lot_chk`: si `business_unit='ANMAT'` ⇒ lote + vencimiento obligatorios.
  - Triggers sync/cascade de `business_unit` cabecera→líneas.
  - `recibida_parcial` es **derivado, no persistido**.
- **`0026_inventory_movements.sql`** — ledger `inventory_movements` (enums `movement_type_t`: `ingreso`/`egreso`/`traslado`/`ajuste`; `movement_reference_t`); `before_quantity`/`after_quantity`, `notes`, `reference_type`/`reference_id`. **Inmutabilidad** vía triggers BEFORE UPDATE/DELETE/TRUNCATE → `RAISE EXCEPTION` (elegido sobre RLS porque `service_role` la bypassa).
- **`0027_wms_functions.sql`** — índices únicos de identidad, **lockdown RLS** (drop policies insert/update/delete sobre items/lots/movements: el stock SOLO se escribe vía RPC) y **3 RPC SECURITY DEFINER**:
  - `confirm_reception(p_reception_id uuid)` — find-or-create item por (cliente,sku,posición); find-or-create/acumula lote; suma a `stock_available` (o `stock_reserved` si cuarentena); inserta movimiento `ingreso` con before/after; pasa líneas a `recibido`/`cuarentena` y cabecera a `recibida`/`cuarentena`/`en_recepcion`.
  - `release_quarantine(p_reception_id uuid)` — pasa `stock_reserved`→`stock_available`, movimiento `ajuste`, cabecera→`recibida`.
  - `confirm_movement(...)` — `traslado`/`ajuste`/`egreso` (el `ingreso` solo se registra por `confirm_reception`).
  - Autorización en las 3: `current_role()` ∈ (`admin`,`operaciones`,`supervisor`), si no `RAISE` `insufficient_privilege`.
  - `grant execute … to authenticated` + `notify pgrst, 'reload schema'`.

### 5.2 Capa TS + UI (construida; tsc/eslint EXIT 0)
- `src/lib/wms/receptions.ts` — `listReceptions`, `createReception`, `addReceptionItem`, `submitReception`, `confirmReception` (rpc), `releaseQuarantine` (rpc), `cancelReception`.
- `src/lib/wms/movements.ts` — `confirmMovement` (rpc), `listMovements`.
- `src/lib/wms/types.ts` — tipos + `RECEPTION_STATUS_META`.
- UI: `/wms/recepciones`, `/wms/recepciones/nueva` (`NewReceptionForm`), `/wms/movimientos` + `actions.ts` + `RowActions.tsx`.

## 6. INCIDENTE — PostgreSQL 42804 (RESUELTO Y VALIDADO)
- **Síntoma:** el botón "Confirmar" de una recepción fallaba. El mensaje truncado en UI sugería `42703 (column does not exist)` → **diagnóstico inicial equivocado**.
- **Método que lo resolvió:** instrumentación temporal en `confirmReception` (`console.error` del error PostgREST completo: `message/details/hint/code`). Tras un click real, el log de DEV reveló el código verdadero.
- **Causa raíz:** `42804 datatype_mismatch` — `column "status" is of type reception_item_status_t but expression is of type text`. Una expresión `CASE … THEN 'valor' END` en plpgsql resuelve a **`text`**, y al asignarse a una columna **ENUM** Postgres NO castea implícitamente.
- **Fix aplicado (cast explícito) en `0027_wms_functions.sql`:**
  - `set status = (case when v_quar then 'cuarentena' else 'recibido' end)::reception_item_status_t` (línea ~131).
  - `set status = (case when v_quar then 'cuarentena' when v_pending = 0 then 'recibida' else 'en_recepcion' end)::reception_status_t` (línea ~140).
- **Auditoría de la familia enum/text (0025/0026/0027):** se revisaron TODOS los `CASE` y asignaciones a columnas enum.
  - Corregidos: 2 (los de arriba).
  - Descartados con justificación: `active = case … end` (→ boolean, seguro), literales sueltos `set status = 'recibido'` en `release_quarantine` (`unknown`, castea implícito), comparaciones e `INSERT` con literales (seguros), concatenaciones `→ text`.
  - **Conclusión: familia enum/text cerrada** — no quedan patrones `CASE→enum` ni `text→enum` sin cast.
- **Estado:** **RESUELTO Y VALIDADO** end-to-end (ver §7). La función aplicada en la DB ya contiene el cast (verificado: `pg_get_functiondef` contiene `reception_item_status_t`).

## 7. Casos de prueba

### Caso 1 — Recepción GENERAL (REC-2026-0001) — ✅ VALIDADO
Evidencia verificada en Supabase el 2026-06-02:
| Verificación | Resultado |
|---|---|
| `receptions.status` | `pendiente` → **`recibida`** ✅ |
| `reception_items` (G-001) | `pendiente` → **`recibido`** ✅ |
| `inventory_items` (G-001) creado | **1** ✅ |
| `inventory_movements` (ingreso) generado | **1** ✅ |
| `stock_available` (G-001) | **100** ✅ |
| UI sincronizada | ✅ (lista refleja `recibida`) |
| Fix 42804 live en DB | ✅ (`fn_has_cast = true`) |

### Casos pendientes (kit definido, NO ejecutados)
- **Caso 2 — ANMAT:** alta con `business_unit='ANMAT'` sin lote/vencimiento ⇒ debe rechazar por CHECK `reception_items_anmat_lot_chk`.
- **Caso 3 — Cuarentena:** recepción con `requires_quarantine=true` ⇒ stock va a `stock_reserved`, cabecera→`cuarentena`; luego `release_quarantine` ⇒ `reserved`→`available`, cabecera→`recibida`, movimiento `ajuste`.
- **Caso 4 — Traslado/Movimientos:** `confirm_movement` traslado (cambia `position_id`, conserva stock) / ajuste / egreso. (Sin UI de alta de movimiento aún — vía RPC.)
- **Caso 5 — Idempotencia/estado:** re-confirmar una `recibida` no debe duplicar stock (guardas de estado en la RPC).
- **Caso 6 — Ledger inmutable:** UPDATE/DELETE sobre `inventory_movements` ⇒ debe fallar por trigger de inmutabilidad.

## 8. Bugs
| # | Bug | Estado |
|---|---|---|
| 1 | `confirm_reception` 42804 (CASE text→enum) | ✅ RESUELTO Y VALIDADO |
| — | Diagnóstico inicial 42703 (column not exist) | descartado (era mensaje truncado de UI) |
| — | Management API bloquea WRITES (HTTP 403/1010) | conocido — writes los corre Martín en SQL Editor/UI; reads OK |

## 9. Limpieza pendiente antes del commit de Sprint 2
1. **Quitar instrumentación temporal** en `src/lib/wms/receptions.ts` (`confirmReception`, líneas ~147-162: bloque `console.error("[confirmReception] FULL SUPABASE ERROR …")` y el `throw` enriquecido) → volver al manejo de error estándar.
2. Ejecutar Casos 2–6.
3. Commit aislado de Sprint 2 (migraciones 0025-0027 + `src/lib/wms/*` + UI recepciones/movimientos), método staged + revisión + OK.
