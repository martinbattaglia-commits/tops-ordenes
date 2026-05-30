# NEXUS ERP — FASE 2 · DOCUMENTS HARDENING

> **Modo:** DISEÑO · ARQUITECTURA · PLANIFICACIÓN. **NO implementación.**
> **Objetivo:** rediseñar `0010_documents.sql` a estándar Enterprise resolviendo los
> 8 bloqueantes (P1–P8) detectados en `ERP-FASE2-DOCUMENTS-0010-AUDITORIA.md`.
> **Estado:** 0010 versionada, **NO aplicada**. `documents`/`document_type_t`/bucket
> `documents` NO existen. La nueva 0010 propuesta **NO se aplica ni se escribe como
> migración en disco** hasta GATE explícito; el SQL vive en este documento como diseño.
> **PROHIBIDO (en efecto):** no aplicar 0010 · no modificar producción · no crear
> tablas · no crear buckets · no ejecutar migraciones · no deploy · no merge.
> **Fecha:** 2026-05-29.

---

## 0. Resumen

La nueva 0010 endurecida es **app-compatible** (no obliga a reescribir el modelo de
datos que ya usa `actions.ts`), salvo **un cambio obligatorio de código**: pasar de
`getPublicUrl` a `createSignedUrl` (bucket pasa a privado). Todo lo demás se resuelve
en la capa SQL/Storage/RBAC reutilizando patrones **ya presentes en el repo**:

- RLS multi-tenant idéntica a `customer_invoices` (0011): `current_role() in (…) or
  client_id = (select client_id from profiles where id=auth.uid())`.
- Audit append-only idéntico a `invoice_audit` (0011): tabla `bigserial`, insert-only.
- Bucket privado idéntico a `invoices` (0011): `public => false` + signed URLs.
- RBAC granular reutilizando `permissions`/`has_permission()` (0009).
- `depot_t` (MAGALDI/LUJAN) ya existe (0001) → multi-sede sin enum nuevo.

> **Hallazgo de diseño (NO ASUMIR/VERIFICAR):** los permisos pedidos
> `document.read/upload/delete/audit` **no pueden crearse con esos literales** porque
> (a) la convención del repo es `modulo.accion` (`documental.*`) y (b) `permissions`
> tiene `unique(module, action)` y `permission_action_t` solo admite
> `view/create/edit/delete/sign/export/admin` (no existe `read/upload/download/audit`).
> Se mapea la intención a la arquitectura real (ver §7). Esto evita un constraint
> violation en producción.

---

## 1. Arquitectura propuesta

### 1.1 Enums

```sql
-- document_type_t: sin cambios respecto a 0010 original (ya idempotente).
do $$ begin
  create type document_type_t as enum (
    'factura','remito','contrato','habilitacion','certificado','auditoria',
    'presupuesto','orden_compra','orden_servicio','constancia_afip','otro'
  );
exception when duplicate_object then null; end $$;

-- NUEVO: acciones auditables del ciclo de vida documental (P3).
do $$ begin
  create type document_audit_action_t as enum (
    'create','view','download','update','delete','restore'
  );
exception when duplicate_object then null; end $$;

-- NUEVO: origen acotado (reemplaza el text libre `source`).
do $$ begin
  create type document_source_t as enum ('upload','email','scan','api','migration');
exception when duplicate_object then null; end $$;
```

### 1.2 Tabla `public.documents` (endurecida)

