# TOPS NEXUS — WMS Architecture Snapshot (2026-06-03)

> Foto del modelo WMS al cierre de Gate 4B. Solo documentación (sin cambios).
> Fuente: migraciones `0001`–`0033` en `supabase/migrations/`.

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

**Packing (0033)**
- `packing_units` — `public_id 'BLT-'`, `order_id, label, unit_type, status, weight_kg, notes, active`.
- `packing_unit_items` — `packing_unit_id, allocation_id, quantity`. CHECK `quantity > 0`. **`unique(allocation_id)`** (1 reserva → 1 bulto).

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

> **Nota:** los estados `despachado/despachada` (línea/alloc/packing) y `entregado` (pedido) ya están **congelados** pero los consume **Gate 4C** (aún sin RPC que los setee).

### 1.3 RPC existentes (SECURITY DEFINER · authz admin/operaciones/supervisor)

#### Recepción (0027)
- `confirm_reception(p_reception_id)` — **Entrada:** recepción pendiente/en_recepcion/cuarentena. **Salida:** crea/actualiza `inventory_items` + `inventory_lots`, escribe `inventory_movements` (ingreso), marca ítems recibido/cuarentena. **Responsabilidad:** único ingreso de stock. **Invariante:** stock entra a `available` (o `reserved` si cuarentena); ledger registra before/after.
- `release_quarantine(p_reception_id)` — **Entrada:** recepción en cuarentena. **Salida:** `reserved → available`, movimiento `ajuste`. **Invariante:** total sin cambio (solo bucket).
- `confirm_movement(item, type, to_pos, qty, ...)` — traslado/ajuste/egreso. **Invariante:** valida referencia; el `egreso` **no decrementa `inventory_lots`** todavía (se completa en 4C); `'despacho'` con TODO.

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

---

## 2. Flujo completo actual

```
                 ┌──────────────────────────────────────────────────────┐
                 │              inventory_movements (LEDGER)             │
                 │         append-only · inmutable · fuente de verdad    │
                 └──────────────────────────────────────────────────────┘
                        ▲ ingreso                         ▲ egreso (4C)
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
                                                          │  DESPACHO (Gate 4C)  │  ◄── PENDIENTE
                                                          │  confirm_dispatch    │
                                                          │  EGRESO real:        │
                                                          │  reserved→0 +        │
                                                          │  inventory_lots-- +  │
                                                          │  ledger (egreso) +   │
                                                          │  status: despachada  │
                                                          └──────────┬───────────┘
                                                                     ▼
                                                          ┌──────────────────────┐
                                                          │  ENTREGA (Gate 4C)   │  ◄── PENDIENTE
                                                          │  confirm_delivery    │
                                                          │  pedido: entregado   │
                                                          └──────────────────────┘
```

---

## 3. Riesgos conocidos

1. **Cadena de migraciones partida en git** (0032/0033 vs 0025-0031 sin commitear) — `GIT_RECOVERY_CHECKLIST.md`.
2. **DEV/PROD misma DB** — cualquier prueba impacta producción; usar kits con rollback (0 footprint).
3. **`confirm_movement` no decrementa `inventory_lots`** — el egreso real y el FEFO por lote son responsabilidad de Gate 4C (extender la RPC).
4. **`cancel_order` no libera allocations pickeada/empacada** — operativamente hay que revertir (unpack→unpick) antes de cancelar.
5. **Bulto vacío trabado** (sin `anular_packing_unit`).
6. **Gaps de numeración** `0012`/`0028` (intencionales).

---

## 4. Próximos pasos

1. **Fase 0 (higiene):** commit aislado de Gates 1/2/3 (0025-0031 + código) para reparar la cadena de migraciones; backup/push de `main`.
2. **Gate 4C (diseño):** `shipments` + `shipment_status_t`; `confirm_dispatch` (EGRESO + `inventory_lots--` FEFO + `reserved→0`), `confirm_delivery`; extender `confirm_movement` para `'despacho'`. Resolver decisiones D1-D6 (`GATE_4C_DECISIONS.md`).
3. **Deuda:** `anular_packing_unit` (4B.1/4C); correr casos 2-6 Recepciones.
4. **Gate 5:** cadena de custodia digital sobre `packing_units`.
