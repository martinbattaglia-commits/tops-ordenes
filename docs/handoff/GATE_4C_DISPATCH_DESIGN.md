# GATE 4C — Despacho + Entrega · Documento de diseño (BORRADOR para aprobación arquitectónica)

> Estado: **propuesta de diseño. NO implementado.** Sin código, sin migraciones, sin TS, sin UI.
> Metodología (igual que 4A/4B): diseño → OK arquitectónico → backup → migración → validación SQL
> (kit 0 footprint) → capa TS → UI → validación visual → commit aislado → push.
> Aditivo sobre Gates 1–4B. **No reabre** nada validado (Recepción, Inventario, Reserva, Picking, Packing).
>
> **Gate 4C es el PRIMER egreso irreversible del sistema.** Es el único gate que decrementa
> `inventory_lots` y mueve stock fuera del depósito (`reserved → 0`) escribiendo el ledger inmutable
> `inventory_movements` con un movimiento `egreso`. Toda la severidad del diseño se deriva de eso.
>
> Verificado contra repo: `main` @ `3b1b3a6` (sincronizado con `origin/main`, 0/0), migraciones
> `0024`–`0033` íntegras y versionadas en git, gaps `0012`/`0028` intencionales.

---

## 0. Pre-condiciones de estabilización (verificadas antes de diseñar)

| Pre-condición | Estado | Evidencia |
|---|---|---|
| Repositorio estabilizado | ✅ | working tree limpio |
| `main` ↔ `origin/main` sincronizados | ✅ | `rev-list --left-right --count` = `0 0` |
| Gate 2 (Inventario+Ledger) cerrado | ✅ | `0024`/`0026` aplicadas y versionadas |
| Gate 3 (Pedidos+Reserva FEFO) cerrado | ✅ | `0030`/`0031` aplicadas y versionadas |
| Gate 4A (Picking) cerrado | ✅ | `0032`, commit `17b0be5` |
| Gate 4B (Packing) cerrado | ✅ | `0033`, commit `c5390bd` |
| Cadena `0025 → 0033` íntegra | ✅ | `git ls-files` lista 0024-0033 (0028 gap intencional) |
| `inventory_movements` inmutable | ✅ | trigger `trg_inventory_movements_immutable` (0026) bloquea U/D/T a todo rol |
| Enums terminales congelados | ✅ | `despachada`/`despachado`/`entregado`/`packing.despachada` ya declarados, sin RPC que los setee |

> **Nota sobre el handoff:** `WMS_PHASE_CLOSURE_HANDOFF.md` (2026-06-03) reportaba dos riesgos
> hoy **superados** por el avance del repo: (1) "cadena de migraciones partida en git" y (2) "main
> sin push". Ambos están resueltos en `3b1b3a6`. El presente diseño asume el repo en ese estado.

---

## 1. Objetivo funcional

Cerrar el ciclo logístico ejecutando el **egreso físico real** de la mercadería ya empacada y su
posterior **entrega** al destinatario. Gate 4C confirma dos eventos terminales:

**Despacho (`confirm_dispatch`)** — la mercadería sale del depósito:
- `stock_allocations.status`: **`empacada` → `despachada`**.
- `logistics_order_items.status`: **`empacado` → `despachado`**.
- `packing_units.status`: **`cerrada` → `despachada`**.
- `logistics_orders.status`: **`preparado` → `despachado`** (derivado).
- **EGRESO de stock**: `inventory_items.stock_reserved -= qty`, `inventory_lots.quantity -= qty` (FEFO),
  y **un asiento `inventory_movements` (`egreso`, `reference_type='despacho'`)** por cada decremento de lote.
- Crea **un `shipment`** (cabecera de despacho) que agrupa los bultos del pedido.

**Entrega (`confirm_delivery`)** — el destinatario recibe:
- `shipments.status`: **`despachado` → `entregado`**.
- `logistics_orders.status`: **`despachado` → `entregado`** (derivado).
- **Sin impacto de stock** (la mercadería ya egresó en el despacho).

A diferencia de Picking (4A) y Packing (4B), que **NO tocan stock**, Despacho es el momento en que la
mercadería deja de existir en el inventario lógico. **Es irreversible salvo por una RPC de reversión
explícita y compensatoria** (§14), nunca por mutación del ledger.

---

## 2. Modelo de datos

### 2.1 Principios heredados (no se rediscuten)
- **`inventory_movements` es la única fuente de verdad del stock físico** (append-only, inmutable).
  El egreso real de Gate 4C se materializa **acá** y solo acá.
- **`stock_allocations` gobierna los estados operativos**; líneas/pedido/bultos/shipment se **derivan**.
- **Toda escritura de stock/estados pasa por RPC `SECURITY DEFINER`** (RLS lockdown; el front nunca escribe).
- **Roll-ups derivados, nunca flags primarios** (patrón `wms_pick_recompute_line` / `wms_pack_recompute`).
- **Mutaciones UI = Server Actions + `revalidatePath()`**, nunca `router.refresh()`.

