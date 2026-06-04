# TOPS NEXUS — MASTER HANDOFF (definitivo)
> Generado 2026-06-03. Fuente de verdad para continuar en un chat nuevo sin releer el historial.
> Verificado contra repo `~/CODE/tops-ordenes`, migraciones `0001`–`0031` y Supabase `arsksytgdnzukbmfgkju`.

> 🟢 **ACTUALIZACIÓN DE ESTADO (2026-06-03, posterior a la redacción original):**
> El cuerpo de este documento se escribió con **Gate 4 "en diseño"**. Estado **vigente**:
> - **Gate 4A (Picking)** — ✅ cerrado y commiteado (`17b0be5`, migración `0032`).
> - **Gate 4B (Packing)** — ✅ cerrado y commiteado (`c5390bd`, migración `0033`).
> - **Mini-Gate 4B.1 (Packing Cancel)** — ✅ **VALIDADO y commiteado** (`547f6eb`, RPC `anular_packing_unit`,
>   migración `0034`, kit 12/12 0 footprint). Capa TS/UI (botón "Anular") pendiente, **no bloqueante**.
> - **Gate 4C (Despacho + Entrega)** — ✅ **VALIDADO + CERRADO** (`841f85b`). `0035_wms_dispatch.sql`
>   aplicada; `gate4c_dispatch_validation_report.sql` **14/14 OK** (FEFO real, egreso sobre `stock_reserved`,
>   ledger append-only, reversión compensatoria, D1=A, authz). `shipments` + `shipment_status_t` +
>   `confirm_dispatch`/`confirm_delivery`/`revert_dispatch` + `wms_dispatch_recompute` + TS (`src/lib/dispatch/*`)
>   + UI (`/wms/despachos`). Ver `GATE_4C_IMPLEMENTATION_REPORT.md`.
> - **Cadena de migraciones** versionada en git hasta `0035`; `main` ↔ `origin/main` (sin push pendiente).
> - **GATE 4 COMPLETO** (4A · 4B · 4B.1 · 4C).
> - **Gate 5 — Cadena de Custodia:** ✅ **VALIDATED + CLOSED (2026-06-03).** `0036`–`0039` aplicadas en
>   Supabase Production y commiteadas (`7196b86`/`468d893`/`d301e8e`/`681d810`): 3 tablas custody + tokens QR +
>   3 buckets privados + 9 RPC + hash-chain + read-audit. **QA completo:** `0036`=10/10, `0037`=9/9,
>   **`0038`=10/10**, **`0039`=12/12** (0 FAIL · 0 SKIP). **App Layer completa** (`b55916e`): TS Layer +
>   Server Actions + QR + Timeline + Dashboard + Shipment Integration + Evidence Viewer + POD Surface +
>   **POD-PDF server-side** (`61e69e4`, cierra B4). `tsc`=0 · `eslint` limpio. Ver
>   `GATE_5_FINAL_CLOSURE_REPORT.md`. **Follow-up operativo/compliance (NO bloqueante del cierre de ingeniería):**
>   B3 backup de Storage · B6 política legal de retención (+ anclaje Merkle opcional).
> - **RENUMERACIÓN DEFINITIVA:** `0034` = Packing Cancel (4B.1) · `0035` = Dispatch (4C).
>   (Las referencias a "Fase 4C = `0034`" más abajo son previas a la renumeración — leer `0035`.)
> Docs de referencia: `WMS_PHASE_CLOSURE_HANDOFF.md`, `GATE_4C_READINESS_REPORT.md`, `GATE_4B1_CLOSURE_REPORT.md`.

---

## 1. RESUMEN EJECUTIVO
- **Proyecto:** TOPS NEXUS — Operating System / ERP vertical para operador logístico 3PL.
- **Empresa:** Logística TOPS (VEROTIN S.A.). Usuario: **Martín Battaglia (presidente)**. Idioma: español rioplatense.
- **Objetivo:** centralizar Comercial/CRM, Compras, WMS (Recepciones/Inventario/Lotes/Picking/Packing/Despachos), Pedidos+Reservas, Tracking de flota, Google Workspace, Dashboard ejecutivo y Reportes; reemplazo progresivo de Neuralsoft. No‑negociables: auditoría e inmutabilidad.
- **Estado actual:** Gates 1‑3 **funcionalmente completos y validados**. **Gate 4 (Picking/Packing/Despacho) ABIERTO en fase de diseño** (sin implementar).
- **Gate actual:** GATE 4 — Picking → Packing → Despacho.
- **Avance estimado:** núcleo WMS+Pedidos ~70% del alcance operativo; falta Gate 4 (salida de mercadería) y Gate 5 (cadena de custodia / MELI).

