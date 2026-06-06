# CRM_WRITE_PATH_IMPLEMENTATION_REPORT — W-1 · Funciones RPC transaccionales

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Rama:** `feature/crm-comercial-f2-1`
**Fecha:** 2026-06-06
**Frente:** Write-Path (F2.1-8) · **Paso W-1** — migración `0047_crm_write_path_fns.sql`
**Fuente de diseño:** `docs/comercial/CRM_WRITE_PATH_ARCHITECTURE.md` (D-1/D-2/D-3 aprobadas)
**Estado:** ✅ **implementado y validado en staging — 29/29 PASS (GO)**

> Solo funciones. **No** se crearon/modificaron tablas, columnas, enums, policies, RLS ni RBAC. Aplicado **solo en staging** (`vrxosunxlhohmqymxots`). Producción intacta.

---

## 1. Qué se entregó

| # | Archivo | Contenido |
|---|---|---|
| 1 | `supabase/migrations/0047_crm_write_path_fns.sql` | 3 funciones RPC `SECURITY INVOKER` + grants |
| 2 | `supabase/tests/CRM_WRITE_PATH_VALIDATION.sql` | Suite de validación (29 asserts) en `BEGIN…ROLLBACK` |
| 3 | `scripts/run-w1-staging.mjs` | Runner con **guard de URL**: aplica 0047 + corre la validación en staging |
| 4 | `docs/comercial/CRM_WRITE_PATH_IMPLEMENTATION_REPORT.md` | Este documento |
| 5 | `docs/comercial/CRM_WRITE_PATH_STAGING_RESULTS.md` | Evidencia de ejecución (PASS/FAIL/tiempos) |

---

## 2. Funciones creadas (parámetros y responsabilidades)

Las tres son `language plpgsql · security invoker · set search_path = public, pg_temp` y **retornan `crm_opportunities`** (la fila actualizada). La atomicidad la garantiza el modelo transaccional de PostgreSQL: cada llamada corre en una (sub)transacción; si cualquier sentencia interna falla (`raise exception`), **se revierte todo** — nunca queda `crm_opportunities` desincronizado de `crm_stage_history`.

### 2.1 `crm_advance_stage(p_opp uuid, p_to crm_stage_t, p_note text default null)`
Transición de etapa atómica.
1. `SELECT … FOR UPDATE` de la opp (RLS `comercial.view`; excluye soft-deleted) → lock de fila.
2. **Idempotencia:** si `estado = p_to` → retorna sin tocar nada ni escribir ledger.
3. **Validación de transición** (máquina de estados embebida):

   | Desde | Destinos permitidos |
   |---|---|
   | `nuevo_lead` | `contactado`, `perdido` |
   | `contactado` | `calificado`, `perdido` |
   | `calificado` | `visita`, **`propuesta`** (D-3 directo), `perdido` |
   | `visita` | `propuesta`, `perdido` |
   | `propuesta` | `negociacion`, `perdido` |
   | `negociacion` | `ganado`, `perdido` |
   | `ganado` / `perdido` | — (terminal, sin reapertura desde UI) |

   Cualquier otra → `INVALID_TRANSITION`.
4. **D-2 · bloqueo duro:** `p_to = 'ganado'` con `assigned_site IS NULL` → `GANADO_REQUIRES_CAPACITY`.
5. **Derivación de `committed_state`:** `perdido→none` · `ganado→comprometido` · resto activo → `reservado` si hay `assigned_site`, si no `none`. *(Nunca fija `ocupado` — eso es exclusivo de `crm_complete_onboarding`, preservando la regla anti-doble-conteo F2.1-4.)*
6. `UPDATE` opp (set `estado`, `committed_state`; además `actual_close` al cerrar y `lost_reason` al perder) + `INSERT` en `crm_stage_history` (`from`, `to`, `changed_by = auth.uid()`, `note`).

### 2.2 `crm_reserve_capacity(p_opp uuid, p_site text, p_units jsonb, p_available_m2 numeric default null)`
Reserva de sitio/unidades.
1. Lock de la opp; rechaza si está `perdido` (`CANNOT_RESERVE_LOST`).
2. Valida `p_site ∈ {PEDRO_LUJAN_3159, MAGALDI_1765}` (`INVALID_SITE`) y `p_units` array jsonb no vacío (`INVALID_UNITS`).
3. **Chequeo de capacidad atómico opcional:** si `p_available_m2` no es nulo y `m2 > p_available_m2` → `INSUFFICIENT_CAPACITY`.
4. `UPDATE`: `assigned_site`, `assigned_units`, `capacity_feasible=true`, `committed_state='reservado'` + evento en `crm_stage_history` (`from=to=estado` actual, nota "Capacidad reservada en …").

> **Frontera de capacidad física (documentada, por diseño):** el baseline físico (10.049 m² comercializables, etc.) vive en los **modelos TS del Digital Twin** (`lujan3159-map.ts`/`magaldi1765-map.ts`), **no en Postgres**. Por eso la función **no** puede calcular factibilidad física por sí sola: el server action (W-2) computa la disponibilidad con el motor `corporate-capacity.ts` y la pasa como `p_available_m2` para el chequeo atómico final (evita TOCTOU). Si se invoca sin ese presupuesto, la DB solo valida invariantes de datos. Esto es coherente con `CRM_WRITE_PATH_ARCHITECTURE.md §4.1`.

