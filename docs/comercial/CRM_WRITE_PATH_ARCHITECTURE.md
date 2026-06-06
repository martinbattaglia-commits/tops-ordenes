# CRM_WRITE_PATH_ARCHITECTURE — Write-Path de la Ficha 360° (F2.1-8)

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Rama:** `feature/crm-comercial-f2-1` @ `a76fff7`
**Fecha:** 2026-06-06
**Frente aprobado:** Write-Path — convertir la Ficha 360° en una **pantalla operativa**.
**Naturaleza de este documento:** **diseño previo a código.** No hay código nuevo acá. Define contratos, máquina de estados, integración con capacidad, atomicidad, seguridad y plan de validación en staging.

> **Restricciones vigentes:** staging primero · sin producción · sin `main` · sin Netlify · sin Supabase PROD (`arsksytgdnzukbmfgkju`). Toda escritura se valida contra staging (`vrxosunxlhohmqymxots`) en transacción + ROLLBACK antes de cualquier persistencia real.

---

## 0. Objetivo y alcance

**Hoy** la Ficha 360° es **read-only**: el botón "siguiente acción" (`nextAction()` en `Opportunity360View.tsx:29`) solo cambia de tab (`setTab`). No hay escritura.

**Objetivo:** que las acciones de la Ficha **muevan la oportunidad** por el pipeline, **dejen rastro auditable** y **actualicen la capacidad y el dashboard** automáticamente — todo bajo RLS, validado en staging.

**Alcance aprobado (este frente):**

1. **Server Actions** de escritura (transición de etapa + edición de oportunidad + reserva de capacidad + completar onboarding).
2. **Transiciones de etapa** con máquina de estados y guardas.
3. Escritura del ledger **`crm_stage_history`** (append-only) en cada transición.
4. Derivación y persistencia de **`committed_state`** según la etapa.
5. **Integración con el Capacity Engine** (reserva de sitio/unidades → snapshot → vacancia comercial/proyectada; `ocupado` al completar onboarding, regla anti-doble-conteo).
6. **Actualización automática del Dashboard** de vacancia (revalidación de rutas).

**Fuera de alcance (NO se abren acá):** webhook Clientify (F2.1-5), exponer `__nexusCapture` en bundles, owner resolution `profiles_public`, salida a producción / merge a `main`.

---

## 1. Estado verificado del repositorio (grounding)

Todo lo que sigue está fundamentado en código y migraciones reales leídas hoy:

| Pieza | Ubicación | Hecho verificado |
|---|---|---|
| Enums de etapa | `0041_crm_enums.sql` | `crm_stage_t`: `nuevo_lead, contactado, calificado, visita, propuesta, negociacion, ganado, perdido` (8) |
| Enum de compromiso | `0041_crm_enums.sql` | `crm_committed_state_t`: `none, reservado, comprometido, ocupado` |
| Oportunidad (eje) | `0042_crm_core.sql` | `estado`, `committed_state` (default `none`), `assigned_site`, `assigned_units jsonb`, `capacity_feasible`, `m2`, `service_type`, `actual_close`, `lost_reason`, `probabilidad`, `created_by`. RLS: UPDATE exige `has_permission('comercial.edit')` |
| Ledger de etapas | `0045_crm_sync_audit.sql` | `crm_stage_history(id bigserial, opportunity_id, from_stage, to_stage, changed_by, changed_at, note)`. **Append-only**: hay policy de INSERT (`comercial.edit`) y DELETE (admin), **sin policy de UPDATE** → inmutable |
| Onboarding | `0044_crm_contracts_onboarding.sql` | `crm_onboarding.status`: `pendiente, en_curso, bloqueado, completado`; `progress_pct 0..100`; FK a opp `on delete cascade` |
| Contrato | `0044` | `opportunity_id ... on delete restrict` (R-G1) |
| Snapshot de capacidad | `committed-capacity.ts` | Cuenta solo opps con `assigned_site` y `m2`, `committed_state in ('reservado','comprometido')`, `estado != 'perdido'`, `deleted_at is null`. **`ocupado` NO se cuenta** (anti-doble-conteo) |
| Motor puro | `corporate-capacity.ts` | `findAvailability()` + `CommittedSnapshot` por parámetro; vacancia física/comercial/proyectada |
| Dashboard | `dashboard-vacancia/page.tsx` | `export const dynamic = "force-dynamic"`; llama `getCommittedSnapshot()` en cada request |
| Ficha (vista) | `Opportunity360View.tsx` | `"use client"`; `nextAction(estado)` → `{label, tab}`; botón hace `setTab` (sin escritura) |
| Server action existente (patrón a imitar) | `capture-actions.ts` | `"use server"`; usa `createClient()` (sesión de usuario, RLS); retorna `{ok, message, publicId}`; resiliente si no hay Supabase |
| Cliente Supabase server | `supabase/server.ts` | `createClient()` = sesión de usuario (cookies) → **RLS aplica + `auth.uid()` disponible**. Existe `createAdminClient()` (service role, bypass RLS) — **NO se usa en el write-path** |

