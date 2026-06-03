# TOPS NEXUS — WMS Phase Closure Handoff (Gate 4A + Gate 4B)

> Cierre administrativo de la fase WMS antes de abrir Gate 4C (Despacho + Entrega).
> Generado 2026-06-03. Fuente de verdad para el handoff. Sin desarrollo nuevo.
> Verificado contra repo (`main` @ `c5390bd`, ahead 22) y migraciones `0001`–`0033`.

---

## 1. Estado general

### Gates completados (commiteados y validados)
| Gate | Módulo | Commit | Estado |
|---|---|---|---|
| Gate 4A | Picking | `17b0be5` | ✅ Cerrado · SQL+TS+UI+E2E+kit validación |
| Gate 4B | Packing | `c5390bd` | ✅ Cerrado · SQL+TS+UI+E2E 12/12+kit validación |

### Gates / fases previas (estado)
- **Recepciones (Gate 1)** · **Inventario+Ledger (Gate 2)** · **Pedidos+Reserva (Gate 3)**: funcionalmente **validados** y **aplicados en DB**, pero **SIN commitear** en git (ver §Deuda/Riesgos y `GIT_RECOVERY_CHECKLIST.md`).
- **FASE 9A (Lotes/Vencimientos)**: commiteada (`7aa9e52`).
- **Digital Twin físico (0020-0023)**: commiteado.

### Gates pendientes
- **Gate 4C — Despacho + Entrega**: NO iniciado. Es el primer gate que toca stock/ledger de forma **irreversible** (egreso). Decisiones abiertas en `GATE_4C_DECISIONS.md`.
- **Gate 5 — Cadena de Custodia Digital** (QR por unidad, evidencia fotográfica, auditoría visual): planificado, no iniciado. `packing_units` es la entidad física canónica reservada para esto.

### Riesgos abiertos (resumen — detalle en docs específicos)
1. **🔴 CRÍTICO — Cadena de migraciones partida en git:** `0032`/`0033` (commiteadas) dependen de `0025/0026/0027/0029/0030/0031` (**sin commitear**). Un clon limpio de `main` compila picking/packing pero las migraciones base no están versionadas. Mitigación: commit aislado de Gates 1/2/3 (Fase 0 pendiente).
2. **🟠 `main` sin push** (ahead 22 de `origin/main`) — sin respaldo remoto de Gates 4A/4B. Existe rama `backup/main-pre-fullmerge-20260530` (anterior a esta fase).
3. **🟠 DEV/PROD comparten la misma DB** Supabase (`arsksytgdnzukbmfgkju`). Las pruebas E2E dejan footprint (pedidos cancelados, bultos vacíos, filas `audit_log`).
4. **🟡 Gaps de numeración de migraciones:** `0012` y `0028` no existen (huecos intencionales: `0028` reservado a Digital Twin v2, bloqueado).

### Deuda técnica registrada
- `anular_packing_unit()` — no existe RPC de anulación; un **bulto vacío abierto** no se puede cerrar (`close` exige ≥1 ítem) ni anular → queda "trabado" y oculta "Empacar todo" (D2). Candidata a **4B.1 o 4C**. (Chip de tarea creado.)
- **Footprint de demos E2E** en DB compartida: pedidos `TEST_*`/cancelados + bultos vacíos colgados + filas `picking.*`/`packing.*` en `audit_log` (append-only, no se borran).
- **Casos 2‑6 de Recepciones**: kit `wms_validation_kit_casos_2-6.sql` sin correr.
- **POST‑503 residual** (revalidación inline bajo `next start` single‑instance): no‑fatal.

---

## 2. Gate 4A — Picking (resumen ejecutivo)

- **Objetivo:** confirmar el retiro físico de la mercadería reservada y dejar el pedido listo para empacar. Transiciones `stock_allocations`: `reservada → pickeada`; línea `reservado → pickeado`. **No** avanza el header del pedido (queda `en_preparacion`).
- **SQL (`0032_wms_picking.sql`):** RPC `confirm_picking(allocation)`, `confirm_picking_order(order)`, `unpick_allocation(allocation)` + helper interno `wms_pick_recompute_line`. SECURITY DEFINER, authz `admin/operaciones/supervisor`, cast explícito a enum. **No** toca stock/ledger/`inventory_lots`. Hook `audit_log` (`picking.confirm`/`picking.unpick`).
- **TS (`src/lib/picking/{types,picking}.ts`):** `PhysicalLocation` (jerarquía canónica), `listPickQueue`, `listPickRoute` (ruta por ubicación física), wrappers RPC. Mutaciones **solo** vía RPC.
- **UI (`/wms/picking`, `/wms/picking/[id]`):** cola + ruta por ubicación física con columna de prioridad; acciones Pickear/Deshacer/Pickear todo. Server Actions + `revalidatePath()`, sin `router.refresh()`.
- **Validaciones:** kit `gate4a_picking_validation_report.sql` (25 filas, todas OK, 0 footprint) + E2E visual.
- **Commit:** `17b0be5` `feat(wms): Gate 4A Picking` (10 archivos).
- **Estado final:** ✅ CERRADO.

---

## 3. Gate 4B — Packing (resumen ejecutivo)

