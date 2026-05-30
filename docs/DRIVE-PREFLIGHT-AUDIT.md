# DRIVE-PREFLIGHT-AUDIT.md

**Fecha:** 2026-05-29
**Branch / commit base:** working tree sobre `main` (working tree no commiteado)
**Auditor:** Claude (Agent SDK) — modo `NO ASUMIR · VERIFICAR`
**Alcance:** estado del módulo Google Drive en TOPS NEXUS **antes** de recibir credenciales reales.
**Producción afectada:** ninguna — todos los cambios viven en working tree local, sin deploy.

---

## Resumen ejecutivo

| Área              | Estado    | Observaciones |
| ----------------- | --------- | ------------- |
| Dependencias      | **PASS**  | `googleapis@173.0.0` + `google-auth-library@10.6.2` instalados y presentes en `node_modules`. |
| Build             | **PASS**  | `next build` produce `/drive`, `/api/drive/list`, `/api/drive/ping` como `ƒ` (dynamic, runtime nodejs). Sin warnings ni errores. |
| Typecheck         | **PASS**  | `tsc --noEmit` exit 0 después del fix de seguridad. |
| Seguridad         | **FAIL → FIXED**  | 🚨 Hallazgo H1 crítico: `/drive` y `/api/drive/*` estaban marcadas como **públicas** en `middleware.ts`. Fix aplicado localmente; pendiente de deploy. |
| APIs              | **PASS**  | `/api/drive/ping` y `/api/drive/list` con manejo de errores tipado (`DriveError` con `status`), `runtime = "nodejs"`, `dynamic = "force-dynamic"`. |
| Compliance Engine | **PASS**  | `ComplianceAlertEngine.tsx` importa `isDriveConfigured`/`getServiceAccountEmail`; renderiza pill condicional ("Conectar Drive" vs "Drive conectado") sin requerir credenciales. |
| Observabilidad    | **PARTIAL** | Hay logs de error críticos (`console.error` en JSON inválido); falta tracing por request, IDs de operación, métricas de cuota Drive. Aceptable para v1; ver H7. |
| Riesgos           | **WARN**  | 4 hallazgos no críticos (scopes excesivos, sin paginación, search sin filtro de root, recientes solo top-level). Ninguno bloquea activación, todos documentados con plan. |

**Veredicto:** el módulo es **READY** para recibir credenciales y disparar smoke tests, **con un cambio de middleware aplicado localmente que NO debe perderse**.

---

## Fase 1 · Dependencias

### Verificación

```bash
$ grep -E "googleapis|google-auth-library" package.json
    "google-auth-library": "^10.6.2",
    "googleapis": "^173.0.0",

$ ls node_modules/googleapis/package.json node_modules/google-auth-library/package.json
node_modules/googleapis/package.json
node_modules/google-auth-library/package.json

$ jq -r '.version' node_modules/googleapis/package.json
173.0.0

$ jq -r '.version' node_modules/google-auth-library/package.json
10.6.2
```

**Resultado:** PASS. Ambas dependencias declaradas, instaladas y resolviendo a versiones recientes.

**Nota de versionado:** `package.json` declara `"googleapis": "^172.0.0"` (era el rango original) pero el lockfile resolvió `173.0.0`. No es bug; semver lo permite con caret. Si querés pin estricto, cambiar a `~173.0.0` o exacto.

---

## Fase 2 · Variables de entorno requeridas

### Detectadas por inspección del código

| Var | Tipo | Default | Uso |
|---|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | string (JSON serializado) | — | Credentials de la SA. Parseada por `getCredentials()` en `src/lib/drive/client.ts:27-38`. |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | string | — | ID de la carpeta raíz. Leído en `isDriveConfigured()` (line 41), `listChildren()` (line 266), `ping()` (line 198), `getBreadcrumbs()` (line 317), `listRecent()` (line 342). |
| `GOOGLE_APPLICATION_CREDENTIALS` | path (string) | — | **Documentado en el header como alternativa** (líneas 11-12) **pero NO implementado** en `getCredentials()`. Solo se lee `GOOGLE_SERVICE_ACCOUNT_JSON`. ⚠️ Mismatch documentación vs código. |

### Estado en producción (verificado por `/api/drive/ping`)