### 2.3 `crm_complete_onboarding(p_opp uuid, p_note text default null)`
Cierre de onboarding → ocupación.
1. Lock de la opp. **Idempotencia:** si ya `committed_state='ocupado'` → no-op.
2. Exige `estado='ganado'` (`ONBOARDING_REQUIRES_GANADO`) y que exista un `crm_onboarding` para la opp (`ONBOARDING_NOT_FOUND`).
3. `UPDATE crm_onboarding` (`status='completado'`, `progress_pct=100`, `completed_at`) + `UPDATE` opp (`committed_state='ocupado'`) + evento en `crm_stage_history`.
4. **Anti-doble-conteo:** `ocupado` queda **fuera** del `CommittedSnapshot` (el snapshot filtra solo `reservado`/`comprometido` — `committed-capacity.ts:45`).

---

## 3. Errores controlados (códigos de excepción)

| Excepción | Disparador | Función |
|---|---|---|
| `OPP_NOT_FOUND` | opp inexistente, eliminada **o no visible bajo RLS** | las 3 |
| `INVALID_TRANSITION` | transición no permitida por la máquina de estados | advance |
| `GANADO_REQUIRES_CAPACITY` | `→ganado` sin `assigned_site` (D-2) | advance |
| `CANNOT_RESERVE_LOST` | reservar sobre opp `perdido` | reserve |
| `INVALID_SITE` | sitio fuera del catálogo conocido | reserve |
| `INVALID_UNITS` | `assigned_units` no es array jsonb no vacío | reserve |
| `INSUFFICIENT_CAPACITY` | `m2 > p_available_m2` (presupuesto del server) | reserve |
| `ONBOARDING_REQUIRES_GANADO` | completar onboarding sin estar `ganado` | complete |
| `ONBOARDING_NOT_FOUND` | no hay `crm_onboarding` para la opp | complete |

Cada excepción aborta su transacción → **rollback total** (verificado, QA-8).

---

## 4. Escenarios soportados (mapa a QA obligatorio)

| QA | Escenario | Cubierto por |
|---|---|---|
| 1 | Transición válida | `calificado→propuesta` (sección 3 de la validación) |
| 2 | Transición inválida | `nuevo_lead→ganado` rechazada |
| 3 | Idempotencia | `propuesta→propuesta` no-op, sin ledger nuevo |
| 4 | Bloqueo duro ganado sin `assigned_site` | `negociacion→ganado` rechazada (D-2) |
| 5 | Visita opcional | `calificado→propuesta` directo permitido (D-3) |
| 6 | `stage_history` consistente | 3 transiciones + estado == última transición |
| 7 | `auth.uid()` correcto | `changed_by` == usuario impersonado en todas las filas |
| 8 | Rollback en error | estado/committed/ledger intactos tras cada error |
| + | Ciclo de vida completo | reserve→propuesta→negociacion→ganado→onboarding→**ocupado** |
| + | Anti-doble-conteo | `ocupado` fuera del snapshot (F2.1-4) |
| + | RLS por rol | usuario sin `comercial.edit` no puede avanzar etapa (R-G2) |

---

## 5. Integridad — verificaciones de no-duplicación

- **FK existentes:** `crm_stage_history.opportunity_id → crm_opportunities` (cascade) y `crm_onboarding.opportunity_id` se usan tal cual; no se redefinen.
- **RLS existente:** se reusa (no se crean policies). Las funciones son `SECURITY INVOKER` → la RLS verificada en staging (R-G2) sigue gobernando. **Matiz de seguridad observado:** un usuario sin `comercial.view` recibe `OPP_NOT_FOUND` (la policy de **lectura** oculta la fila antes de llegar al UPDATE). El efecto neto es correcto — la escritura queda bloqueada y **sin fuga de información** (no revela si la opp existe).
- **`auth.uid()` / `has_permission()`:** se consumen los helpers existentes (`0005`/`0009`); no se reimplementa lógica de identidad ni de permisos.
- **`updated_at`:** lo gestiona el trigger existente `tg_touch_updated_at`; las funciones no lo tocan a mano.
- **Ledger inmutable:** las funciones solo hacen `INSERT` en `crm_stage_history` (jamás `UPDATE`/`DELETE`), respetando su append-only.

---

## 6. Seguridad

- `SECURITY INVOKER` (no DEFINER) → cero bypass de RLS; el modelo de permisos sigue intacto.
- `set search_path = public, pg_temp` en las tres → previene hijacking de search_path (mismo patrón que `is_admin()`/`has_permission()`).
- Grants: `execute` solo a `authenticated` y `service_role` (revocado de `public`; **sin** `anon`).
- `changed_by = auth.uid()` dentro de la función → no se confía en el cliente para la autoría del ledger.

---

## 7. Cómo reproducir

```bash
# Guard incluido: aborta si STAGING_DB_URL no es staging.
node scripts/run-w1-staging.mjs
```
Aplica `0047` (persistente) y corre la validación en `BEGIN…ROLLBACK`. Evidencia en `CRM_WRITE_PATH_STAGING_RESULTS.md`.

---

## 8. Frontera del paso (lo que W-1 NO incluye)

- ❌ Server actions TS (`stage-actions.ts`) → **W-2**.
- ❌ Wiring en `Opportunity360View.tsx` → **W-3**.
- ❌ `revalidatePath` del dashboard → **W-4**.
- ❌ Selector de unidades por sede / cálculo de `p_available_m2` desde el motor TS → W-2.
- ❌ Producción, `main`, Netlify, Clientify, Dashboard Corporativo: **intactos**.

> **W-1 cerrado.** Base transaccional lista para W-2. No avanzar a W-2 sin aprobación.