```sql
create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),
  -- Versionado (P5): todas las versiones comparten document_group_id.
  document_group_id uuid not null default gen_random_uuid(),
  version         int  not null default 1,
  is_current      boolean not null default true,
  supersedes_id   uuid references public.documents(id) on delete set null,

  type            document_type_t not null default 'otro',
  title           text not null,
  summary         text,
  doc_date        date,
  expires_at      date,

  -- Multi-tenant + multi-sede (P2/P8).
  client_id       uuid references public.clients(id) on delete set null,
  vendor_id       uuid references public.vendors(id) on delete set null,
  depot           depot_t,                         -- MAGALDI / LUJAN (0001)

  -- Storage (P1/P6): bucket privado, default corregido.
  storage_bucket  text not null default 'documents'
                    check (storage_bucket = 'documents'),
  storage_path    text not null,
  mime_type       text not null
                    check (mime_type in (
                      'application/pdf','image/png','image/jpeg',
                      'image/webp','image/tiff')),
  file_size       bigint not null default 0 check (file_size >= 0),
  file_hash       text,                            -- SHA-256 hex

  -- Contenido / IA.
  extract         jsonb,
  raw_text        text,
  tags            text[] not null default '{}',
  source          document_source_t not null default 'upload',

  -- Auditoría de fila + soft-delete (P3/P4).
  uploaded_at     timestamptz not null default now(),
  uploaded_by     uuid references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  deleted_by      uuid references auth.users(id) on delete set null,

  ai_tokens_used  int default 0,
  ai_model        text,

  unique (storage_bucket, storage_path),
  unique (document_group_id, version)
);
```

### 1.3 Índices

```sql
create index if not exists documents_type_idx        on public.documents(type);
create index if not exists documents_docdate_idx      on public.documents(doc_date desc);
create index if not exists documents_vendor_idx       on public.documents(vendor_id);
create index if not exists documents_client_idx       on public.documents(client_id);
create index if not exists documents_depot_idx        on public.documents(depot);
create index if not exists documents_group_idx        on public.documents(document_group_id);
create index if not exists documents_expires_idx      on public.documents(expires_at)
  where expires_at is not null;
create index if not exists documents_tags_gin         on public.documents using gin(tags);
create index if not exists documents_fts_gin          on public.documents using gin (
  to_tsvector('spanish',
    coalesce(title,'')||' '||coalesce(summary,'')||' '||coalesce(raw_text,'')));
create index if not exists documents_extract_gin      on public.documents
  using gin (extract jsonb_path_ops);
-- Escala (P8): BRIN barato sobre el eje temporal de inserción.
create index if not exists documents_uploaded_brin    on public.documents
  using brin (uploaded_at);
-- Dedup por tenant (P7 del informe previo): un hash vivo por cliente.
create unique index if not exists documents_hash_uq   on public.documents(client_id, file_hash)
  where file_hash is not null and deleted_at is null;
-- Una sola versión "actual" por grupo (P5).
create unique index if not exists documents_current_uq on public.documents(document_group_id)
  where is_current;
```

### 1.4 Tabla `public.documents_audit` (append-only, P3)

```sql
create table if not exists public.documents_audit (
  id                bigserial primary key,
  document_id       uuid references public.documents(id) on delete set null,
  document_group_id uuid,                          -- sobrevive aunque se borre la fila
  client_id         uuid,                          -- snapshot para scoping del audit
  ts                timestamptz not null default now(),
  user_id           uuid references auth.users(id) on delete set null,
  action            document_audit_action_t not null,  -- create|view|download|update|delete|restore
  ip                text,
  user_agent        text,
  detail            jsonb
);
create index if not exists documents_audit_doc_idx    on public.documents_audit(document_id, ts desc);
create index if not exists documents_audit_client_idx on public.documents_audit(client_id, ts desc);
```

### 1.5 Triggers (inmutabilidad de contenido + versionado)

```sql
-- updated_at + bloqueo de campos de contenido (el blob es inmutable: cambio = nueva versión).
create or replace function public.tg_documents_guard()
returns trigger language plpgsql as $$
begin
  if (new.storage_path is distinct from old.storage_path
      or new.file_hash is distinct from old.file_hash
      or new.file_size is distinct from old.file_size
      or new.storage_bucket is distinct from old.storage_bucket) then
    raise exception 'Documento inmutable: el contenido no se modifica. Subí una nueva versión.';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_documents_guard on public.documents;
create trigger trg_documents_guard
  before update on public.documents
  for each row execute function public.tg_documents_guard();

-- Al insertar una nueva versión, marca como no-actual a la anterior del grupo.
create or replace function public.tg_documents_version()
returns trigger language plpgsql as $$
begin
  if new.supersedes_id is not null then
    update public.documents
       set is_current = false
     where id = new.supersedes_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_documents_version on public.documents;
create trigger trg_documents_version
  after insert on public.documents
  for each row execute function public.tg_documents_version();
```

