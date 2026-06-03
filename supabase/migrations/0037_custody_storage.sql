-- =========================================================================
-- 0037_custody_storage.sql — GATE 5.1: STORAGE LAYER de la Cadena de Custodia.
--
-- Capa de almacenamiento de evidencia (binarios) + acceso AUDITADO. ADDITIVE
-- sobre 0036 (Custody Core). Implementa el patrón de 0010_documents:
--   bucket PRIVADO + signed URLs + SECURITY DEFINER + auditoría de acceso.
--
-- ALCANCE (autorizado · GATE_5_*_DESIGN/REVIEW/IMPLEMENTATION_PLAN):
--   · 3 buckets PRIVADOS nuevos: custody-evidence, custody-pii, custody-pod.
--     NO reutiliza signatures / pdfs / attachments (0003).
--   · Storage RLS (storage.objects) por bucket: PII con gating de rol MÁS estricto.
--   · RPC emit_custody_signed_url(...) — valida permisos + registra auditoría de
--     LECTURA (audit_log, action 'custody.access') + devuelve el "grant"
--     (bucket/path/evidence_id) para que la APP firme el signed URL (Supabase SDK).
--   · Modelo de retención (SOLO columnas): custody_evidence.retention_class /
--     retention_until. SIN borrados, SIN cron, SIN workers.
--
-- FIRMA DEL SIGNED URL (precedente 0010): Postgres NO tiene trigger de SELECT ni
--   firma URLs de Storage (eso lo hace el storage-api con el JWT secret). Por eso
--   esta RPC es el PORTÓN DE AUTORIZACIÓN + AUDITORÍA; la firma criptográfica del
--   signed URL la realiza la APP (Supabase SDK / service-role) con el grant devuelto.
--
-- BACKUP DE STORAGE — ⚠️ ADVERTENCIA EXPLÍCITA:
--   El Storage de Supabase NO está cubierto por el backup de la DB NI por PITR
--   (que además está deshabilitado). Los binarios de custodia REQUIEREN una
--   estrategia de backup/replicación SEPARADA y OBLIGATORIA antes de operar.
--
-- NO INCLUYE (pertenece a 0038/0039): upload RPC, captura de evidencia, POD,
--   timeline, generación de PDF, firma digital, TS, React, Server Actions.
--
-- Re-ejecutable: on conflict do update / create or replace / drop+create policy.
-- ⚠️ Requiere 0010 (patrón) + 0036 (Custody Core) APLICADAS. Backup manual previo (PITR off).
-- =========================================================================

