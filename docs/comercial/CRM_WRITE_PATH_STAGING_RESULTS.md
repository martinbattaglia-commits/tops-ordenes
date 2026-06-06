# CRM_WRITE_PATH_STAGING_RESULTS — W-1 · Evidencia de validación en staging

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha de ejecución:** 2026-06-06
**Entorno:** `tops-nexus-staging` · ref **`vrxosunxlhohmqymxots`** · pooler `aws-1-sa-east-1.pooler.supabase.com`
**Artefactos:** `0047_crm_write_path_fns.sql` + `supabase/tests/CRM_WRITE_PATH_VALIDATION.sql`
**Runner:** `scripts/run-w1-staging.mjs` (guard de URL incluido)

## Resultado

> ## ✅ GO — 29 / 29 PASS · 0 FAIL
> Guard de entorno: **PASS** (staging confirmado, sin ref de PROD).
> `0047` aplicada de forma persistente (3 funciones). Validación en `BEGIN…ROLLBACK`: **sin datos residuales**.

---

## Condiciones de ejecución

- **Guard:** `STAGING_DB_URL` contiene `vrxosunxlhohmqymxots` y **no** `arsksytgdnzukbmfgkju` → conexión permitida.
- **0047:** aplicada con `CREATE OR REPLACE FUNCTION` (idempotente) — persistente en staging.
- **Validación:** transacción única que termina en `ROLLBACK`; los fixtures (3 usuarios, 4 oportunidades, 1 onboarding) **no persisten**.
- **Tiempo:** ejecución completa (aplicar 0047 + 29 asserts) en pocos segundos sobre una sola conexión `pg`.
- **Warnings:** ninguno.

---

## Detalle (29 asserts · todos PASS)

| Sección | Test | Resultado | Detalle |
|---|---|---|---|
| 0-preflight | 3 funciones RPC de 0047 existen | ✅ PASS | count=3 |
| 0-preflight | 3 funciones son SECURITY INVOKER (R-G2) | ✅ PASS | invoker=3 |
| 1-fixtures | usuarios + 4 opps + onboarding semilla | ✅ PASS | ok |
| 2-reserve | reserve_capacity fija assigned_site | ✅ PASS | site=PEDRO_LUJAN_3159 |
| 2-reserve | reserve_capacity → committed_state=reservado | ✅ PASS | committed=reservado |
| 2-reserve | reserve_capacity → capacity_feasible=true | ✅ PASS | feasible=true |
| 2-reserve | escribe ledger con auth.uid() correcto **[QA-7]** | ✅ PASS | changed_by=…0c0001 |
| 2-reserve | rechaza si m²(300) > disponible(50) | ✅ PASS | INSUFFICIENT_CAPACITY |
| 3-advance | **[QA-1, QA-5]** calificado→propuesta directo (visita opcional D-3) | ✅ PASS | estado=propuesta |
| 3-advance | committed_state se mantiene reservado (assigned_site presente) | ✅ PASS | committed=reservado |
| 3-advance | ledger registró la transición **[QA-6]** | ✅ PASS | filas=1 |
| 4-invalid | **[QA-2]** nuevo_lead→ganado rechazada | ✅ PASS | INVALID_TRANSITION |
| 4-invalid | **[QA-8]** ROLLBACK: estado intacto | ✅ PASS | estado=nuevo_lead |
| 4-invalid | **[QA-8]** ROLLBACK: sin filas en ledger | ✅ PASS | filas=0 |
| 5-hardblock | **[QA-4]** ganar sin assigned_site rechazado (D-2) | ✅ PASS | GANADO_REQUIRES_CAPACITY |
| 5-hardblock | **[QA-8]** ROLLBACK: estado/committed intactos | ✅ PASS | estado=negociacion committed=reservado |
| 5-hardblock | **[QA-8]** ROLLBACK: sin filas en ledger | ✅ PASS | filas=0 |
| 6-idempotencia | **[QA-3]** from==to es no-op (sin error) | ✅ PASS | estado=propuesta |
| 6-idempotencia | **[QA-3]** from==to NO agrega fila al ledger | ✅ PASS | antes=0 después=0 |
| 7-lifecycle | negociacion→ganado con capacidad → comprometido | ✅ PASS | estado=ganado committed=comprometido |
| 7-lifecycle | complete_onboarding → committed_state=ocupado | ✅ PASS | committed=ocupado |
| 7-lifecycle | complete_onboarding → onboarding completado/100% | ✅ PASS | status=completado pct=100 |
| 7-lifecycle | anti-doble-conteo: ocupado fuera del snapshot (F2.1-4) | ✅ PASS | cuenta_en_snapshot=false |
| 7-lifecycle | complete_onboarding idempotente (ya ocupado → no-op) | ✅ PASS | antes=5 después=5 |
| 8-consistencia | **[QA-6]** 3 transiciones reales de etapa registradas | ✅ PASS | transiciones=3 |
| 8-consistencia | 2 eventos de capacidad (reserve+onboarding) | ✅ PASS | eventos=2 total=5 |
| 8-consistencia | **[QA-6]** estado de la opp == última transición del ledger | ✅ PASS | opp=ganado ledger=ganado |
| 8-consistencia | **[QA-7]** todos los changed_by = usuario comercial | ✅ PASS | filas_con_uid_distinto=0 |
| 9-rls | **[R-G2]** usuario sin comercial.edit no puede avanzar etapa | ✅ PASS | bloqueado (OPP_NOT_FOUND vía RLS de lectura) |

---

## Cobertura del QA obligatorio (8/8)

| # | QA | Estado |
|---|---|---|
| 1 | Transición válida | ✅ |
| 2 | Transición inválida | ✅ |
| 3 | Idempotencia | ✅ |
| 4 | Bloqueo duro de ganado sin `assigned_site` | ✅ |
| 5 | Visita opcional | ✅ |
| 6 | `stage_history` consistente | ✅ |
| 7 | `auth.uid()` correcto | ✅ |
| 8 | Rollback correcto en error | ✅ |

**Criterio de éxito alcanzado:** todas PASS · **cero inconsistencias** entre `crm_opportunities` y `crm_stage_history`.

---

## Nota de seguridad (matiz observado en §9)

El bloqueo a un usuario sin `comercial.edit` se materializó como `OPP_NOT_FOUND`: la **RLS de SELECT** (`comercial.view`) oculta la fila antes de que la función llegue al `UPDATE`. El resultado es el correcto (escritura denegada) y además **no filtra** si la oportunidad existe. R-G2 se mantiene sobre el write-path.

---

## Estado de producción

- **PROD (`arsksytgdnzukbmfgkju`):** intacto. No tiene 0047 ni se tocó.
- **`main` / Netlify / Clientify:** intactos.
- **Staging:** 0047 aplicada (funciones). Sin datos de prueba (rollback).

> **W-1 GO.** Listo para W-2 (server actions) **previa aprobación**.
