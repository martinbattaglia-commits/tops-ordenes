---
name: devops-tops-nexus
description: >-
  DevOps de TOPS NEXUS: deploys Netlify, GitHub Actions, env vars, secrets, cron jobs,
  branch/PR flow, rollback y runbooks. Usar al preparar un deploy, tocar netlify.toml o los
  workflows, configurar variables de entorno/secretos, diseñar o arreglar crons, planear un
  rollback o recuperar git. El asistente NUNCA commitea, pushea, mergea, deploya ni aplica
  migraciones: prepara y muestra; ejecuta Martín. NO usar para código de negocio, diseño de
  schema (architecture-tops-nexus) ni tuning de queries (performance-tops-nexus).
---

# devops-tops-nexus

> **Antes de actuar, leé y aplicá [`../_shared/GOVERNANCE.md`](../_shared/GOVERNANCE.md) (G1–G11).
> En particular G1: el asistente prepara staged y muestra; NO ejecuta acciones de prod.**

## Propósito
Operar la cadena de release (Netlify + GitHub Actions + Supabase) de forma segura y reproducible,
sin violar las reglas de no-push/deploy/commit ni de migraciones a mano.

## Cuándo usarla
- Preparar un deploy (pre-deploy checklist).
- Configurar env vars / secrets.
- Editar `netlify.toml` o `.github/workflows/*`.
- Diseñar o arreglar crons (schedulers).
- Planear un rollback.
- Recuperar git (commits perdidos, working tree).

## Cuándo NO usarla
- Código de negocio / features → módulo o `architecture-tops-nexus`.
- Diseño de schema/RLS → `architecture-tops-nexus`.
- Tuning de queries/build perf → `performance-tops-nexus`.

## Reglas obligatorias (además de G1–G11)
- **El asistente NUNCA** commitea/pushea/mergea/deploya/aplica migraciones — lo hace Martín (G1). → `docs/handoff/DEPLOY-RUNBOOK.md:5`.
- **Netlify publica desde `main` por push** (auto-build, `publish=.next`); no hay deploy manual como camino normal. Build con **plugin `@netlify/plugin-nextjs`**. → `docs/handoff/FINAL-DEPLOY-RUNBOOK.md:100`; `netlify.toml:7-22`.
- **Build = Node 22 + heap 4 GB** (`NODE_VERSION=22`, `NODE_OPTIONS=--max-old-space-size=4096`); no bajarlos. → `netlify.toml:14-19`.
- **Cron auth = `Authorization: Bearer ${CRON_SECRET}`**; el secret de GitHub Actions debe ser el **mismo valor** que la env var en Netlify. **DEBE ser fail-closed** — el patrón actual `if (secret) {…}` es **fail-open** (si `CRON_SECRET` falta, el endpoint queda abierto): P0 conocido a corregir, y `CRON_SECRET` debe setearse en Netlify **antes** de aplicar 0081. → `.github/workflows/compliance-drive-sync.yml:39-46`; `src/app/api/compliance/sync/route.ts:19-25`; memoria `compliance-cockpit-sync-state`.
- **Pre-deploy gate:** `npm run env:check` debe dar `RESULT: PASS` (exit 0). **Un solo FAIL = NO DEPLOY.** → `docs/handoff/PRE_DEPLOY_ENVIRONMENT_CHECKLIST.md:4`.
- **Secret scanning de Netlify es bloqueante:** si nombra un secreto real, **removerlo y ROTAR la clave** antes de redeployar (no solo enmascarar). `SECRETS_SCAN_OMIT_*` solo para falsos positivos. Nunca desactivar el scanner global. → `docs/handoff/NETLIFY-BUILD-FAILURE-ROOT-CAUSE.md:6,55`.
- **Secretos** (G9): `service_role` solo backend, X.509 ARCA host-only, `.env.local` nunca commiteado, env-check nunca imprime valores.
- **Migraciones a mano, orden ascendente, sin DROP/rollback de schema.** → `docs/handoff/FINAL-DEPLOY-RUNBOOK.md:49,55`; `docs/handoff/ROLLBACK-PLAN.md:35` (G3).
- **Rollback:** 1º republicar en Netlify el último deploy *Published* estable (instantáneo, sin rebuild); si hay que revertir código → `git revert -m 1 <merge_sha>` sobre main; env var mala → corregir variable + redeploy, **no** revertir código. → `docs/handoff/ROLLBACK-PLAN.md:15-39`.
- **Git:** push con **refspec explícito** (`git push -u origin <branch>:<branch>`) — el upstream de `claude/*` es `origin/main` (footgun de `git push` pelado). Antes de operaciones riesgosas: `backup/` branch + `git diff > patch`. No reescribir historia, no squash, no `reset --hard` con worktree sucio. → `docs/handoff/FINAL-DEPLOY-RUNBOOK.md:21-23,78`; `docs/handoff/GIT_RECOVERY_CHECKLIST.md:91-93`.
- **Backup:** `SUPABASE_DB_URL` = cadena Postgres de **PROD** (Session Pooler, `sslmode=require`); `pg_dump` **v17** (el workflow falla si no). → `.github/workflows/supabase-backup.yml:11,86-89`.

