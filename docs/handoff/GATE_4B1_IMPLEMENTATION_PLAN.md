# MINI-GATE 4B.1 — `anular_packing_unit()` · Plan técnico de implementación (Fase 2)

> ✅ **CIERRE (2026-06-03): CAPA DB (RPC) VALIDADA Y CERRADA.** `0034_wms_packing_cancel.sql` aplicada y
> validada (kit 12 checks, 0 footprint, todo OK). **Bloqueante #3 de Gate 4C resuelto.**
> **Pendiente NO bloqueante:** la capa de superficie (wrapper TS `anularPackingUnit` + Server Action +
> botón "Anular" en `PackBoard.tsx`, Fases 3–4) **no se implementó todavía** — es mejora operativa, no
> condiciona la codificación de Gate 4C (D1=A se satisface a nivel RPC). Ver `GATE_4B1_CLOSURE_REPORT.md`.

> Estado original: **plan aprobado para ejecución diferida. NO implementado.** Sin SQL/TS/React/migraciones/UI generados.
> Estrategia confirmada: **Empty-only** (`abierta` vacío → `anulada`); `cerrada → anulada` directa **prohibida**;
> cero impacto sobre stock/ledger/FEFO/reservas/picking/pedidos; compatibilidad con Gate 4C = objetivo principal.
>
> Diseño aprobado: `docs/handoff/GATE_4B1_CANCEL_PACKING_UNIT_DESIGN.md`.
> Verificado contra repo `main` @ `3b1b3a6`: migración `0033` + capa TS `src/lib/packing/*` + UI
> `src/app/(app)/wms/packing/*` leídas. **Este documento es el plan; no contiene código.**

---

## 1. Resumen ejecutivo del plan

Mini-Gate 4B.1 = **una RPC nueva + un wrapper + una Server Action + un botón de UI**. Es la
implementación de menor superficie de todo el WMS. El relevamiento del código confirma que la capa de
lectura **ya está preparada** para `anulada`:

- `packing_status_t` ya incluye `'anulada'` (0033:53) → **sin cambio de enum**.
- `types.ts`: `PackingStatus` ya incluye `"anulada"` con `PACKING_STATUS_META`; `PackingUnitRow.item_count`
  ya existe → **`types.ts` NO se modifica**.
- `listPackBoard()` ya filtra `.neq("status","anulada")` (packing.ts:~388) → **la cola/tablero ya ocultan
  bultos anulados sin tocar nada**.

Por lo tanto el trabajo neto es: **(1)** migración `0034` con la RPC; **(2)** wrapper `anularPackingUnit`;
**(3)** Server Action `anularPackingUnitAction`; **(4)** botón "Anular" condicionado en `PackBoard.tsx`;
**(5)** kits de validación SQL; **(6)** E2E visual. Todo **aditivo**, sin tocar las 6 RPC de 0033 ni sus tablas.

> **Renumeración:** 4B.1 toma la migración **`0034`**. **Gate 4C pasa de `0034` a `0035`.** Hay que
> actualizar la referencia `0034` → `0035` en `GATE_4C_DISPATCH_DESIGN.md` (§17, §20) al cerrar 4B.1.

---

## 2. Impacto por archivo

### 2.1 NUEVO — `supabase/migrations/0034_wms_packing_cancel.sql`
**Contiene (a nivel spec, NO código):**
- Header con garantías explícitas: additive; Empty-only; cero touch a stock/ledger/FEFO/allocations/pedidos;
  requiere `0033` aplicada.
- **Sin** `create type` (enum `'anulada'` ya existe). **Sin** `create table`/`alter table`. **Sin** permisos nuevos.
- **Una** función `public.anular_packing_unit(p_packing_unit_id uuid) returns void`, patrón idéntico a
  `close_packing_unit`/`reopen_packing_unit` (0033:378-449). Detalle del contrato en §3.
- `grant execute on function public.anular_packing_unit(uuid) to authenticated;`
- `notify pgrst, 'reload schema';`
- Re-ejecutable (`create or replace`).

**Riesgo de archivo:** Bajo. No altera objetos existentes; solo agrega una función.

### 2.2 MODIFICADO (additive) — `src/lib/packing/packing.ts`
- **Agregar** un wrapper `anularPackingUnit(packingUnitId: string): Promise<void>` espejando exactamente
  `reopenPackingUnit` (packing.ts:76-81): `createClient()` → guard "Supabase no configurado" →
  `supabase.rpc("anular_packing_unit", { p_packing_unit_id })` → throw con prefijo `anularPackingUnit:` en error.