## 2. STACK TECNOLÓGICO
- **Framework:** Next.js **14.2.18** (App Router; server components + Server Actions).
- **Lenguajes:** TypeScript, React, SQL (PostgreSQL/PL/pgSQL).
- **Base de datos:** Supabase Postgres, proyecto **`arsksytgdnzukbmfgkju`**. RLS en todas las tablas, PostgREST (API + RPC), Realtime (tracking), PostGIS (GPS).
- **Hosting:** Netlify (`tops-ordenes.netlify.app`); dominio objetivo `nexus.logisticatops.com` (pendiente).
- **Estilos:** Tailwind + design system propio `nx-*` (alias `gws-*`) en `globals.css`. Regla de affordance: info=surface, acción=interactive.
- **Auth/RBAC:** Supabase Auth + `public.current_role()` (lee `profiles.role`, `user_role_t`). Tablas RBAC granular `roles`/`permissions`/`role_permissions` + `permission_module_t`.
- **Integraciones:** Clientify (CRM, MCP), Hikvision (CCTV), Google Workspace, OpenAI (OCR), Resend (email), ARCA (facturación AR), Traccar+Mapbox (GPS).
- **Arquitectura:** monolito Next App Router con shell único (Sidebar/Topbar) y dominios colapsables; lógica de stock encapsulada en RPC `SECURITY DEFINER`.

## 3. ARQUITECTURA DEL SISTEMA
- **Shell:** `src/app/(app)/` con layout + Sidebar/Topbar; dominios: Cockpit, Google Workspace, Compras·Proveedores, Operaciones·Servicios, **WMS·Depósito**, **Pedidos·Logística**, Comercial·CRM, Compliance·ANMAT, Seguridad·CCTV, Analytics&Finanzas, Sistema.
- **Capa de datos:** `src/lib/<dominio>/*.ts` (accessors lectura + wrappers de RPC). Patrón demo/Supabase: `isMock()` (`env.app.demoMode || needsSupabase`) → datos mock; si no, Supabase.
- **Modelo físico (Digital Twin) — jerarquía real de 6 niveles** (¡el handoff viejo decía zones→aisles→levels, INCORRECTO!):
  `warehouses → warehouse_floors → warehouse_sectors → warehouse_zones → warehouse_racks → warehouse_positions`.
  `warehouse_positions.id` = clave de integración con inventario/pedidos/mapa.
- **Flujo de stock (extremo a extremo):**
  Recepción → `confirm_reception` (crea `inventory_items`/`inventory_lots`, suma `stock_available` o `stock_reserved` si cuarentena, registra movimiento `ingreso`) → Inventario → Pedido → `allocate_order` (reserva FEFO: `stock_available→stock_reserved` + fila en `stock_allocations`) → **[Gate 4]** Picking → Packing → Despacho (`egreso` real en ledger) → Entrega.
- **Decisiones arquitectónicas centrales:** (a) **stock solo se escribe vía RPC `SECURITY DEFINER`** (RLS lockdown de inventory_items/lots/movements/stock_allocations); (b) **ledger `inventory_movements` append‑only** garantizado por **trigger** (no RLS, porque `service_role` la bypassa); (c) **reservas en `stock_allocations`** (ledger independiente), no en `stock_reserved` plano; (d) **mutaciones = Server Actions + `revalidatePath()`** (evitar `router.refresh()`).

## 4. GATES COMPLETADOS
> Numeración del handoff oficial (mapea a migraciones reales). Migración `0012` no existe (gap histórico). `0028` reservado a Digital Twin v2 (bloqueado).