### 1.6 Función de log de acceso (lectura/descarga — P3)

> **Nota técnica honesta:** PostgreSQL **no tiene triggers de SELECT**. La auditoría de
> `view`/`download` es **necesariamente de capa aplicación**: el server action que
> genera la signed URL llama a esta función `SECURITY DEFINER` para registrar el evento
> aunque el lector sea un cliente B2B. Creación/modificación/borrado sí se cubren con
> los triggers de §1.5 + inserts explícitos.

```sql
create or replace function public.log_document_event(
  p_document_id uuid,
  p_action      document_audit_action_t,
  p_ip          text default null,
  p_user_agent  text default null,
  p_detail      jsonb default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_client uuid;
begin
  select document_group_id, client_id into v_group, v_client
    from public.documents where id = p_document_id;
  insert into public.documents_audit
    (document_id, document_group_id, client_id, user_id, action, ip, user_agent, detail)
  values
    (p_document_id, v_group, v_client, auth.uid(), p_action, p_ip, p_user_agent, p_detail);
end $$;
```

### 1.7 RLS (P2 — aislamiento multi-tenant)

```sql
alter table public.documents       enable row level security;
alter table public.documents_audit enable row level security;

-- LECTURA: internos ven todo; cliente solo lo suyo; soft-deleted oculto salvo admin.
drop policy if exists "documents read scoped" on public.documents;
create policy "documents read scoped"
  on public.documents for select
  using (
    (deleted_at is null or public.current_role() = 'admin')
    and (
      public.current_role() in ('admin','operaciones','supervisor')
      or client_id = (select client_id from public.profiles where id = auth.uid())
    )
  );

-- ALTA: solo personal interno (los clientes NO suben). Alineado a documental.create.
drop policy if exists "documents insert internal" on public.documents;
create policy "documents insert internal"
  on public.documents for insert
  with check (public.current_role() in ('admin','operaciones','supervisor'));

-- EDICIÓN de metadata + soft-delete (deleted_at) → interno. El trigger bloquea contenido.
drop policy if exists "documents update internal" on public.documents;
create policy "documents update internal"
  on public.documents for update
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

-- DELETE FÍSICO: solo admin (excepcional; lo normal es soft-delete).
drop policy if exists "documents delete admin" on public.documents;
create policy "documents delete admin"
  on public.documents for delete
  using (public.current_role() = 'admin');

-- AUDIT: lectura admin/supervisor; insert interno; SIN update/delete (append-only).
drop policy if exists "documents_audit read admin" on public.documents_audit;
create policy "documents_audit read admin"
  on public.documents_audit for select
  using (public.current_role() in ('admin','supervisor'));

drop policy if exists "documents_audit insert auth" on public.documents_audit;
create policy "documents_audit insert auth"
  on public.documents_audit for insert
  with check (auth.role() = 'authenticated');
```

### 1.8 Storage privado + políticas (P1/P6)

```sql
-- Bucket PRIVADO con límite de tamaño y mime types (patrón 0003/0011).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents','documents', false, 26214400,    -- 25 MiB (app cap = 20 MB)
  array['application/pdf','image/png','image/jpeg','image/webp','image/tiff']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lectura/escritura/actualización: autenticado (las signed URLs se emiten server-side).
drop policy if exists "documents read auth"   on storage.objects;
create policy "documents read auth"
  on storage.objects for select
  using (bucket_id = 'documents' and auth.role() = 'authenticated');

drop policy if exists "documents write auth"  on storage.objects;
create policy "documents write auth"
  on storage.objects for insert
  with check (bucket_id = 'documents' and auth.role() = 'authenticated');

drop policy if exists "documents update auth" on storage.objects;
create policy "documents update auth"
  on storage.objects for update
  using (bucket_id = 'documents' and auth.role() = 'authenticated');

-- DELETE de objetos: SOLO admin (separa el `for all` peligroso del 0010 original).
drop policy if exists "documents delete admin obj" on storage.objects;
create policy "documents delete admin obj"
  on storage.objects for delete
  using (bucket_id = 'documents' and public.current_role() = 'admin');
```

