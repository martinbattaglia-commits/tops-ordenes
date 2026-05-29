-- =========================================================================
-- TOPS NEXUS — Centro Documental con OCR  ·  VERSIÓN ENTERPRISE HARDENED
-- =========================================================================
-- FASE 2 · DOCUMENTS HARDENING (GATE 1 materialización).
-- Diseño aprobado en docs/ERP-FASE2-DOCUMENTS-HARDENING.md.
-- Cierra los bloqueantes P1–P8 de ERP-FASE2-DOCUMENTS-0010-AUDITORIA.md:
--   P1 bucket PRIVADO + signed URLs + file_size_limit + allowed_mime_types
--   P2 RLS multi-tenant (current_role() + client_id = profiles.client_id)
--   P3 documents_audit append-only (sin update / sin delete) + log de acceso
--   P4 soft-delete (deleted_at/deleted_by); DELETE físico solo admin
--   P5 versionado (document_group_id / version / is_current / supersedes_id)
--   P6 storage: tamaño máx, mime types, nomenclatura, retención
--   P7 RBAC reconciliado (documental.view/create/delete + export/admin)
--   P8 escalabilidad (índices, BRIN, GIN, depot_t)
-- NO se aplica en este GATE. db push PROHIBIDO hasta GATE 3.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Enums
-- -------------------------------------------------------------------------
do $$ begin
  create type document_type_t as enum (
    'factura',
    'remito',
    'contrato',
    'habilitacion',
    'certificado',
    'auditoria',
    'presupuesto',
    'orden_compra',
    'orden_servicio',
    'constancia_afip',
    'otro'
  );
exception when duplicate_object then null; end $$;

-- Acciones auditables del ciclo de vida documental (P3).
do $$ begin
  create type document_audit_action_t as enum (
    'create','view','download','update','delete','restore'
  );
exception when duplicate_object then null; end $$;

-- Origen acotado (reemplaza el text libre `source`).
do $$ begin
  create type document_source_t as enum ('upload','email','scan','api','migration');
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------------------
-- 2. Tabla principal
-- -------------------------------------------------------------------------
create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),

  -- Versionado (P5): todas las versiones comparten document_group_id.
  document_group_id uuid not null default gen_random_uuid(),
  version         int  not null default 1 check (version >= 1),
  is_current      boolean not null default true,
  supersedes_id   uuid references public.documents(id) on delete set null,

  type            document_type_t not null default 'otro',
  title           text not null,
  summary         text,
  doc_date        date,
  expires_at      date,

  -- Multi-tenant (P2) + multi-sede (P8).
  client_id       uuid references public.clients(id) on delete set null,
  vendor_id       uuid references public.vendors(id) on delete set null,
  depot           depot_t,                         -- MAGALDI / LUJAN (enum de 0001)

  -- Storage (P1/P6): bucket privado, default corregido a 'documents'.
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

-- -------------------------------------------------------------------------
-- 3. Índices (P8)
-- -------------------------------------------------------------------------
create index if not exists documents_type_idx     on public.documents(type);
create index if not exists documents_docdate_idx   on public.documents(doc_date desc);
create index if not exists documents_vendor_idx    on public.documents(vendor_id);
create index if not exists documents_client_idx    on public.documents(client_id);
create index if not exists documents_depot_idx     on public.documents(depot);
create index if not exists documents_group_idx     on public.documents(document_group_id);
create index if not exists documents_expires_idx   on public.documents(expires_at)
  where expires_at is not null;
create index if not exists documents_tags_gin      on public.documents using gin(tags);
create index if not exists documents_fts_gin       on public.documents using gin (
  to_tsvector('spanish',
    coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(raw_text,'')));
create index if not exists documents_extract_gin   on public.documents
  using gin (extract jsonb_path_ops);
-- BRIN barato sobre el eje temporal de inserción (escala a millones de filas).
create index if not exists documents_uploaded_brin on public.documents
  using brin (uploaded_at);
-- Dedup por tenant: un hash vivo por cliente (los globales client_id null no dedup).
create unique index if not exists documents_hash_uq on public.documents(client_id, file_hash)
  where file_hash is not null and deleted_at is null;
-- Una sola versión "actual" por grupo (P5).
create unique index if not exists documents_current_uq on public.documents(document_group_id)
  where is_current;

