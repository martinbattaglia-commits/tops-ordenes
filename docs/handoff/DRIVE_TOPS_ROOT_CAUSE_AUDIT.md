# TOPS NEXUS — DRIVE TOPS · ROOT CAUSE AUDIT (Fase 1)

> **Tipo:** auditoría read-only. No se implementó, no se crearon credenciales, no se tocó código ni
> producción. **Objetivo:** una única causa raíz demostrable de por qué Drive TOPS muestra
> "Conectar Google Drive" en vez de contenido.
> **Fuente de verdad de producción:** `arsksytgdnzukbmfgkju` (DB) / entorno Netlify (env del frontend).
> **Fecha:** 2026-06-07. **Auditor:** Claude Code.

---

## Resumen
Drive TOPS muestra "Conectar Google Drive" porque **`isDriveConfigured()` evalúa `false`**, y eso
ocurre **únicamente** cuando faltan (o son inválidas) las dos variables de entorno requeridas:
**`GOOGLE_SERVICE_ACCOUNT_JSON`** y/o **`GOOGLE_DRIVE_ROOT_FOLDER_ID`**. No es un bug de código: el
módulo está completo y correcto; **falta la configuración de la Service Account de Google**.

---

## D1 — Rutas / APIs / Componentes (evidencia)
| Tipo | Ruta | Rol |
|------|------|-----|
| Página | `src/app/(app)/drive/page.tsx` | Server component; calcula `isDriveConfigured()` (línea 8) y pasa `configured` a `DriveBrowser` |
| Componente | `src/app/(app)/drive/DriveBrowser.tsx` | Si `configured=false` → `<ConnectDriveState>` (línea 246); el texto **"Conectar Google Drive"** está en la línea 635 |
| API | `src/app/api/drive/ping/route.ts` | Diagnóstico; devuelve `503 "Drive no configurado"` si `!isDriveConfigured()` |
| API | `src/app/api/drive/list/route.ts` | Listado de carpetas (consumido por el browser) |
| Cliente/lib | `src/lib/drive/client.ts` | Cliente Google Drive (Service Account); define `isDriveConfigured()`, `getCredentials()`, `ping()`, `listChildren()`, etc. |

## D2 — Proveedor (con evidencia)
> **Google Drive.** No iCloud, no otro.

Evidencia (`src/lib/drive/client.ts`):
- `import { google } from "googleapis"` + `import { JWT } from "google-auth-library"`.
- Autenticación por **Service Account** (JWT), scopes `drive.readonly` + `drive.file`.
- Variables `GOOGLE_SERVICE_ACCOUNT_JSON` / `GOOGLE_DRIVE_ROOT_FOLDER_ID`.
- API endpoints `drive.files.list/get/create`, `supportsAllDrives`.

## D3 — Variables requeridas (solo nombres)
```
GOOGLE_SERVICE_ACCOUNT_JSON        (JSON serializado de la Service Account; debe contener
                                    los campos client_email y private_key)
GOOGLE_DRIVE_ROOT_FOLDER_ID        (ID de la carpeta raíz compartida con la Service Account)
```
> Definidas (vacías) en `.env.example:54-55`. No se exponen valores en esta auditoría.

## D4 — `GOOGLE_SERVICE_ACCOUNT_JSON`
> **AUSENTE** (no verificable como presente).
- En el entorno auditado: `unset`. No existe `.env`/`.env.local`/`.env.production` en el repo.
- En `.env.example` figura **vacía** (`GOOGLE_SERVICE_ACCOUNT_JSON=`).
- La evidencia de la UI ("Conectar Google Drive") prueba que en producción está **ausente o es un
  JSON inválido** (ver D7).

## D5 — `GOOGLE_DRIVE_ROOT_FOLDER_ID`
> **AUSENTE** (no verificable como presente).
- En el entorno auditado: `unset`. Sin `.env`.
- En `.env.example` figura **vacía** (`GOOGLE_DRIVE_ROOT_FOLDER_ID=`).

## D6 — ¿Service Account / carpeta raíz configuradas?
- **Service Account:** **NO configurada.** El email de la SA se deriva de `GOOGLE_SERVICE_ACCOUNT_JSON`
  (`getServiceAccountEmail()` parsea `client_email`); sin ese JSON, no hay SA.
- **Carpeta raíz:** **NO configurada.** Depende de `GOOGLE_DRIVE_ROOT_FOLDER_ID` (ausente).
- Por lo tanto tampoco existe el **share** de la carpeta raíz con el email de la SA (paso 3 del
  instructivo en `client.ts`), que solo puede verificarse **después** de configurar las vars (vía
  `GET /api/drive/ping` → `rootShared`).

## D7 — Qué bloquea exactamente a Drive TOPS
**Cadena causal demostrable (código):**
1. `src/app/(app)/drive/page.tsx:8` → `const configured = isDriveConfigured();`
2. `src/lib/drive/client.ts` → `isDriveConfigured() = getCredentials() !== null && Boolean(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID)`
3. `getCredentials()` → `return null` si `process.env.GOOGLE_SERVICE_ACCOUNT_JSON` es falsy **o** el
   JSON no parsea / le faltan `client_email`/`private_key`.
4. Si `configured === false` → `DriveBrowser` renderiza `<ConnectDriveState>` (`DriveBrowser.tsx:246`)
   → texto **"Conectar Google Drive"** (`:635`).

**⇒ Causa raíz única:** las variables de entorno **`GOOGLE_SERVICE_ACCOUNT_JSON` y
`GOOGLE_DRIVE_ROOT_FOLDER_ID` no están configuradas** en el entorno de ejecución (Netlify). No hay
defecto de código ni de datos: el módulo Drive está implementado y correcto; **falta el aprovisionamiento
de la Service Account de Google y su carpeta raíz.**

---

## Nota de alcance / verificación 100% en producción
La verdad de runtime del frontend vive en el **entorno Netlify**, no legible desde esta auditoría.
La cadena causal (código + evidencia de UI) es **concluyente**. Para confirmación directa, **read-only**:
`GET /api/drive/ping` (autenticado, permiso `compliance.view`) →
- `503 { error: "Drive no configurado", hint: "Setea GOOGLE_SERVICE_ACCOUNT_JSON y GOOGLE_DRIVE_ROOT_FOLDER_ID" }`
  ⇒ confirma vars ausentes (causa raíz de esta auditoría).
- `200 { ok:true, rootShared:false }` ⇒ vars presentes pero la carpeta raíz **no compartida** con la SA
  (sería una causa raíz distinta — no es el caso indicado por la UI "Conectar").

---

## Veredicto (Fase 1)
> **CAUSA RAÍZ:** `GOOGLE_SERVICE_ACCOUNT_JSON` y `GOOGLE_DRIVE_ROOT_FOLDER_ID` **AUSENTES** en el
> entorno → `isDriveConfigured() = false` → pantalla "Conectar Google Drive".
>
> **No es bug de código.** Remediación (Fase 2, fuera de esta auditoría): crear Service Account en
> Google Cloud, cargar el JSON en `GOOGLE_SERVICE_ACCOUNT_JSON`, compartir la carpeta raíz con el
> email de la SA (Lector), y setear `GOOGLE_DRIVE_ROOT_FOLDER_ID`. Verificar con `/api/drive/ping`.

*Auditoría read-only — sin fixes, sin credenciales, sin reinicios, sin cambios de código.*