---

## 2. Máquina de estados — transiciones de etapa

El pipeline es **lineal con salidas** (`perdido` desde casi cualquier punto; `ganado` solo desde `negociacion`). La máquina se centraliza en **una sola fuente** (tabla de transiciones válidas), consumida por la guarda del server action.

### 2.1 Transiciones válidas (avance "feliz" + salidas)

| Desde | Avance válido | Salida |
|---|---|---|
| `nuevo_lead` | → `contactado` | → `perdido` |
| `contactado` | → `calificado` | → `perdido` |
| `calificado` | → `visita` · → `propuesta` (visita opcional) | → `perdido` |
| `visita` | → `propuesta` | → `perdido` |
| `propuesta` | → `negociacion` | → `perdido` |
| `negociacion` | → `ganado` | → `perdido` |
| `ganado` | (terminal de pipeline → onboarding) | — |
| `perdido` | (terminal) | — |

**Reglas de guarda:**
- Solo se permite una transición listada arriba. Cualquier otra → `{ ok:false, message:"Transición no permitida: X → Y" }`.
- **No** se permite reabrir `ganado`/`perdido` desde la UI (re-apertura = acción admin futura, fuera de alcance).
- **`ganado` exige capacidad reservada (`assigned_site` no nulo) — BLOQUEO DURO (D-2 resuelto).** Si falta, la transición se rechaza con `{ ok:false, message:"No se puede ganar sin capacidad reservada. Reservá un sitio primero." }`. Esto garantiza que **todo lo ganado impacte el dashboard** (sin `assigned_site` el snapshot no descontaría los m²). La guarda vive en la función SQL `crm_advance_stage` y se re-chequea en el server action.
- **`visita` es opcional (D-3 resuelto):** `calificado → propuesta` directo está permitido (además de `calificado → visita`). La tabla de transiciones lo refleja.

### 2.2 Idempotencia
Si `from == to`, no-op con `{ ok:true, message:"Sin cambios" }` y **no** se escribe ledger (evita ruido en el audit).

---

## 3. Derivación de `committed_state` (regla de negocio central)

`committed_state` **no lo elige el usuario**: se **deriva** de la etapa destino. Esta es la regla que cierra el lazo oferta↔demanda.

| Etapa destino | `committed_state` resultante | Efecto en snapshot/dashboard |
|---|---|---|
| `nuevo_lead`, `contactado`, `calificado`, `visita` | `none` | No computa |
| `propuesta` | `reservado` | Suma a **vacancia proyectada** (−reservado) *si* hay `assigned_site` |
| `negociacion` | `reservado` | idem proyectada |
| `ganado` | `comprometido` | Suma a **vacancia comercial** (−comprometido) |
| `perdido` | `none` (libera) | Deja de computar |
| (onboarding `completado`) | `ocupado` | **Sale del committed** (su m² ya está en ocupación física del Twin) |

**Invariante de doble escritura:** toda transición que cambie `estado` **también** ajusta `committed_state` en la misma operación atómica (ver §5) y **escribe una fila en `crm_stage_history`**. Las tres cosas (estado, committed_state, ledger) son una unidad.

**Dependencia de `assigned_site`:** `reservado`/`comprometido` solo afectan el dashboard si la opp tiene `assigned_site` (el snapshot filtra por eso — `committed-capacity.ts:47`). Por eso la **reserva de capacidad** (§4) es parte del flujo, no un extra.

---

## 4. Integración con el Capacity Engine

El write-path conecta el CRM con el motor por **dos puntos**:

### 4.1 Reserva de capacidad (acción `reserveCapacity`)
En la etapa `calificado` la "siguiente acción" es **"Validar capacidad y cotizar"**. Hoy `findAvailability()` corre en el cliente solo para mostrar el badge. El write-path agrega la **persistencia de la reserva**:

- `reserveCapacity(oppId, { site, units, m2? })` escribe en la oportunidad: `assigned_site`, `assigned_units` (jsonb), `capacity_feasible = true`.
- A partir de ese momento, si la opp está en `propuesta`/`negociacion`/`ganado`, el snapshot la cuenta.
- La validación de factibilidad se **recalcula en el server** (no se confía en el cliente) llamando al motor con el `CommittedSnapshot` actual, para evitar sobre-reservar.

