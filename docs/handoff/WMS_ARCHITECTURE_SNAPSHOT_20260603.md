# TOPS NEXUS — WMS Architecture Snapshot (2026-06-03)

> Foto del modelo WMS **al cierre de Gate 4C** (Despacho + Entrega). Solo documentación (sin cambios).
> Actualizado 2026-06-03 tras Gate 4C VALIDADO + CERRADO (`0035`, 14/14 OK) y Mini-Gate 4B.1 (`0034`).
> Fuente: migraciones `0001`–`0035` en `supabase/migrations/`.

---

## 1. Modelo WMS actual

### 1.1 Entidades de dominio

**Modelo físico (Digital Twin · 0020-0023)** — 6 niveles:
`warehouses → warehouse_floors → warehouse_sectors → warehouse_zones → warehouse_racks → warehouse_positions`
`warehouse_positions.id` = clave de integración con inventario/picking/packing.

**Inventario (0024)**
- `inventory_items` — `id, sku, description, client_name, position_id, stock_available, stock_reserved, active`. Identidad única `(client_name, sku, position_id)`.
- `inventory_lots` — `id, inventory_item_id, lot_number, expiration_date, quantity, active`. Identidad única `(inventory_item_id, lot_number, expiration_date)`.

**Ledger (0026)**
- `inventory_movements` — append-only inmutable (trigger). `movement_type, inventory_item_id, lot_number, quantity, before_quantity, after_quantity, from_position_id, to_position_id, reason, notes, reference_type, reference_id, created_by, created_at`.

**Recepciones (0025)**
- `receptions` — `public_id 'REC-'`, `client_name, business_unit, status, requires_quarantine, received_at`.
- `reception_items` — `sku, description, quantity, position_id, lot_number, expiration_date, status, inventory_item_id`. CHECK ANMAT (lote+vencimiento).

**Pedidos + Reserva (0030)**
- `logistics_orders` — `public_id 'PED-'`, `client_name, customer_ref, status, priority, requested_date, notes, active`.
- `logistics_order_items` — `order_id, sku, description, quantity_requested, lot_constraint, status`. CHECK `quantity_requested > 0`.
- `stock_allocations` — ledger de reservas. `order_item_id, inventory_item_id, lot_number, quantity, status, reserved_at, released_at`. FK `inventory_item` RESTRICT. CHECK `quantity > 0`.

**Packing (0033 + 0034)**
- `packing_units` — `public_id 'BLT-'`, `order_id, label, unit_type, status, weight_kg, notes, active, shipment_id` (FK a `shipments`, agregada en 0035).
- `packing_unit_items` — `packing_unit_id, allocation_id, quantity`. CHECK `quantity > 0`. **`unique(allocation_id)`** (1 reserva → 1 bulto).
- **Mini-Gate 4B.1 (0034):** RPC `anular_packing_unit` (`abierta` vacío → `anulada`). Sin tablas/enum nuevos.

**Despacho + Entrega (0035) — Gate 4C ✅ CLOSED**
- `shipments` — cabecera de despacho, `public_id 'DSP-'`. 1 por pedido (índice parcial `unique(order_id) where status<>'anulado'`). Campos: `order_id, status, carrier, vehicle_ref, tracking_ref, dispatched_at/by, delivered_at/by, received_by_name, reverted_at/by, notes, active`. RLS lockdown (escritura solo vía RPC).

**Auditoría (0001)**
- `audit_log` — append-only. `ts, user_id, entity, entity_id, action, payload(jsonb), ip`. Mecanismo único de auditoría de picking/packing.

### 1.2 Estados (enums vigentes)

