# Runbook — Conectar Google Drive real (Service Account)

> **Implementación oficial.** Este runbook corresponde a la única implementación
> de Drive del proyecto:
>
> - **Código:** `src/lib/drive/client.ts`
> - **Variables de entorno:**
>   - `GOOGLE_SERVICE_ACCOUNT_JSON` — el JSON completo de la Service Account.
>   - `GOOGLE_DRIVE_ROOT_FOLDER_ID` — ID de la carpeta raíz expuesta.
>
> No existe otra convención válida. (El cliente histórico de 3 variables
> —`GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` / `GOOGLE_DRIVE_FOLDER_ID`— fue
> eliminado; si lo ves mencionado en docs de auditoría viejas, está obsoleto.)
>
> El objetivo es que cualquier persona que tome TOPS Nexus pueda conectar Drive
> de punta a punta siguiendo solo este documento, sin contexto adicional.

Dos datos clave que condicionan todo el setup:

- **Las rutas `/api/drive/*` exigen sesión iniciada + permiso RBAC
  `compliance.view`.** No se pueden verificar con `curl` anónimo: se validan
  logueado desde el navegador (o con la cookie de sesión).
- **Para conservar la escritura** (subir facturas/PDFs a Drive, scope
  `drive.file`), la carpeta raíz debe compartirse con la Service Account como
  **Editor**, no como Lector. Con Lector solo se navega/lee.

---

## 1. Proyecto en Google Cloud
1. Entrá a https://console.cloud.google.com/
2. Selector de proyecto (arriba) → **New Project** (o reutilizá uno de TOPS si ya existe).
3. Nombre sugerido: `tops-nexus-drive`. Anotá el **Project ID**.

## 2. Habilitar Google Drive API
1. Menú → **APIs & Services → Library** (o https://console.cloud.google.com/apis/library/drive.googleapis.com).
2. Buscá **Google Drive API** → **Enable**. (Confirmá que quede sobre el proyecto correcto.)

## 3. Crear la Service Account
1. **APIs & Services → Credentials → Create credentials → Service account.**
2. Nombre: `nexus-drive-sa`. **Create and continue.**
3. **Roles IAM: ninguno.** (El acceso a Drive NO va por IAM, va por compartir la carpeta — paso 5.) **Done.**
4. Anotá el email de la SA: `nexus-drive-sa@<project-id>.iam.gserviceaccount.com`.

## 4. Generar la JSON key
1. Abrí la SA → pestaña **Keys → Add key → Create new key → JSON → Create.**
2. Se descarga un `.json`. **Es un secret:** guardalo en gestor de contraseñas, no en el repo, no en email, no en chats.
3. Ese archivo completo es el valor de `GOOGLE_SERVICE_ACCOUNT_JSON` (paso 7).

## 5. Compartir la carpeta raíz con la SA  ⚠️ como Editor
1. En Google Drive, ubicá (o creá) la carpeta raíz que querés exponer (ej. `TOPS / Documental`).
2. Click derecho → **Compartir** → pegá el email de la SA (paso 3.4).
3. Rol: **Editor** (necesario para que ande el guardado de PDFs; si solo querés lectura, Lector alcanza pero pierde la escritura). **Enviar / Listo.**

## 6. Obtener `GOOGLE_DRIVE_ROOT_FOLDER_ID`
1. Abrí esa carpeta en Drive. La URL es:
   `https://drive.google.com/drive/folders/`**`1AbCdEf...XyZ`**
2. El tramo final (después de `/folders/`) es el **ROOT_FOLDER_ID**. Copialo.

## 7. Cargar variables en Netlify
1. Netlify → tu sitio (`tops-ordenes`) → **Site configuration → Environment variables.**
2. **Add a variable** (×2):
   - `GOOGLE_SERVICE_ACCOUNT_JSON` = contenido **completo** del `.json` (objeto entero, desde `{` hasta `}`).
   - `GOOGLE_DRIVE_ROOT_FOLDER_ID` = el ID del paso 6.
3. Scope: **All scopes** (o al menos Production). **Guardar.**
4. **Trigger redeploy:** Deploys → *Trigger deploy → Deploy site.* Las env vars solo toman efecto en un build nuevo.

## 8. Verificar `/api/drive/ping`  (logueado, no anónimo)
1. Logueate en la app con tu usuario (rol con `compliance.view`).
2. En la misma pestaña (con sesión activa) abrí: `https://<tu-dominio>/api/drive/ping`
3. Esperado — JSON:
   ```json
   { "ok": true,
     "serviceAccountEmail": "nexus-drive-sa@...",
     "rootFolderId": "1AbCd...",
     "rootFolderName": "Documental",
     "rootShared": true }
   ```
   - `rootShared: true` → la SA ve la carpeta. ✅
   - `503 "Drive no configurado"` → faltan vars o no redeployaste (volvé a 7).
   - `rootShared: false` o error 502 → no compartiste la carpeta con la SA, o ID equivocado (paso 5/6).
   - `401/403` → no estás logueado o tu rol no tiene `compliance.view`.

## 9. Verificar `/api/drive/list`
1. Logueado, abrí: `https://<tu-dominio>/api/drive/list`
2. Esperado: `{ "ok": true, "configured": true, "entries": [ ... ], "breadcrumbs": [] }` con el contenido de la raíz.
3. Vacío con `ok:true` = carpeta sin archivos (no es error). Probá con subcarpetas vía `?folderId=<id>`.

## 10. Validar navegación desde la UI
1. Entrá a `https://<tu-dominio>/drive` (DriveBrowser).
2. Confirmá: lista la raíz, entrás a carpetas, breadcrumbs, búsqueda y "recientes" funcionan.
3. Para validar **escritura** (opcional): generá una OC/factura que dispare guardado en Drive y verificá que aparezca el PDF en la carpeta compartida.

---

## Checklist de cierre
- [ ] Drive API habilitada · [ ] SA creada · [ ] JSON key a salvo
- [ ] Carpeta compartida como **Editor** con la SA · [ ] ROOT_FOLDER_ID copiado
- [ ] 2 env vars en Netlify + redeploy · [ ] ping `rootShared:true` · [ ] list OK · [ ] UI navega

## Seguridad
El `.json` es una credencial viva — si se filtra, revocá la key desde la SA
(paso 4) y generá otra. Nunca la pongas en el repo ni la pegues en docs
versionados.

---

## Referencia técnica rápida
- **Cliente:** `src/lib/drive/client.ts` — `isDriveConfigured()`, `ping()`, `listChildren()`, `searchFiles()`, `getBreadcrumbs()`, `listRecent()`, `uploadPdf()`, `ensureVendorFolderPath()`, `isUnderRoot()`.
- **Scopes:** `drive.readonly` (leer todo lo compartido) + `drive.file` (crear archivos en carpetas compartidas como Editor).
- **Rutas API:** `GET /api/drive/ping`, `GET /api/drive/list` — ambas con `runtime = "nodejs"`, rate-limit por IP y RBAC `compliance.view`.
- **UI:** `/drive` (DriveBrowser). Todo el listado/búsqueda queda acotado a la carpeta raíz (`isUnderRoot`).