### 4.2 Ocupación al completar onboarding (acción `completeOnboarding`)
- Cuando el onboarding llega a `completado` (o `progress_pct = 100`), se dispara la transición de capacidad **`comprometido → ocupado`** en la oportunidad.
- **Regla anti-doble-conteo:** `ocupado` sale del `CommittedSnapshot` (ya verificado en `committed-capacity.ts`). El m² pasa a vivir en la ocupación física del Digital Twin.
- *Nota:* la reconciliación del seed del Twin (RA-4) sigue abierta; esto no la bloquea — el snapshot es la fuente para vacancia comercial/proyectada; la física viene del modelo local autorizado.

### 4.3 Lazo cerrado
```
reserveCapacity → assigned_site/units     ┐
advanceStage(→propuesta)   → reservado    ├─► getCommittedSnapshot() ─► corporate-capacity ─► Dashboard
advanceStage(→ganado)      → comprometido │        (force-dynamic, se recalcula en cada request)
completeOnboarding         → ocupado ─────┘        (sale del committed)
```

---

## 5. Atomicidad y concurrencia (decisión de diseño)

**Problema:** una transición toca **2 tablas** (`crm_opportunities` UPDATE + `crm_stage_history` INSERT) y debe ser **todo-o-nada**. supabase-js (PostgREST) **no** ejecuta transacciones multi-statement desde el cliente. Dos llamadas secuenciales pueden dejar el ledger desincronizado del estado → audit corrupto.

**Opciones evaluadas:**

| Opción | Atómico | RLS | Costo | Veredicto |
|---|---|---|---|---|
| **A. Función Postgres `crm_advance_stage()` (RPC), `SECURITY INVOKER`** | ✅ una tx | ✅ respeta `has_permission` del invocador | +1 migración aditiva (**0047**) | **Recomendada** |
| B. Dos llamadas supabase-js en el server action | ❌ parcial posible | ✅ | 0 migraciones | Rechazada (rompe invariante de audit) |
| C. Service-role + lógica compensatoria | ⚠️ | ❌ bypassa RLS | complejidad | Rechazada (viola modelo de seguridad) |

**Decisión: Opción A — APROBADA (D-1 resuelto).** Migración **`0047_crm_write_path_fns.sql`** (aditiva, solo funciones — sin cambios de esquema), con:

- `crm_advance_stage(p_opp uuid, p_to crm_stage_t, p_note text) returns crm_opportunities`
  Valida transición (tabla de transiciones embebida o `CASE`), deriva `committed_state`, hace UPDATE + INSERT en `crm_stage_history` en una sola tx. `changed_by := auth.uid()`. `SECURITY INVOKER` → la RLS de ambas tablas se evalúa con el permiso del usuario (igual que hoy). Si el usuario no tiene `comercial.edit`, la función falla por RLS (no hace falta re-chequear).
- `crm_reserve_capacity(p_opp uuid, p_site text, p_units jsonb)` — UPDATE de `assigned_site/units/capacity_feasible`.
- `crm_complete_onboarding(p_opp uuid)` — set onboarding `completado`/`progress 100` + opp `committed_state='ocupado'` + fila de ledger marcando el hito, en una tx.

> **Por qué SECURITY INVOKER y no DEFINER:** mantiene el modelo RLS verificado en staging (R-G2). DEFINER abriría un bypass que habría que auditar de nuevo. Las funciones son *additive* (no tocan tablas), por lo que el gate estructural existente sigue válido.

**Concurrencia:** el UPDATE toma lock de fila sobre la opp; dos transiciones simultáneas se serializan. La derivación de `committed_state` desde `to_stage` es determinística, así que no hay condición de carrera lógica. La capacidad se valida en el server contra el snapshot del momento (lectura consistente dentro de la tx de reserva).

**Si Dirección prefiere 0 migraciones nuevas en este frente:** fallback a Opción B con el INSERT del ledger **primero** y el UPDATE después, y un reconciliador; pero se documenta como deuda. La recomendación firme es A.

---

## 6. Server Actions — contratos (firmas, sin implementación)

Módulo nuevo `src/lib/comercial/stage-actions.ts` (`"use server"`), espejando el patrón de `capture-actions.ts` (usa `createClient()` de sesión, retorna resultado tipado, resiliente sin Supabase).

