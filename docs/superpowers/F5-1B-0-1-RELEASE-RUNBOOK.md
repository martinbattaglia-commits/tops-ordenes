# F5.1-b.0.1 · Release runbook DEFINITIVO (con gates)

> **Ventana Dirección 2026-07-03 · Opción 2: CC ejecuta pasos autorizados de a uno, con GO
> explícito de Dirección ANTES de cada acción irreversible. NO autorización total.**
> Estado al abrir: prod `70cdd68`, deploy `6a47d1ed56172d219e2e9a6b` **locked**, última mig `0177`,
> `0178` NO aplicada, `searchable_items`=797, FTS `'vencimiento'`=0. Paquete **staged, sin commit**.

## Reparto de ejecución
- **CC (vía Supabase MCP, tras GO por paso):** aplicar 0178, dry-run, reproyección/backfill, validaciones read-only.
- **Dirección/Martín (CLI):** commit local, deploy DRAFT, deploy PROD, unlock/re-lock Netlify.
- CC **frena y pide GO** antes de cada write. CC **nunca** pushea/mergea/toca main. Solo proyecto `arsksytgdnzukbmfgkju`.

## Orden definitivo (schema+data ANTES del código)

| # | Etapa | Tipo | GO Dirección | Ejecuta | Rollback de la etapa |
|---|---|---|---|---|---|
| 0 | Pre-flight | **read-only** | — (hecho) | CC | n/a |
| 1 | Commit local del paquete b.0.1 (sin push) | git local | **GO** | Martín (o CC si lo autorizás) | `git reset --soft HEAD~1` |
| 2 | Aplicar `0178` (schema-only) | **prod DDL** | **GO** | CC | `ROLLBACK_0178` Nivel 1 (drop 2 RPC) + Nivel 2 (restaurar vista 0176) |
| 3 | Dry-run `ai_docs_backfill_dryrun()` | read-only | **GO** (pedido) | CC | n/a (no escribe) |
| 4 | Decidir reproyección (opcional) | decisión | **GO** | Dirección | — |
| 4b | Reproyección `ai_docs_backfill_apply()` (si GO) | **prod data** | **GO** | CC | re-apply tras `ROLLBACK_0178` Nivel 2 (body vuelve a 0176) |
| 5 | Deploy **DRAFT** (`netlify deploy --build`, sin `--prod`, Node 22, RAÍZ) | Netlify | **GO** | Martín | descartar draft (no publica) |
| 6 | Smoke DRAFT (ítem visible; `/copilot` "desactivado" = correcto) | read-only | — | CC/Martín | — |
| 7 | Deploy **PROD**: unlock deploy actual → `netlify deploy --build --prod` | **Netlify prod** | **GO** | Martín | re-deploy `6a47d1ed…` o `netlify rollback` |
| 8 | **Re-lock inmediato** del nuevo deploy | Netlify | **GO** | Martín | — |
| 9 | Smoke PROD (`/api/version`=nuevo sha; login 200; rutas 307; webhook 403/401; 0 500/502) | read-only | — | CC | (dispara rollback si rojo) |
| 10 | Smoke Copilot eval set en vivo (Gemini) + auditar `ai_messages` | read-only | — | Dirección+CC | — |
| 11 | Cierre o rollback | — | **GO** si rollback | CC/Martín | según etapa |

## Detalle por etapa

**Etapa 2 — Aplicar 0178 (CC, tras GO).** `apply_migration` como postgres, nombre `0178_docs_retrieval_improvements`, contenido exacto del archivo (incluye fix filtro `tipo` ANMAT). Aditiva: agrega `ai_contracts_overview`/`ai_docs_browse` (INVOKER→authenticated) y redefine la vista. **NO cambia `searchable_items`** ni el comportamiento visible (el código `70cdd68` no llama las RPCs nuevas). Verificación: 2 RPC presentes (prosecdef=false), vista redefinida.

**Etapa 3 — Dry-run (CC, read-only, tras GO).** `select ai_docs_backfill_dryrun();` Gate: `pii_residual_en_body=0`, `visibility_key_no_permitida=0`, `proyectados=797`, `orphans_actuales=0`. Si `pii_residual>0` → ABORT + rollback vista.

**Etapa 4 — Decidir reproyección.** ⚠️ **La reproyección es OPCIONAL para el valor central de b.0.1:** `ai_contracts_overview` (por vencer / último firmado) lee `contracts` en vivo, NO necesita backfill; `ai_docs_browse` filtra por `title ILIKE`, funciona con el body viejo. El backfill SOLO mejora el FTS de `ai_search_knowledge` para búsquedas genéricas (p.ej. `'vencimiento'` pasaría de 0 a >0) y **cambia lo que ven los pilotos en la búsqueda existente de inmediato**. Opción de mínimo riesgo: **deferir el backfill** (release = 0178 + código, sin data write) y reproyectar en otra ventana.

**Etapa 4b — Reproyección (CC, prod data, tras GO).** `select ai_docs_backfill_apply();` Gate: `{upserted:797, orphans_deleted:0}`. Post: `ai_search_knowledge('vencimiento',null,50)` > 0.

**Etapas 5–8 — Deploy (Martín, CLI).** Requiere commit (Etapa 1) para `/api/version` trazable. Gotchas: correr desde la RAÍZ del repo (502 ENOENT run-config.json); Node 22; env-redeploy `--skip-functions-cache`; unlock→deploy→**re-lock inmediato**; NO agregar `AI_ENABLED` a preview (draft sin Gemini → `/copilot` "desactivado" es correcto).

## Read-only vs writes
- **Read-only:** 0 (pre-flight), 3 (dry-run), 6 (smoke draft), 9 (smoke prod), 10 (smoke copilot).
- **Writes (cada uno con GO):** 1 (git local), 2 (prod DDL), 4b (prod data), 5/7/8 (Netlify).

## Riesgos
- **R-orden:** mitigado (schema+data antes del código → sin ventana NO_EVIDENCE por RPC inexistente).
- **R-backfill:** cambia la búsqueda del Copilot en vivo antes del deploy de código (mejora, no rompe; guard/citas intactos). Deferible.
- **R-deploy-lock:** olvidar el re-lock deja prod desprotegido → Etapa 8 obligatoria.
- **R-commit:** deploy sin commit → `/api/version` no trazable / dirty. Por eso commit = Etapa 1.
- **R-RLS:** las RPC nuevas son INVOKER → nunca sobre-exponen (validado + adversarial GO).

## Rollback global
DB: `ROLLBACK_0178_docs_retrieval_improvements.md`. Deploy: re-deploy `6a47d1ed…` + re-lock. Código: `git reset` (rama aislada, sin push).

## Primer paso que pido autorizar
**Etapa 1 — Commit local del paquete b.0.1 (git local, sin push).** Requiere tu GO. Podés correrlo vos, o autorizarme a hacerlo yo (es local y reversible con `git reset`).
