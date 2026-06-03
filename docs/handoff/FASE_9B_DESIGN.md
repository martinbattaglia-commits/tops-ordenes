# TOPS Nexus — FASE 9B: Pedidos Logísticos + Reservas (DISEÑO TÉCNICO)

> Generado 2026-06-02. Continúa `FASE_9_DESIGN.md`. **NO es implementación.**
> Diseño para aprobación explícita antes de escribir código (regla §3, gate-heavy).
> Construye sobre FASE 9A (commit `7aa9e52`) y el núcleo Sprint 2 (`0024`–`0027`).

## 0. Alcance de 9B (y lo que NO entra)
**Entra:** cabecera/líneas de pedido + **reserva de stock** (`stock_allocations`) + RPC de reserva/liberación/cancelación + RBAC `pedidos` + UI del tablero de pedidos y alta.
**NO entra (fases siguientes):** Picking (9C), Packing (9C), Despacho/egreso real + `lots--` (9D), entrega + Tracking (9D). 9B deja el pedido **reservado** (stock en `stock_reserved`), listo para que 9C lo pickee.

Decisión de arquitectura ya tomada: **reserva vía `stock_allocations`** (ledger de reservas), NO `stock_reserved` plano.

---

## 1. Modelo de datos (migraciones `0029`+)

> ⚠️ `0028_facility_spaces.sql` queda **reservado** a Digital Twin v2 (bloqueado). 9B usa `0029`→`0031`.

### 1.1 `0029_pedidos_permission_module.sql` (AISLADA — patrón `0021`)
```sql
alter type public.permission_module_t add value if not exists 'pedidos';
```
Debe correrse y commitearse **sola** (Postgres no permite usar un valor de enum nuevo en la misma TX que el `ALTER TYPE`).

### 1.2 `0030_logistics_orders.sql` — tablas + enums + RLS
Enums (CREATE TYPE nuevo → seguro en la misma migración):
- `logistics_order_status_t`: `borrador · pendiente · en_preparacion · preparado · despachado · entregado · cancelado`.
- `order_item_status_t`: `pendiente · reservado · reservado_parcial · pickeado · empacado · despachado · cancelado`. *(9B solo usa hasta `reservado`/`reservado_parcial`; el resto lo consumen 9C/9D.)*
- `alloc_status_t`: `reservada · pickeada · empacada · despachada · liberada`. *(9B usa `reservada`/`liberada`.)*

