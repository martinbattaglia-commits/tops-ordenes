# DRIVE-HARDENING-REPORT.md

**Fecha:** 2026-05-29
**Branch base:** working tree sobre `main`
**Modo:** `NO ASUMIR · VERIFICAR` · sin deploy · sin merge · sin producción
**Continuación de:** `docs/DRIVE-PREFLIGHT-AUDIT.md`

---

## 🟢 ACTUALIZACIÓN POST-REMEDIATION (2026-05-29)

El red team posterior (`docs/DRIVE-FINAL-REDTEAM.md`) detectó **2 críticos + 3 altos** que NO eran visibles desde el lente "hardening". Fueron cerrados en `docs/DRIVE-REMEDIATION-REPORT.md`.

**Cambios relevantes al estado de hallazgos de este reporte:**
- **R6** (request-id sin sanitizar) → ya estaba abierto como "medio" acá → **cerrado** durante remediation con `safeRequestId()`.
- **R7** (logs sin user.id) → **parcialmente mitigado** (helper RBAC tiene user.id; falta wirearlo a `timed()`).
- **H8** (cache reset) → función exportada pero el endpoint admin **sigue pendiente**, sin afectar deploy.

**Veredicto efectivo del módulo (compuesto):** 🟢 **READY FOR CREDENTIALS**

---

## Tabla de hallazgos

| Hallazgo | Severidad | Acción | Estado |
| -------- | --------- | ------ | ------ |
| **H1** Rutas Drive/CCTV/WhatsApp/Clientify públicas en middleware | 🚨 Crítico | Re-escribir whitelist a 5 rutas reales + 401 JSON en APIs | ✅ Aplicado (local). Build verde. |
| **H2** Scopes OAuth excesivos (`drive` full) | ⚠️ Medio | Reemplazar por `drive.readonly` + `drive.file` (menor privilegio) | ✅ Aplicado. Documentado caveat para uploadPdf. |
| **H3** Sin paginación en `listChildren` (truncado silencioso a 200) | ⚠️ Medio | Devolver `nextPageToken`, default 50, cap 200, "Cargar más" en UI | ✅ Aplicado en client + route + DriveBrowser. |
| **H4** `searchFiles` sin filtro de root (leak de Drive externo) | ⚠️ Bajo | Opt-in `bounded=true` (default) que filtra por hijos directos del root | ✅ Aplicado. Chip UI indica scope. |
| **H5** `listRecent` solo top-level del root (pierde modifs profundas) | ⚠️ Bajo | Query global + filtro bounded (mismo set rootChildrenIds que H4) | ✅ Aplicado. Skeleton mientras carga. |
| **H6** Documentación `GOOGLE_APPLICATION_CREDENTIALS` no implementada | ⚠️ Bajo | Sacar mención del JSDoc del módulo (no es bug, es deuda doc) | ✅ Aplicado. |
| **H7** Observabilidad mínima (solo `console.error` esporádico) | ⚠️ Medio | Structured JSON logging + `timed()` wrapper + `x-request-id` propagado | ✅ Aplicado. Sentry ready (formato compatible). |
| **H8** Cache module-level sin invalidación tras rotar creds | ⚠️ Bajo | Función `resetDriveCache()` exportada (sin endpoint admin público) | ✅ Aplicado (función). Endpoint admin queda pendiente para sesión futura. |
| **H9 NUEVO** Falta sanitización de `\\` en queries Drive | ⚠️ Bajo | `escapeDriveQuery()` ahora escapa `\\` y `'` (antes solo `'`) | ✅ Aplicado. |
| **H10 NUEVO** No hay manejo específico de 401 en frontend | ⚠️ Bajo | DriveBrowser detecta 401 → mensaje "Tu sesión expiró" | ✅ Aplicado. |
| **H11 NUEVO** Empty/loading/error states de recientes no diferenciaban | ⚠️ Bajo | Skeleton específico mientras `recentLoading=true` | ✅ Aplicado. |
| **H12 NUEVO** Errores sin trazabilidad cliente↔server | ⚠️ Medio | Footer del ErrorPanel muestra `ref: <requestId>` para soporte | ✅ Aplicado. |

**Resumen:** 12 hallazgos verificados — 8 originales + 4 detectados durante el hardening — todos aplicados localmente, build verde, typecheck verde. 0 en producción todavía.