- **No** se modifica ninguna función existente. `listPackBoard` **ya** excluye `anulada` (sin cambio).
- **No** se toca `types.ts` (tipos ya soportan `anulada` + `item_count`).

**Riesgo de archivo:** Muy bajo. Append de una función pura.

### 2.3 MODIFICADO (additive) — `src/app/(app)/wms/packing/actions.ts`
- **Importar** `anularPackingUnit` desde `@/lib/packing/packing`.
- **Agregar** `anularPackingUnitAction(packingUnitId: string, orderId: string): Promise<Result>` espejando
  `reopenPackingUnitAction` (actions.ts): `try { await anularPackingUnit(id); revalidate(orderId); return {ok:true} } catch (e) { return fail(e) }`.
- **Reusa** el helper `revalidate(orderId)` existente (revalida `/wms/packing`, `/wms/packing/[id]`,
  `/wms/picking`, `/wms/picking/[id]`, `/pedidos/[id]`, `/pedidos`). **Sin `router.refresh()`** (criterio 4A/4B).
- **No** se revalida `/wms/inventario` (4B.1 no toca stock — coherente con el comentario de cabecera de actions.ts).

**Riesgo de archivo:** Muy bajo. Append de una action con patrón idéntico.

### 2.4 MODIFICADO (additive) — `src/app/(app)/wms/packing/_components/PackBoard.tsx`
- **Importar** `anularPackingUnitAction` (junto a `closePackingUnitAction`/`reopenPackingUnitAction`, PackBoard.tsx:16-17).
- En el bloque de acciones por bulto (PackBoard.tsx:~199-211), **agregar** un botón **"Anular"** que se
  renderiza **solo si** `u.status === "abierta" && u.item_count === 0` (bulto abierto y vacío). Usa el
  helper `run(() => anularPackingUnitAction(u.id, orderId))` y la transición `pending` ya existentes.
  - Estética: `btn btn-ghost btn-sm` con `Icon name="trash"` (o equivalente), `title="Anular bulto vacío"`,
    color de peligro suave. Confirmación liviana opcional ("¿Anular bulto vacío?") por ser terminal.
  - Para bultos con contenido o `cerrada`/`despachada`: **no** se muestra (la guía operativa es desempacar/reabrir primero).

**Riesgo de archivo:** Bajo. Un botón condicionado en una fila ya existente; sin reestructurar el componente.

### 2.5 NUEVO — kits de validación
- `docs/handoff/gate4b1_cancel_validation.sql` (kit `RAISE NOTICE`, 0 footprint `BEGIN/ROLLBACK`).
- `docs/handoff/gate4b1_cancel_validation_report.sql` (variante reporte en filas — Supabase SQL Editor no muestra NOTICE).

### 2.6 SIN CAMBIOS (confirmado por relevamiento)
- `src/lib/packing/types.ts` — `PackingStatus`/`PACKING_STATUS_META`/`item_count` ya soportan `anulada`.
- Las 6 RPC y 2 tablas de `0033` — intactas (4B.1 es additive).
- `page.tsx` (cola), `PackingActions.tsx` (botón "Empacar todo"), `[id]/page.tsx` — sin cambios (la cola ya
  excluye anulados vía `listPackBoard`/`listPackQueue`).

---

## 3. Especificación del contrato de la RPC (para la migración 0034)

> Descripción funcional del comportamiento esperado. **No es el SQL** — es el contrato a implementar.

**Firma:** `public.anular_packing_unit(p_packing_unit_id uuid) returns void`
**Atributos:** `language plpgsql`, `security definer`, `set search_path = public`.

**Secuencia de validación y efecto:**

| Paso | Condición | Resultado si falla |
|---|---|---|
| 1. Authz | `current_role() in ('admin','operaciones','supervisor')` | `raise ... insufficient_privilege` ("no autorizado") |
| 2. Lock+existencia | `select * into v_unit from packing_units where id = p_packing_unit_id for update` | si no existe → `no_data_found` ("bulto % no existe") |
| 3. Guard despachada | `v_unit.status <> 'despachada'` | `raise` ("bulto % ya despachado — usar reversión de despacho") |
| 4. Guard estado | `v_unit.status = 'abierta'` | si no → `raise` ("bulto % no está abierto (estado %) — reabrí y desempacá antes de anular") |
| 5. Guard vacío (DURO) | `count(packing_unit_items where packing_unit_id = p_packing_unit_id) = 0` | si >0 → `raise` ("bulto % con contenido — desempacá las reservas antes de anular") |
| 6. Mutación | `update packing_units set status='anulada'::packing_status_t, active=false where id=...` | — |
| 7. Audit | `insert into audit_log (user_id, entity='packing_unit', entity_id, action='packing.cancel', payload=jsonb{order_id, public_id, from:'abierta', to:'anulada', items:0})` | — |