### GATE 1 — Recepciones (COMPLETADO; Caso 1 validado)
- **Objetivo:** ingreso de mercadería de terceros (cabecera + líneas) con enforcement ANMAT.
- **Alcance:** `receptions`/`reception_items`; enums `business_unit_t`(ANMAT/GENERAL/CORPORATE), `reception_status_t`, `reception_item_status_t`; CHECK ANMAT (si BU=ANMAT ⇒ lote+vencimiento); `public_id` `REC-YYYY-NNNN`.
- **Archivos:** `supabase/migrations/0025_wms_receptions.sql`, `0026_inventory_movements.sql`, `0027_wms_functions.sql`; `src/lib/wms/receptions.ts`, `movements.ts`; UI `src/app/(app)/wms/recepciones/*`, `movimientos/page.tsx` + `actions.ts`.
- **Validación:** **Caso 1 (REC‑2026‑0001) E2E** — pendiente→recibida, ítem→recibido, inventory_item creado, movimiento ingreso, `stock_available=100`. **Casos 2‑6** (ANMAT/cuarentena/traslado/idempotencia/ledger inmutable): kit SQL preparado en `docs/handoff/wms_validation_kit_casos_2-6.sql`, **NO ejecutados/confirmados aún**.
- **Resultado:** operativo en DEV; incidente 42804 (CASE→enum) resuelto con cast en `0027`.

### GATE 2 — Inventario (COMPLETADO)
- **Objetivo:** stock de terceros + movimientos + lotes + FEFO + vencimientos (lectura).
- **Alcance:** `inventory_items` (identidad `client_name,sku,position_id`; `stock_available`/`stock_reserved`), `inventory_lots` (lote/vencimiento/quantity); ledger `inventory_movements` (immutable trigger; `movement_type_t` ingreso/traslado/egreso/ajuste; `movement_reference_t` recepcion/movimiento/ajuste/despacho); RPC `confirm_movement`. **FASE 9A:** pantallas Lotes y Vencimientos (semáforo ANMAT, KPIs, CSV) — base canónica `getLotInventory` (FEFO).
- **Archivos:** `0024_wms_inventory.sql`; `src/lib/wms/{data.ts,types.ts,twin.ts,lots.ts}`; UI `wms/{page,inventario,lotes,vencimientos}`; `vencimientos/export/route.ts`.
- **Validación:** FASE 9A E2E en preview (KPIs/FEFO/semáforo/filtros/CSV/responsive, consola limpia). **Commit `7aa9e52`** (único commit de esta etapa).
- **Resultado:** operativo. **Gap conocido:** `egreso` no decrementa `inventory_lots.quantity` (se cierra en Gate 4C).

### GATE 3 — Pedidos + Reserva de Stock (COMPLETADO Y VALIDADO)
- **Objetivo:** pedidos logísticos 3PL + motor de reservas FEFO con cobertura/trazabilidad.
- **Alcance (FASE 9B esquema + 9C UI):** `logistics_orders`/`logistics_order_items`/`stock_allocations`; enums `logistics_order_status_t`, `order_item_status_t`, `alloc_status_t`; RPC `allocate_order`/`release_allocation`/`cancel_order`; UI tablero/alta/detalle (cobertura, FEFO, trazabilidad, editar borrador).
- **Archivos:** `0029_pedidos_permission_module.sql`, `0030_logistics_orders.sql`, `0031_pedidos_functions.sql`; `src/lib/pedidos/{types,orders,allocations}.ts`; `src/app/(app)/pedidos/{page.tsx,actions.ts,nuevo/*,[id]/*,_components/*}`.
- **Validación E2E (datos reales, 2026‑06‑03):** crear → confirmar → reservar; **reserva total 60u (100%)** y luego **parcial 40u (67%, RESERVADO_PARCIAL)** con **depleción de stock entre pedidos**; allocations creadas; cobertura/trazabilidad correctas; liberar y cancelar revierten stock; **UI auto‑refresca in‑place**. Fixture: `Test-general-001`/`G-001` (100u). Pedidos de prueba cancelados; **G‑001 restaurado a 100/0**.
- **Resultado:** motor de reservas validado. Incidente 503 (router.refresh) resuelto.