### 2.2 Entidad nueva: `shipments` (cabecera de despacho)
Espeja el patrón cabecera/detalle de `receptions` / `logistics_orders` / `packing_units`.
**1 shipment ↔ 1 pedido** (D2 = A). El vínculo con los bultos se hace por una columna **aditiva**
`packing_units.shipment_id` (nullable), que deja la puerta abierta a consolidación futura sin rediseño.

El `shipment` **NO** duplica el detalle de contenido: el "qué salió" ya está en `packing_unit_items`
(→ `stock_allocations` → `inventory_items`/`lot_number`) y el "cuánto salió del stock" en
`inventory_movements`. El shipment es el **nodo de despacho/entrega y el ancla de tracking** (D4).

### 2.3 Relación con el ledger
El egreso escribe `inventory_movements` con:
- `movement_type = 'egreso'`
- `reference_type = 'despacho'`
- `reference_id  = shipments.id`  ← traza polimórfica despacho→ledger
- `from_position_id = inventory_items.position_id`, `to_position_id = null` (sale del depósito)
- `before_quantity`/`after_quantity` = saldo total del ítem (available+reserved) antes/después.

---

## 3. Tablas nuevas

```
shipments
  id                uuid pk default gen_random_uuid()
  short_id          int  (sequence)                       -- legible
  public_id         text unique                           -- 'DSP-2026-0001' (trigger set_*_public_id)
  order_id          uuid not null fk logistics_orders(id) on delete restrict   -- 1:1 lógico con el pedido
  status            shipment_status_t not null default 'despachado'
  carrier           text                                  -- transportista (opcional, D4)
  vehicle_ref       text                                  -- patente / id de vehículo (opcional, D4 → Traccar)
  tracking_ref      text                                  -- id externo de seguimiento (opcional)
  dispatched_at     timestamptz not null default now()
  dispatched_by     uuid fk auth.users(id) on delete set null
  delivered_at      timestamptz                           -- null hasta entrega
  delivered_by      uuid fk auth.users(id) on delete set null
  received_by_name  text                                  -- quién recibió (texto libre, prueba de entrega)
  reverted_at       timestamptz                           -- null salvo reversión
  reverted_by       uuid fk auth.users(id) on delete set null
  notes             text
  active            boolean not null default true
  created_at        timestamptz not null default now()

  -- 1 shipment vigente por pedido (permite re-despacho tras reversión: el anulado libera el slot)
  -- índice único parcial: unique (order_id) where status <> 'anulado'
```

**Columna aditiva sobre tabla existente (única modificación fuera de tablas nuevas):**
```
packing_units
  + shipment_id   uuid null fk shipments(id) on delete set null   -- bulto → despacho (consolidación-ready)
```
> Es la **única** alteración a una tabla previa. Es estrictamente aditiva (columna nullable, sin
> default destructivo, sin tocar datos existentes), por lo que no reabre Gate 4B.

**RLS:** lectura `authenticated`; **escritura solo vía RPC** (lockdown idéntico a `stock_allocations`
0031 / `packing_units` 0033). `shipments` y la columna `packing_units.shipment_id` son solo-lectura
para todos los roles; las RPC `SECURITY DEFINER` son el único camino de escritura.

> **No se crea `shipment_items`.** El detalle de contenido es derivable
> (`shipment → order → packing_units → packing_unit_items → allocations`). Agregar una tabla de
> detalle sería redundante en 4C-A. Si una futura consolidación (4C.1) rompe el 1:1, el detalle
> se modela ahí, no acá (additive).

---

## 4. Enums nuevos

- **`shipment_status_t`** (nuevo): `('despachado', 'entregado', 'anulado')`.
  - `despachado` = egreso ejecutado, mercadería en tránsito (estado de nacimiento del shipment).
  - `entregado`  = recibido por el destinatario (terminal feliz).
  - `anulado`    = despacho revertido por RPC compensatoria (§14).
  - **No** se incluye `pendiente`: el shipment **nace en el momento del egreso**, no antes (no hay
    "shipment en borrador" — el bulto cerrado es el estado de espera, ya modelado por `packing_status`).

- **NO se crean enums de allocation / línea / pedido / packing.** Los estados terminales que consume 4C
  ya están **congelados**:
  - `alloc_status_t.despachada` (0030)
  - `order_item_status_t.despachado` (0030)
  - `logistics_order_status_t.despachado` / `.entregado` (0030)
  - `packing_status_t.despachada` (0033)

- **D6 = A (mínimo):** **NO** se crean `rechazado` / `devolucion`. La logística inversa (reingreso de
  stock al ledger) es un gate posterior (§ D6).

---

## 5. RPC necesarias

Todas `SECURITY DEFINER`, authz `admin/operaciones/supervisor`, cast explícito a enum, `FOR UPDATE`
sobre el pedido para serializar (mismo patrón que `confirm_packing_order`).

### 5.1 `confirm_dispatch(p_order_id) → uuid` (devuelve `shipments.id`)
**El egreso irreversible.** Orquestación atómica (una sola transacción; todo o nada):
1. **Guards de entrada (D1 = A):**
   - Pedido en `preparado`.
   - **Todos** los `packing_units` no `anulada` del pedido en `cerrada` (rechaza si hay `abierta`).
   - **Todas** las allocations vivas (≠ `liberada`) del pedido en `empacada`.
   - Idempotencia: si ya existe `shipment` vigente (≠ `anulado`) del pedido → no-op / rechazo explícito.
