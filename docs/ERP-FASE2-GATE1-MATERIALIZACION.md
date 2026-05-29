# NEXUS ERP — FASE 2 · GATE 1 · Materialización DOCUMENTS HARDENING

> **Modo:** materialización de artefactos. **Nada aplicado / migrado / desplegado.**
> **Estado:** archivos reescritos en disco (rama de trabajo). `supabase db push`,
> `migration repair`, deploy y merge **siguen PROHIBIDOS** hasta GATE 3.
> **Fecha:** 2026-05-29.
> **Diseño origen:** `ERP-FASE2-DOCUMENTS-HARDENING.md` (aprobado).

---

## 0. Artefactos generados

| # | Archivo | Acción | Validación |
|---|---------|--------|------------|
| 1 | `supabase/migrations/0010_documents.sql` | **Reescrito** Enterprise Ready (112 → 290 líneas) | SQL no aplicado |
| 2 | `src/lib/documental/storage.ts` | **Reescrito**: `getPublicUrl`→`createSignedUrl` + path versionado | `tsc` OK |
| 3 | `src/app/(app)/documental/actions.ts` | **Reescrito**: versionado + auditoría + signed URL + soft-delete + nuevas actions | `tsc` OK |
| 4 | `src/app/(app)/documental/UploadDocument.tsx` | **Editado**: `publicUrl`→`signedUrl` | `tsc` OK |

`page.tsx` **no requirió cambios** (usa `listDocs()` mock, no consume URLs públicas).

> **Typecheck:** `npx tsc --noEmit` pasa limpio en los 4 archivos. Único error
> reportado: `src/lib/compras/compras-mock.ts:415` (literal `"warn"`), **preexistente
> y ajeno** a esta fase (módulo Compras, no tocado). No bloquea Documents.

---

## 1. SQL Enterprise Ready definitivo

El archivo `supabase/migrations/0010_documents.sql` queda con esta estructura
(resumen; el SQL completo está en el archivo):

1. **Enums (3, idempotentes):** `document_type_t` (sin cambios) ·
   `document_audit_action_t` (create/view/download/update/delete/restore) ·
   `document_source_t` (upload/email/scan/api/migration).
2. **`documents`** con versionado (`document_group_id/version/is_current/supersedes_id`),
   multi-tenant (`client_id`), multi-sede (`depot depot_t`), storage privado con CHECK
   (`storage_bucket='documents'`, `mime_type in (...)`, `file_size>=0`), soft-delete
   (`deleted_at/deleted_by`), `updated_at`. Uniques: `(storage_bucket,storage_path)` y
   `(document_group_id,version)`.
3. **Índices:** type, doc_date, vendor, client, depot, group, expires (partial), tags
   (GIN), FTS español (GIN), extract (GIN `jsonb_path_ops`), **BRIN(uploaded_at)**,
   unique parcial dedup `(client_id,file_hash) where … deleted_at is null`, unique
   parcial `(document_group_id) where is_current`.
4. **`documents_audit`** bigserial append-only (document_id, group, client_id snapshot,
   ts, user_id, action, ip, user_agent, detail jsonb).
5. **Triggers:** `tg_documents_guard` (bloquea cambios de contenido → fuerza nueva
   versión, toca `updated_at`) · `tg_documents_version` (al insertar versión, desmarca
   `is_current` de la anterior).
6. **`log_document_event(...)`** `SECURITY DEFINER` — registra view/download desde la app.
7. **RLS:** read scoped (interno ve todo / cliente solo lo suyo / soft-deleted oculto
   salvo admin) · insert interno · update interno · delete físico admin · audit read
   admin/supervisor · audit insert authenticated (sin update/delete).
8. **Storage:** bucket `documents` **privado** (`public=false`, `on conflict do update`
   fuerza privacidad), `file_size_limit=26214400`, `allowed_mime_types`; policies
   separadas SELECT/INSERT/UPDATE (authenticated) y **DELETE solo admin**; drop de la
   policy legacy `for all`.
9. **RBAC:** seeds `documental.export` + `documental.admin` + mapeo a roles
   `compliance`/`admin` (idempotente).
10. **Realtime** (`documents` a `supabase_realtime`) + `notify pgrst`.

---

## 2. Diff respecto a 0010 original

### 2.1 Seguridad / Storage (P1)
| 0010 original | 0010 hardened |
|---------------|---------------|
| `buckets … public=true` | `public=false` + `file_size_limit` + `allowed_mime_types` + `on conflict do update` |
| policy `for all` (incl. DELETE a cualquier authenticated) | 4 policies separadas; **DELETE solo admin** |
| app usa `getPublicUrl` | app usa `createSignedUrl` (TTL 300 s) |