| Enum | Valores | Migración |
|---|---|---|
| `warehouse_type_t` | general, anmat, mixed | 0020 |
| `warehouse_position_status_t` | disponible, reservado, ocupado, mantenimiento | 0020 |
| `warehouse_sector_type_t` | almacenamiento, recepcion, despacho, picking, cuarentena, oficinas, servicios | 0020 |
| `warehouse_zone_type_t` | almacenamiento, picking, recepcion, despacho, cuarentena, refrigerado | 0020 |
| `business_unit_t` | ANMAT, GENERAL, CORPORATE (s/ uso) | 0025 |
| `reception_status_t` | borrador, pendiente, en_recepcion, cuarentena, recibida, anulada | 0025 |
| `reception_item_status_t` | pendiente, recibido, cuarentena | 0025 |
| `movement_type_t` | ingreso, traslado, egreso, ajuste | 0026 |
| `movement_reference_t` | recepcion, movimiento, ajuste, despacho | 0026 |
| `logistics_order_status_t` | borrador, pendiente, en_preparacion, preparado, despachado, entregado, cancelado | 0030 |
| `order_item_status_t` | pendiente, reservado, reservado_parcial, pickeado, empacado, despachado, cancelado | 0030 |
| `alloc_status_t` | reservada, pickeada, empacada, despachada, liberada | 0030 |
| `packing_status_t` | abierta, cerrada, despachada, anulada | 0033 |
| `shipment_status_t` | despachado, entregado, anulado | 0035 |

> **Nota (actualizada 2026-06-03):** los estados `despachado/despachada` (línea/alloc/packing), `entregado` (pedido) y `anulado` (shipment) están **vivos y validados**: los setean las RPC de **Gate 4C (0035)** — ver §1.3 Despacho.

### 1.3 RPC existentes (SECURITY DEFINER · authz admin/operaciones/supervisor)

#### Recepción (0027)
- `confirm_reception(p_reception_id)` — **Entrada:** recepción pendiente/en_recepcion/cuarentena. **Salida:** crea/actualiza `inventory_items` + `inventory_lots`, escribe `inventory_movements` (ingreso), marca ítems recibido/cuarentena. **Responsabilidad:** único ingreso de stock. **Invariante:** stock entra a `available` (o `reserved` si cuarentena); ledger registra before/after.
- `release_quarantine(p_reception_id)` — **Entrada:** recepción en cuarentena. **Salida:** `reserved → available`, movimiento `ajuste`. **Invariante:** total sin cambio (solo bucket).
- `confirm_movement(item, type, to_pos, qty, ...)` — traslado/ajuste/egreso de **stock disponible** (`stock_available`). **Intacto:** Gate 4C **NO** lo reutiliza para despacho (su rama `egreso` opera sobre `available`, no `reserved` — hallazgo L1). El egreso de despacho + FEFO por lote vive en `confirm_dispatch` (0035).

#### Reserva (0031)
- `allocate_order(p_order_id)` — **Entrada:** pedido pendiente/en_preparacion. **Salida:** reserva FEFO (parcial habilitada, idempotente): `available → reserved` + fila `stock_allocations` por (cliente, sku) ordenado por vencimiento. **NO** escribe ledger. Pedido → `en_preparacion`. **Invariante:** `stock_reserved = Σ allocations 'reservada' + cuarentena`.
- `release_allocation(p_allocation_id)` — libera una reserva: `reserved → available`, allocation → `liberada`, recalcula línea.
- `cancel_order(p_order_id)` — cancela pedido y libera **todas** las reservas `reservada`. **Limitación:** no libera allocations `pickeada`/`empacada` (deben revertirse antes).

#### Picking (0032)
- `confirm_picking(p_allocation_id)` — `reservada → pickeada`; roll-up línea → `pickeado`; audit. **NO** toca stock/ledger. **Entrada:** allocation `reservada`. **Salida:** allocation `pickeada`.
- `confirm_picking_order(p_order_id)` — pickea todas las `reservada` del pedido (idempotente). Exige pedido `en_preparacion`.
- `unpick_allocation(p_allocation_id)` — `pickeada → reservada`; forward-guard si línea `empacado/despachado/cancelado`.
- `wms_pick_recompute_line(uuid)` — helper interno (REVOKE public/authenticated): deriva estado de línea.