## 5. ESTADO ACTUAL DEL REPOSITORIO
**Git:** `main` ~**20 commits adelante de origin, SIN push**. Último commit `7aa9e52` (FASE 9A). **Trabajo SIN commitear (working tree):** WMS Sprint 2 (`0025/0026/0027` + `lib/wms/receptions.ts`,`movements.ts` + UI recepciones/movimientos), **Pedidos Gate 3** (`0029/0030/0031` + `lib/pedidos/*` + UI `pedidos/*`), `docs/handoff/*`, y un "Grupo C" (~15 archivos: clients, clientify, org, globals.css, middleware, compras/pdf+email, OrderDetailTabs).
**Supabase:** migraciones `0001`–`0027` + `0029`/`0030`/`0031` **aplicadas** (`0028` no existe). `tsc`/`eslint` en verde para el código de Gates 1‑3.

- **Operativo:** Cockpit, Compras (OC/facturas/ARCA), Operaciones/Servicios (OS), Workspace, ANMAT, CCTV, Tracking GPS, RBAC, Drive; **WMS:** Dashboard, Inventario, Recepciones, Movimientos, Lotes, Vencimientos, Digital Twin v1; **Pedidos:** tablero/alta/detalle + reservas.
- **Parcial:** FEFO (exacto entre ítems; **split por lote pendiente** hasta Gate 4C). Casos 2‑6 de recepciones (kit listo, sin correr).
- **Pendiente:** Picking, Packing, Despachos (placeholders `ModuleScaffold`), Pedidos·Tablero avanzado, Dashboard ejecutivo consolidado, Digital Twin v2 (bloqueado).

## 6. DECISIONES TÉCNICAS IMPORTANTES
1. **stock solo vía RPC `SECURITY DEFINER`** + RLS lockdown (drop policies de escritura en inventory_items/lots/movements/stock_allocations). Justificación: integridad/auditoría; el front nunca escribe stock directo.
2. **Ledger `inventory_movements` append‑only por TRIGGER** (BEFORE UPDATE/DELETE/TRUNCATE → RAISE). *Descartado* RLS para inmutabilidad porque `service_role` la bypassa.
3. **Reservas en `stock_allocations`** (ledger independiente con `reserved_at`/`released_at`). *Descartado* usar `stock_reserved` plano (colisiona con cuarentena, sin trazabilidad por pedido). Invariante: `stock_reserved = Σ allocations 'reservada' + reservado_por_cuarentena`.
4. **Cliente = `client_name text`** (consistencia con inventory/receptions). *Descartado* FK a `clients` (rompía consistencia WMS). FK como evolución futura.
5. **Reserva parcial habilitada**; **FEFO obligatorio para todos los clientes**.
6. **FEFO a nivel ítem** (los buckets son por ítem, no por lote); split por lote diferido a Gate 4C.
7. **Mutaciones = Server Actions + `revalidatePath()`**; *descartado* `router.refresh()` (causaba carrera/503).
8. **Cast explícito a enums** en toda asignación (`(case … end)::enum_t`, literales `'x'::enum_t`) — cierra la familia 42804. Comparaciones se dejan sin cast (castean implícito).
9. **Migraciones numeradas, secuenciales, aplicadas a mano** por Martín en el SQL Editor (el asistente NO puede ejecutar WRITES vía Management API; reads OK). SQL idempotente.
10. **Metodología gate‑heavy:** diseño → OK → build → validación → commit aislado. Cambios aditivos; no tocar lo validado.
11. **`public_id` por trigger** (`REC-`/`PED-`/`DSP-` + año + `lpad(short_id,4)`).

