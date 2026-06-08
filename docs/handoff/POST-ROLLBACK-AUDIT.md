# POST-ROLLBACK-AUDIT

**Fecha:** 2026-06-08
**Disparador reportado:** tras el rollback del Cockpit, Clientify (Contactos/Pipeline/Oportunidades) devuelve `401 Invalid token` y Drive TOPS volvió a "Conectar Google Drive".
**Modo:** auditoría read-only. **No se modificó código.** Secretos no impresos.

## TL;DR (causa raíz)

**No es una regresión de código del rollback.** Ni el código de Clientify ni el de Drive fueron tocados (el único cambio en `lib/clientify/` fue `mappers.ts` = una URL de UI, no auth). La causa es **de entorno/runtime**:

> El dev server `:3030` fue **reiniciado durante el trabajo de Cockpit desde un shell zsh NO-interactivo** (la herramienta Bash). Ese shell **no sourcea `~/.zshrc`** y por lo tanto **no carga `~/.claude/secrets.env`**, donde viven los 3 secretos válidos. El servidor quedó corriendo **sin** `CLIENTIFY_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON` ni `GOOGLE_DRIVE_ROOT_FOLDER_ID` en `process.env`.

Consecuencia por integración:
- **Drive:** las 2 variables no existen en `.env.local` (solo en `secrets.env`) → `env.drive.configured = false` → "Conectar Google Drive".
- **Clientify:** `.env.local` **sí** tiene un `CLIENTIFY_API_KEY` pero es el **token viejo/inválido** (el válido está en `secrets.env`). Al faltar el secreto del shell, Next usa el de `.env.local` → token inválido → **401 "Invalid token"**.

## Evidencia técnica

### Shell que lanzó el dev server (read-only, sin valores)
```
CLIENTIFY_API_KEY: ausente
GOOGLE_SERVICE_ACCOUNT_JSON: ausente
GOOGLE_DRIVE_ROOT_FOLDER_ID: ausente
```
`~/.zshrc`:
```
L4: [ -f "$HOME/.claude/secrets.env" ] && source "$HOME/.claude/secrets.env"
L5: # export CLIENTIFY_API_KEY=<oculto>   (comentado en sesión previa)
```
→ Un zsh **interactivo/login** (como el que usa la app de escritorio para lanzar el server) sí cargaría los secretos. El zsh **no-interactivo** de la herramienta Bash **no** ejecuta `~/.zshrc` → server sin secretos.

`~/.claude/secrets.env` (presencia, sin valor): `CLIENTIFY_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_ROOT_FOLDER_ID` → **los 3 definidos** (fuente válida).

### `.env.local` del worktree servido (gracious-pasteur)
```
CLIENTIFY_API_KEY:            EN .env.local (len=40)   ← token STALE/inválido
CLIENTIFY_BASE_URL:          EN .env.local (len=28)
GOOGLE_SERVICE_ACCOUNT_JSON: ausente                   ← Drive depende 100% del shell
GOOGLE_DRIVE_ROOT_FOLDER_ID: ausente
NEXT_PUBLIC_DEMO_MODE:       EN .env.local (=0)
```

### Lectura de variables (sin cambios por el rollback ni por H1)
- `src/lib/env.ts:77` → `clientify.apiKey: process.env.CLIENTIFY_API_KEY?.trim() ?? ""`
- `src/lib/env.ts:79` → `clientify.configured: Boolean(process.env.CLIENTIFY_API_KEY?.trim())`
- `src/lib/env.ts:90` → `drive.configured: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON …)`
- `src/lib/clientify/client.ts:71` → `Authorization: \`Token ${env.clientify.apiKey}\`` (esquema **"Token"**, correcto; el 401 es por **valor** inválido, no por header/scheme).
- Precedencia Next: `@next/env` **no pisa** `process.env` preexistente; pero como el shell no aportó la var, **gana `.env.local`** (token stale) → 401.

### Confirmación de que el rollback NO tocó estas integraciones
`git diff --stat` de la sesión:
```
src/app/(app)/comercial/pipeline/page.tsx   8   (URL UI new.clientify.com — no auth)
src/app/(app)/ejecutivo/page.tsx          412   (rollback cockpit)
src/app/(app)/layout.tsx                   12   (rollback cockpit)
src/components/shell/Shell.tsx              7   (rollback cockpit)
src/components/shell/Sidebar.tsx           31   (rollback cockpit)
src/lib/clientify/mappers.ts                2   (URL UI — no auth)
src/lib/env.ts                              9   (solo bloque rbac/H1; clientify/drive intactos)
src/lib/rbac/check.ts                      17   (H1)
src/lib/rbac/types.ts                      46   (mi_espacio; cockpit_* revertidos)
```
**Ningún archivo de auth de Clientify (`client.ts`) ni de Drive (`lib/drive/*`, `api/drive/*`) fue modificado.**

## Auditoría por punto solicitado