### 2.2 Multi-tenant (P2)
| `docs read auth` = `auth.role()='authenticated'` (todos ven todo) | `documents read scoped` con `client_id = (select client_id from profiles where id=auth.uid())` + roles internos |

### 2.3 Auditoría (P3)
| inexistente | `documents_audit` append-only + `log_document_event` + triggers; la app audita create/view/download/delete |

### 2.4 Soft-delete (P4)
| DELETE físico (RLS admin) | `deleted_at`/`deleted_by`; físico reservado a admin; soft-deleted oculto por RLS |

### 2.5 Versionado (P5)
| inexistente | `document_group_id`/`version`/`is_current`/`supersedes_id` + unique parcial + trigger |

### 2.6 Escalabilidad (P8)
| 6 índices | + depot, group, extract GIN, **BRIN(uploaded_at)**, 2 unique parciales; columna `depot depot_t` |

### 2.7 Data quality
| `source text`, `mime_type text`, `storage_bucket default 'attachments'` | `source document_source_t`, `mime_type` con CHECK, `storage_bucket default 'documents'` con CHECK |

### 2.8 RBAC (P7)
| ignora RBAC granular | seeds `documental.export/admin` + mapeo a roles |

---

## 3. Cambios requeridos en aplicación (ya materializados)

- **`storage.ts`:** `uploadDocument` ya no devuelve `publicUrl`; devuelve
  `{bucket,path,size,hash,groupId,version}`. Nueva `getSignedUrl(path, ttl=300)` y
  `newDocumentGroupId()`. `buildDocPath` ahora `{client|_global}/{yyyy}/{mm}/{group}/v{n}-{sha8}-{name}`.
  > **Refinamiento honesto vs diseño:** el `type` **se quitó del path** (vive en la
  > columna `documents.type`) para conservar la resiliencia "subir-antes-de-OCR": al
  > momento del upload el tipo aún no se conoce. No afecta seguridad ni RLS.
- **`actions.ts`:** `ProcessResult.publicUrl` → `signedUrl`. `processDocumentAction`
  setea `document_group_id/version/is_current/client_id/vendor_id/depot/uploaded_by`,
  llama `log_document_event('create')`, devuelve signed URL. Nuevas server actions:
  `getDocumentUrlAction(id,'view'|'download')` (RLS + signed URL + audit) y
  `softDeleteDocumentAction(id)` (soft-delete + audit). `auditContext()` captura ip/UA
  desde `headers()`.
- **`UploadDocument.tsx`:** consume `result.signedUrl` con leyenda "enlace temporal (5 min)".

### Cambios de aplicación AÚN pendientes (no bloqueantes para aplicar 0010)
- La tabla del listado (`page.tsx`) sigue sobre `listDocs()` mock. Cuando se conecte a
  la DB real, sus links de descarga deben usar `getDocumentUrlAction` (signed + audit),
  no URLs directas. Se hará al cablear el listado a datos reales (fuera de GATE 1).

---

## 4. Riesgos

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| `tg_documents_version` hace UPDATE dentro de AFTER INSERT → dispara `tg_documents_guard` | BAJO | El guard solo bloquea cambios de **contenido**; `is_current` no es contenido → pasa. Verificado por diseño. |
| Dedup unique `(client_id,file_hash)`: docs globales (`client_id null`) **no** deduplican | BAJO | Aceptado y documentado; los duplicados globales son raros y no rompen. |
| Signed URL TTL 300 s puede ser corto para descargas lentas | BAJO | `getSignedUrl(path, ttl)` parametrizable; subir TTL para descargas grandes. |
| `log_document_event` SECURITY DEFINER amplía superficie | BAJO | `set search_path=public`, solo inserta en audit, no expone datos. |
| App `getUser()` en demo/SSR sin sesión → `uploaded_by` null | BAJO | Columna nullable por diseño; audit registra user null. |
| Listado real aún no auditado (pendiente §3) | MEDIO | Se cubre al cablear el listado; no afecta la aplicación de 0010. |

**Nuevos bloqueantes detectados:** **NINGUNO.** Todos los hallazgos son de severidad
BAJA/MEDIA y mitigados o diferidos sin impedir la aplicación de 0010.

---

## 5. Impacto

- **Base de datos (al aplicar):** +3 tipos, +2 tablas (`documents`, `documents_audit`),
  +2 funciones, +2 triggers, +13 índices, +1 bucket privado, +5 storage policies, +2
  permisos + mapeos. **No toca tablas existentes** (a diferencia de 0011). Riesgo sobre
  datos vivos: NULO (objetos nuevos).
- **App:** Documents pasa a depender de signed URLs (sin esto la UI no mostraría
  archivos). Resto de módulos sin impacto. Build TypeScript verde.