- **Cast explícito a enum** en la asignación de `status` (criterio 42804 uniforme con 0031/0032/0033).
- **No** invoca `wms_pack_recompute` (roll-up-neutral, §diseño).
- **No** referencia `inventory_items`/`inventory_lots`/`inventory_movements`/`stock_allocations`/`logistics_orders`.
- El orden de guards 3→4 da mensajes específicos por estado (`despachada` distinto de `cerrada`/`anulada`).

---

## 4. Estrategia de validación

### 4.1 Validación SQL (kit 0 footprint — bloqueante antes de TS/UI)
Transacción `BEGIN … ROLLBACK` + sentinel `__qa_rollback__`. Fixture mínimo:
`confirm_reception → allocate_order → confirm_picking → (pack/close para casos con contenido)`.

| # | Caso | Esperado |
|---|---|---|
| 1 | Camino feliz: `create_packing_unit` (vacío) → `anular_packing_unit` | `status='anulada'`, `active=false`, `audit_log` `packing.cancel` |
| 2 | Guard vacío: bulto con 1 ítem (`pack_allocation`) → `anular` | **RECHAZA**; tras `unpack_allocation` → `anular` OK |
| 3 | Política `cerrada`: empacar + `close` → `anular` | **RECHAZA** ("no está abierto"); tras `reopen`+`unpack` → `anular` OK |
| 4 | Terminalidad: `anular` un `anulada` | **RECHAZA** |
| 5 | Roll-up neutral: anular vacío en pedido `en_preparacion` | línea/pedido **sin cambios** |
| 6 | NO-STOCK | `stock_available`/`stock_reserved` sin cambios |
| 7 | NO-LEDGER | `count(inventory_movements)` igual; `inventory_lots` intacto |
| 8 | NO-ALLOCATION | `stock_allocations` (conteo/estados) sin cambios |
| 9 | NO-ORDER | `logistics_orders`/`_items` sin cambios |
| 10 | `packing_unit_items` intacta | 0 filas afectadas en toda la operación |
| 11 | Authz | JWT vacío / rol inválido → `insufficient_privilege` |
| 12 | Guard `despachada` | cubierto por inspección de código en 4B.1 (no hay vía legítima a `despachada` sin 4C); E2E conjunto cuando exista `0035` |

**Cierre del kit:** tras `ROLLBACK`, todos los conteos/saldos vuelven al inicial (0 footprint verificable).

### 4.2 Validación visual (E2E navegador)
- Pedido temporal `Test-general-001 / G-001`: reservar → pickear → `create_packing_unit` (bulto vacío) →
  verificar botón **"Anular"** visible **solo** en ese bulto vacío `abierta` → anular → el bulto
  **desaparece** del tablero (por `listPackBoard.neq('anulada')`).
- **Control negativo:** empacar una reserva → el botón "Anular" **no** aparece en ese bulto (tiene contenido).
- **Cadena compuesta:** `close` → "Anular" no aparece (cerrada) → `reopen` → `unpack` → ahora vacío →
  "Anular" reaparece → anular OK.
- Red: `POST` de `revalidatePath` **sin `?_rsc`** (sin carrera 503), como 4B.
- Restaurar fixture: cancelar pedido de prueba + `G-001` a 100/0.

---

## 5. Checklist de ejecución (gate-heavy, ordenado)

> **Nota de seguridad:** 4B.1 **no escribe stock/ledger** → su blast radius en la DB compartida DEV/PROD es
> mínimo (marca una fila vacía). Aun así, por disciplina del proyecto y por ser DB compartida, se mantiene
> el resguardo previo. **Ninguna ejecución sin OK explícito de Martín** (las migraciones las aplica él en el SQL Editor).