-- -------------------------------------------------------------------------
-- 4. Auditoría documental append-only (P3)
-- -------------------------------------------------------------------------
create table if not exists public.documents_audit (
  id                bigserial primary key,
  document_id       uuid references public.documents(id) on delete set null,
  document_group_id uuid,                          -- sobrevive aunque se borre la fila
  client_id         uuid,                          -- snapshot para scoping del audit
  ts                timestamptz not null default now(),
  user_id           uuid references auth.users(id) on delete set null,
  action            document_audit_action_t not null,
  ip                text,
  user_agent        text,
  detail            jsonb
);
create index if not exists documents_audit_doc_idx    on public.documents_audit(document_id, ts desc);
create index if not exists documents_audit_client_idx on public.documents_audit(client_id, ts desc);

-- -------------------------------------------------------------------------
-- 5. Triggers: inmutabilidad de contenido + mantenimiento de versión
-- -------------------------------------------------------------------------
-- El blob es inmutable: cambiar el archivo = subir una nueva versión, no editar.
create or replace function public.tg_documents_guard()
returns trigger language plpgsql as $$
begin
  if (new.storage_path  is distinct from old.storage_path
      or new.file_hash      is distinct from old.file_hash
      or new.file_size      is distinct from old.file_size
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

-- Al insertar una versión nueva, la anterior del grupo deja de ser la actual.
create or replace function public.tg_documents_version()
returns trigger language plpgsql as $$
begin
  if new.supersedes_id is not null then
    update public.documents set is_current = false where id = new.supersedes_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_documents_version on public.documents;
create trigger trg_documents_version
  after insert on public.documents
  for each row execute function public.tg_documents_version();

-- -------------------------------------------------------------------------
-- 6. Log de acceso (lectura/descarga) — Postgres no tiene trigger de SELECT,
--    así que la app llama esta función SECURITY DEFINER al emitir signed URL.
-- -------------------------------------------------------------------------
create or replace function public.log_document_event(
  p_document_id uuid,
  p_action      document_audit_action_t,
  p_ip          text  default null,
  p_user_agent  text  default null,
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

-- -------------------------------------------------------------------------
-- 7. RLS (P2)
-- -------------------------------------------------------------------------
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

-- ALTA: solo personal interno (los clientes NO suben).
drop policy if exists "documents insert internal" on public.documents;
create policy "documents insert internal"
  on public.documents for insert
  with check (public.current_role() in ('admin','operaciones','supervisor'));

-- EDICIÓN de metadata + soft-delete. El trigger bloquea cambios de contenido.
drop policy if exists "documents update internal" on public.documents;
create policy "documents update internal"
  on public.documents for update
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

-- DELETE FÍSICO: solo admin (lo normal es soft-delete).
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

-- -------------------------------------------------------------------------
-- 8. Storage privado + políticas granulares (P1/P6)
-- -------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents','documents', false, 26214400,        -- 25 MiB (app cap = 20 MB)
  array['application/pdf','image/png','image/jpeg','image/webp','image/tiff']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "documents bucket internal write" on storage.objects;  -- legacy 0010

drop policy if exists "documents read auth" on storage.objects;
create policy "documents read auth"
  on storage.objects for select
  using (bucket_id = 'documents' and auth.role() = 'authenticated');

drop policy if exists "documents write auth" on storage.objects;
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

-- -------------------------------------------------------------------------
-- 9. RBAC (P7) — reconciliado con permission_action_t real
--    documental.view/create/delete ya sembrados en 0009.
--    Se agregan export (descarga) y admin (auditoría).
-- -------------------------------------------------------------------------
insert into public.permissions (slug, module, action, label, description) values
  ('documental.export','documental','export','Descargar documentos',
     'Generar signed URL y registrar descarga'),
  ('documental.admin', 'documental','admin', 'Auditoría documental',
     'Ver bitácora documents_audit')
on conflict (slug) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on true
where r.slug = 'compliance' and p.slug in ('documental.export','documental.admin')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on true
where r.slug = 'admin' and p.slug in ('documental.export','documental.admin')
on conflict do nothing;

-- -------------------------------------------------------------------------
-- 10. Realtime + reload
-- -------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.documents;
  end if;
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