## 7. PROBLEMAS RESUELTOS
1. **42804 en `confirm_reception`** — *Síntoma:* "Confirmar" fallaba (mensaje truncado sugería 42703). *Causa:* `CASE…END` resuelve a `text` y no castea a columna ENUM. *Solución:* cast explícito `::reception_item_status_t`/`::reception_status_t`. *Archivos:* `0027_wms_functions.sql`.
2. **42804 en `release_allocation`** — mismo patrón en el `CASE` de estado de línea. *Solución:* `(case … end)::order_item_status_t` + cast a todas las escrituras de enum. *Archivos:* `0031_pedidos_functions.sql`.
3. **ChunkLoadError / build corrupto** — *Síntoma:* `/pedidos/*` no hidrataba ("missing required error components", `ChunkLoadError (timeout)`); luego `TypeError reading 'call'` en prod. *Causa:* correr **dos `next` sobre el mismo `.next`** (dev + previews / dev + build concurrentes) corrompe el manifest webpack. *Solución:* un solo proceso Next por `.next`; `rm -rf .next && npm run build && npm start`. *Archivos:* ninguno (operativo/build).
4. **`GET ?_rsc → 503` tras reservar** — *Síntoma:* la UI no se actualizaba al reservar. *Causa:* `router.refresh()` en **carrera con `revalidatePath()`** de la misma Server Action (la ruta se regeneraba). *Solución:* quitar `router.refresh()` y confiar en `revalidatePath()`. *Archivos:* `OrderDetailActions.tsx`, `OrderRowActions.tsx`, `EditOrderForm.tsx` (`NewOrderForm.tsx` mantiene `router.push`).
5. **Diagnóstico (proceso, no app):** clicks por coordenada erraban por escalado del viewport → usar clicks por **ref**/JS; inputs controlados no actualizaban estado con `form_input` → setear con **native setter + evento `input`**.

## 8. INCIDENTES ABIERTOS
**Crítico:** (ninguno bloquea funcionalidad).
**Importante:**
- **`main` sin push + Gates 2/3 y Sprint 2 sin commitear** → riesgo de pérdida; falta **commit aislado** (con OK) y backup/push de `main`.
- **POST‑503 residual:** la Server Action de reserva muestra `503` en el POST (revalidación inline bajo `next start` de instancia única) — **no‑fatal** (commitea + UI actualiza + GET fresco 200). Revisar en deploy real o **adelgazando `revalidatePath`**.
- **Casos 2‑6 de Recepciones** sin ejecutar (kit listo).
- **DEV/PROD misma DB** (`arsksytgdnzukbmfgkju` usada como DEV) — sin separación clara.
**Mejora futura:**
- ~~**FEFO split por lote + `inventory_lots.quantity--` en egreso**~~ ✅ **CERRADO en Gate 4C** (`confirm_dispatch`, 0035; validado C3/C4).
- **Digital Twin v2** (`0028_facility_spaces.sql`) — bloqueado hasta matriz maestra de Dirección.
- Rol `supervisor` no existe en tabla `roles` (sí en `user_role_t`/RLS) → seed RBAC de 'pedidos' para supervisor es no‑op (acceso real cubierto por RLS).

## 9. BASE DE DATOS
**Físico (0020):** `warehouses`,`warehouse_floors`,`warehouse_sectors`,`warehouse_zones`,`warehouse_racks`,`warehouse_positions` (+enums `warehouse_*_t`). Seed: sedes `MAGALDI_1765`, `PEDRO_LUJAN_3159` + pisos/sectores de incendio.
**Inventario (0024):** `inventory_items` (client_name, sku, description, position_id→positions, stock_available, stock_reserved, active); `inventory_lots` (inventory_item_id→items, lot_number, expiration_date, quantity, active). Identidad única `(client_name,sku,position_id)` y `(inventory_item_id,lot_number,expiration_date)` (en 0027).
**Recepciones (0025):** `receptions` (public_id REC-, client_name, business_unit, status, requires_quarantine, …) + `reception_items` (sku, lote, vencimiento, quantity, position_id, status). CHECK ANMAT. Triggers: public_id, sync/cascade business_unit.
**Ledger (0026):** `inventory_movements` (movement_type, inventory_item_id, lot_number, quantity, before/after, from/to_position, reason, notes, reference_type, reference_id, created_by). **Trigger de inmutabilidad** (UPDATE/DELETE/TRUNCATE → RAISE).
**Pedidos (0030):** `logistics_orders` (public_id PED-, client_name, customer_ref, status, priority, requested_date, notes) + `logistics_order_items` (sku, description, quantity_requested, lot_constraint, status; CHECK qty>0) + `stock_allocations` (order_item_id→items, inventory_item_id→inventory_items RESTRICT, lot_number, quantity, status, **reserved_at**, **released_at**; CHECK qty>0).
**RPC (SECURITY DEFINER, auth `current_role() in (admin,operaciones,supervisor)`):**
- `confirm_reception(p_reception_id)` — ingreso a inventario (o cuarentena), movimiento `ingreso`. *(0027)*
- `release_quarantine(p_reception_id)` — reserved→available, movimiento `ajuste`. *(0027)*
- `confirm_movement(item, type, to_pos, qty, …)` — traslado/ajuste/egreso (ingreso prohibido); valida referencia (`despacho` con TODO hasta que exista `shipments`). **No decrementa lots.** *(0027)*
- `allocate_order(p_order_id)` — reserva FEFO + parcial + idempotente: candidatos `(client,sku)` con `stock_available>0` ordenados por `min(expiration)` `nulls last`, `FOR UPDATE`; `available→reserved` + `stock_allocations`; línea `reservado`/`reservado_parcial`/`pendiente`; pedido `en_preparacion`. **No escribe inventory_movements.** *(0031)*
- `release_allocation(p_allocation_id)` — reserved→available, alloc `liberada`+released_at, recalcula línea. *(0031)*
- `cancel_order(p_order_id)` — libera todas las reservas activas, líneas+cabecera `cancelado`. *(0031)*
**RBAC (0009):** `permission_module_t` (+`wms`,`operaciones`,`pedidos`), `permission_action_t`, `roles` (director_ops/admin/operaciones/compliance), `permissions`, `role_permissions`. `current_role()` SECURITY DEFINER (0005).
**Flujos clave:** ingreso (confirm_reception) · reserva (allocate_order) · liberación/cancelación · [Gate 4] picking/packing/despacho(egreso).