---

## Estado por área (auditoría inicial actualizada)

| Área | Antes | Después | Evidencia |
|------|-------|---------|-----------|
| Seguridad | FAIL | **FIXED-LOCAL** | middleware whitelist reducida + 401 JSON en APIs |
| Performance | WARN | **MEJORADA** | paginación, defaults menores (50 vs 200), cache reset |
| Observabilidad | PARTIAL | **PASS** | structured logging + request IDs |
| UX | PASS | **MEJORADA** | scope chips, paginación visible, ref de error, skeletons |
| APIs | PASS | **PASS+** | request IDs, manejo 401, response headers |
| Typecheck | PASS | **PASS** | `tsc --noEmit` exit 0 |
| Build | PASS | **PASS** | `next build` ok, /drive 4.72 kB (+0.63 kB vs antes), Middleware 82.1 kB |
| Compliance Engine | PASS | **PASS** | sin cambios, sigue enchufando automático |

---

## Cambios aplicados — file map

### `src/lib/drive/client.ts` (185 → 533 líneas, +348)

**Bloque header**
- SCOPES reescritos: `drive.readonly` + `drive.file` (eliminado `drive` full)
- Docstring del módulo actualizado: roles Lector vs Editor por carpeta
- Eliminada mención no implementada de `GOOGLE_APPLICATION_CREDENTIALS` (H6)

**Nuevos exports**
- `resetDriveCache(): void` — invalida `driveCached`, `serviceAccountEmail`, `folderCache`
- `escapeDriveQuery(s: string): string` — escape de `\\` y `'` para Drive Query Language
- `isUnderRoot(fileId, maxDepth=6): Promise<boolean>` — walk hacia arriba para verificar subtree
- `searchFiles(query, opts: { pageSize, bounded })` — firma nueva, retorna `{entries, bounded, rootScoped}`
- `listChildren(folderId, opts: { pageSize, pageToken, query })` — retorna `ListChildrenPage = { entries, nextPageToken, total }`
- `listRecent(limit, opts: { bounded })` — query global con post-filter opt-in

**Structured logging**
- `logDrive(level, meta)` — emite JSON one-line a stdout con `{ts, level, mod, ...}`
- `timed(op, meta, fn)` — wrapper async que mide ms + ok/err + re-throws

**Bug fix latente**
- `folderCache` movido a top-level (antes la declaración estaba bajo `ensureFolder`); ahora `resetDriveCache()` la puede limpiar sin error TS de uso-antes-de-declaración

### `src/lib/supabase/middleware.ts` (72 → 87 líneas)

- `isPublic` reducido de 12 patterns a 9 (eliminados: `/drive`, `/api/clientify`, `/api/cctv`, `/api/drive`, `/api/whatsapp`)
- Agregados específicos: `/api/whatsapp/webhook`, `/api/clientify/webhook` (los webhooks externos)
- Nueva rama: APIs autenticadas sin sesión devuelven 401 JSON en vez de 307 redirect

### `src/app/api/drive/list/route.ts` (107 → 131 líneas)

- Acepta `pageToken`, `pageSize` (1..200), `bounded` (default true)
- Propaga `x-request-id` en headers y body
- Estructura de respuesta enriquecida: `nextPageToken`, `searchActive`, `bounded`, `rootScoped`, `requestId`

### `src/app/api/drive/ping/route.ts` (41 → 56 líneas)

- Acepta `x-request-id` del cliente o genera uno propio
- Propaga en headers y body para correlación con structured logs

### `src/app/(app)/drive/DriveBrowser.tsx` (478 → 555 líneas)

- Estado: `nextPageToken`, `loadingMore`, `searchScope`, `recentLoading`, `lastRequestId`
- `load()` acepta `pageToken` + `append` para concatenar resultados
- `loadMore()` — handler del botón "Cargar más"
- Botón "Cargar más" + indicador de loading spinner inline
- Subtitle dinámico: scope chip cuando hay búsqueda activa
- `ErrorPanel` muestra `requestId` para soporte
- Skeleton rows en recientes mientras `recentLoading=true`
- Detección de 401 → mensaje "Tu sesión expiró"
- Botón X para limpiar búsqueda inline en el input