```
type ActionResult =
  | { ok: true;  message: string; opportunity?: OpportunitySnapshot }
  | { ok: false; message: string };

advanceStage(opportunityId: string, toStage: CrmStage, note?: string): Promise<ActionResult>
  // valida transición · llama RPC crm_advance_stage · revalida rutas

reserveCapacity(opportunityId: string, input: { site: string; units: AssignedUnit[]; m2?: number }): Promise<ActionResult>
  // recalcula factibilidad en server · llama RPC crm_reserve_capacity · revalida

completeOnboarding(opportunityId: string): Promise<ActionResult>
  // llama RPC crm_complete_onboarding · committed_state→ocupado · revalida

updateOpportunityFields(opportunityId: string, patch: EditableOppFields): Promise<ActionResult>
  // edición de campos editables (monto, probabilidad, expected_close, contacto, m2…)
  // NO cambia estado ni committed_state · UPDATE directo bajo RLS · revalida
  // campos editables: lista blanca explícita (nunca estado/committed_state/ids)
```

**Comportamiento transversal de cada action:**
1. Guard de entorno: si `createClient()` es null → `{ ok:false, message:"Supabase no configurado" }` (igual que capture-actions). En runtime contra PROD (sin `crm_*`) esto degrada suave, no rompe.
2. Ejecuta RPC.
3. En éxito: `revalidatePath()` de las rutas afectadas (§7).
4. Mapea errores de Postgres/RLS a `message` legible.

---

## 7. Actualización automática del Dashboard

El dashboard ya es `force-dynamic` → recalcula el snapshot en cada navegación. Para que el cambio se refleje **sin recargar a mano** tras una acción, cada server action revalida:

```
revalidatePath('/comercial/oportunidades/[id]', 'page')   // la propia ficha
revalidatePath('/comercial/oportunidades')                // la lista (badges de etapa)
revalidatePath('/comercial/dashboard-vacancia')           // vacancia comercial/proyectada
revalidatePath('/comercial/pipeline')                     // tablero Kanban por etapa
```

Resultado: marcar `ganado` en la Ficha → al ir al dashboard, la vacancia **comercial** ya descontó esos m². Eso **cierra el lazo F2.1-4 ↔ CRM con datos reales**, que era el objetivo del frente.

---

## 8. UI wiring — de `setTab` a acción real

`Opportunity360View.tsx` es `"use client"`. Las server actions se importan y se invocan dentro de `useTransition` (patrón estándar Next 14 App Router; mismo límite client→server que ya usa `CaptureEmbed` con `saveCaptureForOpportunity`).

- El botón **"siguiente acción"** (hoy `onClick={() => setTab(next.tab)}`) pasa a:
  - Para acciones de **transición pura** (contactado, calificar, marcar ganado, marcar perdido): llama `advanceStage(...)` y, en éxito, refresca (router.refresh) — el `next.tab` se conserva como navegación secundaria.
  - Para **"Validar capacidad y cotizar"** (`calificado`): abre el tab capacidad con un CTA "Reservar" que llama `reserveCapacity(...)`.
  - Para **onboarding completado**: botón en el tab onboarding → `completeOnboarding(...)`.
- Estados de UI: `pending` (spinner en el botón), `error` (toast/inline con `message`), `success` (refresh + badge de etapa/committed actualizado).
- **Perdido** requiere capturar `lost_reason` (input breve) → pasa como `note`/campo dedicado.

> El stepper (`PipelineStepper`) y los badges (`STAGE_LABEL`, `COMMITTED_LABEL`) ya existen y reaccionan al nuevo `estado`/`committedState` tras `router.refresh()` — no hay que rediseñarlos.

---

## 9. Seguridad, RLS y auditoría

- **Sesión de usuario, no service-role.** Las actions usan `createClient()` → RLS evalúa `has_permission('comercial.edit')` (verificado en staging, R-G2). `createAdminClient()` queda **prohibido** en este frente.
- **`changed_by` / `created_by` = `auth.uid()`** dentro de las funciones SQL (no se confía en el cliente).
- **Ledger inmutable:** `crm_stage_history` no tiene policy de UPDATE → nadie reescribe historia. Solo INSERT (edit) y DELETE (admin).
- **Lista blanca de campos editables** en `updateOpportunityFields` — nunca permitir patchear `estado`, `committed_state`, `id`, `public_id`, `created_by` por esa vía (esos solo cambian por las transiciones).
- **Anti-double-count** preservado (ocupado fuera del snapshot).

---

## 10. Plan de validación en staging (tx + ROLLBACK)

