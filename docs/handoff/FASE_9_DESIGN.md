# TOPS Nexus — FASE 9: WMS Operativo + Pedidos Logísticos (DISEÑO TÉCNICO)

> Generado 2026-06-02. Relevamiento verificado contra migraciones `0001`–`0027`,
> capa `src/lib/wms/*` y las pantallas actuales. **NO es implementación.** Diseño
> para aprobación explícita antes de escribir código (regla §3, gate-heavy).
> Estado de ejecución del asistente: **read-only**; los writes los aplica Martín.

## Hallazgos de verificación (correcciones al handoff previo)
1. **Jerarquía física real** (`0020_wms_physical_model.sql` + `twin.ts`):
   `warehouses → warehouse_floors → warehouse_sectors → warehouse_zones → warehouse_racks → warehouse_positions`.
   (El `WMS_HANDOFF.md §1` decía `zones → aisles → levels` — **incorrecto**. Se usa el esquema real.)
2. **Roles** (`user_role_t`, `0001:23`): `admin · operaciones · supervisor · cliente`. No hay `presidente`; Martín = `admin`. Las 3 RPC autorizan `admin/operaciones/supervisor`.
3. **`permission_module_t`** tiene `wms` (`0021`) pero **NO** `pedidos` (el comentario de `0021` lo difería a "FASE 6"; nunca se creó).
4. **Última migración = `0027`**. `0028_facility_spaces.sql` está **reservado** para Digital Twin v2 (bloqueado por matriz de Dirección). ⇒ FASE 9 numera **`0029`+**.
5. **Cliente = `client_name text`** (free text) en `inventory_items`/`receptions`. No hay FK a `clients`. Decisión de diseño abierta (ver §Decisiones).

---

# ENTREGABLE 1 — Mapa de tablas actuales

## EXISTE (aplicado en DEV, `0020`–`0027`)

| Capa | Tablas | Notas |
|---|---|---|
| Físico (`0020`) | `warehouses`, `warehouse_floors`, `warehouse_sectors`, `warehouse_zones`, `warehouse_racks`, `warehouse_positions` | 6 niveles. `warehouse_positions.id` = clave de integración. Enums `warehouse_*_t`. Sembrado: 2 sedes + pisos + sectores de incendio. Zones/racks/positions parcial (Luján). |
| Inventario (`0024`) | `inventory_items` (`client_name`, `sku`, `position_id`, `stock_available`, `stock_reserved`, `active`), `inventory_lots` (`lot_number`, `expiration_date`, `quantity`) | Identidad ítem = (client, sku, position). Buckets de stock a nivel **ítem**, no por lote. |
| Recepciones (`0025`) | `receptions`, `reception_items` | Enums `business_unit_t`, `reception_status_t`, `reception_item_status_t`. Patrón cabecera (`short_id`/`public_id` por trigger) reutilizable. |
| Ledger (`0026`) | `inventory_movements` (append-only, **trigger de inmutabilidad**) | Enums `movement_type_t` (`ingreso/traslado/egreso/ajuste`), `movement_reference_t` (`recepcion/movimiento/ajuste/despacho`). **`egreso` y `despacho` YA existen.** |
| Núcleo TX (`0027`) | RPC `confirm_reception`, `release_quarantine`, `confirm_movement` | `SECURITY DEFINER`; stock **solo** se escribe vía RPC (RLS lockdown). `confirm_movement` ya soporta `egreso`; tiene un TODO para validar referencia `despacho` "al implementar Despachos". |
| RBAC | `user_role_t`, `permission_module_t` (+`wms`), `current_role()` | — |

## FALTA (no existe ninguna tabla)

| Área FASE 9 | ¿Tabla nueva? | Observación |
|---|---|---|
| Pedidos Logísticos | **SÍ** | cabecera + líneas. 0 tablas hoy (pantalla = placeholder `ModuleScaffold`). |
| Reserva/Asignación de stock | **SÍ** | No hay mecanismo para reservar stock a un pedido. Pieza crítica nueva. |
| Picking | SÍ (liviana) o derivado | Confirmación de cantidades/lote + ruta por posición. |
| Packing | **SÍ** | bultos/cajas + contenido. |
| Despachos | **SÍ** | cabecera de despacho; el egreso REUSA el ledger. |
| Lotes | **NO** | Vista de lectura sobre `inventory_lots`+`inventory_items`+`full_code`. |
| Vencimientos | **NO** | Vista de lectura + semáforo + CSV. |
| `permission_module_t = 'pedidos'` | **SÍ** (enum) | migración aislada (patrón `0021`). |

---

# ENTREGABLE 2 — Modelo de datos definitivo

**Principios:** aditivo · reutilizar inventario + ledger + RPC · stock **solo** vía RPC `SECURITY DEFINER` · el despacho es un `egreso` en el ledger inmutable existente.

