# Prompt de handoff — Verificación / diagnóstico de Google Drive

> **Cuándo usarlo.** Para abrir una sesión **nueva** de Claude Code y verificar o
> diagnosticar la integración de Google Drive **una vez que ya está configurada**,
> sin depender de ningún chat previo. Copiá el bloque de abajo tal cual.
>
> **Prerrequisitos (deben estar cumplidos antes de usarlo).**
> - Service Account creada en Google Cloud + Google Drive API habilitada.
> - JSON key generada y a salvo (es un secret).
> - Carpeta raíz compartida con el email de la SA como **Editor**.
> - `GOOGLE_SERVICE_ACCOUNT_JSON` y `GOOGLE_DRIVE_ROOT_FOLDER_ID` cargadas en
>   Netlify + redeploy disparado.
>
> **Complementa a** [`docs/DRIVE-SETUP-RUNBOOK.md`](./DRIVE-SETUP-RUNBOOK.md): ese
> runbook es el procedimiento de **alta** (pasos 1–10); este prompt es para la
> fase de **verificación/diagnóstico** posterior. Si todavía no completaste el
> alta, seguí primero el runbook.

---

```
Contexto: trabajo en el repo TOPS Nexus (~/CODE/tops-ordenes), un ERP interno
Next.js 14 App Router en Netlify (deploy desde `main`). Soy Martín, presidente
de Logística TOPS.

Estado de Google Drive:
- Implementación oficial ÚNICA: src/lib/drive/client.ts
- Variables oficiales: GOOGLE_SERVICE_ACCOUNT_JSON + GOOGLE_DRIVE_ROOT_FOLDER_ID
  (la convención vieja de 3 vars fue eliminada; está obsoleta).
- Scopes: drive.readonly + drive.file (lectura + guardado de PDFs).
- Rutas: GET /api/drive/ping y GET /api/drive/list, ambas con RBAC
  `compliance.view` y rate-limit. UI en /drive (DriveBrowser).
- Runbook operativo completo en: docs/DRIVE-SETUP-RUNBOOK.md

Lo que YA hice del lado operativo (asumilo hecho):
- Creé la Service Account en Google Cloud, habilité Drive API, generé la JSON key.
- Compartí la carpeta raíz con el email de la SA como Editor.
- Cargué GOOGLE_SERVICE_ACCOUNT_JSON y GOOGLE_DRIVE_ROOT_FOLDER_ID en Netlify
  y disparé un redeploy.

Tarea: ayudame a verificar que Drive quedó conectado de punta a punta y a
diagnosticar si algo falla, siguiendo la sección de verificación del runbook
(pasos 8, 9 y 10). Concretamente:
1. Revisá /api/drive/ping (logueado): esperá { ok:true, rootShared:true,
   serviceAccountEmail, rootFolderName }.
2. Revisá /api/drive/list: esperá entries[] con el contenido de la raíz.
3. Validá navegación en la UI /drive.
Si algo da 503 / 502 / 401 / rootShared:false, usá la tabla de errores del
runbook para decirme exactamente qué revisar (vars, share, ID, sesión/rol).

Restricciones permanentes: NO hagas push, deploy, merge ni migraciones sin mi
OK explícito. NO cargues ni pidas secrets en el repo. NO crees cuentas. Primero
diagnosticá y proponé antes de tocar código. Respondé en español, directo.
```

---

> **Nota.** La verificación de `/api/drive/ping` y `/api/drive/list` requiere
> **sesión iniciada con rol `compliance.view`** — no se puede pegar por `curl`
> anónimo. Esas pruebas las hacés vos en el navegador logueado y le pasás el
> resultado (o el JSON de respuesta) al agente para que lo interprete.