### Clientify
1. **Variables de entorno:** válidas en `secrets.env`; `.env.local` tiene una STALE.
2. **Lectura de variables:** `env.ts:77/79` correcta, sin cambios.
3. **Wrapper:** `client.ts` correcto, sin cambios.
4. **Headers Authorization:** `Authorization: Token <key>` — correcto.
5. **Bearer Token:** Clientify usa `Token` (no Bearer); correcto.
6. **API URL:** `CLIENTIFY_BASE_URL` o default `https://api.clientify.net/v1` — OK.
7. **Middleware:** no relacionado (el 401 viene de la API de Clientify, no del middleware Next).
8. **Cambios del rollback:** ninguno tocó auth Clientify (solo `mappers.ts` = URL UI).

### Drive
- **GOOGLE_SERVICE_ACCOUNT_JSON:** ausente del runtime (no está en `.env.local`, sí en `secrets.env` no cargado).
- **GOOGLE_DRIVE_ROOT_FOLDER_ID:** idem.
- **env.ts:** lectura intacta (`drive.configured` depende de la var ausente).
- **check.ts:** sin relación con la config de Drive (es RBAC; H1 no lo afecta).
- **rutas /api/drive/*:** sin cambios; fallan en bootstrap porque la credencial no está en env.
- **parser del JSON:** no llega a parsear — la var no existe.

## Determinaciones exigidas

| Pregunta | Respuesta |
|---|---|
| ¿Qué commit rompió la integración? | **Ninguno.** Los cambios están sin commitear y no tocan auth de Clientify/Drive. El disparador es **operacional**: reinicio del dev server desde un shell sin `secrets.env`. |
| ¿Qué archivo fue modificado? | **Ninguno de auth.** `mappers.ts` (URL UI) y `env.ts` (bloque rbac/H1) no afectan la carga del token ni del JSON. |
| ¿Qué variable dejó de cargarse? | Las **3**: `CLIENTIFY_API_KEY` (válida), `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_ROOT_FOLDER_ID` — dejaron de inyectarse al no sourcearse `secrets.env`. Clientify además quedó con el token **stale** de `.env.local`. |
| ¿La credencial desapareció? | No: sigue en `secrets.env`. Lo que cambió es **quién lanzó el server** (shell sin esos secretos). |
| ¿La variable dejó de leerse? | El código la lee igual; **el entorno dejó de proveerla**. |
| ¿El backend falla en bootstrap? | Drive sí (sin credencial → no configurado). Clientify arranca pero la llamada externa da 401 por token inválido. |

## Regresiones encontradas

| # | Regresión | Origen |
|---|---|---|
| R1 | Clientify 401 en Contactos/Pipeline/Oportunidades | runtime sin `CLIENTIFY_API_KEY` válido → fallback a token stale de `.env.local` |
| R2 | Drive TOPS "Conectar Google Drive" | runtime sin `GOOGLE_SERVICE_ACCOUNT_JSON` / `GOOGLE_DRIVE_ROOT_FOLDER_ID` |
| (latente) | `.env.local` tiene un token Clientify inválido | landmine: cualquier arranque sin el secreto del shell reproduce el 401 |

## Impacto

- **Ámbito:** **dev local** (server `:3030` en worktree gracious-pasteur). **Producción (Netlify) NO está afectada por esto** — usa sus propias env vars; este incidente es del runtime local reiniciado por la herramienta.
- **Severidad:** media (bloquea Clientify y Drive en local; no hay pérdida de datos ni de credenciales).
- **Sin relación con la lógica RBAC/Cockpit** recién trabajada.

## Plan de corrección (NO aplicado — pendiente de tu OK)

**Inmediato (elige uno):**
1. **Relanzar el dev server desde un shell con los secretos** (la app de escritorio / un zsh login que sourcee `secrets.env`), en vez de la herramienta Bash. Reaparecen Clientify y Drive sin tocar archivos.
2. O exportar los 3 secretos antes de `npm run dev`.

**Permanente (recomendado) — independizar el dev local del shell:**
3. **Reconciliar `.env.local`** del worktree servido:
   - reemplazar el `CLIENTIFY_API_KEY` stale por el **válido** (el de `secrets.env`);
   - agregar `GOOGLE_SERVICE_ACCOUNT_JSON` y `GOOGLE_DRIVE_ROOT_FOLDER_ID`.
   Así el server funciona lo lance quien lo lance. (`.env.local` es gitignored → no se commitea el secreto.)

**Higiene:**
4. Eliminar o corregir el token stale de `.env.local` para que no vuelva a enmascarar el válido.
5. (Prod) Verificar que Netlify tenga las 3 vars correctas — fuera del alcance de este incidente local.

> Recomendación: opción **1** para destrabar ya, + opción **3** para que no se repita en cada reinicio. No ejecuto nada hasta tu confirmación (no imprimiré secretos al aplicarlo).