2. **Crea `shipments`** (`public_id 'DSP-'`, `status='despachado'`, `dispatched_by=auth.uid()`).
3. **Por cada allocation `empacada` del pedido** (loop FEFO §11):
   - Resuelve egreso de lote por **FEFO real** sobre `inventory_lots` (lote más próximo a vencer del ítem),
     decrementando `quantity` lote a lote hasta cubrir `allocation.quantity` (multi-lote si hace falta).
   - Decrementa `inventory_items.stock_reserved -= allocation.quantity`.
   - Escribe **un `inventory_movements` (`egreso`, `reference_type='despacho'`, `reference_id=shipment.id`)**
     por **cada lote** decrementado (o uno solo con `lot_number=null` si el ítem no tiene lotes — D3).
   - `allocation.status: empacada → despachada`, `released_at` queda null (no es liberación, es egreso).
4. **Vincula bultos:** `packing_units.shipment_id = shipment.id`, `status: cerrada → despachada`.
5. **Roll-ups** (`wms_dispatch_recompute`): líneas `empacado → despachado`; pedido `preparado → despachado`.
6. **Audit:** `audit_log` (`dispatch.confirm`, payload con order, shipment, totales, lotes decrementados).

### 5.2 `confirm_delivery(p_shipment_id) → void`
1. Guard: shipment en `despachado`.
2. `shipments.status: despachado → entregado`, `delivered_at=now()`, `delivered_by=auth.uid()`,
   `received_by_name` opcional.
3. Roll-up: pedido `despachado → entregado` (derivado del shipment).
4. **Sin impacto de stock** (D6 = A).
5. Audit: `audit_log` (`delivery.confirm`).

### 5.3 `revert_dispatch(p_shipment_id) → void` (reversión compensatoria — §14)
Reversa controlada del egreso **sin violar la inmutabilidad del ledger**: escribe movimientos
**nuevos** de signo opuesto, nunca borra ni actualiza los `egreso` originales.
1. Guard: shipment en `despachado` (no se revierte un `entregado` en 4C; eso sería devolución → gate posterior).
2. Por cada allocation `despachada` del shipment:
   - **Re-incrementa** `inventory_lots.quantity` (mismos lotes que el egreso, leídos del ledger original)
     y `inventory_items.stock_reserved`.
   - Escribe **un `inventory_movements` (`ingreso`, `reference_type='despacho'`, `reference_id=shipment.id`,
     `reason='reversion_despacho'`)** por lote restituido (movimiento compensatorio, append-only).
   - `allocation.status: despachada → empacada`.
3. `packing_units: despachada → cerrada`, `shipment_id = null`.
4. Roll-ups: líneas `despachado → empacado`; pedido `despachado → preparado`.
5. `shipments.status: despachado → anulado`, `reverted_at`/`reverted_by`.
6. Audit: `audit_log` (`dispatch.revert`).

### 5.4 Helper interno `wms_dispatch_recompute(p_order_id)` (REVOKE public/authenticated)
Deriva el estado de **línea** (`empacado ↔ despachado`) y **pedido**
(`preparado ↔ despachado ↔ entregado`) a partir del conjunto de allocations + estado del shipment.
Mismo contrato que `wms_pick_recompute_line` / `wms_pack_recompute`. **Despacho-seguro**: inerte sobre
estados terminales que no le corresponden.

> **Sobre extender `confirm_movement`:** el handoff sugería "extender `confirm_movement` para
> `'despacho'`". **Recomendación: NO reutilizar la rama `egreso` existente** — esa rama (0027:271)
> decrementa `stock_available`, pero el stock despachable vive en **`stock_reserved`**. Además el egreso
> de despacho requiere loop multi-lote FEFO + asiento por lote + transición de allocations, todo
> atómico con la creación del shipment. Encapsularlo **inline en `confirm_dispatch`** es más seguro
> (una transacción, semántica `reserved→0` correcta) que sobrecargar `confirm_movement`. `confirm_movement`
> queda intacto para traslados/ajustes/egresos de stock disponible (no reservado).

---

## 6. Roll-ups

| Nivel | Estado | Regla derivada |
|---|---|---|
| Allocation | `despachada` | la setea `confirm_dispatch` directamente (egreso ejecutado) |
| Línea (`order_item_status_t`) | `despachado` | cuando **todas** sus allocations vivas (≠`liberada`) están `despachada` |
| Pedido (`logistics_order_status_t`) | `despachado` | cuando **todas** las líneas no canceladas están `despachado` |
| Pedido | `entregado` | cuando su `shipment` vigente pasa a `entregado` (derivado del shipment, no de allocations) |
| Packing unit | `despachada` | la setea `confirm_dispatch` (bulto vinculado al shipment) |