- **Objetivo:** consolidar lo pickeado en **unidades logísticas (bultos)** y dejar el pedido `preparado`. Transiciones `stock_allocations`: `pickeada → empacada`; línea `pickeado → empacado`; pedido `en_preparacion → preparado` (derivado).
- **SQL (`0033_wms_packing.sql`):** tablas `packing_units` (`BLT-` por trigger) + `packing_unit_items` (`unique(allocation_id)` = 1 reserva → 1 bulto); enum `packing_status_t('abierta','cerrada','despachada','anulada')`; RPC `create_packing_unit`, `pack_allocation`, `unpack_allocation`, `close_packing_unit`, `reopen_packing_unit`, `confirm_packing_order` + helper `wms_pack_recompute`. **No** toca stock/ledger/`inventory_lots`. Hooks `audit_log` (`packing.create/pack/unpack/close/reopen`).
- **TS (`src/lib/packing/{types,packing}.ts`):** `listPackQueue`, `listPackBoard` (paradas + bultos), 6 wrappers RPC. **Reusa** `PhysicalLocation` de Picking (sin duplicar ni modificar Gate 4A).
- **UI (`/wms/packing`, `/wms/packing/[id]`):** cola + tablero de armado (bulto activo, empacar/quitar/cerrar/reabrir, Empacar todo con regla D2). KPIs por línea + Bultos armados. Server Actions + `revalidatePath()` (incluye `/wms/picking`), sin `router.refresh()`.
- **Validaciones:** kit `gate4b_packing_validation_report.sql` (12 casos, todas OK, 0 footprint) + E2E visual 12/12 + evidencia de red (1 `POST` revalidatePath, sin `?_rsc`).
- **Incidencia resuelta en E2E:** embed PostgREST anidado profundo en `listPackBoard.units` no parseaba → corregido a consulta **shallow** + mapa de allocations.
- **Commit:** `c5390bd` `feat(wms): Gate 4B Packing` (10 archivos).
- **Estado final:** ✅ CERRADO.

---

## 4. Arquitectura actual del flujo WMS

```
Recepción ──► Reserva ──► Picking ──► Packing ──► Despacho ──► Entrega
 (0025/0027) (0030/0031) (0032)      (0033)      (PENDIENTE)  (PENDIENTE)
 confirm_     allocate_   confirm_    pack_       confirm_     confirm_
 reception    order       picking     allocation  dispatch     delivery
                                                  (Gate 4C)    (Gate 4C)
```

| Etapa | Estado allocation | Estado línea | Estado pedido | Stock |
|---|---|---|---|---|
| Recepción | — | — | — | available/reserved ↑ (ingreso, ledger) |
| Reserva | reservada | reservado/parcial | en_preparacion | available → reserved (shift) |
| Picking | pickeada | pickeado | en_preparacion | **sin cambios** |
| Packing | empacada | empacado | preparado | **sin cambios** |
| Despacho (4C) | despachada | despachado | despachado | **EGRESO** reserved→0 + `inventory_lots--` (ledger) |
| Entrega (4C) | despachada | despachado | entregado | sin cambios |

---

## 5. Invariantes del sistema (explícitos)

1. **Picking NO toca stock.** `confirm_picking`/`confirm_picking_order`/`unpick_allocation` solo cambian `stock_allocations.status` y el estado de línea. Cero escrituras en `inventory_items`, `inventory_lots`, `inventory_movements`. (Validado: kit 4A casos NO-STOCK/NO-LEDGER + E2E.)
2. **Packing NO toca stock.** Idem para las 6 RPC de `0033`. La mercadería sigue en el bucket `reservado`. (Validado: kit 4B + E2E inventario 100/0 restaurado.)
3. **`inventory_movements` es la única fuente de verdad del stock físico** (ledger append-only, inmutable por trigger; bloquea UPDATE/DELETE/TRUNCATE incluso a `service_role`). El egreso real recién ocurre en Gate 4C.
4. **`stock_allocations` gobierna los estados operativos.** Picking/Packing operan sobre allocations; el resto (líneas, pedido, bultos) se **deriva** de ellas.
5. **Los roll-ups son derivados, nunca fuente primaria.** `wms_pick_recompute_line` y `wms_pack_recompute` calculan estado de línea/pedido a partir del conjunto de allocations; no se persisten flags independientes. Invariante despacho-seguro documentado en `0033` (no degradan pedidos/líneas despachados).
6. **Toda escritura de stock/reservas/picking/packing pasa por RPC SECURITY DEFINER** (RLS lockdown: las tablas son solo-lectura para roles; el front nunca escribe directo).
7. **Mutaciones de UI = Server Actions + `revalidatePath()`**, nunca `router.refresh()` (evita la carrera `?_rsc` → 503).

---

## 6. Deuda técnica (registro consolidado)

| Ítem | Descripción | Severidad | Destino |
|---|---|---|---|
| `anular_packing_unit()` | No hay RPC de anulación; bulto vacío abierto queda trabado (no cierra, no anula) | Media | 4B.1 / 4C |
| Bultos vacíos en demo | Demos E2E dejan `BLT-*` vacíos colgados de pedidos cancelados | Baja | limpieza manual o `anular` |
| Cadena migraciones git | `0032/0033` commiteadas dependen de `0025-0031` sin commitear | **Alta** | Fase 0 (commit Gates 1/2/3) |
| `main` sin push | Gates 4A/4B sin respaldo remoto | Media | push tras consolidar |
| Casos 2‑6 Recepciones | Kit sin correr | Baja | validación pendiente |
| FEFO split por lote | `inventory_lots.quantity--` por lote difiere a 4C | Media | Gate 4C |
| POST‑503 residual | Revalidación inline single-instance | Baja | revisar en deploy |

Ver detalle operativo en: `WMS_ARCHITECTURE_SNAPSHOT_20260603.md`, `GATE_4C_DECISIONS.md`, `SUPABASE_BACKUP_CHECKLIST.md`, `GIT_RECOVERY_CHECKLIST.md`.
