# GATE 4B — Packing · Documento de diseño y alcance (BORRADOR para aprobación)

> Estado: **propuesta de diseño. NO implementado.** Sigue la metodología de Gate 4A:
> diseño → OK → migración → validación SQL → capa TS → UI → validación visual →
> commit aislado. Aditivo sobre Gates 1–4A. No reabre nada validado.

## 1. Objetivo funcional
Consolidar la mercadería ya **pickeada** de un pedido en **unidades logísticas**
(bultos / cajas / pallets), registrando **qué reservas van en cada bulto**, para
dejar el pedido listo para despacho. Packing confirma:
- `stock_allocations.status`: **`pickeada` → `empacada`**.
- `logistics_order_items.status`: **`pickeado` → `empacado`**.
- `logistics_orders.status`: **`en_preparacion` → `preparado`** (cuando todo el pedido quedó empacado).

Packing **NO mueve stock** (la mercadería sigue en el bucket `reservado`); el egreso
real, el `inventory_lots--` y `reserved→0` son de **Gate 4C (Despacho)**.

## 2. Modelo de datos propuesto
Dos tablas nuevas (cabecera de bulto + contenido), espejando el patrón de
`receptions`/`reception_items` y `logistics_orders`/`logistics_order_items`:

- **`packing_units`** — un bulto físico que pertenece a un pedido.
- **`packing_unit_items`** — el contenido del bulto: vincula una `stock_allocation`
  (ya `pickeada`) a un bulto, con la cantidad empacada.

La **allocation sigue siendo atómica** (consistente con 4A): una allocation
`pickeada` entra **entera** en **un** bulto. El campo `quantity` en
`packing_unit_items` se incluye para forward-compat (packing parcial futuro), pero
en 4B siempre `= stock_allocations.quantity`.

## 3. Nuevas tablas

```
packing_units
  id              uuid pk
  short_id        int (sequence)
  public_id       text unique          -- 'BLT-2026-0001' (trigger)
  order_id        uuid fk logistics_orders(id) on delete cascade
  label           text                 -- rótulo operativo (opcional: "Caja 1")
  unit_type       text                 -- 'caja' | 'pallet' | 'bulto' (texto libre v1)
  status          packing_status_t default 'abierta'
  weight_kg       numeric(12,3)        -- opcional
  notes           text
  active          boolean default true
  created_at      timestamptz default now()
  created_by      uuid fk auth.users

packing_unit_items
  id                uuid pk
  packing_unit_id   uuid fk packing_units(id) on delete cascade
  allocation_id     uuid fk stock_allocations(id) on delete restrict  -- 1 allocation → 1 bulto
  quantity          numeric(14,3) check (> 0)   -- = allocation.quantity en 4B
  created_at        timestamptz default now()
  unique (allocation_id)               -- una allocation no se empaca dos veces (atomicidad 4B)
```

- `public_id` por trigger (patrón `set_*_public_id` de receptions/pedidos).
- `unique(allocation_id)` garantiza que una reserva está a lo sumo en un bulto.
- RLS: lectura `authenticated`; escritura **solo vía RPC** (lockdown, como
  `stock_allocations` en 0031 / `inventory_*` en 0027).

## 4. Nuevos enums
- **`packing_status_t`** (nuevo): `('abierta', 'cerrada', 'despachada', 'anulada')`.
  - `abierta` = se está armando · `cerrada` = sellada/lista para despacho.
  - `despachada` se **declara ahora** (congela el dominio) y la consume **4C**.
- **NO** se crean enums de allocation ni de línea/pedido: `empacada` /
  `empacado` / `preparado` **ya están congelados** en `0030`.

## 5. RPCs (todas `SECURITY DEFINER`, authz `admin/operaciones/supervisor`, cast explícito a enum)
1. `create_packing_unit(p_order_id, p_label, p_unit_type) → uuid`
   - Crea un bulto `abierta` para el pedido (debe estar `en_preparacion` con líneas pickeadas).
2. `pack_allocation(p_packing_unit_id, p_allocation_id)`
   - Bulto `abierta` + allocation `pickeada` → inserta `packing_unit_items`,
     allocation `→ empacada`, **roll-up** línea/pedido, audit.
3. `unpack_allocation(p_allocation_id)`  *(reversa)*
   - `empacada → pickeada`, elimina la fila de `packing_unit_items`, roll-up revierte.
     Bloqueado si la línea ya está `despachado`/`cancelado` (forward-guard).
