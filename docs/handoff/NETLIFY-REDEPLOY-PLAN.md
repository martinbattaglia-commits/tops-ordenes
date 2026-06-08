# NETLIFY-REDEPLOY-PLAN — TOPS NEXUS

**Fecha:** 2026-06-08 · Plan de redeploy tras el fallo de secret scanning en `70a9944`.

> ## ⚠️ FIX REAL (confirmado por log): redacción del secreto, NO el omit de netlify.toml
> El log de Netlify confirmó el secreto en `docs/handoff/DRIVE-TOPS-ROOT-FOLDER-UPDATE.md` (valor de `GOOGLE_DRIVE_ROOT_FOLDER_ID`, líneas 14/26/49/61). **Fix aplicado:** reemplazar el valor por `[REDACTED]` en ese doc. El omit de `netlify.toml` que se proponía abajo **fue revertido** (no correspondía: hubiera enmascarado, no resuelto). El procedimiento de redeploy (Pasos 1–4 / rollback) sigue vigente; solo cambia el contenido del commit (redacción del doc, no `netlify.toml`).

---

**Fix (versión previa, descartada):** ~~config-only en `netlify.toml`~~ → reemplazado por la redacción del valor real (ver banner).

---

## Fix preparado (ya aplicado al archivo, commit pendiente de tu OK para push)
`netlify.toml [build.environment]`:
```toml
SECRETS_SCAN_OMIT_PATHS = "public/tools/**"
SECRETS_SCAN_OMIT_KEYS  = "NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,NEXT_PUBLIC_MAPBOX_TOKEN,NEXT_PUBLIC_APP_URL,NEXT_PUBLIC_DEMO_MODE"
```
Justificación: `public/tools/**` = templates estáticos con base64 de fuentes (falso positivo, verificado sin secretos reales); `NEXT_PUBLIC_*` = públicas por diseño.

---

## Paso 0 — Confirmar contra el log (recomendado, 30s)
En Netlify → Deploy fallido `70a9944` → sección **"Secrets scanning"**: anota **archivo + clave** que nombró.
- Si dice `public/tools/...` o una clave `NEXT_PUBLIC_*` → el fix preparado lo cubre. Seguir.
- Si nombra **otro archivo** → agregarlo a `SECRETS_SCAN_OMIT_PATHS` (si es asset estático) **o**, si fuera un secreto real, **removerlo del archivo y ROTAR la clave** antes de redeployar.

## Paso 1 — Commit del fix (ya preparado)
```bash
cd <worktree>
git add netlify.toml docs/handoff/NETLIFY-*.md docs/handoff/DEPLOY-DIFF-AUDIT.md
git commit -m "fix(netlify): omit static print templates from secret scan (falso positivo eyJ base64)"
```
> Commit **config + docs únicamente**. Sin cambios de código de producto.

## Paso 2 — Redeploy a producción
El fix debe llegar a `main` (que es lo que Netlify publica). Como `main` == `70a9944` y este commit va encima:
```bash
git push origin HEAD:main        # fast-forward; dispara nuevo build de Netlify
```
- Alternativa sin push directo: abrir PR del commit a `main` y mergear.
- Si el push no dispara build: Netlify → **Trigger deploy → Deploy site** (o **Clear cache and deploy** si sospechás caché).

## Paso 3 — Verificar el build
- Netlify log: la sección "Secrets scanning" debe pasar (sin "Exposed secrets").
- `✓ Compiled successfully`, 119 rutas, estado **Published** del nuevo commit.

## Paso 4 — Smoke test
- Ejecutar `POST-DEPLOY-SMOKE-TEST.md` (login real + módulos).
- **Verificación específica del incidente:** confirmar que la **navegación nueva** ya se ve en prod (Sidebar unificado Cockpit, sin grupo "Google Workspace") → confirma que el deploy publicado es el nuevo, no `86b54ca`.

## Rollback
- Si el nuevo build falla por otra causa: Netlify → republicar `86b54ca` (último estable) — instantáneo, sin rebuild. Detalle en `ROLLBACK-PLAN.md`.

---

## Notas de seguridad
- El fix **no** desactiva el secret scanning global: sigue protegiendo todo el árbol salvo `public/tools/**` (assets estáticos auditados) y las claves `NEXT_PUBLIC_*` (públicas por diseño).
- Auditoría previa: **0 secretos reales** en los 257 archivos cambiados (ver `NETLIFY-SECRET-SCAN-AUDIT.md`).
- No se modificó ninguna funcionalidad (CRM360/Compliance/RRHH/Drive intactos). Solo `netlify.toml` + docs.