**Nomenclatura de path (P6):**
`{client_id|'_global'}/{type}/{yyyy}/{mm}/{document_group_id}/v{version}-{sha8}.{ext}`
→ tenant-prefixed, navegable, colisión-segura (incluye group+version+hash).

**Retención (P6):** no se borra físico por defecto. Documentos con `expires_at` vencido
pasan a archivado lógico (job/cron fuera de DDL); el bucket puede mover a storage class
fría. Borrado físico solo por admin tras período de retención legal (fiscal 10 años /
ANMAT según producto).

### 1.9 RBAC (P7) — reconciliado con el enum real

```sql
-- Reutiliza permisos existentes (0009): documental.view/create/delete.
-- Agrega documental.export (descarga) y documental.admin (auditoría).
insert into public.permissions (slug, module, action, label, description) values
  ('documental.export','documental','export','Descargar documentos',
     'Generar signed URL y registrar descarga'),
  ('documental.admin', 'documental','admin', 'Auditoría documental',
     'Ver bitácora documents_audit')
on conflict (slug) do nothing;

-- Mapear a roles (ej: compliance y admin obtienen auditoría/descarga).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on true
where r.slug = 'compliance' and p.slug in ('documental.export','documental.admin')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on true
where r.slug = 'admin' and p.slug in ('documental.export','documental.admin')
on conflict do nothing;
```

| Permiso pedido | Slug real (repo) | Acción enum | Estado |
|----------------|------------------|-------------|--------|
| `document.read`     | `documental.view`   | `view`   | ya existe (0009) |
| `document.upload`   | `documental.create` | `create` | ya existe (0009) |
| `document.delete`   | `documental.delete` | `delete` | ya existe (0009) |
| `document.download` | `documental.export` | `export` | **nuevo (seed)** |
| `document.audit`    | `documental.admin`  | `admin`  | **nuevo (seed)** |

### 1.10 Realtime + reload

```sql
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.documents;
  end if;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
```

---

## 2. Escalabilidad (P8) — millones de docs, multi-depósito/cliente/sede

- **Hoy:** no-particionada + BRIN(`uploaded_at`) + btree(`client_id`,`type`,`depot`) +
  GIN(tags, FTS, extract). Soporta cómodamente **cientos de miles → pocos millones**.
- **Umbral ~5–10M filas:** migrar a **partición declarativa `RANGE(uploaded_at)`**
  (mensual/anual). Caveat: requiere recrear PK incluyendo la columna de partición y
  re-aplicar RLS por partición → planificar como migración dedicada (0013), no ahora.
- **`raw_text`/`extract` pesados:** a umbral, **mover a satélite `document_content`
  (1:1)** para mantener el heap de `documents` liviano y los índices calientes. Requiere
  ajuste de app → diferir; documentado como palanca de escala.
- **Multi-sede:** `depot depot_t` + índice; multi-cliente: `client_id` + RLS; multi-bucket
  innecesario (un bucket privado + prefijo por tenant escala mejor que N buckets).

---

## 3. Riesgos mitigados

| Riesgo (informe previo) | Cómo lo cierra esta versión |
|--------------------------|------------------------------|
| RP-DOC-PUBLIC (bucket público) | bucket `public=false` + signed URLs + `on conflict do update` que **fuerza** privacidad aunque exista |
| RP-DOC-TENANT (fuga multi-tenant) | RLS `client_id = profiles.client_id` (patrón 0011) |
| RP-DOC-AUDIT (sin trazabilidad) | `documents_audit` append-only + `log_document_event` (view/download) + triggers |
| RP-DOC-DELETE (borrado sin rastro) | soft-delete (`deleted_at`), DELETE físico solo admin, storage DELETE solo admin |
| RP-DOC-LOCKIN (irreversible) | se aplica endurecida **desde el día 1**, antes de tener datos |
| P4 storage `for all` | políticas separadas SELECT/INSERT/UPDATE vs DELETE-admin |
| P5 RBAC ignorado | seeds `documental.export/admin` + mapeo a roles |
| P6 sin límites | `file_size_limit` + `allowed_mime_types` |
| P7 hash huérfano | unique parcial `(client_id, file_hash)` |
| P8 default mismatch | `default 'documents'` + CHECK |

---

## 4. Cambios requeridos