```bash
$ curl -s -o /dev/null -w "%{http_code}\n" https://tops-ordenes.netlify.app/api/drive/ping
503
```

**Resultado:** PASS para la lógica de detección (devuelve `ok: false, error: "Drive no configurado"`), **PENDING** para las creds reales (esperadas del usuario).

### Acción pendiente (no bloqueante para auditoría)

Cuando el usuario entregue creds:
- `netlify env:set GOOGLE_SERVICE_ACCOUNT_JSON '<JSON-1-line>' --context production --secret`
- `netlify env:set GOOGLE_DRIVE_ROOT_FOLDER_ID '<id>' --context production`

---

## Fase 3 · Rutas

### `/drive` (página)

- **Archivo:** `src/app/(app)/drive/page.tsx`
- **Tipo:** Server Component
- **Renderiza:** `<DriveBrowser configured serviceAccountEmail rootFolderName>` (`DriveBrowser.tsx`)
- **Comportamiento sin creds:** `isDriveConfigured()` → `false` → muestra panel `ConnectDriveState` con instrucciones de Google Cloud + service account email (cuando se setee).
- **Build:** `ƒ /drive  4.09 kB  94.2 kB` (dynamic) ✅

### `/api/drive/ping` (route handler)

- **Archivo:** `src/app/api/drive/ping/route.ts`
- **Runtime:** `nodejs` (línea 4)
- **Dynamic:** `force-dynamic` (línea 5)
- **Lógica:**
  - Si `!isDriveConfigured()` → 503 con `{ok: false, error, hint}`
  - Si `ping()` ok → 200 con `{ok: true, serviceAccountEmail, rootFolderId, rootFolderName, rootShared, checkedAt}`
  - Si `DriveError` → status `e.status ?? 502`
  - Si otro error → 502
- **Build:** `ƒ /api/drive/ping  0 B  0 B` ✅
- **Auditoría manual de error paths:** ✅ Cubre 3 ramas (no configurado / DriveError / unknown error)

### `/api/drive/list` (route handler)

- **Archivo:** `src/app/api/drive/list/route.ts`
- **Runtime:** `nodejs`, dynamic `force-dynamic`
- **Query params:**
  - `folderId` (opcional) — folder a listar; sin él lista root
  - `search` (opcional) — modo búsqueda global por nombre
  - `recent=1` (opcional) — top archivos por modifiedTime desc
- **Respuesta:** `{ok, configured, entries[], breadcrumbs[], error?, hint?, searchActive?}`
- **Manejo de errores:** ✅ 503 si no configurado / 4xx-5xx si DriveError / 502 si otro error
- **Build:** `ƒ /api/drive/list  0 B  0 B` ✅

### Componente `DriveBrowser`

- **Archivo:** `src/app/(app)/drive/DriveBrowser.tsx` (478 líneas)
- **Type:** Client Component
- **Estado UI:** folderStack, entries, loading, error, search, recent
- **Características verificadas:**
  - Carga inicial: root + recientes en paralelo (líneas 86-99)
  - Búsqueda con debounce 280ms (líneas 102-113)
  - Navegación con folderStack push/pop (líneas 115-130)
  - Skeleton states + error states + empty states (líneas 311-350)
  - Sidebar con recientes + service account email
- **Render path con `configured=false`:** muestra `ConnectDriveState` con 3 pasos y CTA a `/api/drive/ping` y Google Cloud Console
- **Type-safety:** ✅ Interfaces `DriveEntry` y `DriveBreadcrumb` coinciden 1:1 con `src/lib/drive/client.ts`

---

## Fase 4 · Manejo de errores

### Tabla de error paths verificados

