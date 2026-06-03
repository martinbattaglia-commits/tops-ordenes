# GATE 4C — Despacho + Entrega (`0035`) · PLAN DE IMPLEMENTACIÓN DEFINITIVO

> Estado: **diseño de implementación. READ ONLY. NO implementado.** Sin SQL/TS/React/migraciones/RPC/UI.
> No se modificaron archivos, no commits, no push, no deploy.
> Arquitecto Principal + Staff Engineer (rol). Repo `~/CODE/tops-ordenes` @ `3b1b3a6`.
> Sucesor de `GATE_4C_DISPATCH_DESIGN.md` (diseño arquitectónico aprobado, D1–D6 resueltos): este documento
> baja ese diseño a **plan de implementación ejecutable** sobre la migración **`0035_wms_dispatch.sql`**.
>
> **⚠️ Cambio de contexto material vs. el diseño original:** **PITR NO está habilitado**; solo hay
> **backups diarios**. Como Gate 4C es el **primer egreso irreversible**, esto reordena la estrategia de
> seguridad: **la reversión compensatoria (`revert_dispatch`) + el backup manual inmediato pre-egreso pasan
> a ser la red primaria**, no el PITR (ver §12 Riesgos y §13 Checklist).

---

## 0. Verificaciones previas (confirmadas, READ ONLY)

| Verificación | Resultado |
|---|---|
| **Git — branch** | `main` |
| **Git — HEAD** | `3b1b3a6` (`fix(tracking): ingest de Traccar…`) |
| **Git — origin/main** | `3b1b3a6` (idéntico) |
| **Git — ahead/behind** | `0` / `0` (sincronizado) |
| **Git — working tree** | 2 handoffs `M` + docs/migración 4B.1 untracked. **`0034` aún sin commitear** (git:0) — recomendable commitear 4B.1 antes de 4C. |
| **Migraciones `0024→0034`** | Íntegras en disco; `0024–0033` versionadas; `0034` presente sin commitear; gaps `0028`/`0035` esperados. Orden y dependencias correctos. |
| **Ledger — inmutabilidad** | Trigger `trg_inventory_movements_immutable` (UPDATE/DELETE) + `trg_inventory_movements_no_truncate` (TRUNCATE) **intactos** (0026). Compatible con reversión compensatoria (solo INSERT). |
| **Packing — 4B.1** | `anular_packing_unit` (0034) operativa y validada → **D1=A satisfecho** (bultos vacíos trabados anulables y excluibles). |
| **Enums terminales 4C** | `alloc_status_t.despachada`, `order_item_status_t.despachado`, `logistics_order_status_t.despachado/entregado`, `packing_status_t.despachada` **ya congelados** (0030/0033). |

> **Nota de slate:** no existe definición real de `shipments`/`shipment_status_t`/`confirm_dispatch`/
> `confirm_delivery`/`revert_dispatch` (solo menciones en comentarios). `0035` es greenfield.

---

## 1. Resumen ejecutivo

Gate 4C cierra el ciclo logístico con dos eventos terminales y su reversa:

- **Despacho (`confirm_dispatch`)** — el **primer egreso real** del sistema. Saca la mercadería ya empacada:
  `stock_reserved -= q` + `inventory_lots.quantity -= q` (FEFO real, multi-lote) + asiento(s) `egreso` en el
  ledger inmutable. Transiciona allocations `empacada→despachada`, líneas `empacado→despachado`, bultos
  `cerrada→despachada`, pedido `preparado→despachado`. Crea **un `shipment`** por pedido.
- **Entrega (`confirm_delivery`)** — `shipment despachado→entregado`, pedido `despachado→entregado`. **Sin stock.**
- **Reversión (`revert_dispatch`)** — corrección operativa **antes de la entrega**: restituye stock con
  asientos `ingreso` **compensatorios** (el ledger no se muta), devuelve estados a `preparado`/`empacada`/
  `cerrada`, shipment `anulado`.

**Invariantes obligatorios (no se rediscuten):** `inventory_movements` append-only/inmutable; FEFO real por
lote en el egreso; toda escritura de stock vía RPC `SECURITY DEFINER`; roll-ups **derivados** de
allocations/shipment; cero escrituras directas desde UI (Server Actions + `revalidatePath()`).

**Migración única:** `0035_wms_dispatch.sql` (aditiva). Riesgo: **ALTO** (egreso irreversible, PITR off).

---

## 2. Modelo de datos

