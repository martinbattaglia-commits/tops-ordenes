# DRIVE-TOPS-ROOT-FOLDER-UPDATE

**Fecha:** 2026-06-08 · **Estado: ✅ APLICADO (dev).** Cambio de **configuración** (`GOOGLE_DRIVE_ROOT_FOLDER_ID`), sin tocar código.
La carpeta fue compartida con la SA y el cambio quedó aplicado en `.env.local` del worktree servido.

---

## Resultado

| Ítem | Valor |
|---|---|
| **Carpeta anterior** | `TOPS Nexus Backups` — id `1Erng2SywVN9ymHqUzkT0iMRrKSmrHWBw` (contenía `backup-*.dump`) |
| **Carpeta nueva** | `AGENCIA GUBERNAMENTAL DE CONTROL` |
| **folder_id utilizado** | **`[REDACTED]`** |
| **Variable** | `GOOGLE_DRIVE_ROOT_FOLDER_ID` (`.env.local` dev) |
| **Backup** | `.env.local.pre-drive-root.bak` |

> Service account: `tops-ordenes-drive@tops-ordenes.iam.gserviceaccount.com` — ahora con acceso a la carpeta (compartida por Presidencia).

---

## Evidencia funcional (Drive API real, con la SA)

**Folder objetivo encontrado:**
```
AGENCIA GUBERNAMENTAL DE CONTROL → id [REDACTED]
```

**Primer nivel del nuevo root (lo que verá el usuario al abrir Drive TOPS):**
```
[DIR] LUJAN   (id 1Q1HM7bC3MHfOgQzmOoo8CZhQx0O_9VKd)  · parent = AGENCIA ✓
[DIR] MAGALDI (id 1lzRU8WvAASd506SRrvcfmAN1ST8SZIfs)  · parent = AGENCIA ✓
```
→ exactamente **LUJAN** y **MAGALDI**, sin backups ni dumps ni carpetas técnicas de la SA.

**Contraste (root anterior, lo que se veía antes):**
```
[file] backup-2026-06-07T081803Z.dump
[file] backup-2026-06-04T231356Z.dump
```

---

## Validaciones

| Validación | Resultado |
|---|---|
| Carpeta AGENCIA accesible para la SA | ✅ (compartida; encontrada vía API) |
| folder_id real obtenido (sin asumir) | ✅ `[REDACTED]` |
| Primer nivel = LUJAN + MAGALDI | ✅ (confirmado por API; parents = AGENCIA) |
| No aparecen backups/dumps/internos | ✅ (el nuevo root no los contiene) |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` actualizado | ✅ `.env.local` (+ backup) |
| Dev server recompila | ✅ `/drive` → 307 (login); `/api/drive/list` → 401 sin sesión (no 500) |

> Navegación LUJAN/MAGALDI, breadcrumbs (raíz = AGENCIA), búsqueda y recientes operan sobre el nuevo root porque **todo el módulo usa la misma env var** (`client.ts` la lee en listado/breadcrumbs/search/recientes). La verificación visual logueada la confirma Presidencia; la fuente de datos (children del nuevo root) ya está validada contra la API.

---

## Pendiente para producción

- **Netlify:** setear `GOOGLE_DRIVE_ROOT_FOLDER_ID = [REDACTED]` en las env vars del sitio (este cambio fue en `.env.local` = dev local). Requiere tu OK / acceso a Netlify (no se tocó producción).
- Confirmar que la SA tenga acceso en el contexto de prod (la compartición es a nivel de la cuenta de servicio, así que aplica igual).

> Cambio de config aplicado en dev. Sin tocar código. Sin commit/push. Producción pendiente de setear la misma variable en Netlify.