- **0011 ARCA:** independiente; sin colisión de objetos.
- **Performance:** índices extra → costo de escritura marginal; lectura/búsqueda
  mejoradas (FTS + extract GIN + BRIN).

---

## 6. Estrategia de implementación (SIN EJECUTAR — para GATEs futuros)

**GATE 2 — Validación en staging (requiere autorización):**
1. Crear restore point del proyecto Supabase.
2. Aplicar `0010_documents.sql` en un proyecto/branch de **staging** (NO prod) vía SQL
   Editor (pegar archivo) o `supabase db push` apuntando a staging.
3. Validaciones post-aplicación:
   - `documents`/`documents_audit` existen; enums creados; bucket `documents` `public=false`.
   - RLS: como `cliente` solo veo mis docs; como `operaciones` veo todos; soft-deleted oculto.
   - Trigger: UPDATE de `storage_path` → error "Documento inmutable".
   - `log_document_event` inserta fila de audit.
   - Smoke `/documental`: upload PDF → OCR → fila + audit `create` → signed URL abre el archivo.
   - Storage: DELETE de objeto como no-admin → denegado.
4. Verificar idempotencia: re-ejecutar 0010 completo → sin error (guards + `if not exists` + `on conflict`).

**GATE 3 — Producción (requiere autorización explícita por separado):**
1. Restore point prod.
2. Aplicar 0010 (SQL Editor o `db push` controlado).
3. Repetir validaciones del GATE 2 en prod.
4. Deploy de la app (signed URLs) **sincronizado** con la aplicación de 0010.
5. Merge de la rama a `main`.

> **Orden crítico:** la app con signed URLs y la migración deben ir **juntas**. Si se
> aplica 0010 (bucket privado) sin desplegar la app nueva, la UI vieja con `publicUrl`
> dejaría de mostrar archivos. Y desplegar la app nueva sin 0010 falla porque la tabla
> no existe. → **co-deploy.**

---

## 7. Estrategia de rollback

- **GATE 1 (ahora):** `git checkout -- supabase/migrations/0010_documents.sql
  src/lib/documental/storage.ts 'src/app/(app)/documental/actions.ts'
  'src/app/(app)/documental/UploadDocument.tsx'` restaura el estado previo. Nada en DB.
- **GATE 2/3 si falla la aplicación (sin datos productivos):**
  ```sql
  drop table if exists public.documents_audit;
  drop table if exists public.documents cascade;
  drop function if exists public.log_document_event(uuid,document_audit_action_t,text,text,jsonb);
  drop function if exists public.tg_documents_guard();
  drop function if exists public.tg_documents_version();
  drop type if exists public.document_audit_action_t;
  drop type if exists public.document_source_t;
  drop type if exists public.document_type_t;
  delete from storage.buckets where id='documents';
  delete from public.permissions where slug in ('documental.export','documental.admin');
  -- + revertir schema_migrations al registro previo
  ```
- **Con datos cargados:** NO drop. Rollback degradado = desactivar el módulo en UI; la
  data ya es privada+auditada. Por eso conviene co-deploy correcto desde el inicio.
- **Restore point Supabase** obligatorio antes de cualquier apply.

---

## 8. Recomendación profesional + Criterio de éxito

### ¿La nueva 0010 está lista para ser aprobada para producción?

# ✅ SÍ

**Fundamento técnico:**
- Cierra los **8 bloqueantes** (P1–P8) con patrones **ya probados en el repo**
  (RLS multi-tenant de 0011, audit append-only de 0011, bucket privado de 0011/0003,
  RBAC de 0009, `depot_t` de 0001). No inventa arquitectura nueva sin precedente.
- Es **idempotente** (guards de enum, `if not exists`, `on conflict`, `drop policy if exists`).
- **No toca tablas existentes** → riesgo sobre datos vivos NULO.
- La app está materializada y **compila** (signed URLs, auditoría, soft-delete, versionado).
- **No se detectaron nuevos bloqueantes**; los riesgos remanentes son BAJOS y mitigados.

**Condición de la aprobación (no bloqueante, operativa):** la puesta en producción debe
ser **co-deploy** (migración 0010 + app con signed URLs juntas) y pasar primero por
**GATE 2 (staging)** con las validaciones del §6. La aprobación es del **artefacto**;
la **ejecución** sigue requiriendo tus GATEs explícitos (no se aplica nada en esta fase).

> **Deuda honesta a corregir aparte:** el riesgo **RP-IDEMP** documentado en FASE 0/1.5
> es falso (los enums sí tienen guard). Pendiente de corrección documental, fuera del
> alcance PROHIBIDO de esta fase.