#### Packing (0033)
- `create_packing_unit(p_order_id, p_label, p_unit_type)` → uuid — abre bulto `abierta`. Exige pedido `en_preparacion`.
- `pack_allocation(p_packing_unit_id, p_allocation_id)` — `pickeada → empacada`; inserta `packing_unit_items`; roll-up línea → `empacado`, pedido → `preparado`. Integridad: la reserva debe pertenecer al pedido del bulto. **NO** toca stock.
- `unpack_allocation(p_allocation_id)` — `empacada → pickeada`; exige bulto `abierta`; forward-guard `despachado/cancelado`.
- `close_packing_unit(p_packing_unit_id)` — `abierta → cerrada` (exige ≥1 ítem).
- `reopen_packing_unit(p_packing_unit_id)` — `cerrada → abierta` (bloquea `despachada`).
- `confirm_packing_order(p_order_id)` — crea bulto, empaca todo lo `pickeada`, cierra, pedido → `preparado`. Idempotente (no-op si no hay pickeadas). Serializado por `FOR UPDATE` del pedido (no duplica BLT).
- `wms_pack_recompute(uuid)` — helper interno (REVOKE public/authenticated): deriva estado línea (pickeado↔empacado) + pedido (en_preparacion↔preparado). Invariante despacho-seguro.

#### Cancelación de bulto (0034 · Mini-Gate 4B.1)
- `anular_packing_unit(p_packing_unit_id)` — `abierta` (VACÍO) → `anulada` + `active=false`. Guard de vacío duro (cero-touch de `stock_allocations`). Roll-up-neutral. Audit `packing.cancel`.

#### Despacho + Entrega (0035 · Gate 4C — ✅ VALIDADO 14/14)
- `confirm_dispatch(p_order_id)` → uuid (shipment) — **PRIMER EGRESO IRREVERSIBLE.** Whole-order atómico. **Guards:** pedido `preparado` · **D1=A** todos los bultos `cerrada` (sin `abierta`) · ≥1 allocation `empacada` · unicidad de shipment vigente. **Efecto:** crea `shipments` (`DSP-`, `despachado`); por allocation egresa **FEFO real** sobre `inventory_lots` (multi-lote; guard de consistencia `Σ lotes ≥ cantidad`); decrementa **`stock_reserved`** (NO `available`); escribe **`inventory_movements` `egreso` por lote** (`reference_type='despacho'`, `reference_id=shipment`); allocations→`despachada`, bultos `cerrada`→`despachada`(+`shipment_id`); roll-up líneas→`despachado`, pedido→`despachado`. D3=C: sin lote → solo `stock_reserved`, egreso `lot_number=null`.
- `confirm_delivery(p_shipment_id, p_received_by)` — `despachado → entregado` (`delivered_at/by`, `received_by_name`); pedido → `entregado`. **Sin stock.**
- `revert_dispatch(p_shipment_id)` — **reversión compensatoria** de un despacho NO entregado: lee los `egreso` del ledger y escribe **`ingreso` nuevos** (`reason='reversion_despacho'`) — **jamás** UPDATE/DELETE; restituye `stock_reserved`+`inventory_lots`; allocations→`empacada`, bultos→`cerrada` (desvincula), pedido→`preparado`, shipment→`anulado`. Re-despachable.
- `wms_dispatch_recompute(uuid)` — helper interno (REVOKE public/authenticated): deriva línea (`empacado↔despachado`) + pedido (`preparado↔despachado↔entregado`) de allocations + shipment. Despacho-seguro.

---

## 2. Flujo completo actual