### 4.1 SQL (esta versión, sin aplicar)
- Reescribir `0010_documents.sql` con §1 completo. **No tocar 0011** (independiente).

### 4.2 Código (obligatorio para que el bucket privado funcione)
- `src/lib/documental/storage.ts`: `getPublicUrl` → `createSignedUrl(path, ttl)` (p.ej.
  300 s); `uploadDocument` mantiene `documents` bucket; construir path con la nueva
  nomenclatura (group/version).
- `src/app/(app)/documental/actions.ts`:
  - quitar dependencia de `publicUrl`; devolver `documentId` y emitir signed URL on-demand;
  - setear `document_group_id`/`version`/`is_current` (default OK en primera versión);
  - llamar `log_document_event(documentId,'create',…)` tras insert;
  - opcional: chequear `file_hash` para dedup antes de insertar.
- Endpoints de **lectura/descarga**: generar signed URL + `log_document_event(...,'view'|'download')`.
- UI de listado: leer vía signed URL (no `publicUrl`).

### 4.3 RBAC/roles
- Asignar `documental.export/admin` a `compliance`/`admin` (incluido en seeds §1.9).

---

## 5. Impacto

| Área | Impacto |
|------|---------|
| **0011 ARCA** | Ninguno (independiente). `constancia_afip` entrante encaja, ahora privado igual que invoices. |
| **Órdenes/Compras** | `vendor_id`/`client_id` ya presentes; sin breaking change. |
| **Firmas (0003/0008)** | Sin reuso de buckets; documentado para evitar fragmentación futura. |
| **ANMAT** | habilitaciones/certificados con `expires_at` + privacidad → base sólida para alertas de vencimiento. |
| **Portal cliente B2B** | ahora **seguro**: el cliente solo ve sus documentos vía RLS + signed URL. |
| **App `/documental`** | requiere el cambio de signed URLs (§4.2); sin esto, la UI no muestra archivos. |
| **Performance** | índices adicionales (GIN extract, BRIN) → costo de escritura marginal, ganancia de lectura alta. |

---

## 6. Rollback

- **Antes de aplicar:** trivial — no está en prod; no aplicar y listo.
- **Si se aplicó sin datos:** `drop table public.documents_audit; drop table
  public.documents cascade; drop function log_document_event; drop function
  tg_documents_guard; drop function tg_documents_version; drop type
  document_audit_action_t; drop type document_source_t; drop type document_type_t;
  delete from storage.buckets where id='documents';` + revertir `schema_migrations` +
  borrar seeds `documental.export/admin`. Restaurar `storage.ts`/`actions.ts`.
- **Con datos cargados:** NO hacer drop. La versión ya es privada+auditada, así que el
  rollback degradado es desactivar el módulo en UI, no migrar datos. Por eso conviene
  aplicarla **bien desde el inicio**.
- **Restore point Supabase** obligatorio antes de cualquier `apply` (cuando se autorice).

---

## 7. Recomendación profesional

✅ **Esta versión endurecida es Enterprise Ready en diseño** y cierra los 8 bloqueantes
sin reescribir el modelo de datos de la app (solo el cambio de signed URLs, que es
obligatorio e inevitable con un bucket privado).

**Camino recomendado:**
1. Aprobar este diseño (FASE actual, sin ejecución).
2. **GATE 1:** materializar el SQL en `supabase/migrations/0010_documents.sql`
   (reescritura del archivo, aún sin aplicar) + ajustar `storage.ts`/`actions.ts`.
3. **GATE 2:** revisar en SQL Editor sobre rama / proyecto de staging.
4. **GATE 3 (apply prod):** restore point → aplicar → smoke test `/documental`
   (upload, OCR, listado con scoping por rol, descarga auditada) → merge a `main`.

**No avanzar a GATE 1** sin tu autorización. La decisión de "¿la nueva 0010 se aprueba
para producción?" queda para después de revisar este documento, según lo pediste.

> **Deuda honesta arrastrada:** corregir en los docs de FASE 0/1.5 el riesgo
> **RP-IDEMP** (falso: los enums sí tienen guard). Acción de seguimiento documental,
> fuera del PROHIBIDO de esta fase.
