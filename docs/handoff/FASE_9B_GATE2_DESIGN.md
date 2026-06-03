# TOPS Nexus — FASE 9B / GATE 2: Motor de Reservas FEFO (DISEÑO TÉCNICO)

> Generado 2026-06-02. **NO es implementación.** Diseño para aprobación previa
> (regla §3). Construye sobre Gate 1 (`0029`/`0030`, esquema aplicado) y el núcleo
> Sprint 2 (`0024`/`0026`/`0027`). Migración nueva: **`0031_pedidos_functions.sql`**.

## 0. Insumos revisados (grounding)
- `0024`: `inventory_items` buckets `stock_available`/`stock_reserved` **a nivel ítem** (identidad `client_name,sku,position_id`); `inventory_lots(inventory_item_id, lot_number, expiration_date, quantity, active)`.
- `0026`: `inventory_movements` append-only (trigger de inmutabilidad). **La reserva NO es un movimiento físico → 9B NO escribe en este ledger.**
- `0027`: patrón RPC — `security definer · set search_path=public`; auth `current_role() in (admin,operaciones,supervisor)`; `SELECT … FOR UPDATE` para lockeo; stock solo escribible por RPC (RLS lockdown). La cuarentena sube `stock_reserved` **sin** `stock_allocations`.
- `0030` (Gate 1): `logistics_orders`/`logistics_order_items`/`stock_allocations` (con `reserved_at`/`released_at`); enums `logistics_order_status_t`/`order_item_status_t`/`alloc_status_t`.
- `lots.ts` (9A): FEFO = `expiration_date asc nulls last`.

## 1. Modelo de reserva e invariante
La reserva es un **shift de bucket** dentro del mismo ítem: `stock_available → stock_reserved`, acompañado de una fila en `stock_allocations` que dice **qué pedido** se llevó **cuánto** de **qué ítem/lote**.

**Invariante (lo garantizan las RPC):**
```
stock_reserved(ítem) = Σ stock_allocations.quantity (status='reservada') del ítem
                      + reservado_por_cuarentena
```
Como la cuarentena (`0027 confirm_reception`) sube `stock_reserved` **sin** crear allocation, y `allocate_order` solo toca `stock_available` (subiendo `stock_reserved` **con** allocation), los dos usos nunca se pisan. `allocate_order` jamás reserva contra lo cuarentenado (no está en `stock_available`).

## 2. FEFO — granularidad y limitación honesta
Los buckets son **por ítem**, no por lote. FEFO se resuelve **ordenando los `inventory_items` candidatos** de un `(client_name, sku)` por el **vencimiento más próximo de sus lotes**:
```
fefo_date(ítem) = min(inventory_lots.expiration_date where active)   -- nulls last
```
La allocation guarda el **lote más próximo a vencer** del ítem (`fefo_lot`) como `lot_number`, para trazabilidad. **Limitación (cierra 9D):** si un ítem mezcla 2 lotes en el mismo bucket, no se hace split exacto por lote (el bucket no lo distingue); la depleción precisa por lote y `inventory_lots.quantity--` llegan con el egreso de 9D. El orden FEFO **entre ítems** sí es exacto.

## 3. RPC `allocate_order(p_order_id uuid)` → reserva (FEFO + parcial)
**Firma:** `returns void · language plpgsql · security definer · set search_path=public`.
**Contrato:**
1. Auth: `current_role() in (admin,operaciones,supervisor)` o `RAISE insufficient_privilege`.
2. `SELECT … FOR UPDATE` del pedido; validar `status in ('pendiente','en_preparacion')` (si no, raise).
3. Por cada línea con `status in ('pendiente','reservado_parcial')`:
   - `ya_reservado = Σ stock_allocations.quantity (status='reservada')` de la línea → **idempotencia** (re-correr no duplica).
   - `faltante = quantity_requested − ya_reservado`; si `≤ 0` → línea `reservado`, continuar.
   - **Candidatos FEFO** (lockeados): 
     ```
     select ii.id, ii.stock_available, <fefo_date>, <fefo_lot>
     from inventory_items ii
     where ii.client_name = v_order.client_name and ii.sku = v_line.sku
       and ii.active and ii.stock_available > 0
     order by fefo_date asc nulls last, ii.id
     for update
     ```
   - Loop: `q = least(faltante, cand.stock_available)`; `update inventory_items set stock_available -= q, stock_reserved += q`; `insert stock_allocations(order_item_id, inventory_item_id, lot_number=fefo_lot, quantity=q, status='reservada', reserved_at=now(), created_by=auth.uid())`; `faltante -= q`; salir si `faltante = 0`.
   - Estado de la línea: `faltante = 0` → `reservado`; `0 < reservado < requested` → `reservado_parcial`; `reservado = 0` → queda `pendiente` (no hubo stock).
4. Cabecera: si se reservó algo → `en_preparacion`; si **nada** se reservó en ninguna línea → queda `pendiente`.

**Concurrencia:** lock del pedido + `FOR UPDATE` de los ítems candidatos con `ORDER BY fefo_date, id` (orden de lockeo consistente → sin deadlock, sin overselling entre pedidos concurrentes).
**No escribe `inventory_movements`.**