Siguiendo el patrón `CRM_STAGING_VALIDATION.sql` (46 tests) y las notas de entorno del handoff:

1. **Aplicar 0047 a staging** (funciones; aditivo). Guard: `STAGING_DB_URL` contiene `vrxosunxlhohmqymxots` y **no** `arsksytgdnzukbmfgkju`.
2. **Suite de transiciones** (todo en una tx que termina en ROLLBACK):
   - Sembrar opp en `calificado` → `reserveCapacity` → verificar `assigned_site` y que el snapshot la empieza a contar.
   - `advanceStage(→propuesta)` → `committed_state='reservado'`, 1 fila en `crm_stage_history` (`from=calificado,to=propuesta`), snapshot suma a **proyectada**.
   - `advanceStage(→negociacion→ganado)` → `comprometido`, ledger con 2 filas más, snapshot pasa a **comercial**.
   - `completeOnboarding` → `ocupado`, **sale** del snapshot.
   - Transición inválida (p. ej. `nuevo_lead→ganado`) → la función **rechaza**, sin escribir ledger.
   - Usuario sin `comercial.edit` → RLS bloquea (re-confirma R-G2 sobre el write-path).
3. **Aserción de lazo:** recomputar `getCommittedSnapshot()` y comparar la vacancia comercial/proyectada antes/después (números esperados al m²).
4. **Idempotencia:** `from==to` → no-op, sin fila de ledger.
5. **GO/NO-GO** documentado (nuevo `CRM_WRITE_PATH_STAGING_RESULTS.md`), sin datos residuales (ROLLBACK; las secuencias `public_id` pueden avanzar — cosmético).

---

## 11. Entregables y orden de implementación (tras aprobación de este doc)

| Paso | Entregable | Validación |
|---|---|---|
| W-1 | Migración `0047_crm_write_path_fns.sql` (funciones RPC, aditivo) | aplica en staging |
| W-2 | `stage-actions.ts` (`advanceStage`, `reserveCapacity`, `completeOnboarding`, `updateOpportunityFields`) + máquina de transiciones en `crm-types`/util | `tsc --noEmit`, `next lint` |
| W-3 | Wiring en `Opportunity360View.tsx` (useTransition, estados pending/error, lost_reason) | build verde |
| W-4 | Revalidación de rutas + verificación de lazo dashboard | preview/staging |
| W-5 | `CRM_WRITE_PATH_STAGING_VALIDATION.sql` + ejecución + `…_RESULTS.md` (GO/NO-GO) | 100% PASS |

Hito sugerido en commits: **F2.1-8** (write-path). Todo en `feature/crm-comercial-f2-1`.

---

## 12. Riesgos y decisiones abiertas

| # | Punto | Estado |
|---|---|---|
| D-1 | **Migración 0047 (RPC).** Atomicidad opp+ledger vía funciones aditivas `SECURITY INVOKER`. | ✅ **RESUELTO — Opción A aprobada** |
| D-2 | **Guarda de `ganado` sin `assigned_site`.** | ✅ **RESUELTO — bloqueo duro** (no se gana sin reserva) |
| D-3 | **`visita` opcional vs obligatoria.** | ✅ **RESUELTO — opcional** (`calificado→propuesta` directo permitido) |
| D-4 | **Runtime apunta a PROD (RA-1):** las acciones degradan suave (sin `crm_*` → `{ok:false}`). La operación real del write-path se prueba **solo en staging** hasta la decisión de salida a producción. | Conocido / aceptado |
| D-5 | **`reserveCapacity` y selección de unidades:** el catálogo de `units` por sede viene de los modelos locales del Twin; definir el selector (qué sectores/cubículos/islas ofrece la UI). Arranca con `assigned_units` libre + `assigned_site` y se refina. | Alcance fino (no bloquea W-1) |

---

## 13. Lo que NO se toca (frontera del frente)

- ❌ `main`, Netlify, producción, Supabase PROD, Clientify PROD.
- ❌ Esquema de tablas existentes (0047 es **solo funciones**, aditivo).
- ❌ El motor puro `corporate-capacity.ts` (se consume, no se modifica).
- ❌ El read-path ya validado (mapper, supabase reader, fallback local) — se reutiliza tal cual.
- ❌ Webhook Clientify, bundles de captura, owner resolution, reconciliación de seed (otros frentes).

---

*Diseño previo a código. Sin migraciones aplicadas, sin ramas nuevas, sin commits. Esperando aprobación del contrato (en especial D-1 y D-2) para implementar W-1…W-5 sobre `feature/crm-comercial-f2-1`, validando contra staging.*
