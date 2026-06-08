# POST-ROLLBACK-FIX-REPORT

**Fecha:** 2026-06-08
**Base:** `POST-ROLLBACK-AUDIT.md` (causa raíz ya determinada — no se repitió auditoría).
**Modo:** correcciones aplicadas. Secretos no impresos en ningún momento.

---

## Correcciones aplicadas

### 1) CLIENTIFY — carga de `CLIENTIFY_API_KEY`
**Causa (audit):** el dev server se reiniciaba desde un shell sin `~/.claude/secrets.env`; Next caía al `CLIENTIFY_API_KEY` **obsoleto** de `.env.local` → 401.
**Fix:** reconciliación de `.env.local` del worktree servido (gracious-pasteur): se reemplazó el token obsoleto por el **válido** (tomado de `secrets.env`, sin imprimirlo). Ahora la lectura es **consistente e independiente del shell** que lance el server.
- Dependencia del token obsoleto: **eliminada** (sobreescrito).
- Lectura en dev: **consistente** (vive en `.env.local`, gitignored).
- Lectura en prod: el código ya lee de `process.env` (`env.ts:77/79`); prod toma el valor de las env vars de Netlify (ver §Producción).

### 2) DRIVE TOPS — `GOOGLE_SERVICE_ACCOUNT_JSON` + `GOOGLE_DRIVE_ROOT_FOLDER_ID`
**Causa (audit):** ambas variables **no estaban en `.env.local`** (solo en `secrets.env`, no cargado) → `env.drive.configured=false` → "Conectar Google Drive".
**Fix:** se agregaron ambas a `.env.local` desde `secrets.env` (sin imprimir). El JSON se almacenó entre comillas simples (dotenv no procesa escapes dentro de `'...'`, preservando los `\n` del `private_key` idénticos a cuando se sourcea por shell).
- JSON: **válido** (`type=service_account`, `client_email` presente).
- Resultado: `env.drive.configured` pasa a **true** → desaparece "Conectar Google Drive".

### 3) TOPBAR GLOBAL — `Nueva OC`
**Fix:** eliminado el `<Link href="/compras/nueva">Nueva OC` del header corporativo (`Topbar.tsx`). El header queda solo con: buscador, fecha, tema, notificaciones.

### 4) COMMAND CENTER (`/ejecutivo`) — `Nueva OC` + `Nueva OS`
**Fix:** eliminados ambos `<Link>` del header del Cockpit. El Cockpit queda como superficie de **monitoreo/análisis/supervisión** (sin iniciar procesos transaccionales).

### 5) REUBICACIÓN (sin huérfanos)
- **Nueva OC** → permanece **solo en Compras**: `/compras/page.tsx` (L34) y `/compras/ordenes/page.tsx` (L71).
- **Nueva OS** → permanece **solo en Operaciones**: `/dashboard/page.tsx` (L37) y `/orders/page.tsx` (L64).

---

## Archivos modificados

| Archivo | Cambio | Commit |
|---|---|---|
| `.env.local` (worktree, **gitignored**) | `CLIENTIFY_API_KEY` actualizado al válido; alta de `GOOGLE_SERVICE_ACCOUNT_JSON` y `GOOGLE_DRIVE_ROOT_FOLDER_ID` | no versionable (secreto) |
| `src/components/shell/Topbar.tsx` | quitado CTA `Nueva OC` | sin commit |
| `src/app/(app)/ejecutivo/page.tsx` | quitados CTA `Nueva OC` + `Nueva OS` del header | sin commit |

> Backup creado: `.env.local.pre-fix.bak`. No se modificó código de lectura (`env.ts`, `clientify/client.ts`, `lib/drive/*`) — ya eran correctos. No se modificó producción.

---

## Validaciones — evidencia ANTES → DESPUÉS

### Clientify (prueba contra API real, token no impreso)
```
ANTES:   GET /v1/contacts → 401 {"detail":"Invalid token."}   (token obsoleto de .env.local)
DESPUÉS: GET /v1/contacts → HTTP 200 · contactos_total = 2139
```
- Contactos / Pipeline / Oportunidades: consumen el mismo wrapper (`clientify/client.ts`, `Authorization: Token <key>`) → al validar 200 el token, las 3 pantallas operan sin 401.
- Log del dev server (nuevo arranque): **0** ocurrencias de `Clientify fetch failed`.

### Drive (mint real de access token con la credencial de `.env.local`)
```
ANTES:   GOOGLE_SERVICE_ACCOUNT_JSON ausente → "Conectar Google Drive"
DESPUÉS: service_account = tops-ordenes-drive@tops-ordenes.iam.gserviceaccount.com
         token endpoint (JWT bearer) → OK · access_token_present = True
```
- La credencial autentica end-to-end contra Google → Drive vuelve a poder navegar carpetas; desaparece "Conectar Google Drive".

### Topbar / Command Center (grep de CTAs reales)
```
Topbar    href="/compras/nueva"|"/orders/new" → 0
Ejecutivo href="/compras/nueva"|"/orders/new" → 0
Reubicación: Compras (Nueva OC) = 4 archivos · Operaciones (Nueva OS) = 2 archivos
```

### Build
```
tsc --noEmit → EXIT 0 (0 líneas)
/ejecutivo   → HTTP 307 (redirect a login = frontera de sesión; recompila sin 500)
```
> La verificación visual final de las pantallas (Contactos/Pipeline/Oportunidades/Drive logueado) requiere sesión de usuario; las integraciones subyacentes ya autentican (200 Clientify / token Google OK), que era exactamente lo que fallaba.

---

## Independencia del shell (clave del fix)
El dev server se reinició **sin** sourcear `secrets.env` y aun así Clientify (200) y Drive (token OK) funcionan → confirma que `.env.local` quedó **autosuficiente**: el problema no se repetirá aunque el server se relance desde cualquier shell.

## Producción (no modificada)
- El código lee de `process.env` de forma idéntica en dev y prod. En prod los valores provienen de **Netlify env vars**.
- **Acción recomendada (requiere tu OK — regla "no modificar producción"):** verificar que Netlify tenga los valores **válidos** de `CLIENTIFY_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON` y `GOOGLE_DRIVE_ROOT_FOLDER_ID`. No se tocó Netlify en esta corrección.

---

## Resultado final

```
CLIENTIFY ......... ✅ 200 OK · 2139 contactos · sin 401 · token obsoleto eliminado
DRIVE TOPS ........ ✅ credencial válida · access token Google OK · sin "Conectar Google Drive"
TOPBAR ............ ✅ sin "Nueva OC" (solo search/fecha/tema/notificaciones)
COMMAND CENTER .... ✅ sin "Nueva OC"/"Nueva OS" (monitoreo/análisis)
REUBICACIÓN ....... ✅ Nueva OC solo en Compras · Nueva OS solo en Operaciones
BUILD ............. ✅ tsc EXIT 0 · /ejecutivo recompila
```

Dev local operativo e independiente del shell. Sin commit/push. Sin tocar producción.