4. `close_packing_unit(p_packing_unit_id)` / `reopen_packing_unit(p_packing_unit_id)`
   - `abierta ↔ cerrada` (sella / reabre el bulto). `reopen` bloqueado si `despachada`.
5. `confirm_packing_order(p_order_id)`  *(conveniencia "empacar pedido completo")*
   - Crea un bulto, empaca **todas** las allocations `pickeada` del pedido, lo cierra,
     y deja el pedido `preparado`. Idempotente (si no hay pickeadas, no-op).

Helper interno (REVOKE de `public`/`authenticated`, como `wms_pick_recompute_line`):
- `wms_pack_recompute(p_order_item_id)` — recalcula estado de **línea** (pickeado↔empacado)
  y, derivado, **pedido** (`en_preparacion`↔`preparado`).

## 6. Roll-ups de estados
- **Línea** (`order_item_status_t`): `empacado` cuando **todas** sus allocations vivas
  (≠`liberada`) están `empacada` (o posterior); si vuelve a haber alguna `pickeada`
  por `unpack`, la línea revierte a `pickeado`.
- **Pedido** (`logistics_order_status_t`): `preparado` cuando **todas** las líneas no
  canceladas están `empacado`; si por `unpack` deja de estarlo, revierte a `en_preparacion`.
- Coherente con 4A: el estado se **deriva** de la realidad de allocations (sin flags sueltos).

## 7. Interacción con Picking (4A)
- `pack_allocation` exige `allocation.status='pickeada'` (la salida de 4A).
- Al empacar, la allocation pasa a `empacada` y **desaparece de la ruta de picking**
  (que sólo lista `reservada`/`pickeada`) → separación limpia entre tableros.
- `unpack` la devuelve a `pickeada` → reaparece en la ruta de picking.
- El **forward-guard de 4A** (`unpick_allocation` bloquea si línea `empacado`) ya está
  puesto desde 4A: para deshacer un picking primero hay que `unpack` (4B). Sin cambios en 4A.

## 8. Interacción con Despacho (4C)
- 4B entrega: pedido `preparado`, allocations `empacada`, `packing_units` `cerrada`.
- 4C (`confirm_dispatch`) consumirá las allocations `empacada` + los `packing_units`
  para crear el `shipment`, hacer el **EGRESO** (ledger + `inventory_lots--` + `reserved→0`),
  y transicionar `empacada→despachada`, `packing_status cerrada→despachada`,
  pedido `preparado→despachado`. Por eso `packing_status_t` ya declara `despachada`.
- Posible regla 4C: exigir que **todos los bultos** del pedido estén `cerrada` antes de despachar.

## 9. Impacto sobre inventario
**NINGUNO.** Igual que 4A: Packing NO toca `stock_available`/`stock_reserved`,
NI `inventory_lots`, NI `inventory_movements`. La propiedad física del stock sigue
gobernada por Gate 3 (reserva) y Gate 4C (egreso). Garantía explícita en el header de la migración.

## 10. Estrategia de validación SQL
Kit transaccional **0 footprint** (doble seguro `BEGIN/ROLLBACK` + sentinel
`__qa_rollback__`) **y** variante con **reporte en filas** (como Gate 4A), porque el
SQL Editor de Supabase no muestra `RAISE NOTICE`. Fixture: `confirm_reception →
allocate_order → confirm_picking` para llegar a `pickeada`, luego packing. Casos:
1. `create_packing_unit` (bulto `abierta`).
2. `pack_allocation` → allocation `empacada`, línea `empacado`, pedido `preparado`.
3. `unpack_allocation` → revierte a `pickeada`/`pickeado`/`en_preparacion`.
4. `confirm_packing_order` (empaca todo, pedido `preparado`).
5. `close` / `reopen` packing_unit.
6. Roll-up multi-línea (pedido `preparado` solo cuando **todas** las líneas `empacado`).
7. Invariante **NO-STOCK** (buckets sin cambios).
8. Invariante **NO-LEDGER** (`inventory_movements` sin crecer) + `inventory_lots` intacto.
9. Idempotencia (`confirm_packing_order` 2×; re-pack de allocation ya empacada → rechaza).
10. Guards: pack de allocation no-`pickeada` → rechaza; pack en bulto `cerrada` → rechaza;
    `unpack` de allocation no-`empacada` → rechaza; `unique(allocation_id)` (no doble bulto).