-- =========================================================================
-- 1. Buckets PRIVADOS (3) — patrón 0010: public=false + file_size_limit + mime types.
-- =========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('custody-evidence','custody-evidence', false, 8388608,      -- 8 MiB · fotos packing/carga/entrega
     array['image/jpeg','image/png','image/webp']),
  ('custody-pii','custody-pii', false, 2097152,                -- 2 MiB · firmas + documentos del receptor (PII)
     array['image/png','image/jpeg','application/pdf']),
  ('custody-pod','custody-pod', false, 10485760,               -- 10 MiB · PDFs de POD generados
     array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- =========================================================================
-- 2. Storage RLS (storage.objects) — defensa en capas (los binarios se acceden
--    por signed URL; estas policies gobiernan el acceso DIRECTO autenticado).
--    PII: gating de rol MÁS ESTRICTO (admin/supervisor). Evidence/POD: WMS roles.
--    Escritura/edición: personal interno. Borrado: solo admin.
-- =========================================================================

-- LECTURA — custody-evidence / custody-pod: WMS roles.
drop policy if exists "custody evidence/pod read" on storage.objects;
create policy "custody evidence/pod read"
  on storage.objects for select
  using (
    bucket_id in ('custody-evidence','custody-pod')
    and public.current_role() in ('admin','operaciones','supervisor')
  );

-- LECTURA — custody-pii: gating MÁS ESTRICTO (sin 'operaciones').
drop policy if exists "custody pii read strict" on storage.objects;
create policy "custody pii read strict"
  on storage.objects for select
  using (
    bucket_id = 'custody-pii'
    and public.current_role() in ('admin','supervisor')
  );

-- ALTA — los 3 buckets: personal interno (la app sube vía service-role / RPC de 0038).
drop policy if exists "custody write internal" on storage.objects;
create policy "custody write internal"
  on storage.objects for insert
  with check (
    bucket_id in ('custody-evidence','custody-pii','custody-pod')
    and public.current_role() in ('admin','operaciones','supervisor')
  );

-- EDICIÓN — interno (en la práctica los binarios son inmutables; la edición real
--   es la redacción, que borra el objeto — un DELETE controlado por la app/0038).
drop policy if exists "custody update internal" on storage.objects;
create policy "custody update internal"
  on storage.objects for update
  using (
    bucket_id in ('custody-evidence','custody-pii','custody-pod')
    and public.current_role() in ('admin','operaciones','supervisor')
  );

-- BORRADO — solo admin (la redacción de PII borra el binario; queda la fila inmutable).
drop policy if exists "custody delete admin" on storage.objects;
create policy "custody delete admin"
  on storage.objects for delete
  using (
    bucket_id in ('custody-evidence','custody-pii','custody-pod')
    and public.current_role() = 'admin'
  );

-- =========================================================================
-- 3. Modelo de RETENCIÓN (SOLO columnas · sin borrados/cron/workers).
--    Tiered por sensibilidad (lo SETEA la RPC de 0038 al adjuntar evidencia):
--      custody-pii  → 'pii'      (retención MÍNIMA legal)
--      custody-evidence → 'evidence' (según SLA del cliente)
--      custody-pod  → 'pod'      (retención MÁXIMA · prueba)
--    'retention_until' = deadline calculado en 0038; los binarios pueden archivarse
--    a frío tras vencer, conservando SIEMPRE la fila inmutable + sha256 + hash-chain.
-- =========================================================================
alter table public.custody_evidence
  add column if not exists retention_class text
    check (retention_class is null or retention_class in ('evidence','pii','pod'));
alter table public.custody_evidence
  add column if not exists retention_until timestamptz;
create index if not exists custody_evidence_retention_idx on public.custody_evidence (retention_until);

-- =========================================================================
-- 4. RPC emit_custody_signed_url — PORTÓN de autorización + AUDITORÍA de lectura.
--    NO firma el URL (eso es app-side, patrón 0010): valida permisos, registra
--    'custody.access' en audit_log y devuelve el grant (bucket/path/evidence_id).
-- =========================================================================
create or replace function public.emit_custody_signed_url(
  p_evidence_id uuid,
  p_reason      text default null,
  p_ip          text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role     public.user_role_t;
  v_kind     evidence_kind_t;
  v_bucket   text;
  v_path     text;
  v_redacted boolean;
begin
  -- A-2 (patrón 0010): SECURITY DEFINER bypassa RLS → DEBE auto-validar permisos.
  v_role := public.current_role();
  if v_role is null then
    raise exception 'sin perfil/rol: acceso denegado' using errcode = 'insufficient_privilege';
  end if;

  select kind, storage_bucket, storage_path, redacted
    into v_kind, v_bucket, v_path, v_redacted
    from public.custody_evidence where id = p_evidence_id;
  if not found then
    raise exception 'evidencia % inexistente', p_evidence_id using errcode = 'no_data_found';
  end if;

  -- Evidencia redactada (PII borrada): no se emite acceso al binario.
  if v_redacted then
    raise exception 'evidencia % redactada (PII eliminada) — sin acceso', p_evidence_id;
  end if;

  -- Gating por bucket: PII MÁS estricto (admin/supervisor); resto WMS roles.
  if v_bucket = 'custody-pii' then
    if v_role not in ('admin','supervisor') then
      raise exception 'acceso a PII (firma/documento) restringido a admin/supervisor' using errcode = 'insufficient_privilege';
    end if;
  else
    if v_role not in ('admin','operaciones','supervisor') then
      raise exception 'no autorizado' using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- AUDITORÍA DE LECTURA (cambio #5): usuario / fecha / evidence_id / bucket / path / motivo.
  insert into public.audit_log (user_id, entity, entity_id, action, payload, ip)
  values (auth.uid(), 'custody_evidence', p_evidence_id, 'custody.access',
          jsonb_build_object('bucket', v_bucket, 'path', v_path, 'kind', v_kind, 'reason', p_reason),
          p_ip);

  -- GRANT para que la APP firme el signed URL (Supabase SDK). La firma NO es SQL.
  return jsonb_build_object(
    'evidence_id', p_evidence_id,
    'bucket',      v_bucket,
    'path',        v_path,
    'kind',        v_kind,
    'reason',      p_reason,
    'issued_by',   auth.uid(),
    'issued_at',   now()
  );
end;
$$;

revoke all on function public.emit_custody_signed_url(uuid, text, text) from public, anon;
grant execute on function public.emit_custody_signed_url(uuid, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
