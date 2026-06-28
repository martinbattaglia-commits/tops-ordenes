# Runbook de Release — TOPS NEXUS (producción)

> Objetivo: **ningún deploy de producción sin trazabilidad**. Todo build publicado
> debe ser identificable por commit, branch, fecha y buildId.

## Cómo funciona la trazabilidad

La versión se computa en **una sola fuente** — [`scripts/version-info.mjs`](../../scripts/version-info.mjs) —
y se usa en tres lugares:

1. **`next.config.mjs`** inyecta en cada build, como variables `NEXT_PUBLIC_*`:
   `NEXT_PUBLIC_COMMIT_SHA`, `NEXT_PUBLIC_BRANCH`, `NEXT_PUBLIC_BUILD_DATE`,
   `NEXT_PUBLIC_BUILD_ID`, `NEXT_PUBLIC_DEPLOY_CONTEXT`. Además fija
   `generateBuildId = SHA corto`, así el `buildId` servido en `/_next/static/`
   queda atado al commit (trazable desde el propio artefacto publicado).
2. **`prebuild`** (`scripts/gen-version.mjs`) imprime un banner con la versión
   ANTES de compilar → queda registrado en el log de Netlify / la terminal.
   Avisa si el working tree está **sucio** (deploy no reproducible).
3. La app expone la versión en:
   - **`GET /api/version`** → JSON `{ commitSha, shortSha, branch, buildDate, buildId, environment, servedAt }`
   - **Administración → "Versión y trazabilidad"** (`/settings`, RBAC `sistema.view`).

Resolución robusta (local · Netlify CLI · Netlify git build): primero variables
de entorno (`COMMIT_REF`/`BRANCH`/`HEAD`/`CONTEXT` que Netlify define en builds git),
luego `git rev-parse`, luego fallback `unknown`/`local-<ts>` (nunca rompe el build).

## Procedimiento de deploy a producción

Producción es el sitio Netlify **`tops-ordenes`** → https://nexus.logisticatops.com.

1. **Commitear todo.** El working tree debe estar limpio (`git status`). Un deploy
   con cambios sin commitear no es reproducible — el prebuild lo advierte.
2. **Build con versión inyectada** (corre `prebuild` automáticamente):
   ```bash
   npm run build
   ```
   Verificar el banner `▶ BUILD VERSION sha=… branch=… buildId=…` en el log.
3. **Deploy a producción:**
   ```bash
   npx netlify deploy --prod            # sube el .next ya construido en el paso 2
   # (si la sesión expiró: `netlify login`)
   ```
   > Alternativa equivalente que reconstruye en el deploy:
   > `npx netlify deploy --build --prod` (ejecuta `npm run build` → prebuild → versión fresca).
4. **Verificar el deploy publicado** (smoke de trazabilidad):
   ```bash
   curl -s https://nexus.logisticatops.com/api/version
   ```
   El `commitSha` devuelto debe coincidir con `git rev-parse HEAD` del commit deployado.
   También visible en Administración → Versión y trazabilidad.

## Reglas

- **Nunca** deployar desde un working tree sucio o desde un SHA no commiteado.
- Tras cada deploy, confirmar `/api/version` == commit esperado antes de dar por cerrado.
- Esta mejora es de **infraestructura/gobernanza**: no altera ninguna funcionalidad del ERP.
