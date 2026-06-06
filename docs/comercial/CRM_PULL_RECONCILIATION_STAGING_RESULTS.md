# CRM_PULL_RECONCILIATION_STAGING_RESULTS — F2.2-5 · Evidencia

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Entorno:** `tops-nexus-staging` · ref **`vrxosunxlhohmqymxots`**
**Harness:** `scripts/f225-reconcile-staging.mts` · Build: `npm run build`

## Resultado

> ## ✅ GO — 10/10 PASS · tsc ✅ · lint ✅ · build ✅
> Reconciliación por pull validada contra staging. ROLLBACK — sin residuos. Sin migración nueva (reusa 0048).

---

## 1. Compilación

| Check | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0 |
| `npx next lint` (reconcile.ts + sync-contacts/route.ts) | ✅ sin warnings |
| `npm run build` | ✅ `Compiled successfully` · `ƒ /api/clientify/sync-contacts` |

---

## 2. QA — 10/10 PASS (staging, BEGIN…ROLLBACK)

Escenario: contacto **A** ya ingerido (webhook previo); lote de pull `[A, B (perdido), C (sin identidad)]`.

| # | Assert | Resultado |
|---|---|---|
| 1 | pull#1 `scanned=3` | ✅ |
| 2 | pull#1 `recovered=1` (B, **webhook perdido recuperado**) + `recoveredIds=[5002]` | ✅ |
| 3 | pull#1 `refreshed=1` (A ya presente) | ✅ |
| 4 | pull#1 `skipped=1` (C sin identidad) | ✅ |
| 5 | pull#1 `errors=0` | ✅ |
| 6 | pull#1 **persistencia**: exactamente +1 lead (B) | ✅ antes=1 después=2 |
| 7 | pull#2 **idempotente**: `recovered=0, refreshed=2` | ✅ |
| 8 | pull#2 sin filas nuevas (no duplica) | ✅ |
| 9 | `clientify_sync_log` eventos `pull` registrados | ✅ filas=4 |
| 10 | **divergencia recuperada**: B (5002) ahora en `crm_leads` | ✅ |

**TOTAL 10 · PASS 10 · FAIL 0.**

---

## 3. Cobertura del alcance F2.2-5

| Ítem | Evidencia |
|---|---|
| Persistencia | +1 lead + filas `event='pull'` en `clientify_sync_log` |
| Reconciliación | re-ingesta del lote |
| Detección de divergencias | `recovered`/`recoveredIds` (B faltaba) |
| Recuperación ante webhook perdido | B insertado en el pull |
| Idempotencia | pull#2 recovered=0, sin duplicados |

---

## 4. Método y nota

- **Cubierto:** la lógica real (`reconcileContacts`, `normalizeLead`, `crm_ingest_lead`) end-to-end contra staging, con `ingest` inyectado vía `pg` — la misma función que el route invoca con service-role.
- **Limitación honesta:** la capa HTTP del route (listContacts → Clientify + cliente service-role) no se ejercita contra staging (runtime apunta a PROD; sin claves supabase-js de staging). Cubierta por build + la validación de la lógica. El pull HTTP real corre en un entorno con `crm_*` + `CLIENTIFY_API_KEY` + cron.
- **No destructivo:** `BEGIN…ROLLBACK`; fixtures no persisten.

---

## 5. Estado de producción

- **PROD / `main` / Netlify / Clientify PROD (escritura):** intactos.
- **Sin migración nueva** (reusa `crm_ingest_lead` 0048). Solo app-layer + route.

> **F2.2-5 GO.** Backbone de resiliencia operativo. Ver `CLIENTIFY_INBOUND_CLOSURE.md`.
