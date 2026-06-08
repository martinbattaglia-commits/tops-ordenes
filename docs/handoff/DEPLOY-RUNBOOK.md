# DEPLOY-RUNBOOK — TOPS NEXUS

**Fecha:** 2026-06-08 · Ejecución paso a paso del Deploy Productivo.
**Branch origen:** `claude/gracious-pasteur-6efdde` → **destino:** `main` → **deploy:** Netlify.
**Ejecuta:** el usuario. El asistente preparó el plan; NO commitea/mergea/deploya ni escribe en prod.

---

## Pre-requisitos (de PROD-CHECKLIST.md)
- Gates verdes (tsc/lint/build). ✅
- `.gitignore` endurecido (secretos `.bak` y `.next.trash-*` ignorados). ✅
- Decididos: aplicar o no 0069; Clientify key prod válida; Drive root prod correcto.

---

## Paso 1 — Limpieza del worktree (opcional, recomendado)
```bash
cd <worktree>
# los .next.trash-* y .env.local.*.bak ya están gitignored; podés borrarlos:
rm -rf .next.trash-* 2>/dev/null
# NO borrar .env.local (lo necesita el dev). Verificá que los .bak no tengan secretos vivos antes de borrarlos.
```

## Paso 2 — Commit del release (BLOQUEANTE)
> El working tree tiene 58 modificados + 177 sin trackear (142 docs, 19 fuentes, 12 migraciones).
> Sin esto, el deploy NO incluye CRM360/crm_units/compliance/etc.
```bash
git status                      # revisar que NO aparezcan .env*.bak ni .next.trash-* (deben estar ignorados)
git add -A
git status                      # confirmar staged: solo código/docs/migraciones, CERO secretos
git commit -m "feat(release): CRM360 + crm_units + Digital Twin comercial + compliance + deal-name fix + QA fase final"
git push origin claude/gracious-pasteur-6efdde
```

## Paso 3 — Merge a `main`
`main` está 0 detrás (sin divergencia) → fast-forward/merge limpio, sin conflictos.
```bash
git checkout main
git pull origin main
git merge --no-ff claude/gracious-pasteur-6efdde
git push origin main
```
(O vía Pull Request en GitHub si se prefiere review. Los 7 commits RRHH + el commit del release entran juntos.)

## Paso 4 — Migraciones Supabase (prod `arsksytgdnzukbmfgkju`, SQL Editor)
1. Confirmar que las **obligatorias** ya están aplicadas (0052/0053, 0056–0065, 0066–0068).
2. **0069 (opcional):** si se decide mostrar el nombre real del deal:
   ```sql
   alter table public.crm_opportunities add column if not exists clientify_deal_name text;
   ```
   Luego (frente aparte): sumar la columna al SELECT de `opportunities-supabase.ts` + poblar `name` en el sync.
3. Las migraciones son aditivas/idempotentes → seguras de reconfirmar.

## Paso 5 — Variables de entorno en Netlify
- Verificar todas las de PROD-CHECKLIST §4–6. Especial atención:
  - `CLIENTIFY_API_KEY` **válida** (el token del MCP dio 401 en sesión).
  - `GOOGLE_DRIVE_ROOT_FOLDER_ID` correcto (fue cambiado; hay backups `.pre-drive-root`).
  - `NODE_VERSION=22`, `NODE_OPTIONS=--max-old-space-size=4096` (ya en `netlify.toml`).

## Paso 6 — Build & deploy en Netlify
- Push a `main` dispara el build automático (`npm run build`, publish `.next`).
- Verificar log: `✓ Compiled successfully`, 79 páginas, sin errores.
- Esperar estado **Published**.

## Paso 7 — Smoke test post-deploy
- Ejecutar POST-DEPLOY-SMOKE-TEST.md con sesión autenticada en el dominio prod.

## Paso 8 — Sign-off
- Si el smoke test pasa → release confirmado.
- Si falla algo crítico → ROLLBACK-PLAN.md.

---

## Notas
- El asistente NO ejecutó ninguno de estos pasos (commit/push/merge/migración/deploy son acciones del usuario).
- Todo el código fue validado (Release Readiness GO + Preview GO) sobre el working tree actual.