- Coherente con 4A/4B: el estado se **deriva** de la realidad de allocations + shipment; sin flags sueltos.
- **Despacho-seguro:** `wms_pick_recompute_line` (0032) y `wms_pack_recompute` (0033) ya excluyen
  `despachado` de sus recomputaciones (líneas `despachado` se cuentan como completas e **inmutables** para
  esos helpers). `wms_dispatch_recompute` es el único que mueve líneas/pedido hacia/desde `despachado`.

---

## 7. Interacción con Picking (4A) y Packing (4B)

- **Entrada de 4C = salida de 4B:** pedido `preparado`, allocations `empacada`, bultos `cerrada`.
- `confirm_dispatch` exige allocations `empacada` (la salida de 4B) y bultos `cerrada` (D1 = A).
- Al despachar, allocations `empacada → despachada` y bultos `cerrada → despachada`: **desaparecen de los
  tableros de Picking y Packing** (que solo listan `reservada`/`pickeada` y `pickeada`/`empacada`).
- **Forward-guards ya instalados (sin cambios en 4A/4B):**
  - `unpick_allocation` (4A) bloquea si la línea está `empacado`/`despachado`/`cancelado`.
  - `unpack_allocation` (4B) bloquea si la línea está `despachado`/`cancelado`.
  - `reopen_packing_unit` (4B) bloquea si el bulto está `despachada`.
  - → Para deshacer un despacho **hay que `revert_dispatch` primero** (4C); recién entonces `unpack`/`unpick`
    vuelven a estar disponibles. La cadena de reversa es estrictamente LIFO: dispatch → packing → picking.
- **`cancel_order` (Gate 3):** ya **no** libera allocations `pickeada`/`empacada`; con 4C tampoco libera
  `despachada`. Cancelar un pedido despachado exige `revert_dispatch` antes (queda documentado como
  invariante operativo; no se modifica `cancel_order`).

---

## 8. Impacto sobre stock

**Es el primer gate con impacto real.** Sobre `inventory_items`:

| Bucket | Antes (preparado) | Después (despachado) | Mecanismo |
|---|---|---|---|
| `stock_available` | X | X (sin cambio) | la mercadería ya estaba en `reserved`, no en `available` |
| `stock_reserved` | Y (incluye la del pedido) | Y − qty_despachada | `confirm_dispatch` decrementa el bucket reservado |

- **Invariante post-despacho:** `stock_reserved = Σ allocations 'reservada' + reservado_por_cuarentena`
  (las `despachada` ya **no** suman a `reserved`). Esto extiende el invariante de 0031 al egreso.
- **`active`:** si `stock_available + stock_reserved` llega a 0 tras el egreso, el ítem puede marcarse
  `active=false` (mismo criterio que la rama `egreso` de `confirm_movement`).
- **El egreso decrementa `stock_reserved`, NUNCA `stock_available`** — diferencia clave con el egreso de
  stock disponible de `confirm_movement` (§5.4). Validado como caso de prueba dedicado (§12).

---

## 9. Impacto sobre `inventory_movements`

- **`inventory_movements` es inmutable** (trigger 0026). Gate 4C **solo INSERTA** asientos `egreso`
  (despacho) e `ingreso` (reversión compensatoria). **Jamás** UPDATE/DELETE/TRUNCATE (el trigger lo
  impediría incluso a `service_role`).
- **Un asiento por lote decrementado** (granularidad FEFO): si una allocation de 100u se cubre con
  lote A (60u) + lote B (40u), se escriben **2** asientos `egreso` (60 y 40), cada uno con su `lot_number`.
- Cada asiento lleva `reference_type='despacho'`, `reference_id=shipments.id`, `before_quantity`/
  `after_quantity` (saldo total del ítem), `from_position_id=posición`, `to_position_id=null` (externo).
- **Reversión = movimientos NUEVOS compensatorios** (`ingreso`, `reason='reversion_despacho'`,
  mismo `reference_id`), que dejan el rastro de auditoría completo: el ledger muestra egreso + reingreso,
  nunca un hueco. El saldo neto vuelve al origen; la historia queda intacta.
- **Auditoría cruzada:** todo `egreso` de despacho es reconstruible desde `shipments.id` vía
  `inventory_movements.reference_id`, y todo `dispatch.confirm`/`dispatch.revert` queda en `audit_log`.

---

## 10. Estrategia FEFO por lote (resuelve el gap diferido desde 4C)

El gap "FEFO split por lote" (decrementar el lote correcto en `inventory_lots`) estaba **diferido a 4C**
desde Gate 2. Aquí se cierra:

- **Reserva (Gate 3, intacto):** FEFO opera **a nivel ítem**. `allocate_order` ordena candidatos por
  `min(expiration_date)` del ítem y guarda en `stock_allocations.lot_number` un **lote representativo**
  (el más próximo a vencer al momento de reservar). **No** decrementa `inventory_lots`.
- **Despacho (Gate 4C, nuevo):** el lote exacto se **materializa al egresar**. `confirm_dispatch`
  **re-resuelve FEFO real** sobre `inventory_lots` del ítem (orden `expiration_date asc nulls last`) y
  decrementa **lote a lote** hasta cubrir `allocation.quantity`:
  - Caso 1 — un lote cubre todo: 1 decremento, 1 asiento `egreso`.
  - Caso 2 — varios lotes (FEFO split): N decrementos, N asientos `egreso` (uno por lote).
  - Caso 3 (D3) — ítem **sin** `inventory_lots` (`lot_number` null): **no** se toca `inventory_lots`;
    se decrementa solo `stock_reserved`; 1 asiento `egreso` con `lot_number=null`.
