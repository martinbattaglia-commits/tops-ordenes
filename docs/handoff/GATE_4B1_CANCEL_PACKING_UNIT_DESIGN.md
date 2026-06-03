# MINI-GATE 4B.1 — `anular_packing_unit()` · Documento de diseño

> ✅ **ESTADO: VALIDADO Y CERRADO (2026-06-03).** Implementado en `0034_wms_packing_cancel.sql` y validado
> con `gate4b1_cancel_validation_report.sql` (12 checks, 0 footprint, todo OK). Estrategia **Empty-only**
> confirmada. Bloqueante #3 de Gate 4C **resuelto**. Renumeración: `0034` = Packing Cancel · `0035` = Dispatch.
> Cierre formal: `GATE_4B1_CLOSURE_REPORT.md`. *(El texto abajo es el diseño aprobado original, conservado como registro.)*

> Estado original: **propuesta de diseño. NO implementado.** Sin SQL/TS/React/migraciones/UI.
> Metodología gate-heavy: diseño → OK explícito → migración → validación SQL (0 footprint) → TS → UI →
> E2E → commit aislado. **Estrictamente aditivo**, **100% dentro del dominio Packing**.
>
> **Propósito:** cerrar la deuda operativa `anular_packing_unit()` identificada en
> `GATE_4C_READINESS_REPORT.md` (Bloqueante #3, prerrequisito de D1=A de Gate 4C), mediante un
> mini-gate dedicado — **NO** mediante excepciones ocultas dentro de `confirm_dispatch`.
>
> Verificado contra repo: `main` @ `3b1b3a6`, migración `0033_wms_packing.sql` (552 líneas) leída completa.
> Próxima migración disponible: **`0034`** (slate limpio; 4C aún no iniciado).

---

## 0. Hallazgo de fundación (define todo el diseño)

Dos hechos del esquema actual (0033) determinan el diseño y lo hacen trivomamente seguro:

1. **El enum `packing_status_t` YA incluye `'anulada'`** (0033:53: `('abierta','cerrada','despachada','anulada')`).
   `'anulada'` fue **congelado** en Gate 4B pero **ninguna RPC la setea**. → Mini-Gate 4B.1 es **solo una
   RPC nueva**: **no** crea enum, **no** altera tablas, **no** crea tipos, **no** crea permisos.

2. **`close_packing_unit` exige `≥1 ítem`** para cerrar (0033:402-404). → **Un bulto `cerrada` SIEMPRE
   tiene contenido.** Un bulto **vacío** solo puede existir en estado `abierta`. Este invariante resuelve
   por sí solo la pregunta de política `cerrada → anulada` (§3).

**Conclusión de fundación:** la deuda es exclusivamente el **bulto vacío `abierta` trabado** (no cierra
porque `close` exige ítems; no anula porque no hay RPC). El mini-gate solo necesita darle una **salida
terminal limpia** a ese contenedor vacío, sin tocar nada fuera de `packing_units`.

---

## 1. Objetivo funcional

Permitir la **anulación explícita y auditada de un bulto (`packing_unit`) vacío o inválido** antes del
despacho, dándole un estado terminal `anulada` que lo retira de la operación sin pérdida de trazabilidad.

Resuelve el escenario trabado: un bulto `abierta` **sin ítems** que hoy no puede cerrarse (`close` exige
≥1) ni anularse (no existe RPC) → queda colgando del pedido y, bajo **D1=A de Gate 4C** ("todos los
bultos no anulados en `cerrada`"), **bloquearía el despacho del pedido**.

**Principio rector:** la anulación es la **muerte de un contenedor vacío**, NO un mecanismo para descartar
contenido. Cualquier bulto **con** contenido debe **vaciarse primero** por el canal existente
(`unpack_allocation`, Gate 4B) — que es el único autorizado a tocar `stock_allocations` — y recién
entonces anularse. Así 4B.1 **nunca** escribe `stock_allocations`.

---

## 2. Estados permitidos

| Transición | ¿Permitida? | Condición |
|---|---|---|
| `abierta` → `anulada` | ✅ **SÍ** | **El bulto debe estar VACÍO** (`count(packing_unit_items) = 0`). Es el caso de la deuda. |

> **Una sola transición de entrada.** El contrato de la RPC es: *source = `abierta`* + *guard duro:
> cero ítems*. Es la mínima superficie que resuelve la deuda.

---

## 3. Estados prohibidos (y política de `cerrada → anulada`)

| Transición | ¿Permitida? | Razón |
|---|---|---|
| `abierta` (con ≥1 ítem) → `anulada` | ❌ **NO** | Tiene contenido. Hay que `unpack_allocation` cada reserva primero (devuelve `empacada → pickeada`, canal que SÍ puede tocar `stock_allocations`). Anular con contenido implicaría tocar `stock_allocations` desde 4B.1 → **violaría la restricción del mini-gate**. |
| `cerrada` → `anulada` | ❌ **NO (directo)** | **Invariante 0033:** `cerrada` ⟹ tiene ≥1 ítem (close exige ítems). Un `cerrada` nunca está vacío, por lo que **nunca** pasa el guard "cero ítems". La vía correcta es: `reopen_packing_unit` (`cerrada → abierta`) → `unpack_allocation`×N (`empacada → pickeada`) → `anular_packing_unit` (bulto ya vacío). |
| `despachada` → `anulada` | ❌ **NO** | Territorio de **Gate 4C** (egreso irreversible). Anular un despacho es `revert_dispatch` (compensatorio en el ledger), **no** una anulación de packing. Guard duro. |
| `anulada` → cualquiera | ❌ **NO** | `anulada` es **terminal**. Un segundo intento de anular ve `status='anulada' ≠ 'abierta'` → rechazo. |

### Política propuesta sobre `cerrada → anulada` — análisis explícito

La consigna pide analizar "si la arquitectura actual lo permite". **Respuesta: NO se habilita una vía
directa `cerrada → anulada`, y es la decisión correcta**, por tres razones convergentes:

1. **Invariante de contenido:** `cerrada` siempre tiene ítems (0033:402). Una anulación directa de
   `cerrada` tendría que **descartar contenido** → necesitaría tocar `stock_allocations` (devolver
   reservas a `pickeada`). El mini-gate tiene **prohibido tocar `stock_allocations`**.
2. **Separación de responsabilidades:** vaciar un bulto es trabajo de `unpack_allocation` (Gate 4B, ya
   existe, ya audita, ya maneja la transición de reserva). 4B.1 **solo** mata el contenedor vacío. Mezclar
   ambas responsabilidades en una RPC duplicaría lógica y abriría una vía de pérdida de trazabilidad.
3. **Reversibilidad de la composición:** la cadena `reopen → unpack×N → anular` es **explícita, auditada
   paso a paso y reversible** (el operador ve cada reserva volver a `pickeada` antes de matar el bulto).
   Una anulación-cascada sería un solo clic destructivo y opaco.

**Resultado:** `cerrada → anulada` es **alcanzable solo por composición** de RPC existentes + 4B.1, nunca
en un paso. Esto es una **propiedad de seguridad**, no una limitación: garantiza que **ninguna reserva
empacada se pierde silenciosamente** vía anulación.

---

## 4. RPC propuesta

**Nombre:** `public.anular_packing_unit(p_packing_unit_id uuid) returns void`
**Patrón:** idéntico a `close_packing_unit` / `reopen_packing_unit` (0033:378-449) — `SECURITY DEFINER`,
`set search_path = public`, authz `current_role() in ('admin','operaciones','supervisor')`,
`select ... for update` para serializar, cast explícito a enum, hook `audit_log`.

**Lógica (pseudo-contrato, NO código):**
1. **Authz:** `current_role()` ∈ {admin, operaciones, supervisor} — si no, `insufficient_privilege`.
2. **Lock + existencia:** `select * into v_unit ... for update`; si no existe → `no_data_found`.
3. **Guard de estado:** si `v_unit.status = 'despachada'` → rechazo ("bulto despachado — usar reversión de
   despacho"). Si `v_unit.status <> 'abierta'` → rechazo ("bulto no está abierto (estado %) — reabrí y
   desempacá antes de anular"). *(Cubre `cerrada`, `anulada`, `despachada` con mensajes específicos.)*
4. **Guard de vacío (duro):** `count(packing_unit_items where packing_unit_id = ...) = 0`; si tiene ítems
   → rechazo ("bulto con contenido — desempacá las reservas antes de anular"). **Esta es la barrera que
   garantiza cero-touch de `stock_allocations`.**
5. **Mutación (única escritura):** `update packing_units set status = 'anulada'::packing_status_t,
   active = false where id = p_packing_unit_id`. *(Se desactiva además `active` para coherencia con lecturas
   que filtran por `active`; la señal canónica es `status='anulada'`.)*
6. **Audit:** `insert into audit_log (user_id, entity='packing_unit', entity_id, action='packing.cancel',
   payload = {order_id, public_id, from:'abierta', to:'anulada', items:0})`.
7. **Sin roll-up** (ver §5).

**Grant:** `grant execute ... to authenticated` (igual que las 6 RPC de 0033).

> **Nota de naming:** se propone `anular_packing_unit` (verbo español, alineado con el vocabulario del
> dominio y con el nombre de la deuda en el readiness report). Acción de audit `packing.cancel` (alineada
> con la familia `packing.create/pack/unpack/close/reopen`). Confirmar naming antes de migrar.

---

## 5. Roll-ups

**NINGUNO. La anulación de un bulto vacío es roll-up-neutral.**

- `wms_pack_recompute(p_order_item_id)` deriva estado de **línea/pedido** a partir de las
  `stock_allocations` de cada línea. Un bulto **vacío no tiene `packing_unit_items`**, por lo tanto **no
  referencia ninguna allocation** → su anulación **no cambia** el conjunto de allocations de ninguna línea.
- En consecuencia, `anular_packing_unit` **NO invoca** `wms_pack_recompute` y **NO modifica**
  `logistics_order_items.status` ni `logistics_orders.status`.
- Esta neutralidad es **consecuencia directa del guard de vacío** (§4.4): es otra razón para mantener el
  mini-gate empty-only — evita tener que recalcular líneas/pedido (lo que sí requeriría una anulación-cascada).

---

## 6. Compatibilidad con Gate 4C

| Aspecto | Resultado |
|---|---|
| Desbloquea **D1=A** (`confirm_dispatch` exige "todos los bultos **no anulados** en `cerrada`") | ✅ Un bulto vacío trabado ahora puede pasar a `anulada` y queda **excluido** del chequeo D1. **Resuelve el Bloqueante #3 del readiness report sin excepciones ocultas en `confirm_dispatch`.** |
| `despachada → anulada` bloqueada | ✅ Protege el egreso irreversible de 4C; anular un despacho será `revert_dispatch` (4C), no 4B.1. |
| Enum `packing_status_t` | ✅ Sin cambios — `'anulada'` ya existe (0033). 4C no se ve afectado. |
| `packing_units.shipment_id` (columna que 4C propone agregar) | ✅ Sin conflicto — 4B.1 no la referencia (es anterior). Cuando 4C la agregue, los bultos `anulada` tendrán `shipment_id = null` (nunca se despacharon). Coherente. |
| `reopen_packing_unit` guard `despachada` (0033:436) | ✅ Inalterado. La cadena `reopen → unpack → anular` sigue bloqueada sobre despachados. |
| Migración | ✅ 4B.1 = `0034`; 4C pasará a `0035`. Cadena secuencial intacta. |

**4B.1 es prerrequisito de 4C y lo deja estrictamente más listo, sin tocar ningún artefacto de 4C.**

---

## 7. Impacto sobre las tablas del dominio Packing

### `packing_units`
- **Única escritura del mini-gate:** `status: 'abierta' → 'anulada'` + `active: true → false`, para una
  fila vacía. Nada más.
- Lecturas (colas/tableros) deberán filtrar `status <> 'anulada'` (y/o `active`) para ocultar bultos
  anulados — alineación de capa TS/UI en Fase 2 (no en esta migración).

### `packing_unit_items`
- **CERO impacto.** El guard de vacío exige `count = 0` filas para el bulto → no hay nada que insertar,
  borrar ni actualizar. La tabla queda **literalmente intacta**.
- (Contraste deliberado: una anulación-cascada borraría `packing_unit_items` y tocaría
  `stock_allocations`; el diseño empty-only lo evita por completo.)

---

## 8. Confirmación explícita de no-impacto (garantías duras)

| Dominio | Impacto | Por qué |
|---|---|---|
| **Stock** (`inventory_items.stock_available/stock_reserved`) | **CERO** | La RPC nunca referencia `inventory_items`. Un bulto vacío no representa ninguna reserva. |
| **Ledger** (`inventory_movements`) | **CERO** | La RPC nunca referencia el ledger. No hay movimiento físico. El trigger de inmutabilidad ni se roza. |
| **FEFO** (`inventory_lots`, `allocate_order`) | **CERO** | La RPC nunca referencia `inventory_lots` ni la lógica de reserva. FEFO intacto. |
| **Reserva** (`stock_allocations`) | **CERO** | El guard de vacío garantiza que no hay allocation asociada; la RPC nunca escribe `stock_allocations`. |
| **Pedido** (`logistics_orders` / `logistics_order_items`) | **CERO** | Roll-up-neutral (§5): no invoca `wms_pack_recompute`, no escribe pedidos ni líneas. |
| **Picking** (`0032`) | **CERO** | No referenciado. |
| **Gates 1–4A, modelo físico** | **CERO** | No referenciados. |

**Mini-Gate 4B.1 permanece 100% dentro del dominio Packing: escribe una sola columna de estado en
`packing_units` y una fila en `audit_log`. Nada más.**

---

## 9. Riesgos

| ID | Riesgo | Severidad | Probabilidad | Mitigación |
|---|---|---|---|---|
| R1 | Uso indebido para "borrar" un bulto con contenido (pérdida de reservas empacadas) | 🟢 Baja | Baja | **Imposible por diseño:** guard de vacío rechaza bultos con ítems. La única vía a `pickeada` es `unpack_allocation` (auditada). |
| R2 | Anular el último bulto de un pedido en armado | 🟢 Baja | Media | Sin daño: era un contenedor vacío. El operador crea otro con `create_packing_unit`. |
| R3 | Concurrencia: dos anulaciones simultáneas del mismo bulto | 🟢 Baja | Baja | `select ... for update` serializa; la 2.ª ve `anulada` → rechazo limpio. |
| R4 | Terminalidad: querer "desanular" | 🟡 Info | Baja | `anulada` es terminal por diseño (simetría con el modelo). Si se necesitara revertir, es un bulto nuevo (`create_packing_unit`). No se habilita `anulada → abierta`. |
| R5 | DEV/PROD comparten DB; la anulación es terminal | 🟢 Baja | Baja | Blast radius nulo: solo marca una fila vacía sin stock. Validación con kit **0 footprint** (`BEGIN/ROLLBACK`). |
| R6 | Lecturas que no filtran `anulada` muestran bultos muertos | 🟡 Info | Media | Alinear capa TS/UI (Fase 2) para excluir `status='anulada'`/`active=false` de colas y tableros. |
| R7 | `despachada → anulada` por error | 🟢 Baja | Baja | Guard duro rechaza `despachada` con mensaje que redirige a la reversión de despacho (4C). |

**Severidad global del mini-gate: BAJA.** Es la operación con menor blast radius de todo el WMS: una sola
escritura de estado sobre un contenedor vacío, sin cruce de dominios.

---

## 10. Plan de validación

**Kit transaccional 0 footprint** (doble seguro `BEGIN/ROLLBACK` + sentinel `__qa_rollback__`) **y**
variante con **reporte en filas** (el SQL Editor de Supabase no muestra `RAISE NOTICE`), igual que 4A/4B.
Fixture: `create_packing_unit` (bulto vacío) y, para casos con contenido, llegar a `empacada` vía
`confirm_reception → allocate_order → confirm_picking → pack_allocation`.

**Casos:**
1. **Camino feliz:** `create_packing_unit` (vacío `abierta`) → `anular_packing_unit` → `status='anulada'`,
   `active=false`, `audit_log` con `packing.cancel`.
2. **Guard de vacío:** crear bulto, `pack_allocation` (1 ítem) → `anular` → **RECHAZA** ("bulto con
   contenido"). Luego `unpack_allocation` → `anular` (ya vacío) → OK.
3. **Política `cerrada`:** crear bulto, empacar, `close` (`cerrada`) → `anular` → **RECHAZA** ("no está
   abierto"). Luego `reopen` → `unpack` → `anular` (vacío) → OK. *(Valida la cadena compuesta de §3.)*
4. **Terminalidad / idempotencia:** `anular` un bulto ya `anulada` → **RECHAZA**.
5. **Roll-up neutral:** anular bulto vacío de un pedido `en_preparacion` con líneas → estado de
   línea/pedido **sin cambios**.
6. **NO-STOCK:** `inventory_items.stock_available/stock_reserved` sin cambios tras anular.
7. **NO-LEDGER:** `count(inventory_movements)` sin crecer; `inventory_lots` intacto.
8. **NO-ALLOCATION:** `stock_allocations` (conteo y estados) sin cambios.
9. **NO-ORDER:** `logistics_orders` / `logistics_order_items` sin cambios.
10. **Guard `despachada`:** (cuando 4C exista) anular un bulto `despachada` → **RECHAZA**. En 4B.1, como no
    hay vía legítima a `despachada`, se cubre por inspección de código + se deja el caso marcado para el
    E2E conjunto con 4C.
11. **Autorización:** JWT vacío / rol no autorizado → rechazo (`insufficient_privilege`).
12. **`packing_unit_items` intacta:** confirmar 0 filas afectadas en toda la operación.

**Invariante de cierre del kit:** tras todos los casos + `ROLLBACK`, todos los conteos y saldos vuelven a
su valor inicial (0 footprint).

**Validación visual (Fase 2+, no en esta migración):** botón "Anular bulto" visible/habilitado **solo**
sobre bultos `abierta` vacíos del tablero de Packing (`/wms/packing/[id]`); al anular, el bulto desaparece
de la cola; confirmación con `revalidatePath()` (sin `router.refresh()`). E2E con pedido `Test-*`
desechable.

---

## 11. Mapa de archivos previsto (referencia — NO implementar en Fase 1)

**Migración**
- `supabase/migrations/0034_wms_packing_cancel.sql` — **solo** la RPC `anular_packing_unit` + grant +
  `notify pgrst`. Sin tablas, sin enum, sin permisos nuevos. ⚠️ Empuja Gate 4C a `0035`.

**Capa TS** (Fase 2)
- `src/lib/packing/packing.ts` — agregar wrapper `anularPackingUnit(id)` (additive; no toca lo existente).

**UI** (Fase 2)
- `src/app/(app)/wms/packing/[id]/page.tsx` + `_components/PackingActions.tsx` — acción "Anular bulto"
  (solo sobre `abierta` vacíos) + `actions.ts` con `revalidatePath`.

**Docs / validación**
- `docs/handoff/GATE_4B1_CANCEL_PACKING_UNIT_DESIGN.md` (este doc)
- `docs/handoff/gate4b1_cancel_validation.sql` + `gate4b1_cancel_validation_report.sql`

**No se toca:** Gates 1–4A, Gate 4B (las 6 RPC y tablas de 0033 quedan intactas — esto es **additive**),
stock/ledger/FEFO/reserva/pedidos, y **nada de Gate 4C** (no se crea `shipments`/`shipment_status_t`/
`confirm_dispatch`/`confirm_delivery`/`revert_dispatch`).

---

## 12. Resumen de decisiones a confirmar antes de migrar

| Tema | Propuesta |
|---|---|
| Transición habilitada | **Solo `abierta` (vacío) → `anulada`**. |
| `cerrada → anulada` directo | **NO.** Vía composición `reopen → unpack×N → anular` (propiedad de seguridad). |
| `despachada → anulada` | **NO** (territorio 4C). |
| Touch a `stock_allocations` | **CERO** (guard de vacío lo garantiza). |
| Roll-up | **Ninguno** (roll-up-neutral). |
| `active` en anulación | **`active = false`** además de `status='anulada'`. |
| Naming RPC / audit | `anular_packing_unit` / `packing.cancel`. |
| Migración | `0034` (4C pasa a `0035`). |

---

> **FIN — Fase 1 (Diseño). DETENIDO esperando aprobación explícita.**
> No se generó SQL, TS ni UI. No se implementó nada. No se modificaron migraciones ni código.
> Tras el OK: Fase 2 = plan técnico de implementación (sin ejecutar) → luego migración `0034` + validación.