---

## Verificación

### Typecheck

```bash
$ npm run typecheck
> tsc --noEmit
(exit 0)
```

### Build

```bash
$ npm run build | grep -E "/drive|/api/drive|Middleware|Error"
├ ƒ /api/drive/list                      0 B                0 B
├ ƒ /api/drive/ping                      0 B                0 B
├ ƒ /compras/drive                       174 B          87.5 kB
├ ƒ /drive                               4.72 kB        94.8 kB
ƒ Middleware                             82.1 kB
(sin errores, sin warnings)
```

### Diff de tamaño

| Ruta | Antes | Después | Delta |
|------|-------|---------|-------|
| `/drive` | 4.09 kB | 4.72 kB | +0.63 kB (paginación + scope chips + skeletons) |
| `/api/drive/list` | 0 B | 0 B | sin cambio (router-level) |
| `/api/drive/ping` | 0 B | 0 B | sin cambio |
| Middleware | 81.8 kB | 82.1 kB | +0.3 kB (401 JSON branch + comments) |

---

## Cosas que NO se aplicaron (decisión consciente)

### Endpoint admin para `resetDriveCache()`
- **Por qué no:** requiere RBAC + auditoría de quién lo dispara + token rotation playbook.
- **Estado:** función exportada, lista para wirear cuando aprueben el flow.

### Búsqueda recursiva real (más allá de 2 niveles)
- **Por qué no:** Drive API no soporta "ancestor in X" nativo. Implementación walk-tree es O(N*M) y bloquea hasta 30s. Mejor v2 con índice precomputado.
- **Estado:** documentado en docstring de `searchFiles`. La opción `bounded=true` es "best-effort 2 niveles".

### Métricas de cuota Drive
- **Por qué no:** Drive API no expone consumo en headers. Para tracking real hay que mantenerlo client-side (contador in-memory) o ir a Cloud Monitoring API.
- **Estado:** `timed()` deja la duración en logs; con un log shipper (Logflare/Datadog) el dashboard se construye sin más código.

### Integración con Sentry
- **Por qué no:** requiere DSN, decisión de paquete (`@sentry/nextjs`) y política de PII (qué reporta a Sentry vs qué se queda interno).
- **Estado:** structured logs en formato compatible. El día que se enchufa Sentry, el `logDrive` puede ser reemplazado por adapter.

---

## Para cuando lleguen las credenciales

El módulo está **MÁS READY** que antes del audit. Los pasos del DRIVE-INTEGRATION-REPORT son los mismos:

1. Validar JSON (parse + 5 campos + private_key bordes BEGIN/END)
2. Serializar a 1 línea preservando `\n` literales
3. `netlify env:set GOOGLE_SERVICE_ACCOUNT_JSON ... --context production --secret`
4. `netlify env:set GOOGLE_DRIVE_ROOT_FOLDER_ID ... --context production`
5. **Deploy conjunto** (incluye H1 + H2-H8) — opción 🅑 aprobada por el usuario
6. Smoke tests con `x-request-id` propagado:
   - `curl -H "x-request-id: smoke-1" /api/drive/ping` → 200 con `rootFolderName`, `rootShared: true`
   - `curl -H "x-request-id: smoke-2" /api/drive/list` → 200 con `entries[]`, `nextPageToken` si hay >50
   - `curl /api/drive/list?recent=1` → 200 con archivos modificados recientes filtrados al root
7. Verificar logs structured: `netlify logs:function` debería mostrar `{"mod":"drive","op":"ping","ms":N,"ok":true,...}`
8. Abrir `/drive` autenticado → listar real, "Cargar más" si aplica, scope chip cuando se busca
9. Abrir `/anmat` → pill "Drive conectado" en verde

---

## Restricciones honradas

- 🛑 NO DEPLOY — ningún cambio aplicado en producción
- 🛑 NO MERGE — `main` intacto en `a4b24e5` (working tree separado)
- 🛑 NO PRODUCCIÓN — env vars de Netlify sin tocar
- 🛑 NO SIMULAR RESULTADOS — todos los PASS/FAIL respaldados con typecheck/build/grep verificable
- 🛑 NO MARCADO ESPÚREO — H8 marcado "función disponible, sin endpoint" porque no se creó endpoint