- **Por qué re-resolver en el despacho y no usar el `lot_number` guardado en la allocation:** el lote
  representativo guardado en la reserva puede haber quedado desactualizado (recepciones posteriores,
  ajustes) y, sobre todo, una sola columna `lot_number` **no puede expresar un split multi-lote**.
  Re-resolver FEFO al egresar garantiza el "first-expired, first-out" real sobre el estado vigente del
  inventario. (D5 = A: FEFO a nivel ítem en la reserva + decremento FEFO real en el egreso; **no reabre
  Gate 3**.)
- **Guard de consistencia:** si la suma de `inventory_lots.quantity` del ítem es menor que la cantidad a
  despachar (incoherencia stock vs. lotes), `confirm_dispatch` **aborta** la transacción completa
  (no egreso parcial). Caso de prueba dedicado (§12).

---

## 11. Estrategia de despacho

- **Unidad de despacho (D2 = A):** **1 `shipment` por pedido**. Diseño additive
  (`packing_units.shipment_id` nullable) que **no bloquea** una consolidación multi-pedido futura
  (capa "viaje/manifiesto" en Gate 4C.1 o Tracking).
- **Condición de despacho (D1 = A):** todos los bultos no anulados del pedido en `cerrada` + todas las
  allocations en `empacada`. *Prerrequisito operativo:* resolver la deuda `anular_packing_unit` (bulto
  vacío trabado) o que `confirm_dispatch` **ignore explícitamente** los `packing_units` `anulada`/vacíos
  (ver §15, Riesgo R1).
- **Atomicidad:** todo el egreso del pedido ocurre en **una transacción** (`confirm_dispatch`). No hay
  despacho parcial de pedido en 4C: o sale completo o no sale (consistente con la atomicidad de allocation
  de 4A/4B). El despacho parcial sería una RPC futura (split), sin romper el modelo.
- **Serialización:** `FOR UPDATE` sobre el pedido (igual que `confirm_packing_order`) evita doble shipment
  por carrera; el índice único parcial `unique(order_id) where status<>'anulado'` lo garantiza a nivel DB.
- **Tracking (D4):** 4C registra `carrier`/`vehicle_ref`/`tracking_ref` en `shipments` (texto/opcional) y
  **reutiliza el módulo Tracking de Flota existente (Traccar/Mapbox, 0016-0019) a nivel vehículo**. El
  tracking **por bulto/unidad** (QR/AirTag) es alcance de **Gate 5** (cadena de custodia sobre
  `packing_units`). **4C no se acopla a hardware.**

---

## 12. Estrategia de entrega

- **Modelo (D6 = A):** ciclo feliz `despachado → entregado` vía `confirm_delivery`. Terminal.
- La entrega es un evento de **estado puro**: actualiza `shipments` (`entregado`, `delivered_at`,
  `received_by_name` como prueba simple de entrega) y deriva el pedido a `entregado`. **No mueve stock**
  (ya egresó en el despacho).
- **Rechazo / Devolución NO entran en 4C** (D6 = A): implican **reingreso de stock al ledger**
  (`ingreso`/`ajuste`), enums nuevos (`rechazado`/`devolucion`) y mayor superficie. Se difieren a un gate
  "Reverse Logistics" (4C.1). El diseño de `shipments` queda **preparado** para colgar ese evento
  (campos `received_by_name`, `notes`, y la traza `reference_id` en el ledger) sin rediseño.

---

## 13. Estrategia de reversión

> **Distinción crítica:** "reversión" (operativa, dentro de 4C) ≠ "devolución" (logística inversa, gate
> posterior). 4C cubre **solo** la reversión de un despacho **antes** de la entrega (corrección de error
> operativo: se despachó por equivocación). La devolución de mercadería ya entregada es D6/gate posterior.

- **`revert_dispatch(p_shipment_id)`** (§5.3) revierte un shipment `despachado` (no `entregado`):
  restituye stock (`stock_reserved` + `inventory_lots`), devuelve allocations a `empacada`, bultos a
  `cerrada`, pedido a `preparado`, y marca el shipment `anulado`.
- **Inmutabilidad respetada:** la reversión **no borra** los `egreso` originales; escribe asientos
  `ingreso` compensatorios (`reason='reversion_despacho'`). El ledger conserva egreso + reingreso → saldo
  neto restaurado, historia íntegra. Esto es **obligatorio** porque `inventory_movements` es inmutable.
- **Restitución de lotes exacta:** la reversión lee del ledger los asientos `egreso` del shipment
  (`reference_id`) para re-incrementar **los mismos lotes** en las mismas cantidades (no re-resuelve FEFO;
  restaura literalmente lo que salió).
- **LIFO estricto:** el orden de reversa es dispatch → (luego ya disponibles) unpack → unpick. Los
  forward-guards de 4A/4B garantizan que no se puede saltear (no se puede `unpack` un `despachado`).