## Decisión central: cómo se reserva stock (núcleo del diseño)
`inventory_items.stock_reserved` **ya lo usa la cuarentena**. Si Picking también reserva ahí sin distinguir, se pierde trazabilidad y se mezcla con cuarentena. **Propuesta (recomendada):** tabla **`stock_allocations`** (ledger de reservas) como única fuente de verdad de las reservas de picking. Invariante:
`stock_reserved(ítem) = Σ allocations activas del ítem + reservado_por_cuarentena`.
Esto permite: reserva por pedido, liberación, parciales, y FEFO por lote sin tocar el bucket de cuarentena.

## Tablas nuevas propuestas (`0029`+)

1. **`logistics_orders`** — cabecera de pedido.
   `id, short_id, public_id ('PED-2026-0001' por trigger), client_name, status logistics_order_status_t, priority?, customer_ref (n° pedido del cliente), requested_date, notes, active, created_at/by`.
2. **`logistics_order_items`** — líneas.
   `id, order_id FK, sku, description, quantity_requested, lot_constraint? (lote/vencimiento exigido), status order_item_status_t, created_at`. Las cantidades pickeada/empacada se derivan de allocations.
3. **`stock_allocations`** — reservas (bridge a inventario).
   `id, order_item_id FK, inventory_item_id FK, lot_number?, lot_id?, quantity, status alloc_status_t, created_at/by`.
4. **`packing_units`** — bultos/cajas.
   `id, order_id FK, code ('BULTO-PED-2026-0001-01'), label?, weight_kg?, dims?, notes, status packing_status_t, created_at/by`.
5. **`packing_unit_items`** — contenido del bulto.
   `id, packing_unit_id FK, order_item_id FK (o allocation_id), quantity`.
6. **`shipments`** — despachos.
   `id, short_id, public_id ('DSP-2026-0001'), order_id FK, transportista, patente, chofer, dispatched_at, delivered_at?, status shipment_status_t, tracking_ref? (vínculo módulo Tracking), notes, created_at/by`.
7. *(opcional 9C)* **`picking_runs`** — wave/recorrido agrupando allocations por sede/ruta. Evaluable; el picking puede operar sin esto (estado + allocations + ruta derivada).

## Enums nuevos
- `logistics_order_status_t`: `pendiente · en_preparacion · preparado · despachado · entregado · cancelado`.
- `order_item_status_t`: `pendiente · en_picking · pickeado · empacado · despachado · cancelado`.
- `alloc_status_t`: `reservada · pickeada · empacada · despachada · liberada`.
- `packing_status_t`: `abierto · cerrado`.
- `shipment_status_t`: `preparado · despachado · entregado · cancelado`.

## RPC nuevas (`SECURITY DEFINER`, misma autorización admin/operaciones/supervisor)
- **`allocate_order(p_order_id)`** — por cada línea, busca inventario `(client_name, sku)` con **FEFO** por lote, mueve `stock_available → stock_reserved`, crea `stock_allocations` (`reservada`), pasa pedido a `en_preparacion`. (Si no hay stock suficiente → reserva parcial o error, según política a definir.)
- **`confirm_picking(p_order_id | p_allocation_ids)`** — valida SKU/lote pickeado, marca allocations `pickeada`. **Sin cambio de stock** (ya reservado).
- **`confirm_packing(p_order_id, bultos)`** — asocia allocations pickeadas a `packing_units`, allocations `empacada`; cuando todo empacado, pedido → `preparado`.
- **`confirm_dispatch(p_shipment_id)`** — por cada allocation: `stock_reserved -= qty`, inserta `inventory_movements` **`egreso`** (`before/after`, `reference_type='despacho'`, `reference_id=shipment`), **decrementa `inventory_lots.quantity`** del lote (FEFO), allocation `despachada`, pedido `despachado`. *(Extiende la validación de referencia `despacho` en `confirm_movement` ahora que existe `shipments`.)*
- **`confirm_delivery(p_shipment_id)`** — shipment `entregado`, pedido `entregado`, opcional evento de Tracking.
- **`cancel_order(p_order_id)` / `release_allocation(...)`** — `stock_reserved → stock_available`, allocation `liberada`, pedido `cancelado`.

## Gap detectado (a resolver en 9D)
Hoy `confirm_movement('egreso')` **no decrementa `inventory_lots.quantity`** (los lotes solo acumulan en `ingreso`). El despacho FEFO debe agregar ese decremento para que la trazabilidad por lote cierre.

---

# ENTREGABLE 3 — Arquitectura E2E

```
logistics_orders (pendiente)
        │  allocate_order()  →  stock_available → stock_reserved · crea stock_allocations (FEFO) · pedido=en_preparacion
        ▼
   PICKING            confirm_picking()  →  allocations=pickeada (ruta derivada: allocation→inventory_item→warehouse_position)
        │
        ▼
   PACKING            confirm_packing()  →  packing_units + allocations=empacada · pedido=preparado
        │
        ▼
   DESPACHO (shipments)  confirm_dispatch()  →  EGRESO en inventory_movements (ledger inmutable) · stock_reserved→0 · lots-- · pedido=despachado
        │
        ▼
   ENTREGA            confirm_delivery()  →  pedido=entregado · shipment=entregado · (opcional) evento Tracking
```