## 4. RPC `release_allocation(p_allocation_id uuid)` → liberar una reserva
1. Auth (ídem).
2. `SELECT … FOR UPDATE` de la allocation; si `status <> 'reservada'` → raise (solo se libera lo vigente).
3. `update inventory_items set stock_reserved -= q, stock_available += q where id = alloc.inventory_item_id`.
4. `update stock_allocations set status='liberada', released_at=now()`.
5. Recalcular estado de la línea (`reservado`→`reservado_parcial`/`pendiente` según lo que quede activo).

## 5. RPC `cancel_order(p_order_id uuid)` → cancelar pedido
1. Auth (ídem).
2. Lock del pedido; validar `status not in ('despachado','entregado')` (no se cancela lo ya despachado).
3. Para cada allocation `reservada` de las líneas del pedido: revertir bucket (`reserved→available`), `status='liberada'`, `released_at=now()`.
4. Líneas → `cancelado`; cabecera → `cancelado`.

## 6. `0031_pedidos_functions.sql` — estructura
1. **Lockdown RLS de `stock_allocations`** (reemplaza las policies provisionales de 0030): drop insert/update/delete → queda solo lectura; toda escritura pasa por las RPC (igual que `inventory_movements` en 0027). `inventory_items` ya está lockeado por 0027.
2. Las 3 funciones `SECURITY DEFINER` (§3–§5).
3. `grant execute … to authenticated` para las 3.
4. `notify pgrst, 'reload schema'`.
**Additive. No toca** inventario/recepciones/movimientos/0030.

## 7. Capa TypeScript (sin UI) — DECISIÓN DE SCOPE
Propongo `src/lib/pedidos/{types,orders,allocations}.ts`: tipos + wrappers `listOrders`/`getOrder`/`createOrder`/`addOrderItem`/`submitOrder`/`allocateOrder`(rpc)/`releaseAllocation`(rpc)/`cancelOrder`(rpc) + mocks (patrón `lib/wms/receptions.ts`). **Sin React, sin páginas.** → Ver decisión #1: incluir en Gate 2 o diferir a Gate 3 (UI).

## 8. Plan de validación (kit transaccional + rollback, patrón Sprint 2)
Setup: usar `confirm_reception` para crear stock real con 2 lotes (vto distinto) del mismo SKU. Casos:
1. **Reserva total:** pedido cubierto → líneas `reservado`, `stock_available` baja y `stock_reserved` sube por igual, allocations `reservada`, **0 filas en `inventory_movements`**.
2. **FEFO:** 2 ítems/lotes del SKU → reserva primero el de vencimiento más próximo (verificar `lot_number` de la allocation).
3. **Reserva parcial:** pedido > stock → línea `reservado_parcial`, reserva = stock disponible, faltante registrado.
4. **Idempotencia:** re-`allocate_order` no duplica (descuenta `ya_reservado`).
5. **Liberación:** `release_allocation` revierte buckets, allocation `liberada` + `released_at`.
6. **Cancelación:** `cancel_order` libera todo, líneas+cabecera `cancelado`.
7. **Invariante cuarentena:** ítem con stock en cuarentena (`stock_reserved>0`, sin allocation) NO es reservable; `allocate_order` lo ignora.
8. **Autorización:** rol no habilitado → `insufficient_privilege`.
9. **Invariante final:** por ítem, `stock_reserved == Σ allocations activas + cuarentena`.

## 9. Riesgos / decisiones abiertas
- **FEFO ítem-no-lote** (limitación §2) → se documenta; cierra 9D.
- **Reserva parcial:** ¿la línea con 0 reservado queda `pendiente` (propuesto) o `reservado_parcial`? *(Propongo `pendiente`.)*
- **borrador → pendiente:** ¿`allocate_order` exige `pendiente` (propuesto; el alta deja `borrador` y hay que "enviar"), o acepta `borrador` directamente?
- Numeración `0031`. `main` sin push.

## 10. Decisiones CERRADAS (2026-06-02)
1. **Scope Gate 2 = `0031` (3 RPC + lockdown) + kit de validación + capa TS `src/lib/pedidos/*` (sin UI/React).** La UI es Gate 3.
2. **Línea sin stock → queda `pendiente`** (0 reservado no es parcial). `reservado_parcial` solo si `0 < reservado < solicitado`.
3. **`allocate_order` solo desde `pendiente`/`en_preparacion`.** El alta deja `borrador`; hay un paso de "enviar" (`submitOrder`: borrador→pendiente) antes de reservar.

## 11. Entregables Gate 2 (al aprobar)
- `supabase/migrations/0031_pedidos_functions.sql` — lockdown RLS de `stock_allocations` + `allocate_order`/`release_allocation`/`cancel_order` + grants.
- `src/lib/pedidos/types.ts` — tipos + metas de estado (patrón `wms/types.ts`).
- `src/lib/pedidos/orders.ts` — `listOrders`/`getOrder`/`createOrder`/`addOrderItem`/`submitOrder`/`cancelOrder` + mocks.
- `src/lib/pedidos/allocations.ts` — `allocateOrder`(rpc)/`releaseAllocation`(rpc)/`listAllocations`.
- `docs/handoff/fase9b_gate2_validation.sql` — kit transaccional (9 casos §8).
- **Sin UI, sin commit/push/deploy.** `tsc`/`eslint` verdes antes de entregar.