- **Re-despacho:** tras revertir, el pedido vuelve a `preparado` y puede re-despacharse (el shipment
  `anulado` libera el slot del índice único parcial). El re-despacho re-resuelve FEFO sobre el estado
  vigente.

---

## 14. Validación SQL

Kit transaccional **0 footprint** (doble seguro `BEGIN/ROLLBACK` + sentinel `__qa_rollback__`) **y**
variante con **reporte en filas** (el SQL Editor de Supabase no muestra `RAISE NOTICE`), igual que 4A/4B.
Fixture completo: `confirm_reception → allocate_order → confirm_picking → pack_allocation →
close_packing_unit` para llegar a `preparado`, luego despacho/entrega.

**Casos:**
1. `confirm_dispatch` → allocations `despachada`, líneas `despachado`, bultos `despachada`, pedido
   `despachado`; `shipments` creado (`DSP-`, `despachado`).
2. **EGRESO de stock:** `stock_reserved` decrementa exactamente la cantidad despachada; `stock_available`
   **sin cambio**.
3. **FEFO un lote:** `inventory_lots.quantity` del lote más próximo a vencer decrementa; 1 asiento `egreso`.
4. **FEFO split multi-lote:** allocation que abarca 2 lotes → 2 decrementos + 2 asientos `egreso` con sus
   `lot_number`, en orden de vencimiento.
5. **D3 sin lote (`G-001`):** egreso con `lot_number=null` → `inventory_lots` intacto, solo
   `stock_reserved--`, 1 asiento `egreso` `lot_number=null`.
6. **Ledger append-only:** `inventory_movements` **crece** (a diferencia de 4A/4B); intento de UPDATE/DELETE
   sobre un asiento → rechazado por trigger.
7. `confirm_delivery` → shipment `entregado`, pedido `entregado`, **stock sin cambios**.
8. **`revert_dispatch`:** restaura `stock_reserved` + `inventory_lots` (mismos lotes), allocations
   `empacada`, bultos `cerrada`, pedido `preparado`, shipment `anulado`; ledger muestra `egreso`+`ingreso`
   compensatorio (neto 0), sin borrar nada.
9. **Roll-up multi-línea:** pedido `despachado` solo cuando **todas** las líneas `despachado`.
10. **Idempotencia / unicidad:** `confirm_dispatch` 2× → segundo rechaza (shipment vigente existe);
    `unique(order_id) where status<>'anulado'`.
11. **Guards D1:** despachar con un bulto `abierta` → rechaza; con allocation no `empacada` → rechaza.
12. **Guard consistencia FEFO:** `Σ inventory_lots.quantity < qty_despachada` → aborta sin egreso parcial.
13. **Forward-guards cruzados:** `unpack`/`reopen` sobre allocation/bulto `despachada` → rechaza (ya
    instalados en 4A/4B); recién tras `revert_dispatch` se habilitan.
14. **`audit_log`:** `dispatch.confirm` / `delivery.confirm` / `dispatch.revert`.
15. **Autorización:** JWT vacío / rol no autorizado → rechazo (`SECURITY DEFINER` authz).

**Invariante de cierre del kit:** tras todos los casos + `ROLLBACK`, `count(inventory_movements)`,
`stock_available`, `stock_reserved` e `inventory_lots.quantity` vuelven a los valores iniciales (0 footprint).

---

## 15. Validación visual

UI Despacho/Entrega (reemplaza placeholders), estética `nx-*`, Server Actions + `revalidatePath()`
(incluye `/wms/packing`, `/pedidos/...`), **sin `router.refresh()`**:

- `/wms/despacho` — **cola de despacho**: pedidos `preparado` con todos los bultos `cerrada` listos para
  egresar. KPIs: pedidos en cola, bultos cerrados, pedidos despachados (hoy), pedidos entregados.
- `/wms/despacho/[id]` — **panel de despacho**: bultos del pedido + contenido (allocations/lotes que van a
  egresar, con el lote FEFO que se decrementará), datos de transporte (carrier/vehículo), botón
  **Despachar** (con confirmación reforzada: "egreso irreversible") y, si ya despachado, **Entregar** y
  **Revertir despacho**.
- `/wms/entregas` (o pestaña) — shipments `despachado` en tránsito → marcar `entregado` (con receptor).
- **E2E con pedido temporal** `Test-general-001 / G-001`: reservar → pickear → empacar → cerrar →
  **despachar (verificar `stock_reserved--`, ledger `egreso`, `inventory_lots--`/FEFO)** → **entregar** →
  **revertir** (verificar restitución + ledger compensatorio) → **cancelar + restaurar stock 100/0**.
- Evidencia de red: `POST` de `revalidatePath` sin `?_rsc` (sin carrera 503), como en 4B.

---

## 16. Riesgos