11. `audit_log` (`packing.pack` / `packing.unpack` / `packing.close`).
12. Autorización (JWT vacío → rechazo).

## 11. Estrategia de validación visual
UI Packing (reemplaza placeholder), estética `nx-*`:
- `/wms/packing` — **cola**: pedidos con líneas `pickeado` listas para empacar (KPIs:
  pedidos en cola, líneas pendientes de empacar, líneas empacadas, pedidos preparados).
- `/wms/packing/[id]` — **tablero de armado**: paradas `pickeada` del pedido, crear bulto,
  asignar parada → bulto, cerrar bulto, "empacar pedido completo".
- Server Actions + `revalidatePath()` (`/wms/packing`, `/wms/packing/[id]`, `/pedidos/...`),
  **sin `router.refresh()`**.
- E2E con pedido temporal `Test-general-001 / G-001`: reservar → pickear → empacar →
  desempacar → empacar todo → cerrar bulto → **cancelar + restaurar stock 100/0**.

## 12. Riesgos y compatibilidad futura
**Riesgo: MEDIO.** Mayor superficie que 4A (2 tablas + relación bulto↔contenido + 5 RPC),
pero **aditivo**, sin tocar stock/ledger ni Gates 1–4A.
- *Transición pedido→preparado:* debe derivarse sólo de líneas empacadas; no anticipar `despachado` (4C).
- *Atomicidad:* `unique(allocation_id)` evita doble empaque; packing parcial queda para una RPC futura (split), sin romper el modelo.
- *Forward-guard:* `unpack` debe contemplar `despachado`/`cancelado` desde ya (como 4A).

**Gate 5 (QR, fotos, cadena de custodia) — forward-compat:**

> **Nota canónica (aprobada):** `packing_units` será la **entidad física canónica**
> para futuras extensiones de Gate 5 (QR, fotografías, evidencia visual, cadena de
> custodia y tracking de bultos).

El **`packing_unit` es el portador natural** de la cadena de custodia: Gate 5 podrá
sumar (additive) `qr_code`, referencias de **evidencia fotográfica** (foto al cerrar el
bulto) y trazabilidad por unidad, **referenciando `packing_units` / `packing_unit_items`**
sin rediseñar Packing. La granularidad por unidad (1 ítem físico) se logra bajando
`packing_unit_items.quantity` a 1 por fila en el futuro, sin cambiar el contrato de las RPC.

## Decisiones a confirmar antes de la migración (como las 5 de 4A)
- **D1 — Atomicidad:** allocation entera por bulto (recomendado, consistente con 4A) vs. permitir split.
- **D2 — `preparado`:** pedido `preparado` al empacar todas las líneas (recomendado) vs. exigir además todos los bultos `cerrada`.
- **D3 — `confirm_packing_order`:** auto-crea un bulto único y cierra (recomendado) vs. sólo empaca sin cerrar.
- **D4 — `public_id` de bulto:** prefijo `BLT-` (recomendado) / `PKG-` / `PAK-`.
- **D5 — Reversa:** incluir `unpack_allocation` + `reopen_packing_unit` (recomendado, simetría con 4A) vs. sólo avanzar.

## Mapa de archivos (a crear/modificar en Gate 4B)
**Migración**
- `supabase/migrations/0033_wms_packing.sql` (tablas + enum + RPCs + RLS lockdown + grants + audit).

**Capa TS**
- `src/lib/packing/types.ts`
- `src/lib/packing/packing.ts` (`listPackQueue`, `listPackBoard(orderId)`, `createPackingUnit`,
  `packAllocation`, `unpackAllocation`, `closePackingUnit`, `reopenPackingUnit`, `confirmPackingOrder`)

**UI**
- `src/app/(app)/wms/packing/page.tsx` (reemplaza placeholder → cola)
- `src/app/(app)/wms/packing/[id]/page.tsx` (tablero de armado)
- `src/app/(app)/wms/packing/actions.ts` (Server Actions + revalidatePath)
- `src/app/(app)/wms/packing/_components/PackingActions.tsx` (client)

**Docs / validación**
- `docs/handoff/GATE_4B_PACKING_DESIGN.md` (este doc)
- `docs/handoff/gate4b_packing_validation.sql` (kit NOTICE)
- `docs/handoff/gate4b_packing_validation_report.sql` (kit reporte en filas)

**No se toca:** Gates 1–4A, modelo físico, `confirm_*` validados, stock/ledger. Sin cambios de esquema fuera de `0033`.
