# CRM_LEAD_INGEST_STAGING_RESULTS — F2.2-1 · Evidencia de staging

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha de ejecución:** 2026-06-06
**Entorno:** `tops-nexus-staging` · ref **`vrxosunxlhohmqymxots`** · pooler `aws-1-sa-east-1`
**Artefacto:** `supabase/migrations/0048_crm_ingest_lead.sql`
**Runner:** `scripts/f221-ingest-staging.mjs` (guard de URL + `BEGIN…ROLLBACK`)

## Resultado

> ## ✅ GO — 16 / 16 PASS · 0 FAIL
> `0048` aplicada (función `SECURITY DEFINER`). Ingesta validada end-to-end contra staging. ROLLBACK ejecutado — sin datos residuales (las secuencias de `public_id` avanzan, cosmético).

---

## 1. Detalle (16 asserts · todos PASS)

| # | Escenario | Resultado | Detalle |
|---|---|---|---|
| 0 | `crm_ingest_lead` existe y es SECURITY DEFINER | ✅ PASS | prosecdef=true |
| 1 | INSERT nuevo lead → `action=inserted` | ✅ PASS | public_id=LEAD-2026-NNNN |
| 1 | `public_id` formato `LEAD-YYYY-NNNN` | ✅ PASS | trigger OK |
| 1 | Ownership **least-loaded** → U2 (0 leads < U1 con 2) | ✅ PASS | owner=U2 |
| 1 | `status` inicial `nuevo` | ✅ PASS | status=nuevo |
| 1 | `clientify_sync_log` inbound/lead/ok + `nexus_id` | ✅ PASS | direction=inbound entity=lead status=ok |
| 2 | Idempotencia mismo `clientify_id` → `action=updated` | ✅ PASS | mismo lead_id |
| 2 | No duplica fila (1 sola con ese `clientify_id`) | ✅ PASS | filas=1 |
| 2 | Email refrescado (entrante gana en upsert) | ✅ PASS | email actualizado |
| 3 | Dedup por email, mismo nombre → `action=linked` | ✅ PASS | kind=email |
| 3 | No crea fila nueva (enriquece existente) | ✅ PASS | antes=3 después=3 |
| 4 | Conflicto email/nombre → `action=duplicate_flagged` (D-4) | ✅ PASS | flagged=true |
| 4 | Crea fila nueva (no se pierde el lead) | ✅ PASS | antes=3 después=4 |
| 4 | Tag `posible_duplicado` aplicado | ✅ PASS | tags=["posible_duplicado"] |
| 5 | Ownership empate → menor `owner_id` (U1) | ✅ PASS | owner=U1 |
| 6 | Sin comerciales activos → owner null, lead NO se pierde | ✅ PASS | owner=null action=inserted |

**TOTAL 16 · PASS 16 · FAIL 0.**

---

## 2. Cobertura de alcance F2.2-1

| Ítem del alcance | Evidencia |
|---|---|
| `crm_ingest_lead` | preflight + todos los escenarios |
| Deduplicación | idempotencia (clientify_id), enlazar (email), conflicto→crear+marcar (D-4) |
| Ownership least-loaded | asignación al menos cargado + empate determinista + sin-comerciales→null |
| `clientify_sync_log` | fila inbound/lead/ok con `nexus_id` y `_ingest` en payload |
| Persistencia en `crm_leads` | insert/update/link con `public_id`, `status`, `raw`, `tags` |

---

## 3. Método y honestidad

- **Sin claves supabase-js de staging** → la validación llama a la RPC vía `pg` (la misma función que invocará el handler con cliente service-role). La lógica de negocio queda probada al 100%; la verificación HTTP del handler corresponde a **F2.2-2**.
- **Sin Clientify** en este test: la ingesta es agnóstica del transporte (recibe el lead ya normalizado). La integración con el webhook real y payloads capturados se valida en F2.2-2.
- **No destructivo:** `BEGIN…ROLLBACK`; fixtures (2 usuarios, leads de carga) no persisten.

---

## 4. Estado de producción

- **PROD (`arsksytgdnzukbmfgkju`):** intacto (no tiene 0048).
- **`main` / Netlify / Clientify (PROD/escritura):** intactos.
- **Staging:** `0048` aplicada (función additiva). Sin datos de prueba (rollback).

> **F2.2-1 GO.** Ingesta de leads operativa y validada. Listo para F2.2-2 (handler webhook) **previa aprobación**.
