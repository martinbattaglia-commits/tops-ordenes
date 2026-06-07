-- =========================================================================
-- 0060_rrhh_documents_storage.sql — RRHH (Documents & Storage · Gate R5).
-- Almacén documental RRHH: buckets privados dedicados + metadatos + auditoría
-- de acceso + RPC de signed URL. Documentos de legajo y adjuntos de solicitudes.
--
-- ALCANCE R5 (congelado por Dirección):
--   Buckets: rrhh-legajo, rrhh-health (privados).  (D1: rrhh-receipts NO entra.)
--   Tablas:  rrhh_documents, rrhh_document_audit.
--   RPC:     emit_rrhh_signed_url (único acceso al binario).
--   NO recibos, NO payroll, NO firma digital, NO OCR, NO UI. NO tocar R1–R4.
--
-- Seguridad: has_permission (grueso) + propiedad + jerarquía. PROHIBIDO
--   current_role() (FD-5). Fail-closed coalesce (FD-4). PII aislada (FD-1):
--   salud en bucket rrhh-health (solo rrhh.admin + dueño). Append-only (FD-10).
--   LECTURA DIRECTA DE STORAGE PROHIBIDA: los buckets rrhh-* no tienen policy de
--   lectura authenticated → el binario SOLO se obtiene por emit_rrhh_signed_url.
--   (Más estricto que custody, que abre lectura directa por current_role.)
--
-- D2 (supervisor): accede solo a doc_class IN ('adjunto_solicitud','capacitacion')
--   de su equipo; NUNCA dni/cuil/contrato/bancario/salud/recibos.
-- Modelo: RRHH_MASTER_ARCHITECTURE_v2_0.md §2/§5 + RRHH_R5_IMPLEMENTATION_PLAN.md (APPROVED).
-- Precondición: 0056–0059 aplicadas. Patrón: custody 0037 (estructura), no su authz.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Buckets privados dedicados (patrón custody 0037).
-- -------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('rrhh-legajo', 'rrhh-legajo', false, 10485760,
     array['application/pdf','image/png','image/jpeg','image/webp']),
  ('rrhh-health', 'rrhh-health', false, 10485760,
     array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- -------------------------------------------------------------------------
-- 2. Enums
-- -------------------------------------------------------------------------
do $$ begin create type public.rrhh_doc_class_t as enum
  ('dni','cuil','cv','contrato','alta_afip','certificado','estudio','capacitacion','adjunto_solicitud','otro');
exception when duplicate_object then null; end $$;

do $$ begin create type public.rrhh_doc_audit_action_t as enum
  ('create','view','download','soft_delete','restore');
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------------------
-- 3. rrhh_documents — metadatos (binario en bucket; nunca en la tabla).
-- -------------------------------------------------------------------------
create table if not exists public.rrhh_documents (
  id                uuid primary key default gen_random_uuid(),
  document_group_id uuid not null default gen_random_uuid(),
  version           int  not null default 1 check (version >= 1),
  is_current        boolean not null default true,
  empleado_id       uuid not null references public.rrhh_empleados(id) on delete cascade,
  solicitud_id      uuid references public.rrhh_solicitudes(id) on delete set null,  -- adjuntos
  doc_class         public.rrhh_doc_class_t not null,
  storage_bucket    text not null check (storage_bucket in ('rrhh-legajo','rrhh-health')),
  storage_path      text not null,
  sha256            text not null,                       -- tamper-evidence (obligatorio)
  mime_type         text,
  file_size         bigint,
  titulo            text,
  expires_at        date,                                -- vencimiento de documentación
  retention_class   text,
  retention_until   date,
  redacted          boolean not null default false,      -- supresión PII (Ley 25.326)
  uploaded_by       uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz,                         -- soft-delete
  deleted_by        uuid references auth.users(id) on delete set null,
  unique (storage_bucket, storage_path)
);
create index if not exists rrhh_documents_emp_idx       on public.rrhh_documents(empleado_id);
create index if not exists rrhh_documents_solicitud_idx on public.rrhh_documents(solicitud_id);
create index if not exists rrhh_documents_bucket_idx    on public.rrhh_documents(storage_bucket);
create index if not exists rrhh_documents_class_idx     on public.rrhh_documents(doc_class);
create index if not exists rrhh_documents_expires_idx   on public.rrhh_documents(expires_at) where expires_at is not null;

-- -------------------------------------------------------------------------
-- 4. rrhh_document_audit — auditoría de acceso a PII (append-only).
-- -------------------------------------------------------------------------
create table if not exists public.rrhh_document_audit (
  id          bigserial primary key,
  document_id uuid not null references public.rrhh_documents(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null,
  action      public.rrhh_doc_audit_action_t not null,
  ts          timestamptz not null default now(),
  ip          text,
  user_agent  text,
  detail      jsonb not null default '{}'::jsonb
);
create index if not exists rrhh_document_audit_doc_idx on public.rrhh_document_audit(document_id, ts);

-- -------------------------------------------------------------------------
-- 5. Append-only (FD-10).
--    rrhh_documents: forbid DELETE (UPDATE permitido: soft-delete/redacted/version vía admin).
--    rrhh_document_audit: inmutable (forbid DELETE + UPDATE).
-- -------------------------------------------------------------------------
drop trigger if exists trg_forbid_delete_rrhh_documents on public.rrhh_documents;
create trigger trg_forbid_delete_rrhh_documents
  before delete on public.rrhh_documents
  for each row execute function public.tg_forbid_delete_rrhh();

drop trigger if exists trg_forbid_delete_rrhh_docaudit on public.rrhh_document_audit;
create trigger trg_forbid_delete_rrhh_docaudit
  before delete on public.rrhh_document_audit
  for each row execute function public.tg_forbid_delete_rrhh();
drop trigger if exists trg_forbid_update_rrhh_docaudit on public.rrhh_document_audit;
create trigger trg_forbid_update_rrhh_docaudit
  before update on public.rrhh_document_audit
  for each row execute function public.tg_forbid_update_rrhh();

-- -------------------------------------------------------------------------
-- 6. RLS (FD-1/FD-4/FD-5): has_permission + propiedad + jerarquía. Sin current_role().
--    Salud (rrhh-health): solo rrhh.admin o dueño. Supervisor (D2): solo
--    doc_class IN ('adjunto_solicitud','capacitacion') de su equipo.
-- -------------------------------------------------------------------------
alter table public.rrhh_documents      enable row level security;
alter table public.rrhh_document_audit enable row level security;

drop policy if exists "rrhh_documents read" on public.rrhh_documents;
create policy "rrhh_documents read" on public.rrhh_documents
  for select to authenticated
  using (
    deleted_at is null
    and (
      -- SALUD: solo admin o dueño
      ( storage_bucket = 'rrhh-health' and (
          coalesce(public.has_permission('rrhh.admin'), false)
          or exists (select 1 from public.rrhh_empleados e
                     where e.id = rrhh_documents.empleado_id and e.profile_id = auth.uid())
      ))
      -- NO SALUD: staff (view) | dueño | supervisor (solo adjuntos/capacitación de su equipo)
      or ( storage_bucket <> 'rrhh-health' and (
          coalesce(public.has_permission('rrhh.view'), false)
          or exists (select 1 from public.rrhh_empleados e
                     where e.id = rrhh_documents.empleado_id and e.profile_id = auth.uid())
          or ( rrhh_documents.doc_class in ('adjunto_solicitud','capacitacion')
               and exists (select 1 from public.rrhh_empleados sub
                           join public.rrhh_empleados sup on sup.id = sub.supervisor_id
                           where sub.id = rrhh_documents.empleado_id and sup.profile_id = auth.uid()) )
      ))
    )
  );

-- escritura directa: solo rrhh.admin (carga administrativa por service_role bypassa RLS).
drop policy if exists "rrhh_documents write admin" on public.rrhh_documents;
create policy "rrhh_documents write admin" on public.rrhh_documents
  for all to authenticated
  using (coalesce(public.has_permission('rrhh.admin'), false))
  with check (coalesce(public.has_permission('rrhh.admin'), false));

-- auditoría: lectura por staff RRHH; inserción solo por RPC (definer).
drop policy if exists "rrhh_document_audit read" on public.rrhh_document_audit;
create policy "rrhh_document_audit read" on public.rrhh_document_audit
  for select to authenticated
  using (coalesce(public.has_permission('rrhh.view'), false));

-- NOTA: NO se crean policies de lectura sobre storage.objects para los buckets
-- rrhh-*. Con RLS activa y sin policy, authenticated no puede leer/escribir el
-- binario directamente. El acceso de LECTURA se sirve solo por emit_rrhh_signed_url;
-- la carga (upload) se hace con el cliente service_role (admin), que bypassa RLS.

-- =========================================================================
-- 7. RPC emit_rrhh_signed_url — ÚNICO portón de acceso al binario. Audita lectura.
--    SECURITY DEFINER ⇒ auto-valida (fail-closed). Estructura custody; authz RRHH.
-- =========================================================================
create or replace function public.emit_rrhh_signed_url(p_document_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare d record; v_owner boolean; v_sup boolean; v_ok boolean;
begin
  select * into d from public.rrhh_documents where id = p_document_id and deleted_at is null;
  if not found then raise exception 'NOT_FOUND: documento inexistente o eliminado' using errcode='no_data_found'; end if;
  if d.redacted then raise exception 'REDACTED: documento con PII eliminada — sin acceso' using errcode='42501'; end if;

  v_owner := exists (select 1 from public.rrhh_empleados e
                     where e.id = d.empleado_id and e.profile_id = auth.uid());
  v_sup := exists (select 1 from public.rrhh_empleados sub
                   join public.rrhh_empleados sup on sup.id = sub.supervisor_id
                   where sub.id = d.empleado_id and sup.profile_id = auth.uid());

  if d.storage_bucket = 'rrhh-health' then
    v_ok := coalesce(public.has_permission('rrhh.admin'), false) or v_owner;          -- salud: admin o dueño
  else
    v_ok := coalesce(public.has_permission('rrhh.view'), false)
            or v_owner
            or (v_sup and d.doc_class in ('adjunto_solicitud','capacitacion'));        -- D2 supervisor
  end if;
  if not v_ok then raise exception 'ACCESS_DENIED' using errcode='42501'; end if;

  insert into public.rrhh_document_audit (document_id, actor_id, action, detail)
  values (p_document_id, auth.uid(), 'download', jsonb_build_object('reason', p_reason));

  return jsonb_build_object(
    'document_id', p_document_id, 'bucket', d.storage_bucket, 'path', d.storage_path,
    'issued_by', auth.uid(), 'issued_at', now()
  );
end; $fn$;

revoke all on function public.emit_rrhh_signed_url(uuid, text) from public, anon;
grant execute on function public.emit_rrhh_signed_url(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