### 2.1 Tablas impactadas (existentes — solo lectura/escritura vía RPC, sin alterar esquema salvo §2.3)
- `inventory_items` — `stock_reserved -= q` en el egreso (NUNCA `stock_available`). `active` recalculado.
- `inventory_lots` — `quantity -= q` por lote (FEFO). Restituido en reversión.
- `inventory_movements` — **solo INSERT** de `egreso` (despacho) e `ingreso` (reversión compensatoria).
- `stock_allocations` — `status: empacada→despachada` (y reversa).
- `logistics_order_items` / `logistics_orders` — roll-up de estado (derivado).
- `packing_units` — `status: cerrada→despachada` + set `shipment_id` (y reversa).

### 2.2 Tabla nueva — `shipments` (cabecera de despacho · 1 por pedido, D2=A)
Patrón cabecera idéntico a `receptions`/`logistics_orders`/`packing_units` (`short_id` + `public_id` por trigger).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `short_id` | `int default nextval(seq)` | secuencia `shipment_short_id_seq` |
| `public_id` | `text unique` | `'DSP-2026-0001'` por trigger `set_shipment_public_id` |
| `order_id` | `uuid not null fk logistics_orders(id) on delete restrict` | 1:1 lógico con el pedido |
| `status` | `shipment_status_t not null default 'despachado'` | nace en el egreso |
| `carrier` | `text` | transportista (opcional, D4) |
| `vehicle_ref` | `text` | patente / id de vehículo (opcional → Traccar) |
| `tracking_ref` | `text` | id externo de seguimiento (opcional) |
| `dispatched_at` | `timestamptz not null default now()` | |
| `dispatched_by` | `uuid fk auth.users(id) on delete set null` | |
| `delivered_at` | `timestamptz` | null hasta entrega |
| `delivered_by` | `uuid fk auth.users(id) on delete set null` | |
| `received_by_name` | `text` | prueba simple de entrega |
| `reverted_at` | `timestamptz` | null salvo reversión |
| `reverted_by` | `uuid fk auth.users(id) on delete set null` | |
| `notes` | `text` | |
| `active` | `boolean not null default true` | `false` al anular |
| `created_at` | `timestamptz not null default now()` | |

**FK:** `order_id → logistics_orders(id)` (RESTRICT: no borrar pedido con despacho).
**Índices:**
- `shipments_order_idx (order_id)`
- `shipments_status_idx (status)`
- `public_id` unique (constraint)
- **`shipments_order_uk` = unique (order_id) WHERE status <> 'anulado'`** (índice parcial: 1 shipment vigente
  por pedido; permite re-despacho tras reversión).

> **No se crea `shipment_items`.** El detalle "qué salió" es derivable
> (`shipment → order → packing_units → packing_unit_items → stock_allocations → inventory_items/lot`) y el
> "cuánto salió del stock" está en `inventory_movements` (reference_id = shipment.id). Una tabla de detalle
> sería redundante en 4C-A; si una consolidación futura (4C.1) rompe el 1:1, se modela ahí.

### 2.3 Columna nueva (única alteración a tabla existente — aditiva)
- `packing_units.shipment_id uuid null fk shipments(id) on delete set null` — vincula bulto→despacho;
  deja la puerta abierta a consolidación multi-pedido sin rediseño. Columna nullable, sin default
  destructivo → no reabre Gate 4B. Índice `packing_units_shipment_idx (shipment_id)`.

### 2.4 RLS
`shipments`: lectura `authenticated`; **escritura solo vía RPC** (lockdown idéntico a `stock_allocations`
0031 / `packing_units` 0033 — sin policies de escritura; las RPC `SECURITY DEFINER` bypassan RLS).
`packing_units.shipment_id` se escribe solo dentro de las RPC de 4C (ya está bajo lockdown de 0033).

---

## 3. Enum — `shipment_status_t`

```
create type shipment_status_t as enum ('despachado', 'entregado', 'anulado');
```

| Estado | Significado | Naturaleza |
|---|---|---|
| `despachado` | egreso ejecutado; mercadería en tránsito | **estado de nacimiento** (lo setea `confirm_dispatch`) |
| `entregado` | recibido por el destinatario | **terminal feliz** (`confirm_delivery`) |
| `anulado` | despacho revertido por RPC compensatoria | **terminal de reversa** (`revert_dispatch`) |

**Transiciones permitidas:**
```
(nace) → despachado → entregado        (entrega: terminal)
                    → anulado          (reversión ANTES de entrega: terminal)
