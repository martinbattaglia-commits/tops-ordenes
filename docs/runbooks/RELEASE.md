# Runbook de Release — TOPS NEXUS (producción)

> Objetivo: **ningún deploy de producción sin trazabilidad**. Todo build publicado
> debe ser identificable por commit, branch, fecha y buildId.
>
> **Marco normativo**: NEXUS SESSION BOOTSTRAP LAW **v1.2 — Art. 26, 26 BIS y 26 TER**
> (trazabilidad criptográfica del deploy; prohibición de CLI local como práctica
> regular) · **ADR-0001** (Draft Deploy → validación → Publish manual, Lock permanente)
> · `R11_WS-A_Protocolo_Excepcion_Deploy_CLI_Emergencia.md` (única vía CLI admitida;
> expediente R-11, fuera del árbol — en vigencia con su aprobación por Dirección).

## Cómo funciona la trazabilidad

La versión se computa en **una sola fuente** — [`scripts/version-info.mjs`](../../scripts/version-info.mjs) —
y se usa en tres lugares:

1. **`next.config.mjs`** inyecta en cada build, como variables **server-only**
   (sin prefijo `NEXT_PUBLIC_`, así NO viajan al bundle de cliente):
   `BUILD_COMMIT_SHA`, `BUILD_BRANCH`, `BUILD_DATE`, `BUILD_ID`, `BUILD_CONTEXT`.
   Además fija `generateBuildId = SHA corto`: el buildId queda **embebido en el
   artefacto** (`.next/BUILD_ID`) y visible en Administración → «Versión y
   trazabilidad». *Nota App Router*: el buildId **no** aparece en las rutas
   públicas de `/_next/static/`; la verificación externa se hace por
   `/api/version` y por los identificadores del deploy (p. ej. la huella de
   composición vía `listSiteFiles`).
2. **`prebuild`** (`scripts/gen-version.mjs`) imprime un banner con la versión
   ANTES de compilar → queda registrado en el log de build de Netlify (CI) o de
   la terminal. Avisa si el working tree está **sucio** (deploy no reproducible).
3. La app expone la versión en dos niveles (público mínimo vs admin completo):
   - **`GET /api/version`** (PÚBLICO, mínimo) → `{ version (SHA corto), builtAt, environment, servedAt }`.
     NO expone SHA completo, branch ni contexto interno. *Nota*: en builds no-CI
     el campo `environment` refleja `NODE_ENV`, no el contexto de Netlify.
   - **Administración → "Versión y trazabilidad"** (`/settings`, RBAC `sistema.view`):
     metadata COMPLETA — SHA de 40, branch, buildId, entorno.

Resolución robusta: primero variables de entorno (`COMMIT_REF`/`BRANCH`/`HEAD`/`CONTEXT`
que Netlify define en builds de CI), luego `git rev-parse`, luego fallback
`unknown`/`local-<ts>` (nunca rompe el build). En el flujo regular (CI/CD) el
deploy además porta `commit_ref` **nativo** hacia el commit remoto.

## Procedimiento REGULAR de deploy a producción (Ley v1.2 · Art. 26 TER)

Producción es el sitio Netlify **`tops-ordenes`** → https://nexus.logisticatops.com.
El artefacto se **origina siempre en la plataforma (CI/CD) desde un commit remoto
verificable en GitHub**. Queda **prohibido** el build local + CLI como práctica
regular, incluidos `netlify deploy --prod` directo y `netlify deploy --build --prod`.

1. **Commit y push autorizados** del commit validado a `main` en GitHub
   (working tree limpio; gates y guardianes del expediente cumplidos).
2. **Habilitación controlada de builds** (hoy `stop_builds=true`): Gate
   independiente con autorización expresa de Dirección para la ventana.
3. **Build por la plataforma** desde el commit remoto (`allowed_branches=["main"]`),
   manteniendo deshabilitada toda publicación automática — el **Lock de
   Producción no se libera en ningún paso**.
4. **Deploy no publicado** resultante, con trazabilidad nativa (`commit_ref`,
   `commit_url`, log de build con el banner `▶ BUILD VERSION sha=…`).
5. **Validación** sobre la URL del deploy no publicado: `/api/version` == SHA
   esperado + smoke funcional definido por la ventana.
6. **Promoción manual del mismo artefacto por Dirección** (Publish deploy),
   preservando el Lock y sin Auto Publish; re-lock sobre el deploy publicado.
7. **Restitución del estado operativo de Builds** (`stop_builds=true`) y
   verificación final:
   ```bash
   curl -s https://nexus.logisticatops.com/api/version
   ```
   `version` debe coincidir con el SHA corto del commit publicado y el registro
   del deploy debe portar `commit_ref` == puntero de `origin/main`.
8. **Acta de la ventana** (registro de sesión, evidencia por paso, rollback:
   Publish deploy → deploy anterior, restauración instantánea).

> Generación por CI/CD ≠ Auto Publish ≠ promoción manual: el 26 TER obliga a lo
> primero, prohíbe normalizar lo segundo y reserva lo tercero a Dirección.

## Excepción de emergencia (única vía CLI admitida)

Sólo ante imposibilidad técnica u operativa del flujo CI/CD y con incidente que
exija intervención inmediata, conforme a la **Excepción extraordinaria de
emergencia del Art. 26 TER** y al
`R11_WS-A_Protocolo_Excepcion_Deploy_CLI_Emergencia.md` (resolución expresa,
expediente de incidente, evidencia del impedimento, acta de deploy con
`--message "commit=<sha-40> tree=<tree-sha> branch=<rama>"`, draft validado,
rollback, smoke y restitución posterior del flujo CI/CD).
**La existencia de esa excepción no autoriza ni normaliza el uso regular de CLI local.**

## Reglas

- **Nunca** deployar desde un working tree sucio o desde un SHA no commiteado/pusheado.
- Tras cada publicación, confirmar `/api/version` == commit esperado **y**
  `commit_ref` nativo presente (flujo regular) antes de dar por cerrado.
- El Lock de Producción y `stop_builds` (fuera de ventana) son invariantes.
- Esta mejora es de **infraestructura/gobernanza**: no altera ninguna funcionalidad del ERP.
