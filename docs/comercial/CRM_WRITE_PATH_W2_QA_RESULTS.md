# CRM_WRITE_PATH_W2_QA_RESULTS — W-2 · Evidencia de QA

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Entorno DB:** `tops-nexus-staging` · ref **`vrxosunxlhohmqymxots`** · pooler `aws-1-sa-east-1`
**Artefacto:** `src/lib/comercial/stage-actions.ts`
**Harness:** `scripts/qa-w2-staging.mjs` (guard de URL incluido)

## Resultado

> ## ✅ GO
> tsc ✅ · lint ✅ · integración de capacidad ✅ · contrato action↔RPC **9/9 PASS** en staging (tx+rollback, sin datos residuales).

---

## 1. Compilación y lint

| Check | Comando | Resultado |
|---|---|---|
| Tipos | `npx tsc --noEmit` | ✅ exit 0 (sin errores) |
| Lint | `npx next lint --file src/lib/comercial/stage-actions.ts` | ✅ `No ESLint warnings or errors` |

---

## 2. Integración con el Capacity Engine (motor real, TS puro)

`findAvailability(..., basis:'proyectada')` — el cálculo que `reserveCapacity` pasa como `p_available_m2`:

| Caso | Disponible proyectado | Factibilidad | Esperado |
|---|---|---|---|
| ANMAT @ Pedro Luján 3159, 100 m² | **401 m²** | ✅ factible | ✅ |
| Cargas Generales @ Magaldi 1765, 500 m² | **0 m²** | ❌ no factible (CG ocupado) | ✅ |
| ANMAT @ Pedro Luján 3159, 999.999 m² | 401 m² | ❌ no factible | ✅ |

Cifras coherentes con la auditoría de capacidad → la action dimensiona bien el presupuesto.

---

## 3. Contrato Server Action ↔ RPC (staging, BEGIN…ROLLBACK)

Cada assert ejercita —vía `pg`, impersonando al usuario comercial— la **misma operación de base con los mismos nombres de parámetro** que la action invoca.

| # | Test | Resultado | Detalle |
|---|---|---|---|
| 1 | fixtures (usuario comercial + 2 opps + onboarding) | ✅ PASS | ok |
| 2 | `reserveCapacity`: lectura `service_type+m2` bajo RLS | ✅ PASS | service=anmat |
| 3 | `reserveCapacity`: RPC named-args → `committed=reservado` | ✅ PASS | committed=reservado · site=PEDRO_LUJAN_3159 |
| 4 | `advanceStage`: RPC named-args `calificado→propuesta` | ✅ PASS | estado=propuesta |
| 5 | `advanceStage`: `negociacion→ganado` (con capacidad) → comprometido | ✅ PASS | estado=ganado · committed=comprometido |
| 6 | `completeOnboarding`: RPC named-args → `ocupado` | ✅ PASS | committed=ocupado |
| 7 | `updateOpportunityFields`: campos de lista blanca aplicados | ✅ PASS | contacto/monto/probabilidad actualizados |
| 8 | `updateOpportunityFields`: `estado`/`committed_state` **intactos** | ✅ PASS | estado=propuesta · committed=reservado |
| 9 | grants `execute` a `authenticated` en las 3 RPC (exposición PostgREST) | ✅ PASS | las 3 con grant |

**TOTAL 9 · PASS 9 · FAIL 0.** ROLLBACK ejecutado — sin datos residuales.

---

## 4. Qué prueba (y qué no) este QA

**Prueba:**
- Las actions compilan y tipan correctamente.
- Los **nombres/tipos/orden de parámetros** que las actions pasan coinciden con las funciones `0047` (named-args → si hubiera un typo, Postgres fallaría con "function does not exist").
- Las RPC están **expuestas a PostgREST** (grant a `authenticated`) → `supabase.rpc(...)` las alcanza.
- La **lista blanca** de `updateOpportunityFields` no altera `estado`/`committed_state`.
- El **presupuesto de capacidad** se calcula con el motor real y es sano.

**No re-prueba** (ya cubierto en W-1, 29/29): atomicidad, máquina de estados, bloqueo duro D-2, anti-doble-conteo, RLS por rol. El harness invoca las mismas funciones validadas.

**Limitación honesta:** las server actions `"use server"` no se ejecutan fuera del runtime de Next (usan `cookies()`/`revalidatePath()`), y staging no expone claves supabase-js (solo `pg`). La verificación end-to-end por HTTP (PostgREST con JWT real) y el `revalidatePath` se observarán al cablear la UI en **W-3**.

---

## 5. Estado de producción

- **PROD (`arsksytgdnzukbmfgkju`):** intacto.
- **`main` / Netlify / Clientify / Dashboard Corporativo:** intactos.
- **Staging:** sin cambios de esquema en W-2; los datos del harness se revierten (rollback).

> **W-2 GO.** Listo para W-3 (wiring de la Ficha 360°) **previa aprobación**.