## 10. WMS — ESTADO
- **Recepciones:** ✅ alta + confirmación (RPC) + ANMAT CHECK + cuarentena. Caso 1 validado; Casos 2‑6 con kit sin correr.
- **Inventario:** ✅ listado items+lotes, KPIs ocupación, ubicación física (full_code), Digital Twin v1.
- **Lotes:** ✅ pantalla (cliente/SKU/lote/venc/cantidad/ubicación/estado/días, FEFO).
- **FEFO:** ✅ orden por vencimiento (`getLotInventory`); exacto entre ítems; **split por lote pendiente** (Gate 4C).
- **Vencimientos:** ✅ semáforo ANMAT (Vencido/<30/30‑90/90‑180/>180), KPIs (incl. unidades comprometidas), CSV (BOM).
- **Pedidos:** ✅ crear/confirmar/cancelar; tablero + detalle.
- **Reservas:** ✅ `allocate_order` FEFO + parcial + idempotente; depleción entre pedidos validada.
- **Allocations:** ✅ `stock_allocations` ledger (reservada→liberada; pickeada/empacada/despachada listos para Gate 4).
- **Trazabilidad:** ✅ tabla de reservas (lote/cantidad/estado/reserved_at/released_at) + cobertura por línea y total.

## 11. GATE ACTUAL (GATE 4 — Picking/Packing/Despacho) — ABIERTO, EN DISEÑO
- **Qué falta hacer:** RPC `confirm_picking`, `confirm_packing`, `confirm_dispatch`, `confirm_delivery`; tablas `packing_units`+`packing_unit_items`, `shipments` (+ enums `packing_status_t`, `shipment_status_t`); UI `/wms/picking`,`/wms/packing`,`/wms/despachos` (hoy placeholders) + capa TS; cerrar gaps **`egreso`→`inventory_lots.quantity--`** y **validación de referencia `despacho` en `confirm_movement`**; KPIs operativos. Migraciones **`0032`+**.
- **Estados ya disponibles (NO crear):** `order_item_status_t`(pickeado/empacado/despachado), `alloc_status_t`(pickeada/empacada/despachada), `logistics_order_status_t`(preparado/despachado/entregado) — congelados en `0030`.
- **Qué NO tocar:** lógica de reserva (Gate 3 cerrado), `confirm_reception`/`release_quarantine`/`allocate_order` validados, modelo físico congelado, Gates 1‑3 en general (cambios solo aditivos). No reabrir Gate 3 salvo pedido explícito.
- **Riesgos:** Despacho = **egreso irreversible** en ledger inmutable + `lots--` (corrección solo por movimiento compensatorio) → validación exhaustiva antes de commit. Extender `confirm_movement` toca un RPC validado (aditivo, con cuidado). El POST‑503 residual afectará nuevas actions. `main` sin commitear/push.