**Fase 0 — Resguardo (recomendado):**
- [ ] Confirmar `git status` limpio salvo docs; `main` ↔ `origin/main` sincronizados.
- [ ] Confirmar PITR habilitado (red estándar del proyecto). Backup formal **opcional** para 4B.1 (no toca stock), pero anotar timestamp.
- [ ] Crear rama `feat/gate-4b1-cancel-packing` desde `3b1b3a6`.

**Fase 1 — Migración (aplica Martín):**
- [ ] Escribir `0034_wms_packing_cancel.sql` (solo la RPC `anular_packing_unit` + grant + notify).
- [ ] Aplicar `0034` a mano en el SQL Editor de Supabase.
- [ ] Verificar que la función existe y PostgREST recargó el schema.

**Fase 2 — Validación SQL (bloqueante):**
- [ ] Correr `gate4b1_cancel_validation_report.sql` (12 casos §4.1) en transacción con `ROLLBACK`.
- [ ] Confirmar 0 footprint y todos los casos OK. **No avanzar si algún NO-* falla.**

**Fase 3 — Capa TS:**
- [ ] Agregar wrapper `anularPackingUnit` en `packing.ts` (espejo de `reopenPackingUnit`).
- [ ] Agregar `anularPackingUnitAction` en `actions.ts` (espejo de `reopenPackingUnitAction`, reusa `revalidate`).
- [ ] `tsc` + `eslint` en verde.

**Fase 4 — UI:**
- [ ] Agregar botón "Anular" condicionado (`abierta` + `item_count===0`) en `PackBoard.tsx`.
- [ ] Confirmar que **no** se modifica `types.ts` ni la cola.

**Fase 5 — Validación visual (E2E):**
- [ ] E2E §4.2 con `Test-*`; verificar visible-solo-en-vacíos, desaparición tras anular, control negativo, cadena compuesta.
- [ ] Evidencia de red sin `?_rsc`. Restaurar stock 100/0.

**Fase 6 — Cierre:**
- [ ] Actualizar `GATE_4C_DISPATCH_DESIGN.md`: migración 4C `0034` → **`0035`**.
- [ ] Actualizar `GATE_4C_READINESS_REPORT.md`: marcar **Bloqueante #3 resuelto**.
- [ ] Commit aislado `feat(wms): Mini-Gate 4B.1 anular_packing_unit` (migración + TS + UI + kits + docs).
- [ ] Push a `origin/main` (con OK).

---

## 6. Estrategia de rollback / contingencia

| Escenario | Acción |
|---|---|
| La RPC falla validación SQL | No se aplica TS/UI; corregir migración; `0034` es `create or replace` → re-aplicar idempotente. |
| Necesidad de "deshacer" la función en DB | `drop function if exists public.anular_packing_unit(uuid);` (no deja rastro; no hay datos dependientes). Bultos `anulada` ya marcados permanecen (estado válido del enum). |
| Bulto anulado por error | Es terminal por diseño; el operador crea un bulto nuevo (`create_packing_unit`). Las reservas nunca se perdieron (guard de vacío). |
| Conflicto de numeración con 4C | 4B.1 = `0034`, 4C = `0035`. Renumerar 4C **antes** de iniciarlo. |
| Git | Trabajo en rama `feat/gate-4b1-cancel-packing`; revertible por rama/PITR. Backup post-4B (`backup/main-wms-gate4b-20260603`) como red. |

---

## 7. Criterios de "Definition of Done"

- [ ] `anular_packing_unit` aplicada y validada (12 casos SQL, 0 footprint).
- [ ] Wrapper + Server Action + botón UI funcionando; `tsc`/`eslint` verdes.
- [ ] E2E: anular visible solo en bultos `abierta` vacíos; desaparición correcta; control negativo OK.
- [ ] Confirmado cero impacto: stock/ledger/FEFO/allocations/pedidos sin cambios (casos 6-9).
- [ ] `GATE_4C_DISPATCH_DESIGN.md` renumerado a `0035`; Bloqueante #3 del readiness marcado resuelto.
- [ ] Commit aislado + push (con OK).
- [ ] **Resultado:** Gate 4C queda con su prerrequisito de packing **cerrado** y D1=A plenamente satisfacible.

---

> **FIN — Fase 2 (Plan técnico). DETENIDO.**
> No se implementó nada: sin SQL, sin TS, sin UI, sin migraciones generadas. No se modificó código ni se aplicó la migración.
> Próximo paso (requiere OK explícito): ejecutar la Fase 1 del checklist (escribir + aplicar `0034`).