## Comandos sugeridos
```bash
npm run env:check                                  # gate pre-deploy; PASS (exit 0) o NO DEPLOY
NODE_OPTIONS=--max-old-space-size=4096 npm run build
npm run typecheck && npm run lint                  # gates pre-merge
git status                                          # confirmar staging aislado por módulo
git push -u origin <branch>:<branch>                # NUNCA `git push` pelado (upstream=origin/main)
gh pr create --base main --head <branch>            # camino recomendado de merge
git revert -m 1 <merge_commit_sha>                  # rollback de código (Opción B)
git branch backup/main-<fase>-<YYYYMMDD>            # respaldo antes de operación riesgosa
git diff > backups/worktree_$(date +%Y%m%d).patch   # respaldar working tree
git reflog                                          # localizar commits perdidos
netlify watch                                       # seguir el build en curso
```
> Estos comandos los **ejecuta Martín**. El asistente los prepara/documenta (G1).

## Checklist de validación
- [ ] ¿`npm run env:check` = PASS (exit 0)?
- [ ] ¿Secret scan limpio (sin secretos reales en archivos)?
- [ ] ¿Build verde local (Node 22 + 4 GB)?
- [ ] ¿Migraciones **entregadas, no aplicadas**, en orden ascendente?
- [ ] ¿Plan de rollback listo (republish + git revert)?
- [ ] ¿Push con refspec explícito?
- [ ] ¿`CRON_SECRET` seteado en Netlify y handler **fail-closed**?
- [ ] ¿Commits aislados por módulo (staging limpio)?

## Criterios de cierre
- Working tree **staged y mostrado** (no commiteado) (G1).
- Checklist pre-deploy verde con evidencia (`env:check` PASS, build verde).
- Plan de rollback documentado.
- **Nada ejecutado en prod por el asistente.**

## Ejemplos de prompts internos
- *"Prepará el deploy del módulo `<X>`: corré `env:check`, mostrá el diff staged aislado por módulo, listá las migraciones a aplicar a mano (orden ascendente) y el plan de rollback. Confirmá `CRON_SECRET` fail-closed. No commitees, no pushees, no deploys."*
- *"Convertí el guard de cron de fail-open a fail-closed en `api/compliance/sync`, `api/comercial/contratos/sync`, `api/clientify/sync-contacts` y `api/whatsapp/send` con un helper `requireCronAuth()`. Entregá diffs staged; no apliques."*
- *"Diseñá el plan de rollback para el release actual: republish del último deploy estable + `git revert -m 1 <sha>` como plan B. Documentá pasos para que los ejecute Martín."*