**`logistics_orders`** (cabecera; patrón `receptions`):
| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `short_id` | int | `nextval(seq)` |
| `public_id` | text unique | `'PED-2026-0001'` por trigger |
| `client_name` | text not null | depositante (consistencia WMS — ver decisión #1) |
| `customer_ref` | text | n° de pedido del cliente |
| `status` | `logistics_order_status_t` | default `borrador` |
| `priority` | int | default 0 (orden de atención) |
| `requested_date` | date | fecha solicitada |
| `notes` | text | |
| `active` | boolean | default true |
| `created_at` / `created_by` | timestamptz / uuid | |

**`logistics_order_items`** (líneas):
| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `order_id` | uuid FK→logistics_orders | on delete cascade |
| `sku` | text not null | |
| `description` | text not null | |
| `quantity_requested` | numeric(14,3) not null | |
| `lot_constraint` | text | lote/vencimiento exigido (opcional) |
| `status` | `order_item_status_t` | default `pendiente` |
| `created_at` | timestamptz | |
- `quantity_allocated` / `picked` / `packed` se **derivan** de `stock_allocations` (no se persisten).

**`stock_allocations`** (reservas — bridge a inventario):
| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `order_item_id` | uuid FK→logistics_order_items | on delete cascade |
| `inventory_item_id` | uuid FK→inventory_items | on delete restrict |
| `lot_number` | text | lote reservado (trazabilidad FEFO) |
| `quantity` | numeric(14,3) not null | |
| `status` | `alloc_status_t` | default `reservada` |
| `created_at` / `created_by` | timestamptz / uuid | |
- Índices: `(order_item_id)`, `(inventory_item_id)`, `(status)`.

**RLS** (mismo patrón ERP): lectura `authenticated`; insert/update `admin/operaciones/supervisor`; delete `admin`. **Pero** `stock_allocations` y los buckets de stock se escriben **solo vía RPC** (ver §1.3): se hace lockdown de escritura directa a `stock_allocations` salvo RPC (igual que `inventory_movements`).

### 1.3 `0031_pedidos_functions.sql` — RPC transaccionales (`SECURITY DEFINER`)
Autorización en todas: `current_role() ∈ (admin,operaciones,supervisor)` o `RAISE insufficient_privilege`.

- **`allocate_order(p_order_id uuid)`** — reserva:
  1. Lock del pedido; valida estado ∈ (`pendiente`,`en_preparacion`).
  2. Por cada línea `pendiente`/`reservado_parcial`, calcula faltante = `quantity_requested − Σ allocations activas`.
  3. Busca `inventory_items` del `(client_name, sku)` con `stock_available > 0`, **ordenados FEFO** (por vencimiento más próximo de sus lotes). Reserva hasta cubrir el faltante:
     - `stock_available -= q`, `stock_reserved += q` (bucket shift, **NO** es movimiento físico → **NO** escribe `inventory_movements`).
     - inserta `stock_allocations(order_item_id, inventory_item_id, lot_number, q, 'reservada')`.
  4. Setea línea → `reservado` (cubierta) o `reservado_parcial` (faltó stock; ver decisión #2).
  5. Cabecera → `en_preparacion`.
- **`release_allocation(p_allocation_id uuid)`** — libera una reserva: `stock_reserved -= q`, `stock_available += q`, allocation → `liberada`, recalcula estado de la línea.
- **`cancel_order(p_order_id uuid)`** — libera TODAS las allocations activas del pedido (mismo bucket shift) y cabecera → `cancelado`.

**Invariante de coexistencia con cuarentena** (clave): la cuarentena (`0027 confirm_reception`) sube `stock_reserved` **sin** crear `stock_allocations`. Por lo tanto:
```
stock_reserved(ítem) = Σ stock_allocations activas del ítem  +  reservado_por_cuarentena
```
`allocate_order` solo reserva contra `stock_available` (lo cuarentenado nunca está disponible) → **no colisiona**. Una recepción en cuarentena no es reservable hasta `release_quarantine`.

---

## 2. Arquitectura E2E (lo que toca 9B)
```
logistics_orders (borrador → pendiente)
   │  allocate_order()
   ▼
RESERVADO: stock_available → stock_reserved · stock_allocations(reservada) · cabecera=en_preparacion
   │
   └─(9C) confirm_picking → (9C) confirm_packing → (9D) confirm_dispatch [EGRESO ledger + lots--] → (9D) entrega
```
- **Reutiliza:** `inventory_items` (buckets), `inventory_lots` (FEFO — vía `getLotInventory` de 9A como contrato de orden), patrón RPC/`current_role()`/lockdown de Sprint 2, patrón cabecera de `receptions`.
- **Crea:** 3 tablas, 3 enums, 3 RPC, permission `pedidos`, UI tablero/alta.
- **No toca** `inventory_movements` en 9B (la reserva es shift de bucket, no movimiento físico). El egreso real al ledger llega en 9D.

## 3. UI 9B (server components + GET forms, patrón 9A/recepciones)
- `/pedidos` — tablero: KPIs (por estado), filtros (cliente/estado), tabla con `RowActions` (reservar / cancelar).
- `/pedidos/nuevo` — alta cabecera + líneas (patrón `NewReceptionForm`).
- `/pedidos/[id]` — detalle: líneas, allocations (qué ítem/lote/posición reservó), botón **Reservar** (`allocate_order`) y **Liberar/Cancelar**.
- Capa TS nueva `src/lib/pedidos/{orders,allocations,types}.ts`.

## 4. Plan de validación (kit de casos, como Sprint 2 — SQL transaccional + rollback)
1. Reserva happy-path: pedido cubierto → líneas `reservado`, `stock_reserved` sube, `stock_available` baja, allocations creadas, **sin** filas en `inventory_movements`.
2. Stock insuficiente → `reservado_parcial` (o rechazo, según decisión #2).
3. FEFO: con 2 lotes del mismo SKU, reserva primero el de vencimiento más próximo.
4. Liberación/cancelación: revierte buckets, allocations → `liberada`.
5. Idempotencia: re-`allocate_order` no duplica reservas (descuenta lo ya reservado).
6. **Invariante cuarentena:** un ítem con stock en cuarentena no es reservable; `allocate_order` ignora `stock_reserved`.
7. Autorización: rol no habilitado → `insufficient_privilege`.

## 5. Riesgos 9B
- **Toca `stock_reserved`** (compartido con cuarentena) → mitigado por `stock_allocations` + invariante; validar con caso 6.
- **FEFO a nivel ítem, no lote** (los buckets son por ítem; `inventory_lots.quantity` no se decrementa hasta 9D) → 9B reserva por ítem FEFO-ordenado y guarda el lote representativo; la depleción exacta por lote se cierra en 9D. **Flag explícito.**
- Numeración `0029`–`0031` (0028 reservado).
- Pre-existentes: `main` sin push (hoy 20 commits); DEV/PROD misma DB.

---

## 6. Decisiones CERRADAS (2026-06-02)
1. **Cliente = `client_name text`** (consistencia con WMS/inventario; FK a `clients` como evolución futura).
2. **Reserva parcial = SÍ**: `allocate_order` reserva lo disponible y marca la línea `reservado_parcial`; el faltante queda pendiente para reintentar cuando entre stock.
3. **FEFO = para TODOS los clientes** (no solo ANMAT). Minimiza vencimientos en depósito de terceros.
4. **Arranque = por gates**: **Gate 1** = tablas + enums + RBAC (`0029`/`0030`) → validar → **Gate 2** = RPC (`0031`) + UI.

## 7. Plan de gates (construcción 9B)
- **Gate 1 — Esquema (sin lógica):** `0029_pedidos_permission_module.sql` (aislada) + `0030_logistics_orders.sql` (tablas `logistics_orders`/`logistics_order_items`/`stock_allocations` + 3 enums + trigger `public_id` + RLS). SQL idempotente listo para que Martín lo aplique en el SQL Editor. Validación: tablas creadas, RLS activa, insert de pedido de prueba (transaccional + rollback). **Sin RPC, sin tocar stock.**
- **Gate 2 — Lógica + UI:** `0031_pedidos_functions.sql` (`allocate_order`/`release_allocation`/`cancel_order` con reserva parcial + FEFO-todos + invariante cuarentena) + capa TS `src/lib/pedidos/*` + UI `/pedidos`. Validación: kit de casos §4.