## 12. PRÓXIMO PLAN DE TRABAJO (para el chat nuevo)
> Metodología gate‑heavy: por cada sub‑gate → diseño → OK explícito → build → kit de validación (SQL transaccional + E2E navegador) → commit aislado.
- **Fase 0 (pre):** commit aislado de Gate 2+3 (migraciones 0029/0030/0031 + lib/pedidos + UI pedidos) y de Sprint 2 si corresponde, con OK. Definir backup/push de `main`. Opcional: cerrar POST‑503 (adelgazar `revalidatePath`).
- **Fase 4A — Picking:** `0032` `confirm_picking` (alloc reservada→pickeada, línea→pickeado; **sin tocar stock**); UI `/wms/picking` (cola de `en_preparacion`, ruta por `warehouse_position`, confirmación SKU/lote); `src/lib/picking/*`. *(Opcional `picking_runs` para waves.)* Riesgo BAJO.
- **Fase 4B — Packing:** `0033` `packing_units`+`packing_unit_items` + `packing_status_t` + `confirm_packing` (alloc→empacada; pedido→preparado); UI `/wms/packing` (bultos/etiquetado). Riesgo MEDIO. Dep 4A.
- **Fase 4C — Despacho + Entrega:** ✅ **VALIDADO + CERRADO** (`0035`, `841f85b`, 14/14 OK). `shipments` + `shipment_status_t` + `confirm_dispatch` (**EGRESO** sobre `stock_reserved` + **`inventory_lots-=q` FEFO real**; ledger `egreso` por lote) + `confirm_delivery` + `revert_dispatch` (reingreso compensatorio) + `wms_dispatch_recompute`. UI `/wms/despachos`. `confirm_movement` **intacto** (no se reutiliza). D1–D6 resueltos; prerrequisito `anular_packing_unit` ✅ (4B.1).
- **Decisiones a confirmar antes de 4A:** (1) `picking_runs`/waves sí/no; (2) picking por línea vs parcial de allocations; (3) un `shipment` por pedido vs consolidar varios; (4) `lots--` con `lot_number` null (ítems sin lote) — manejo; (5) entrega manual vs disparada por Tracking.

## 13. FUNCIONALIDADES FUTURAS YA APROBADAS
**GATE 5 (PLANIFICADO — NO IMPLEMENTAR EN GATE 4): Cadena de Custodia Digital (requerimiento Mercado Libre).**
- **Recepción:** captura fotográfica, evidencia visual, estado inicial.
- **Identificación:** **QR único por unidad** + ID único por unidad.
- **Almacenamiento:** trazabilidad completa por unidad.
- **Despacho:** nueva fotografía, **comparación visual** ingreso vs salida, evidencia de daños.
- **Auditoría:** historial completo (fotos ingreso/salida, QR, fecha, usuario).
- Reservado para etapa posterior; **no implementar durante Gate 4**.
**Otras decididas:** Digital Twin v2 (`0028`, bloqueado por matriz de Dirección); Dashboard ejecutivo consolidado; CRM/Clientify avanzado; evolución Tracking (geofences/eventos).

## 14. REGLAS DE TRABAJO DEL PROYECTO
1. Antes de modificar código: **leer código real → analizar → diagnóstico (con evidencia de ejecución real) → plan → esperar aprobación.** No asumir.
2. **No deploy, no push, no commit** automáticos. Solo con instrucción explícita. `main` se mantiene local hasta decisión de Martín.
3. **Plan antes de código**, una fase por vez (gate‑heavy). Cambios **aditivos**; no romper/migrar en masa.
4. **Validación antes de cerrar** (caso de prueba / lectura de estado real / build verde). Reportar con honestidad (no afirmar "validado" sin evidencia).
5. **No tocar módulos validados** sin autorización (Cockpit, Compras, Tracking, WMS v1, Recepciones, Inventario, Pedidos, etc.).
6. **Commits aislados por módulo/feature** (no mezclar dominios). No commitear secretos.
7. **DB:** migraciones numeradas/secuenciales/idempotentes, aplicadas a mano por Martín en el SQL Editor (el asistente no ejecuta WRITES vía Management API; reads OK). Inmutabilidad/auditoría no‑negociables; stock solo vía RPC.
8. **Mutaciones front:** Server Actions + `revalidatePath()`; evitar `router.refresh()` salvo justificación fuerte.
9. Idioma: español rioplatense. Reportar con precisión verificable.