| ID | Riesgo | Severidad | Mitigación |
|---|---|---|---|
| R1 | **Bulto vacío trabado** (deuda `anular_packing_unit`) bloquea D1 (todos `cerrada`) | 🟠 Media | Resolver `anular_packing_unit` **antes** de 4C (candidata 4B.1), o `confirm_dispatch` ignora explícitamente bultos `anulada`/sin ítems. Documentar como prerrequisito. |
| R2 | **DEV/PROD comparten la misma DB** (`arsksytgdnzukbmfgkju`) y 4C escribe el ledger inmutable | 🔴 **Alta** | Kits 0 footprint (`BEGIN/ROLLBACK`). E2E **solo** con pedido `Test-*` desechable. **Backup + PITR antes de aplicar la migración** (§17). Un egreso de prueba mal hecho es irreversible salvo PITR. |
| R3 | **Egreso sobre bucket equivocado** (`available` vs `reserved`) | 🔴 Alta | NO reutilizar la rama `egreso` de `confirm_movement` (decrementa `available`). Egreso inline en `confirm_dispatch` sobre `reserved`. Caso de prueba dedicado (§12.2). |
| R4 | **Incoherencia stock vs. lotes** (`Σ lotes < reservado`) produce egreso parcial/negativo | 🟠 Media | Guard de consistencia FEFO: aborta la transacción completa si no hay lotes suficientes (§10, §12.12). |
| R5 | **Reversión que viola inmutabilidad** (intento de borrar el `egreso`) | 🔴 Alta | Reversión = asientos `ingreso` compensatorios nuevos, nunca UPDATE/DELETE. El trigger lo garantiza a nivel DB. |
| R6 | **Doble despacho por carrera** | 🟡 Baja | `FOR UPDATE` del pedido + índice único parcial `unique(order_id) where status<>'anulado'`. |
| R7 | **Confusión reversión vs. devolución** (entregado revertido reingresa stock sin gate) | 🟡 Baja | `revert_dispatch` solo acepta `despachado` (no `entregado`). Devolución → gate posterior. |
| R8 | **Footprint E2E en DB compartida** (shipments `DSP-*`, asientos de ledger de prueba) | 🟡 Baja | E2E con `revert_dispatch` + `cancel_order` para restaurar; asientos de prueba quedan como egreso+reingreso neto 0 (ledger append-only no se borra; documentar). |
| R9 | **Migración fuera de tablas nuevas** (`ALTER packing_units ADD shipment_id`) | 🟡 Baja | Columna nullable estrictamente aditiva, sin default destructivo; no reabre 4B; reversible por PITR. |

---

## 17. Plan de migración

> **Orden obligatorio. Gate 4C es irreversible: el backup y el PITR son no-negociables.**

> 🔢 **RENUMERACIÓN DEFINITIVA (2026-06-03):** la migración de Dispatch es **`0035_wms_dispatch.sql`**.
> `0034` quedó tomada por **Mini-Gate 4B.1** (`0034_wms_packing_cancel.sql`, `anular_packing_unit`,
> **VALIDADO y CERRADO**). El prerrequisito R1 (`anular_packing_unit`) está **RESUELTO** — ver
> `GATE_4B1_CLOSURE_REPORT.md`.

**Fase 0 — Resguardo (antes de tocar nada):**
1. **Backup Supabase manual** del proyecto `arsksytgdnzukbmfgkju` (snapshot lógico previo a `0035`).
   Registrar en `SUPABASE_BACKUP_CHECKLIST.md`.
2. **Confirmar PITR habilitado** (Point-In-Time Recovery) y anotar el timestamp de referencia
   pre-migración. Es la **única** red de seguridad ante un egreso de prueba mal ejecutado en la DB
   compartida DEV/PROD.
3. Confirmar `main` ↔ `origin/main` sincronizados (✅ ya) y crear rama de trabajo
   `feat/gate-4c-dispatch` desde `3b1b3a6`.
4. ✅ Prerrequisito R1 **RESUELTO**: `anular_packing_unit` implementada y validada en Mini-Gate 4B.1 (`0034`).

**Fase 1 — Migración `0035_wms_dispatch.sql` (un solo archivo, aditivo):**
5. Enum `shipment_status_t`. Tabla `shipments` + trigger `public_id 'DSP-'` + secuencia + índice único
   parcial. `ALTER packing_units ADD shipment_id`. RLS lockdown (lectura `authenticated`, escritura solo RPC).
6. RPC `confirm_dispatch`, `confirm_delivery`, `revert_dispatch` + helper `wms_dispatch_recompute`
   (REVOKE public/authenticated). Grants `authenticated`. `notify pgrst, 'reload schema'`.
7. Header de la migración con la **garantía explícita**: "Gate 4C es el primer egreso; toca
   `stock_reserved` + `inventory_lots` + escribe `inventory_movements` (egreso); jamás muta el ledger".

**Fase 2 — Validación SQL (sin footprint):**
8. Correr `gate4c_dispatch_validation_report.sql` (15 casos §14) en transacción con `ROLLBACK`.
   Verificar cierre 0 footprint. **No** aplicar a datos reales todavía.

**Fase 3 — Capa TS:**
9. `src/lib/dispatch/{types,dispatch}.ts` (`listDispatchQueue`, `listDispatchPanel(orderId)`,
   `confirmDispatch`, `confirmDelivery`, `revertDispatch`). Mutaciones **solo** vía RPC.