```
**Prohibidas:** `entregado → *` (terminal; revertir una entrega = devolución → gate posterior, no 4C);
`anulado → *` (terminal); cualquier reapertura.

**No se incluye `pendiente`:** el shipment **nace en el egreso**, no antes. El "estado de espera" es el bulto
`cerrada` (ya modelado por `packing_status_t`).

**Cast explícito a enum** en toda asignación (familia 42804, uniforme con 0031/0032/0033/0034).

---

## 4. RPC

Todas `SECURITY DEFINER`, `set search_path = public`, authz `current_role() in ('admin','operaciones',
'supervisor')`, cast explícito a enum, `FOR UPDATE` del pedido para serializar, hook `audit_log`. Grants a
`authenticated`. `notify pgrst` al final de la migración.

### 4.1 `confirm_dispatch(p_order_id uuid) returns uuid`  — EGRESO IRREVERSIBLE

- **Input:** `p_order_id`. **Output:** `shipments.id` (uuid del despacho creado).
- **Guards (orden):**
  1. Authz.
  2. `select … for update` del pedido; existe; `status = 'preparado'`.
  3. **D1=A:** no existe ningún `packing_unit` del pedido con `status='abierta'` (todos los no-`anulada`
     deben estar `cerrada`). Rechaza si hay bultos abiertos.
  4. Existe ≥1 allocation `empacada` del pedido (si no, nada que despachar → rechaza).
  5. Idempotencia/unicidad: no existe shipment vigente (`status<>'anulado'`) del pedido (backstop:
     índice parcial `shipments_order_uk`).
- **Efectos (una transacción, atómica · todo o nada):**
  1. **Crea `shipments`** (`public_id 'DSP-'`, `status='despachado'`, `dispatched_by=auth.uid()`).
  2. **Por cada allocation `empacada` del pedido** (FOR UPDATE, orden estable por `inventory_item_id`):
     - **Egreso FEFO por lote** (ver §5): decrementa `inventory_lots.quantity` lote a lote (más próximo a
       vencer primero) hasta cubrir `allocation.quantity`; **por cada lote** decrementado:
       `update inventory_lots set quantity = quantity - dec`; `update inventory_items set stock_reserved =
       stock_reserved - dec`; **inserta `inventory_movements`** (`egreso`, `reference_type='despacho'`,
       `reference_id=shipment.id`, `lot_number=lote`, `quantity=dec`, `before/after`=saldo total del ítem
       antes/después, `from_position_id=item.position_id`, `to_position_id=null`).
     - **Caso sin lote (D3=C):** si el ítem no tiene lotes activos (`allocation.lot_number` null), decrementa
       solo `stock_reserved -= allocation.quantity` e inserta **un** `egreso` con `lot_number=null`.
     - `update stock_allocations set status='despachada'` (no se toca `released_at`: es egreso, no liberación).
     - `active` del ítem recalculado (`= false` si `available+reserved <= 0`).
  3. **Vincula bultos:** `update packing_units set shipment_id=shipment.id, status='despachada'` para los
     bultos `cerrada` del pedido.
  4. **Roll-up** (`wms_dispatch_recompute(p_order_id)`): líneas `empacado→despachado`; pedido
     `preparado→despachado`.
  5. **`audit_log`** (`entity='logistics_order'`/`'shipment'`, `action='dispatch.confirm'`, payload:
     order_id, shipment_id, public_id, totales, lotes decrementados, count movimientos).
- **Guard de consistencia FEFO (§5):** si el ítem **tiene** lotes pero `Σ quantity disponible < cantidad a
  despachar`, **aborta** toda la transacción (no egreso parcial).

### 4.2 `confirm_delivery(p_shipment_id uuid) returns void`

- **Input:** `p_shipment_id`. **Output:** void.
- **Guards:** authz; shipment existe (FOR UPDATE); `status='despachado'`.
- **Efectos:** `shipments set status='entregado', delivered_at=now(), delivered_by=auth.uid(),
  received_by_name=coalesce(...)`; roll-up pedido `despachado→entregado`. **Cero stock/ledger.**
- **`audit_log`** (`action='delivery.confirm'`, payload: shipment_id, order_id, received_by_name).

### 4.3 `revert_dispatch(p_shipment_id uuid) returns void`  — reversión compensatoria

- **Input:** `p_shipment_id`. **Output:** void.
- **Guards:** authz; shipment existe (FOR UPDATE); **`status='despachado'`** (NO se revierte un `entregado` en
  4C → eso sería devolución, gate posterior); pedido en `despachado`.
- **Efectos (una transacción):**
  1. **Restitución de stock leída del ledger** (fuente de verdad): por cada `inventory_movements` con
     `reference_type='despacho' and reference_id=p_shipment_id and movement_type='egreso'`:
     `update inventory_lots set quantity = quantity + mov.quantity` (por `inventory_item_id`+`lot_number`,
     si lot no null); `update inventory_items set stock_reserved = stock_reserved + mov.quantity, active=true`;
     **inserta `inventory_movements`** compensatorio (`ingreso`, `reference_type='despacho'`,
     `reference_id=p_shipment_id`, `reason='reversion_despacho'`, `lot_number`, `quantity`, `before/after`).
  2. `update stock_allocations set status='empacada'` para las `despachada` del shipment.
  3. `update packing_units set status='cerrada', shipment_id=null` para los bultos del shipment.
  4. **Roll-up** (`wms_dispatch_recompute`): líneas `despachado→empacado`; pedido `despachado→preparado`.
  5. `update shipments set status='anulado', reverted_at=now(), reverted_by=auth.uid(), active=false`.
  6. **`audit_log`** (`action='dispatch.revert'`, payload: shipment_id, order_id, lotes restituidos).
- **Garantía:** **no UPDATE/DELETE** sobre los `egreso` originales — solo asientos `ingreso` nuevos. El ledger
  conserva egreso + reingreso (neto 0), historia íntegra.

### 4.4 Helper interno `wms_dispatch_recompute(p_order_id uuid)` (REVOKE public/authenticated)
Deriva el estado de **línea** (`empacado ↔ despachado`) y **pedido** (`preparado ↔ despachado ↔ entregado`)
a partir del conjunto de allocations + estado del shipment vigente. Mismo contrato que `wms_pick_recompute_line`
(0032) / `wms_pack_recompute` (0033). **Despacho-seguro**: inerte sobre estados que no le corresponden.

### 4.5 `confirm_movement` — NO se reutiliza ni se modifica
La rama `egreso` de `confirm_movement` (0027) decrementa **`stock_available`**, pero el egreso de despacho es
sobre **`stock_reserved`** + multi-lote FEFO + transición de allocations. Por eso `confirm_dispatch`
implementa el egreso **inline**. `confirm_movement` queda **intacto** (traslados/ajustes/egresos de stock
disponible). *(Opcional, additive y fuera de alcance de 4C: endurecer la validación de `reference_type='despacho'`
en `confirm_movement` ahora que `shipments` existe — no requerido.)*

---

## 5. FEFO — decremento por lote, multi-lote, estrategia exacta

- **Reserva (Gate 3, intacta):** FEFO a **nivel ítem**; `stock_allocations.lot_number` guarda un **lote
  representativo** (más próximo a vencer al reservar). No decrementa `inventory_lots`.
- **Despacho (4C, nuevo) — FEFO real materializado al egresar:** para cada allocation, `confirm_dispatch`
  **re-resuelve FEFO** sobre `inventory_lots` del ítem:
  ```
  select id, lot_number, quantity
  from inventory_lots
  where inventory_item_id = <item> and active and quantity > 0
  order by expiration_date asc nulls last, lot_number
  for update
  ```
  y decrementa **greedy** lote a lote: `dec = least(restante, lote.quantity)`, hasta cubrir `allocation.quantity`.
  - **Un lote cubre todo** → 1 decremento, 1 asiento `egreso`.
  - **Multi-lote (split)** → N decrementos, **N asientos `egreso`** (uno por lote, con su `lot_number` y `dec`).
  - **Sin lotes (D3=C)** → 0 decrementos de lote; `stock_reserved -= allocation.quantity`; 1 asiento `egreso`
    con `lot_number=null`.
- **Guard de consistencia (riesgo F4):** si el ítem **tiene** lotes y `Σ quantity disponible <
  allocation.quantity`, **aborta** la transacción completa (no egreso parcial ni cantidades negativas).
- **Invariante preservado:** para ítems con lotes, `Σ inventory_lots.quantity = stock_available +
  stock_reserved`. La reserva mantiene el invariante (solo shift de bucket); el despacho decrementa **ambos
  lados por la misma cantidad** → invariante intacto post-egreso.
- **Por qué re-resolver al egresar y no usar `allocation.lot_number`:** una columna `lot_number` única no
  expresa un split multi-lote, y el lote representativo pudo cambiar (recepciones/ajustes posteriores).
  Re-resolver garantiza el first-expired-first-out real sobre el estado vigente (D5=A; no reabre Gate 3).

---

## 6. `inventory_movements` — movimientos creados

| Evento | `movement_type` | `reference_type` | `reference_id` | `lot_number` | `reason` | Cantidad |
|---|---|---|---|---|---|---|
| Despacho (por lote) | `egreso` | `despacho` | `shipment.id` | lote o `null` | — | `dec` (parte del lote) |
| Reversión (por lote) | `ingreso` | `despacho` | `shipment.id` | mismo lote | `reversion_despacho` | mismo `dec` |

- `before_quantity`/`after_quantity` = saldo total del ítem (`stock_available + stock_reserved`) antes/después
  de cada paso (coherente con el patrón de 0027). `from_position_id = item.position_id`, `to_position_id =
  null` (egreso) / invertido conceptualmente en la compensación.
- **Granularidad:** **un asiento por lote** decrementado (auditoría FEFO completa). Una allocation de 100u
  cubierta por lote A(60)+B(40) → 2 asientos `egreso`.
- **Confirmaciones duras:**
  - ✅ **NO UPDATE** sobre `inventory_movements` (el trigger 0026 lo bloquea para todo rol).
  - ✅ **NO DELETE** sobre `inventory_movements` (idem).
  - La reversión **no borra ni modifica** los `egreso`; escribe `ingreso` **nuevos** (compensación).
- **Trazabilidad:** todo egreso de un despacho es reconstruible por `reference_id=shipment.id` (índice
  `inventory_movements_ref_idx (reference_type, reference_id)` ya existe en 0026). `revert_dispatch` lo usa
  para restituir exactamente lo egresado.

---

## 7. Reversión — `revert_dispatch()`

- **Qué CREA:** asientos `inventory_movements` **`ingreso`** compensatorios (`reason='reversion_despacho'`,
  `reference_id=shipment.id`), uno por lote restituido (espejo de los `egreso`).
- **Qué NO modifica:** **nunca** toca los `egreso` originales (inmutables); no borra filas del ledger; no
  altera el histórico de `audit_log`.
- **Cómo compensa:** lee del ledger los `egreso` del shipment, re-incrementa `inventory_lots.quantity` y
  `stock_reserved` por las mismas cantidades/lotes, y deja el saldo neto idéntico al previo al despacho. El
  ledger muestra **egreso + reingreso** (neto 0) → sin huecos, auditable.
- **Estados:** allocations `despachada→empacada`; bultos `despachada→cerrada` (+`shipment_id=null`); líneas
  `despachado→empacado`; pedido `despachado→preparado`; shipment `despachado→anulado`.
- **Alcance:** **whole-shipment atómico** (consistente con `confirm_dispatch` whole-order). Solo desde
  `despachado` (no `entregado`). Tras revertir, el pedido vuelve a `preparado` y es **re-despachable** (el
  shipment `anulado` libera el índice parcial `shipments_order_uk`; el re-despacho re-resuelve FEFO).
- **PITR off (contexto):** `revert_dispatch` es la **red de seguridad primaria** ante un despacho erróneo
  (no hay point-in-time recovery). Por eso es parte del alcance 4C desde el día 1, no diferida.

---

## 8. Roll-ups (derivados, vía `wms_dispatch_recompute`)

| Nivel | Estado | Regla |
|---|---|---|
| Allocation | `despachada` | la setea `confirm_dispatch` directamente |
| Línea (`order_item_status_t`) | `despachado` | cuando **todas** sus allocations vivas (≠`liberada`) están `despachada` |
| Pedido (`logistics_order_status_t`) | `despachado` | cuando **todas** las líneas no canceladas están `despachado` |
| Pedido | `entregado` | cuando su shipment vigente pasa a `entregado` (derivado del shipment) |
| Packing unit | `despachada` | la setea `confirm_dispatch` (bulto vinculado al shipment) |

- **Despacho-seguro:** `wms_pick_recompute_line` (0032) y `wms_pack_recompute` (0033) ya excluyen
  `despachado` de su recomputación (lo cuentan como completo e inmutable). `wms_dispatch_recompute` es el
  único que mueve líneas/pedido hacia/desde `despachado`/`entregado`. Sin flags sueltos: todo derivado.
- **Reversa simétrica:** la reversión recalcula a la inversa (líneas `empacado`, pedido `preparado`).

---

## 9. UI — mapa de pantallas (arquitectura, sin componentes)

> Reutiliza la ruta existente **`/wms/despachos`** (hoy placeholder `ModuleScaffold`). Estética `nx-*`.
> Mutaciones = **Server Actions + `revalidatePath()`**, **sin `router.refresh()`**.

| Ruta | Rol | Contenido |
|---|---|---|
| `/wms/despachos` | **Cola de despacho** | pedidos `preparado` con todos los bultos `cerrada` listos para egresar. KPIs: en cola, bultos cerrados, despachados hoy, entregados. |
| `/wms/despachos/[id]` | **Panel de despacho/entrega** | bultos + contenido (allocations/lotes que egresarán, con el lote FEFO a decrementar), datos de transporte (carrier/vehículo). Acciones: **Despachar** (confirmación reforzada "egreso irreversible"), y si despachado: **Entregar** y **Revertir despacho**. |
| `/wms/despachos` (tab/filtro "En tránsito") | **Entregas** | shipments `despachado` → marcar `entregado` (receptor). |

- **Revalidación (clave — el despacho SÍ toca stock):** las actions revalidan `/wms/despachos[/id]`,
  `/wms/packing[/id]`, `/pedidos[/id]`, **y además `/wms/inventario`, `/wms/lotes`, `/wms/vencimientos`**
  (a diferencia de Packing, que no tocaba stock).
- **Affordance:** "Despachar" como acción primaria con confirmación reforzada; "Revertir" como acción de
  peligro con confirmación; nunca escritura directa a DB desde el cliente.

---

## 10. TS — mapa de wrappers y server actions (arquitectura, sin código)

**Capa de datos `src/lib/dispatch/`** (patrón `isMock()` + `createClient()`; mutaciones solo vía RPC):
- `types.ts` — `ShipmentStatus`, `DispatchQueueRow`, `DispatchPanel`, `DispatchUnit`, `DispatchStop`
  (reusa `PhysicalLocation` canónica de Picking, como Packing).
- `dispatch.ts`:
  - `listDispatchQueue()` — pedidos `preparado` con bultos `cerrada` (lectura).
  - `listDispatchPanel(orderId)` — bultos + allocations + lotes FEFO previstos + shipment (lectura).
  - `confirmDispatch(orderId)` → `rpc('confirm_dispatch', { p_order_id })` (devuelve shipment id).
  - `confirmDelivery(shipmentId)` → `rpc('confirm_delivery', { p_shipment_id })`.
  - `revertDispatch(shipmentId)` → `rpc('revert_dispatch', { p_shipment_id })`.

**Server Actions `src/app/(app)/wms/despachos/actions.ts`** (espejo del patrón de packing `actions.ts`):
- `confirmDispatchAction(orderId)`, `confirmDeliveryAction(shipmentId, orderId)`,
  `revertDispatchAction(shipmentId, orderId)` → cada una envuelve el wrapper + `revalidate(orderId)` que
  incluye las rutas de stock (§9). Tipo `Result = {ok:true,id?} | {ok:false,error}`; helper `fail(e)`.

**Cliente** `_components/DispatchActions.tsx` — botones con `useTransition` + manejo de error (patrón de
`PackingActions`/`PackBoard`).

---

## 11. QA — estrategia de validación

### 11.1 Kit SQL transaccional (0 footprint) + variante reporte en filas
`BEGIN/ROLLBACK` + sentinel `__qa_rollback__` (no es DELETE → no choca con el ledger); mediciones en variables
PL/pgSQL que sobreviven al rollback, volcadas a `_qa_dispatch_report`. Fixture:
`confirm_reception → allocate_order → confirm_picking_order → confirm_packing_order` (pedido `preparado`).
**Casos:**
1. `confirm_dispatch` happy path → shipment `DSP-`/`despachado`; allocations `despachada`; líneas
   `despachado`; bultos `despachada`; pedido `despachado`.
2. **EGRESO stock:** `stock_reserved -= q`; `stock_available` **sin cambio**.
3. **FEFO un lote:** lote más próximo a vencer decrementado; 1 asiento `egreso`.
4. **FEFO multi-lote (split):** 2 lotes → 2 decrementos + 2 asientos `egreso` en orden de vencimiento.
5. **D3 sin lote:** egreso con `lot_number=null`; `inventory_lots` intacto; solo `stock_reserved--`.
6. **Guard consistencia (F4):** `Σ lotes < q` → aborta sin egreso parcial.
7. **Ledger append-only:** `inventory_movements` crece; intento de UPDATE/DELETE sobre un asiento → rechazado.
8. `confirm_delivery` → shipment/pedido `entregado`; **stock sin cambios**.
9. **`revert_dispatch`:** restituye `stock_reserved` + `inventory_lots` (mismos lotes); allocations
   `empacada`; bultos `cerrada`; pedido `preparado`; shipment `anulado`; ledger = egreso+ingreso (neto 0),
   sin borrar nada.
10. **Roll-up multi-línea:** pedido `despachado` solo cuando **todas** las líneas `despachado`.
11. **D1=A:** despachar con un bulto `abierta` → rechaza. (Aprovecha `anular_packing_unit` de 4B.1 para el
    fixture de bulto vacío excluido.)
12. **Idempotencia/unicidad:** `confirm_dispatch` 2× → 2º rechaza (`shipments_order_uk`).
13. **Forward-guards cruzados:** `unpack_allocation`/`reopen_packing_unit` sobre `despachada` → rechazan;
    habilitados recién tras `revert_dispatch`.
14. **Autorización:** JWT vacío / rol no autorizado → rechazo.

**Cierre del kit:** tras `ROLLBACK`, `count(inventory_movements)`, buckets e `inventory_lots.quantity` vuelven
al valor inicial (0 footprint verificable).

### 11.2 Smoke test (post-aplicación, mínimo, sobre datos de prueba)
Un `confirm_dispatch` sobre un pedido `Test-*` desechable → verificar shipment creado + 1 movimiento `egreso`
+ `stock_reserved` decrementado; luego `revert_dispatch` → todo restituido. (No tocar pedidos reales.)

### 11.3 E2E navegador
Pedido temporal `Test-general-001 / G-001`: reservar → pickear → empacar → cerrar → **despachar** (verificar
`stock_reserved--`, ledger `egreso`, `inventory_lots--`/FEFO en UI) → **entregar** → (en otro pedido)
**revertir** (verificar restitución + ledger compensatorio). Evidencia de red: `POST` de `revalidatePath` sin
`?_rsc`. Restaurar fixture (`G-001` a 100/0). Verificar revalidación de `/wms/inventario` y `/wms/lotes`.

---

## 12. Riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| **DEV/PROD comparten DB** (`arsksytgdnzukbmfgkju`); 4C escribe el primer egreso irreversible | 🔴 Crítica | Kit SQL 0 footprint; E2E solo con `Test-*`; **backup manual inmediato antes de aplicar `0035` y antes del primer despacho real**. |
| **PITR NO habilitado** (solo backups diarios) | 🔴 Crítica | **Sin point-in-time recovery:** un egreso erróneo solo se recupera por (a) **`revert_dispatch`** (red primaria, in-app, exacta) o (b) restaurar el **backup diario** (hasta ~24 h de pérdida). **Recomendación fuerte:** habilitar PITR antes de operar despachos reales; mientras tanto, **backup manual previo** a cada sesión de despacho real + validar `revert_dispatch` en el kit antes de PROD. |
| **Backups diarios como única red automática** | 🟠 Alta | Confirmar ventana/última corrida del backup diario antes de aplicar `0035`; anotar timestamp. Tratar `revert_dispatch` como el mecanismo de corrección preferente (no esperar al backup). |
| **Egreso sobre bucket equivocado** (`available` en vez de `reserved`, hallazgo L1) | 🔴 Alta | `confirm_dispatch` egresa inline sobre `stock_reserved`; **no** reutiliza `confirm_movement`. Caso 2 del kit dedicado. |
| **Reversión que viola inmutabilidad** | 🔴 Alta | Reversión = asientos `ingreso` nuevos; nunca UPDATE/DELETE. Trigger 0026 lo garantiza. Caso 9. |
| **FEFO: incoherencia `Σ lotes < reservado`** (datos legacy) | 🟠 Media | Guard de aborto en `confirm_dispatch` (no egreso parcial). Caso 6 + chequeo de coherencia previo en el kit. |
| **Despacho parcial de pedido** (intento de despachar líneas sueltas) | 🟠 Media | **No soportado en 4C:** despacho es **whole-order atómico** (todo o nada), consistente con la atomicidad de 4A/4B. El split sería una RPC futura; documentado para no introducirlo ad-hoc. |
| **Doble despacho por carrera** | 🟡 Baja | `FOR UPDATE` del pedido + índice parcial `shipments_order_uk`. Caso 12. |
| **Bulto vacío bloquea D1=A** | 🟢 Baja | Resuelto por 4B.1 (`anular_packing_unit`); anular y excluir. Caso 11. |
| **Olvido de revalidar rutas de stock en UI** (inventario desactualizado) | 🟡 Baja | `revalidate()` de las actions incluye `/wms/inventario`, `/wms/lotes`, `/wms/vencimientos`. Verificado en E2E. |
| **`0034` (4B.1) sin commitear** al iniciar 4C | 🟡 Baja | Commitear 4B.1 (migración + kit + docs) antes o junto con el arranque de 4C. |

---

## 13. Checklist de ejecución (paso a paso)

> **Migraciones las aplica Martín a mano en el SQL Editor** (el asistente no ejecuta WRITES). **Ningún paso
> sin OK explícito.** Con PITR off, los pasos de backup son **no negociables**.

**Fase 0 — Resguardo (obligatorio, reforzado por PITR off):**
- [ ] Commitear Mini-Gate 4B.1 (`0034` + kit + docs de cierre) y los handoffs actualizados (deja git limpio).
- [ ] Confirmar `main` ↔ `origin/main` sincronizados; crear rama `feat/gate-4c-dispatch` desde HEAD.
- [ ] **Backup manual de Supabase** (snapshot) **inmediatamente antes** de aplicar `0035`. Registrar en
      `SUPABASE_BACKUP_CHECKLIST.md` con timestamp.
- [ ] Confirmar última corrida del **backup diario** y su ventana de retención (red secundaria).
- [ ] (Recomendado) Gestionar **habilitación de PITR** antes de despachos reales.

**Fase 1 — Migración `0035_wms_dispatch.sql` (un archivo, aditivo):**
- [ ] Enum `shipment_status_t`. Tabla `shipments` + secuencia + trigger `set_shipment_public_id` ('DSP-') +
      índices (incl. parcial `shipments_order_uk`). `ALTER packing_units ADD shipment_id` + índice. RLS lockdown.
- [ ] RPC `confirm_dispatch`, `confirm_delivery`, `revert_dispatch` + helper `wms_dispatch_recompute`
      (REVOKE public/authenticated). Grants `authenticated`. `notify pgrst`.
- [ ] Header con garantía explícita: "primer egreso; toca `stock_reserved`+`inventory_lots`; INSERT-only en
      ledger; jamás UPDATE/DELETE; reversión compensatoria".
- [ ] Aplicar `0035` a mano. Verificar objetos + reload de PostgREST.

**Fase 2 — Validación SQL (bloqueante, 0 footprint):**
- [ ] Correr `gate4c_dispatch_validation_report.sql` (14 casos §11.1). Todo `OK`. **No avanzar si algún
      NO-* / guard / reversión falla.**
- [ ] Smoke test §11.2 sobre `Test-*` (despacho + revert), restaurar.

**Fase 3 — Capa TS:**
- [ ] `src/lib/dispatch/{types,dispatch}.ts` (lecturas + 3 wrappers RPC). `tsc`/`eslint` verdes.

**Fase 4 — UI:**
- [ ] `/wms/despachos` (cola), `/wms/despachos/[id]` (panel), `actions.ts` (revalida rutas de stock),
      `_components/DispatchActions.tsx`. Confirmación reforzada en Despachar/Revertir.

**Fase 5 — E2E (§11.3):**
- [ ] Flujo completo con `Test-*`; verificar egreso/ledger/FEFO/entrega/reversión + revalidación de stock.
      Evidencia de red sin `?_rsc`. Restaurar `G-001` 100/0.

**Fase 6 — Cierre:**
- [ ] Actualizar handoffs: Gate 4C cerrado; mover devolución/consolidación a 4C.1.
- [ ] Commit aislado `feat(wms): Gate 4C Despacho + Entrega` (migración + TS + UI + kits + docs).
- [ ] Push a `origin/main` (respaldo remoto del primer egreso).

---

## 14. Definition of Done

- [ ] `0035_wms_dispatch.sql` aplicada; `shipments` + `shipment_status_t` + `packing_units.shipment_id` + 3 RPC
      + helper creados; RLS lockdown activo; PostgREST recargado.
- [ ] Kit SQL (14 casos) **todo OK, 0 footprint**; reversión y guards validados; smoke test OK.
- [ ] **Egreso correcto:** decrementa `stock_reserved` (no `available`) + `inventory_lots` FEFO real
      (single y multi-lote) + D3 sin lote; guard de consistencia aborta egresos incoherentes.
- [ ] **Ledger:** asientos `egreso` por lote escritos; **0 UPDATE / 0 DELETE**; reversión = `ingreso`
      compensatorio (neto 0).
- [ ] **Roll-ups derivados** correctos (línea/pedido/bulto/shipment), despacho-seguros y simétricos en reversa.
- [ ] **D1=A** satisfecho (bultos `cerrada`; vacíos anulados vía 4B.1); whole-order atómico; unicidad de shipment.
- [ ] Capa TS + UI funcionando; `tsc`/`eslint` verdes; **revalidación de rutas de stock** verificada; sin
      `router.refresh()`.
- [ ] E2E completo (despacho→entrega→reversión) con evidencia; `G-001` restaurado 100/0.
- [ ] **Resguardo:** backup manual pre-`0035` registrado; backup diario confirmado; (recomendado) PITR gestionado.
- [ ] Commit aislado + push; handoffs actualizados (Gate 4C cerrado).

---

> **FIN — Plan de implementación de Gate 4C (`0035`). READ ONLY, diseño únicamente.**
> Sin SQL/TS/React/migraciones/RPC/UI. Sin modificaciones, commits, push ni deploy.
> Listo para aprobación. Tras el OK: Fase 0 (commit 4B.1 + backup manual, PITR off) → `0035` → validación →
> TS → UI → E2E → commit + push. **Gate 4C NO iniciado.**