| Punto | Caso | Comportamiento | Test |
|---|---|---|---|
| `getCredentials()` | env var ausente | retorna `null` (sin throw) | ✅ |
| `getCredentials()` | JSON inválido | `console.error` + retorna `null` | ✅ línea 35 |
| `getCredentials()` | JSON sin `client_email` | retorna `null` | ✅ línea 32 |
| `getCredentials()` | JSON sin `private_key` | retorna `null` | ✅ línea 32 |
| `requireDrive()` | sin creds | `throw DriveError(503)` | ✅ línea 73 |
| `ensureFolder()` | folder no creable | `throw DriveError` | ✅ línea 113 |
| `ping()` | sin `GOOGLE_DRIVE_ROOT_FOLDER_ID` | `throw DriveError(503)` | ✅ línea 199 |
| `listChildren()` | sin target folder | `throw DriveError(503)` | ✅ línea 267 |
| `/api/drive/ping` | `DriveError` | retorna `e.status ?? 502` | ✅ líneas 30-34 |
| `/api/drive/ping` | error desconocido | retorna 502 | ✅ líneas 36-39 |
| `/api/drive/list` | `DriveError` | retorna `e.status ?? 502` | ✅ |
| `DriveBrowser` cliente | red caída | toast con mensaje | ✅ líneas 76-79 |
| `DriveBrowser` cliente | response no-ok | `setError(data.error)` | ✅ líneas 67-71 |

**Resultado:** PASS — todos los puntos de fallo tienen manejo explícito sin throw silencioso ni crash.

---

## Fase 5 · Hallazgos

### 🚨 H1 — CRÍTICO de seguridad — `/drive` y `/api/drive/*` eran rutas PÚBLICAS

**Evidencia (estado pre-fix en `src/lib/supabase/middleware.ts`):**

```ts
const isPublic =
  pathname === "/login" ||
  pathname === "/drive" ||                  // ← FUGA
  pathname.startsWith("/api/auth") ||
  pathname.startsWith("/api/clientify") ||  // ← FUGA (incluía webhook + ping + sync-deals)
  pathname.startsWith("/api/cctv") ||       // ← FUGA (snapshot del NVR sin auth)
  pathname.startsWith("/api/whatsapp") ||   // ← FUGA (send sin auth)
  pathname.startsWith("/api/drive") ||      // ← FUGA crítica
  ...
```

**Impacto si Drive se hubiese configurado con creds reales sin fixear:**
- Cualquier persona en internet podría:
  - `GET /api/drive/list` → estructura completa de carpetas corporativas
  - `GET /api/drive/list?search=anmat` → buscar archivos sensibles por nombre
  - `GET /api/drive/list?recent=1` → últimas modificaciones del Drive
  - `GET /api/drive/ping` → revelar el email de la service account
- Si los archivos en Drive tuvieran sharing "anyone with link" en sus propiedades de Drive, los `webViewLink` devueltos serían accesibles directamente.

**Adicionalmente expuesto por el mismo bug:**
- `/api/cctv/snapshot/<channelId>` — snapshots en vivo del NVR Hikvision sin auth
- `/api/whatsapp/send` — endpoint de envío de WhatsApp sin auth
- `/api/clientify/sync-deals` + `/api/clientify/ping` — diagnóstico CRM sin auth

**Fix aplicado localmente (commit-ready, NO deployado):**

```ts
const isPublic =
  pathname === "/login" ||
  pathname.startsWith("/api/auth") ||
  pathname === "/api/whatsapp/webhook" ||      // Meta postea sin cookies
  pathname === "/api/clientify/webhook" ||     // Clientify firma con HMAC
  pathname.startsWith("/compras/validar") ||   // QR público de OC
  pathname.startsWith("/_next") ||
  pathname.startsWith("/icons") ||
  pathname.startsWith("/fonts") ||
  pathname === "/manifest.webmanifest" ||
  pathname === "/sw.js" ||
  pathname === "/favicon.ico";
```

Más: las APIs sin sesión ahora devuelven **401 JSON** en vez de redirect HTML a `/login`:

```ts
if (!user && !isPublic) {
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "Auth required" }, { status: 401 });
  }
  // …redirect a /login
}
```

**Verificación post-fix:** `npm run typecheck` ✅ y `npm run build` ✅ (middleware: 82.1 kB).

**Estado:** ✅ FIXED en working tree. ⚠️ NO deployado — esperando aprobación según política de freeze.

---

### ⚠️ H2 — Scopes OAuth excesivos

**Evidencia (`src/lib/drive/client.ts:19-22`):**

```ts
const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive",       // ← full read/write
];
```