## Qué REUTILIZA
- `inventory_items` (`stock_available`/`stock_reserved`), `inventory_lots` (FEFO), `warehouse_positions` (ruta de picking via `full_code` de `data.ts`).
- `inventory_movements` + `movement_type_t='egreso'` + `movement_reference_t='despacho'` (ya existen): el despacho entra al **mismo ledger inmutable**.
- Patrón RPC `SECURITY DEFINER` + `current_role()` + RLS lockdown (stock solo por RPC).
- Patrón de cabecera de `receptions` (`short_id`/`public_id` por trigger) para `logistics_orders`/`shipments`.

## Qué se CREA NUEVO
6 tablas (+1 opcional), 5 enums, ~6 RPC, `permission_module_t='pedidos'`, UI de 6 pantallas (hoy placeholders).

## Qué se CONECTA con Sprint 2
- **Reserva ↔ cuarentena:** `stock_allocations` evita la colisión sobre `stock_reserved` (invariante §Entregable 2).
- **Despacho ↔ ledger:** mismo `inventory_movements`; se extiende la validación `despacho` de `confirm_movement`.
- **Entrega ↔ Tracking:** `shipments.tracking_ref` opcional al módulo `0016–0018`.
- **Pedidos ≠ Órdenes de Servicio:** `logistics_orders` es operación 3PL del cliente; OS es gestión interna (lo aclara el placeholder). Cliente = `client_name text` (consistencia WMS).

## Vistas (sin tablas)
- **Lotes:** `inventory_lots ⋈ inventory_items ⋈ full_code`; filtros cliente/SKU/lote.
- **Vencimientos:** misma base + semáforo por días (verde/amarillo/rojo, umbral configurable) + export CSV. Solo lectura.

---

# ENTREGABLE 4 — Roadmap por fases

| Fase | Alcance | Tablas/RPC | Riesgo | Impacto | Dependencias |
|---|---|---|---|---|---|
| **9A — Lotes + Vencimientos** | 2 vistas de lectura + semáforo ANMAT + CSV | **0 tablas, 0 RPC** (solo `src/lib/wms` + UI) | **BAJO** | MEDIO (ANMAT) | Ninguna (consume `0024`). **Quick win sin riesgo transaccional.** |
| **9B — Pedidos + Reservas** | `logistics_orders`, `logistics_order_items`, `stock_allocations` + enums + `allocate_order`/`release`/`cancel` + `permission 'pedidos'` + tablero | 3 tablas, 3 enums, ~3 RPC | **MEDIO-ALTO** (toca `stock_reserved`) | ALTO | Decisión de modelo de reservas (gate fuerte). |
| **9C — Picking + Packing** | `confirm_picking`, `confirm_packing`, `packing_units`(+items), ruta por posición, UI | 2 tablas, 2 enums, ~2 RPC | MEDIO | ALTO | 9B (allocations). |
| **9D — Despachos + Entrega** | `shipments`, `confirm_dispatch` (egreso + lots--), `confirm_delivery`, extensión `confirm_movement`, vínculo Tracking, UI | 1 tabla, 2 enums, ~3 RPC | **ALTO** (egreso real, inmutable) | ALTO | 9C (empaque). |

**Por fase:** diseño → OK → build → **validación con kit de casos** (como Sprint 2) → **commit aislado**.

## Riesgos transversales
- **Reserva vs cuarentena** sobre `stock_reserved` → mitigado por `stock_allocations` + invariante.
- **Lotes no se decrementan en egreso hoy** → 9D agrega decremento FEFO.
- **Numeración** `0029`+ (0028 reservado a Twin v2).
- **Pre-existentes:** `main` 19 commits sin push; DEV/PROD misma DB; migraciones a mano.

---

# Decisiones que requieren tu OK antes de implementar
1. **Modelo de reserva:** ¿`stock_allocations` (recomendado, trazable) o reusar `stock_reserved` plano (más simple, sin trazabilidad por pedido)?
2. **Cliente:** ¿seguir con `client_name text` (consistencia WMS) o normalizar a FK `clients` en pedidos?
3. **Reserva parcial:** si no hay stock para toda la línea, ¿`allocate_order` reserva parcial y deja pendiente, o rechaza el pedido completo?
4. **FEFO obligatorio** para todos los clientes o solo `ANMAT`.
5. **Orden de fases:** ¿arrancamos por **9A** (quick win, riesgo bajo) como primer entregable, o vas directo a **9B** (núcleo Pedidos)?
6. **`picking_runs`** (wave) en 9C: ¿sí o se difiere?
