# GATE 4A — Picking · Documento de diseño (cerrado)

> Estado: **migración `0032_wms_picking.sql` aprobada para aplicación y validación.**
> Alcance bloqueado (no ampliar sin OK explícito). Aditivo sobre Gates 1–3.

## 1. Alcance y decisiones (congeladas)

| Tema | Decisión |
|---|---|
| Waves / `picking_runs` | **Sin waves.** 1 pedido = 1 sesión de picking. No se crea tabla de olas. |
| Granularidad de confirmación | **Por allocation/posición** (parada de ruta) + conveniencia "pedido completo". |
| Reversa | **Con `unpick`** (`pickeada → reservada`). |
| Stock | **No se toca.** Sin cambios en `stock_available` / `stock_reserved`. |
| Ledger | **No se escribe** `inventory_movements`. |
| Header del pedido | **No se modifica.** `logistics_orders.status` queda en `en_preparacion` (el avance a `preparado` es 4B). |
| Tablas nuevas | **Ninguna operativa** (solo funciones + escritura en `audit_log` existente). |
| Gates 1–3 | **No se modifican.** |

### Reglas de las RPC (`0032`)
- `confirm_picking(p_allocation_id)` — valida **únicamente** la allocation (`reservada`). No se acopla al header del pedido a propósito.
- `confirm_picking_order(p_order_id)` — valida el estado del pedido (**`en_preparacion`**); pickea todas las `reservada` en una transacción; idempotente.
- `unpick_allocation(p_allocation_id)` — `pickeada → reservada`, **bloqueado** si la línea está `empacado`, `despachado` o `cancelado` (forward-guard preparado desde 4A aunque Packing aún no exista).
- `wms_pick_recompute_line(...)` — helper interno (REVOKE de `public`/`authenticated`); deriva el estado de la línea de `stock_allocations`. Una línea `reservado_parcial` cuyas reservas se pickearon queda `pickeado` (el faltante se deriva de `quantity_allocated < quantity_requested`; el enum no tiene `pickeado_parcial`).

### Garantía explícita de propiedad física del stock
Gate 4A **no toca** `logistics_orders.status`, `inventory_movements`, `inventory_items` ni `inventory_lots`. La propiedad física del stock sigue gobernada por:
- **Gate 3** (`allocate_order`) → reserva: `stock_available → stock_reserved`.
- **Gate 4C** (`confirm_dispatch`) → egreso: salida del depósito + `inventory_lots--`.

Picking es **solo** un cambio de estado de la reserva (`reservada ↔ pickeada`).

### Auditoría
`public.audit_log` es el **mecanismo único** de auditoría de Picking. Cada transición inserta una fila (`entity='stock_allocation'`, `action='picking.confirm' | 'picking.unpick'`, `payload` con `order_item_id`/`inventory_item_id`/`lot_number`/`quantity` y `from→to`). Las RPC son `SECURITY DEFINER` (owner) → bypassan RLS para el insert, igual que `confirm_reception` sobre `inventory_movements`.

## 2. Nota de diseño — Ubicación física como fuente estándar

`listPickRoute()` (capa TS, próximo paso) expondrá la **ubicación física completa**:

```
depósito → piso → sector → zona/pasillo → rack → nivel → posición
```

resolviendo `stock_allocations → inventory_items → warehouse_positions → warehouse_racks → warehouse_zones → warehouse_sectors → warehouse_floors → warehouses`.

**Estándar (decisión de arquitectura):** esta estructura de ubicación debe considerarse la **fuente canónica y reutilizable** de localización física para **Gate 4B (Packing)** y **Gate 4C (Despacho)**. Packing y Despacho **deben reutilizar** esta misma derivación; **evitar** introducir consultas alternativas de ubicación que dupliquen o diverjan de este árbol.

## 3. Reserva conceptual para Gate 5 (NO implementar ahora)

Gate 5 (Cadena de Custodia Digital, ej. Mercado Libre) incorporará, **por unidad logística**:
- **QR único** por unidad.
- **Evidencia fotográfica** (ingreso y egreso).
- **Cadena de custodia** trazable por unidad.
- **Auditoría visual** comparativa de ingreso vs. egreso.

**Diseño forward-compat (obligación de Picking):** la `stock_allocation` es un **bucket de cantidad** (`ítem + lote + posición + cantidad`); **no** asume "1 allocation = 1 unidad". Picking **no debe impedir** que Gate 5 cuelgue identidad y evidencia por unidad referenciando la allocation (o el evento de picking del `audit_log`). No tomar en 4A ninguna decisión que bloquee esa extensión.

## 4. Próximos pasos (tras validar `0032`)

1. `src/lib/picking/types.ts` — tipos de dominio (cola, ruta, parada, ubicación física).
2. `src/lib/picking/picking.ts` — accessors `isMock()`: `listPickQueue()`, `listPickRoute(orderId)` (ubicación física completa), wrappers `confirmPicking` / `confirmPickingOrder` / `unpickAllocation`.
3. UI `/wms/picking` y `/wms/picking/[id]` (estética `nx-*`) + `actions.ts` con Server Action + `revalidatePath` (sin `router.refresh()`).
4. Kit de validación `docs/handoff/gate4a_picking_validation.sql` + checklist E2E.
5. Commit aislado (solo bajo orden explícita).