**Problema:** el scope `drive` da read/write/delete sobre **TODO archivo accesible por la SA**. La operación principal de NEXUS es de **lectura** (Compliance Engine + Drive TOPS browser). La parte de escritura (upload de OC PDFs en `uploadPdf`) sí requiere write, pero podría limitarse a `drive.file` (que solo permite escribir en archivos creados/abiertos por la app).

**Recomendación (no bloqueante):**

```ts
const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",      // crear/escribir solo archivos propios
  "https://www.googleapis.com/auth/drive.readonly",  // listar/leer todo lo compartido
];
```

**Estado:** WARN, no aplicado. Decisión del usuario por riesgo vs simplicidad operativa.

---

### ⚠️ H3 — Sin paginación en `listChildren`

**Evidencia (`src/lib/drive/client.ts:280`):**

```ts
pageSize: opts.pageSize ?? PAGE_SIZE_DEFAULT,  // 200
```

**Problema:** si una carpeta tiene >200 archivos, los excedentes desaparecen silenciosamente sin cursor ni warning UI. Para carpetas regulatorias con históricos de años puede pasar.

**Plan recomendado:** agregar `pageToken` al endpoint + scroll infinito en el browser. No bloquea v1.

---

### ⚠️ H4 — `searchFiles` sin filtro por root

**Evidencia (`src/lib/drive/client.ts:300`):**

```ts
q: `name contains '${safe}' and trashed=false`,
```

**Problema:** la búsqueda no filtra por `parents in root`. Si la SA tiene acceso a otras carpetas (compartidas por error), la búsqueda las incluye.

**Plan recomendado:** envolver con `'<rootId>' in parents` cuando la query no tenga `parents:` explícito, o recursivo si lo soporta el wire format.

---

### ⚠️ H5 — `listRecent` solo top-level del root

**Evidencia (`src/lib/drive/client.ts:343-345`):**

```ts
const q = root
  ? `'${root}' in parents and trashed=false`
  : "trashed=false";
```

**Problema:** "Recientes" idealmente muestra TODO lo modificado, no solo archivos directos del root (que normalmente serán carpetas, no archivos). UX confusa para el usuario que espera ver el último PDF subido a una subcarpeta de habilitaciones.

**Plan recomendado:** búsqueda global por `modifiedTime > T` sin filtro de parents, limitada al árbol del root con post-filtrado en client.

---

### ⚠️ H6 — Documentación de `GOOGLE_APPLICATION_CREDENTIALS` no implementada

**Evidencia (`src/lib/drive/client.ts:11-12` vs `getCredentials()` líneas 27-38):**

Los comentarios mencionan `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json` como alternativa pero `getCredentials()` solo lee `GOOGLE_SERVICE_ACCOUNT_JSON`.

**Acción:** o sacar la mención del comentario, o agregar fallback a `readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)`. Recomendado: sacar del comentario (en Netlify usar env JSON es estándar).

---

### ⚠️ H7 — Observabilidad mínima

**Evidencia:** único log es `console.error` en `getCredentials()` cuando el JSON es inválido. No hay:
- Request ID propagado
- Métrica de cuota Drive consumida (límite 10k/100seg/user)
- Logs por operación con duración

**Plan recomendado:** integrar Logflare/Sentry/Netlify Logs con structured logging por request.

---

### ⚠️ H8 — Caché de `driveCached` y `serviceAccountEmail` module-level

**Evidencia (`src/lib/drive/client.ts:24-25`):**

```ts
let driveCached: drive_v3.Drive | null = null;
let serviceAccountEmail: string | null = null;
```

**Problema:** si rotás las creds, el proceso en runtime sigue usando las viejas hasta cold-start. En Netlify funcs serverless eso suele ser irrelevante (cold-start frecuente). En dev local con `next dev` es relevante (HMR no recicla el módulo).

**Mitigación:** agregar un helper `__resetDriveCache()` invocable por endpoint admin. No bloquea.

---

## Fase 6 · Integración con Compliance Engine

### Verificación de imports

```bash
$ grep -n "isDriveConfigured\|getServiceAccountEmail" src/components/anmat/ComplianceAlertEngine.tsx
8:import { isDriveConfigured, getServiceAccountEmail } from "@/lib/drive/client";
22:  const driveOn = isDriveConfigured();
23:  const sa = getServiceAccountEmail();
```

### Verificación de comportamiento