## 15. RESUMEN FINAL PARA NUEVO CHAT (≤2 páginas)
Sos un asistente de ingeniería en **TOPS NEXUS**, ERP/OS vertical de **Logística TOPS (VEROTIN S.A.)**, en `~/CODE/tops-ordenes` (Next.js 14 App Router + TS + Tailwind `nx-*` + Supabase `arsksytgdnzukbmfgkju` + Netlify). Usuario: **Martín Battaglia, presidente**. Español rioplatense.

**Estado:** Gates 1‑3 completos y validados; **Gate 4 (Picking/Packing/Despacho) abierto en diseño** (sin implementar). Gate 5 (Cadena de Custodia Digital / Mercado Libre: fotos recepción+despacho, QR por unidad, auditoría visual) **planificado, NO tocar en Gate 4**.

**Lo que funciona:** Recepciones (confirm_reception, ANMAT, cuarentena; Caso 1 validado, Casos 2‑6 con kit sin correr), Inventario/Lotes/Vencimientos (FEFO, semáforo, CSV), **Pedidos + Reservas** (allocate_order FEFO + parcial + idempotente; cobertura/trazabilidad; UI auto‑refresca). E2E de reservas validado con `Test-general-001`/`G-001` (reserva total 60 y parcial 40=67% con depleción; liberar/cancelar OK; G‑001 quedó 100/0).

**Arquitectura clave:** stock **solo** se escribe vía **RPC `SECURITY DEFINER`** (RLS lockdown); ledger `inventory_movements` **append‑only por trigger**; reservas en **`stock_allocations`** (no `stock_reserved` plano); cliente = `client_name text`; **FEFO a nivel ítem** (split por lote pendiente); mutaciones = **Server Actions + `revalidatePath()`** (NO `router.refresh()`). Modelo físico 6 niveles `warehouses→floors→sectors→zones→racks→positions`.

**DB:** migraciones `0001`–`0027` + `0029`/`0030`/`0031` aplicadas (`0012` no existe; `0028` reservado a Twin v2 bloqueado). RPC: `confirm_reception`, `release_quarantine`, `confirm_movement` (egreso listo; despacho con TODO; **no decrementa lots**), `allocate_order`, `release_allocation`, `cancel_order`. Enums de Gate 4 (`pickeado/empacado/despachado`, `pickeada/empacada/despachada`, `preparado/despachado/entregado`) **ya congelados** en `0030`.

**Gate 4 (a hacer, gate‑heavy, migraciones `0032`+):** 4A Picking (`confirm_picking`, UI ruta por posición; sin stock) → 4B Packing (`packing_units`/`_items`, `confirm_packing`) → 4C Despacho+Entrega (`shipments`, `confirm_dispatch` con **EGRESO real + `inventory_lots.quantity--` FEFO** + `stock_reserved→0`, `confirm_delivery`, extender `confirm_movement` para validar `despacho`). Riesgo alto en 4C (egreso irreversible). Confirmar antes: waves, picking parcial, consolidación de despacho, lot null, entrega manual vs Tracking.

**Incidentes abiertos:** `main` sin commitear/push (Gates 2/3 + Sprint 2) → **commit aislado pendiente**; POST‑503 residual no‑fatal (revalidación bajo `next start` single‑instance); Casos 2‑6 recepciones sin correr; DEV/PROD misma DB; FEFO split por lote (cierra 4C).

**Reglas:** leer→analizar→diagnóstico con evidencia→plan→**esperar aprobación**; **no commit/push/deploy** sin orden explícita; cambios aditivos; no tocar lo validado; migraciones a mano por Martín (el asistente no ejecuta WRITES en Supabase; reads OK); validar antes de cerrar; honestidad técnica.

**Primera acción sugerida en el chat nuevo:** leer `docs/handoff/` (`MASTER_HANDOFF.md`, `FASE_9B_DESIGN.md`, `FASE_9B_GATE2_DESIGN.md`, `WMS_HANDOFF.md`, `PROJECT_STATUS_CURRENT.md`), confirmar `git status`, y proponer **el plan de Gate 4A (Picking)** + responder las 5 decisiones, sin tocar código hasta aprobación.