```
                 ┌──────────────────────────────────────────────────────┐
                 │              inventory_movements (LEDGER)             │
                 │         append-only · inmutable · fuente de verdad    │
                 └──────────────────────────────────────────────────────┘
                        ▲ ingreso / reingreso compensatorio   ▲ egreso (4C ✅)
                        │                                 │
   Recepción ──confirm_reception──► Inventario ──allocate_order──► Reserva
   (0025/0027)                      (0024)                         (0030/0031)
        │                                                              │
        │                                                   stock_allocations
        │                                                   status: reservada
        ▼                                                              ▼
   [stock_available/reserved ↑]                              confirm_picking (0032)
                                                                       │
                                                              status: pickeada
                                                                       ▼
                                                              pack_allocation (0033)
                                                                       │
                                                              status: empacada
                                                              packing_units (bultos)
                                                                       ▼
                                                          ┌──────────────────────┐
                                                          │  DESPACHO (Gate 4C ✅)│  confirm_dispatch
                                                          │  EGRESO real:        │  (0035)
                                                          │  stock_reserved-- +  │  ◄── revert_dispatch
                                                          │  inventory_lots-- +  │      (reingreso
                                                          │  ledger (egreso/lote)│       compensatorio)
                                                          │  status: despachada  │
                                                          │  + shipments (DSP-)  │
                                                          └──────────┬───────────┘
                                                                     ▼
                                                          ┌──────────────────────┐
                                                          │  ENTREGA (Gate 4C ✅) │  confirm_delivery
                                                          │  shipment: entregado │  (sin stock)
                                                          │  pedido: entregado   │
                                                          └──────────────────────┘
```

> **Gate 4C VALIDADO y CERRADO (2026-06-03):** `0035` aplicada; `gate4c_dispatch_validation_report.sql`
> **14/14 OK** (FEFO real, egreso sobre `stock_reserved`, ledger append-only, reversión compensatoria,
> D1=A, guards de autorización). Próximo: **Gate 5 — Cadena de Custodia** (QR + fotos + POD + firma) sobre
> `packing_units` / `shipments`.

---

## 3. Riesgos conocidos

1. ~~**Cadena de migraciones partida en git**~~ ✅ **RESUELTO** — `0025`–`0035` versionadas; `main` ↔ `origin/main` (commits `547f6eb` 4B.1 / `841f85b` 4C).
2. **DEV/PROD misma DB** — 🟠 **VIGENTE.** Cualquier prueba impacta producción; usar kits con rollback (0 footprint). **PITR NO habilitado** → backup manual previo + `revert_dispatch` como red primaria ante egresos erróneos.
3. ~~**`confirm_movement` no decrementa `inventory_lots`**~~ ✅ **RESUELTO** — el egreso + FEFO por lote vive en `confirm_dispatch` (0035); `confirm_movement` queda intacto (no se reutiliza).
4. **`cancel_order` no libera allocations pickeada/empacada/despachada** — 🟠 **VIGENTE.** Hay que revertir (`revert_dispatch`→`unpack`→`unpick`) antes de cancelar.
5. ~~**Bulto vacío trabado**~~ ✅ **RESUELTO** — `anular_packing_unit` (0034, Mini-Gate 4B.1).
6. **Gaps de numeración** `0012`/`0028` (intencionales) — informativo.

---

## 4. Próximos pasos

1. ~~Fase 0 (higiene) / Gate 4C~~ ✅ **COMPLETADO** — cadena versionada hasta `0035`; Gate 4C VALIDADO y CERRADO.
2. **Deuda menor pendiente:** capa TS/UI del botón "Anular" de 4B.1 (no bloqueante); correr casos 2‑6 de Recepciones.
3. **Gate 5 — Cadena de Custodia Digital** (QR por `packing_unit`/`shipment`, evidencia fotográfica, firma del receptor, POD, timeline, auditoría) sobre `packing_units` / `shipments`. Diseño: `GATE_5_CHAIN_OF_CUSTODY_DESIGN.md`. **NO iniciar implementación.**
4. **Operativo (antes de despachos reales):** evaluar habilitar PITR; mantener backup manual previo a cada sesión de egreso.