**Fase 4 — UI:**
10. `/wms/despacho`, `/wms/despacho/[id]`, entregas + Server Actions + `revalidatePath()`. Confirmación
    reforzada en Despachar.

**Fase 5 — Validación visual (E2E):**
11. E2E con pedido `Test-*` desechable (§15), verificando egreso/ledger/FEFO/reversión y restaurando
    stock 100/0. Evidencia de red sin `?_rsc`.

**Fase 6 — Cierre:**
12. Commit aislado `feat(wms): Gate 4C Despacho + Entrega` (migración + TS + UI + kits + este doc).
13. **Push a `origin/main`** (respaldo remoto del primer egreso).
14. Actualizar handoff: marcar Gate 4C cerrado, mover deuda residual (devolución/consolidación) a 4C.1.

---

## 18. Resolución explícita de decisiones D1–D6

| Dec. | Resolución adoptada en este diseño | Implicancia |
|---|---|---|
| **D1** — ¿BLT cerrados antes de despachar? | **A — Sí.** `confirm_dispatch` exige **todos** los bultos no anulados en `cerrada`. | Prerrequisito: resolver `anular_packing_unit` o ignorar bultos vacíos (R1). |
| **D2** — ¿Shipment por pedido o consolidado? | **A — 1 shipment por pedido.** Additive: `packing_units.shipment_id` nullable + índice único parcial. | No bloquea consolidación futura (capa viaje/manifiesto en 4C.1). |
| **D3** — Stock sin lote | **C — Híbrida.** FEFO sobre `inventory_lots` si hay lote; si `lot_number` null, solo `stock_reserved--`. Siempre escribe ledger. | Tolerante a `G-001` sin lotes; trazabilidad cuando hay lote. |
| **D4** — Tracking | **Manual (estados) + Traccar/Mapbox del vehículo** (módulo existente). Por bulto (QR/AirTag) → Gate 5. | 4C no se acopla a hardware; `shipments` guarda `carrier`/`vehicle_ref`/`tracking_ref`. |
| **D5** — FEFO final | **A — FEFO a nivel ítem en reserva + decremento FEFO real (multi-lote) en el egreso.** | Cierra el gap "FEFO split por lote" sin reabrir Gate 3. |
| **D6** — Modelo de entrega | **A — `despachado → entregado`** (`confirm_delivery`). Rechazo/devolución → gate posterior (Reverse Logistics 4C.1). | `shipments` queda preparado para colgar devolución sin rediseño. |

---

## 19. Consideraciones obligatorias (checklist de cierre)

- ✅ **Backup Supabase previo** — Fase 0, paso 1 (snapshot lógico pre-`0035`, registrado en checklist).
- ✅ **PITR habilitado** — Fase 0, paso 2 (timestamp de referencia anotado; única red ante egreso de prueba).
- ✅ **DEV y PROD comparten la misma base** — R2: kits 0 footprint, E2E solo con `Test-*`, backup+PITR
  obligatorios; un egreso de prueba es irreversible salvo PITR.
- ✅ **`inventory_movements` inmutable** — §9: 4C solo INSERTA (`egreso`/`ingreso` compensatorio); jamás
  UPDATE/DELETE; reversión por asientos nuevos. Garantía a nivel trigger (0026).
- ✅ **Gate 4C = primer egreso irreversible** — todo el diseño (atomicidad, guards FEFO, reversión
  compensatoria, confirmación reforzada en UI, backup+PITR) se ordena alrededor de esta severidad.

---

## 20. Mapa de archivos (a crear/modificar en Gate 4C) — referencia, NO implementación

**Migración**
- `supabase/migrations/0035_wms_dispatch.sql` (enum + `shipments` + `ALTER packing_units` + 3 RPC + helper
  + RLS lockdown + grants + audit).

**Capa TS**
- `src/lib/dispatch/types.ts`
- `src/lib/dispatch/dispatch.ts` (`listDispatchQueue`, `listDispatchPanel`, `confirmDispatch`,
  `confirmDelivery`, `revertDispatch`)

**UI**
- `src/app/(app)/wms/despacho/page.tsx` (cola)
- `src/app/(app)/wms/despacho/[id]/page.tsx` (panel de despacho/entrega)
- `src/app/(app)/wms/despacho/actions.ts` (Server Actions + revalidatePath)
- `src/app/(app)/wms/despacho/_components/DispatchActions.tsx` (client)

**Docs / validación**
- `docs/handoff/GATE_4C_DISPATCH_DESIGN.md` (este doc)
- `docs/handoff/gate4c_dispatch_validation.sql` (kit NOTICE)
- `docs/handoff/gate4c_dispatch_validation_report.sql` (kit reporte en filas)

**No se toca:** Gates 1–4B, modelo físico, `confirm_*` validados (`confirm_movement` queda intacto),
stock/ledger fuera de las RPC de 4C. Única alteración a tabla previa: `packing_units.shipment_id` (aditiva).

---

> **FIN — Documento listo para aprobación arquitectónica.** No incluye migraciones, TS ni UI.
> Tras el OK: backup + PITR (Fase 0) → migración `0035` → validación SQL → TS → UI → E2E → commit + push.