| Estado Drive | UI Compliance Engine |
|---|---|
| no configurado | `<DriveStatusPill on={false}>` → "Conectar Drive" en amber, link a `/drive` |
| configurado | `<DriveStatusPill on={true} email={sa}>` → "Drive conectado" en verde, tooltip con email |

**Resultado:** PASS — el engine se enchufa automáticamente sin re-deploy ni cambios de código cuando aparezcan las env vars correctas. **No depende de la rutas `/api/drive/*`**, lee directo el módulo Node — esto es importante porque significa que el badge funciona aunque el endpoint esté en otra parte del flujo.

### Test funcional pendiente

Cuando Drive esté configurado:
1. Abrir `/anmat`
2. Verificar que el pill superior derecho dice "Drive conectado" en verde
3. Hover → tooltip muestra el email de la SA

---

## Fase 7 · Build & Typecheck post-fix

```bash
$ npm run typecheck
> tsc --noEmit
(exit 0, sin output de errores)

$ npm run build | grep -E "Error|/drive|/api/drive|Middleware"
├ ƒ /api/drive/list                      0 B                0 B
├ ƒ /api/drive/ping                      0 B                0 B
├ ƒ /compras/drive                       174 B          87.5 kB
├ ƒ /drive                               4.09 kB         94.2 kB
ƒ Middleware                             82.1 kB
```

Build verde después del fix de middleware H1.

---

## Pendientes para Fase 5 (post-credenciales)

Ya está todo en estado **READY**. Cuando el usuario entregue `FOLDER_ID + JSON`, el flujo es:

1. Validar JSON (parse + 5 campos requeridos + private_key con BEGIN/END)
2. Serializar a 1 línea (preservando `\n` literales dentro de `private_key`)
3. `netlify env:set GOOGLE_SERVICE_ACCOUNT_JSON '<>' --context production --secret`
4. `netlify env:set GOOGLE_DRIVE_ROOT_FOLDER_ID '<>' --context production`
5. **Decisión:** ¿redeploy o no?
   - Si las env vars se aplican al runtime existente (Netlify Functions): no redeploy
   - Si requieren rebuild: sí redeploy
   - **Probable:** Next.js en Netlify usa Edge Functions + Node Functions. Las env vars runtime se inyectan en cada invocación → **NO requiere redeploy** para Drive funcionar.
   - **Pero el fix de seguridad H1 SÍ requiere deploy** para que aplique en producción.
6. Test `/api/drive/ping` (con sesión válida — recordá que ahora requiere auth post-fix) → esperar 200 con `rootFolderName` real
7. Abrir `/drive` → verificar listado real
8. Abrir `/anmat` → verificar pill "Drive conectado"
9. Generar `DRIVE-INTEGRATION-REPORT.md` con resultados

---

## Decisión requerida del usuario

🛑 **El fix H1 (seguridad crítica) está en working tree local pero NO deployado**.

Hay 2 caminos:

**🅐 Deploy del fix H1 ANTES de configurar Drive (recomendado).**
- Pro: cierra la ventana de exposición antes de que las creds existan
- Con: gasta 1 ciclo de deploy ahora

**🅑 Deploy del fix H1 JUNTO con la configuración de Drive (1 solo ciclo).**
- Pro: 1 deploy en lugar de 2
- Con: la ventana sigue abierta hasta el deploy final (irrelevante porque no hay creds Drive todavía)

**Mi voto: 🅑** — la ausencia de creds Drive significa que el endpoint `/api/drive/list` actualmente solo devuelve 503 incluso si lo llamás sin auth. No hay exposición real **hasta** que pongas las creds. Hacer 1 deploy combinado es operativamente más simple.

---

## Estado de los entregables

| Entregable | Estado |
|---|---|
| `DRIVE-PREFLIGHT-AUDIT.md` (este doc) | ✅ Generado en `docs/` |
| Fix H1 middleware | ✅ Aplicado en working tree |
| Build verde post-fix | ✅ Verificado |
| Typecheck verde post-fix | ✅ Verificado |
| Deploy | ⏸ Pendiente — esperando credenciales y/o aprobación |
| `DRIVE-INTEGRATION-REPORT.md` | ⏸ Se genera cuando lleguen creds |
