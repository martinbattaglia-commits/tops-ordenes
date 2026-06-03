-- =========================================================================
-- 0038_custody_evidence.sql — GATE 5.2: EVIDENCE LAYER de la Cadena de Custodia.
--
-- RPC de captura/verificación/erasure sobre 0036 (Core) + 0037 (Storage). ADDITIVE.
-- NO reabre 0036/0037. SIN POD, SIN timeline, SIN PDF, SIN TS/React/Server Actions,
-- SIN captura de cámara/upload frontend/escaneo QR (eso es 0039 / capas app).
--
-- RPC (autorizadas · todas SECURITY DEFINER · authz current_role()):
--   1. attach_custody_evidence  — crea EVENTO (con evidence_sha256 plegado en la
--      hash-chain) + EVIDENCIA, atómico. La cadena (0036) liga el archivo SOLO si el
--      evento se inserta con evidence_sha256 = sha256 del archivo → por eso attach
--      crea ambos. Audit: custody.attach.
--   2. register_custody_event   — crea un EVENTO SIN archivo (cargado/en_transito/etc.).
--      Audit: custody.event.
--   3. verify_custody_chain     — recorre la cadena de una entidad, recomputa
--      prev_hash/row_hash (misma fórmula que el trigger de 0036) y reporta continuidad.
--      Audit: custody.chain_verify.
--   4. redact_custody_evidence  — erasure de PII: NO borra la fila; setea redacted=true,
--      redacted_at, redacted_by. Preserva sha256/auditoría/cadena. Audit: custody.redact.
--
-- COLUMNA ADITIVA (no reabre 0036): custody_evidence.redacted_by (provenance del erasure).
--   El trigger de inmutabilidad de 0036 PERMITE el flip de redacción y NO lista redacted_by
--   en sus columnas inmutables → el UPDATE de redacción puede setearla.
--
-- HASH-CHAIN: misma fórmula canónica que custody_event_hashchain (0036) — sha256() built-in.
-- BINARIO: la firma del signed URL (0037) y el BORRADO físico del binario al redactar son
--   APP-SIDE (Supabase SDK / service-role). Estas RPC son el portón DB-enforced.
--
-- Re-ejecutable: create or replace / add column if not exists / revoke/grant idempotentes.
-- ⚠️ Requiere 0036 + 0037 APLICADAS. Backup manual previo (PITR off).
-- =========================================================================

-- =========================================================================
-- Columna aditiva — provenance del erasure (no reabre 0036).
-- =========================================================================
alter table public.custody_evidence
  add column if not exists redacted_by uuid references auth.users(id) on delete set null;

-- =========================================================================
-- 1. attach_custody_evidence — EVENTO (chain liga el archivo) + EVIDENCIA, atómico.
-- =========================================================================
create or replace function public.attach_custody_evidence(
  p_packing_unit_id uuid,
  p_shipment_id     uuid,
  p_stage           custody_stage_t,
  p_event_type      custody_event_type_t,
  p_kind            evidence_kind_t,
  p_bucket          text,
  p_storage_path    text,
  p_sha256          text,
  p_file_name       text default null,
  p_mime_type       text default null,
  p_size_bytes      bigint default null,
  p_captured_at     timestamptz default null,
  p_exif            jsonb default null,
  p_geo_lat         double precision default null,
  p_geo_lng         double precision default null,
  p_geo_accuracy_m  numeric default null,
  p_geo_source      text default null,
  p_device_ref      text default null,
  p_notes           text default null,
  p_occurred_at     timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_evi_id   uuid;
  v_pub      text;
  v_exists_redacted boolean;
  v_ret_class text;
  v_ret_until timestamptz;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  -- FK válidas: packing_unit_id XOR shipment_id (exactamente uno).
  if num_nonnulls(p_packing_unit_id, p_shipment_id) <> 1 then
    raise exception 'indicar exactamente uno de packing_unit_id / shipment_id';
  end if;
  if p_packing_unit_id is not null
     and not exists (select 1 from public.packing_units where id = p_packing_unit_id) then
    raise exception 'packing_unit % inexistente', p_packing_unit_id using errcode = 'no_data_found';
  end if;
  if p_shipment_id is not null
     and not exists (select 1 from public.shipments where id = p_shipment_id) then
    raise exception 'shipment % inexistente', p_shipment_id using errcode = 'no_data_found';
  end if;

  -- stage / event_type permitido y consistente (mismo dominio que el CHECK de 0036).
  if not (
        (p_stage = 'packing'    and p_event_type = 'foto_packing')
     or (p_stage = 'despacho'   and p_event_type = 'cargado')
     or (p_stage = 'transporte' and p_event_type = 'en_transito')
     or (p_stage = 'entrega'    and p_event_type in ('foto_entrega','firmado'))
     or (p_stage = 'pod'        and p_event_type = 'pod')
  ) then
    raise exception 'event_type % no es válido para stage %', p_event_type, p_stage;
  end if;

  -- bucket válido.
  if p_bucket not in ('custody-evidence','custody-pii','custody-pod') then
    raise exception 'bucket % inválido', p_bucket;
  end if;

  -- sha256 presente.
  if p_sha256 is null or length(trim(p_sha256)) = 0 then
    raise exception 'sha256 obligatorio';
  end if;

  -- (bucket, path) no debe estar tomado; NO reutilizar el path de una evidencia REDACTADA.
  select redacted into v_exists_redacted from public.custody_evidence
    where storage_bucket = p_bucket and storage_path = p_storage_path;
  if found then
    if v_exists_redacted then
      raise exception 'el path % ya pertenece a una evidencia REDACTADA — no reutilizable', p_storage_path;
    end if;
    raise exception 'ya existe evidencia en %/%', p_bucket, p_storage_path;
  end if;

  -- Retención tiered por bucket (modelo de 0037; deadlines TENTATIVOS · confirmar marco legal).
  v_ret_class := case p_bucket
                   when 'custody-pii' then 'pii'
                   when 'custody-evidence' then 'evidence'
                   when 'custody-pod' then 'pod' end;
  v_ret_until := coalesce(p_captured_at, now()) + case v_ret_class
                   when 'pii'      then interval '1 year'
                   when 'evidence' then interval '2 years'
                   when 'pod'      then interval '10 years' end;

  -- EVENTO: evidence_sha256 = sha256 del archivo → la hash-chain (trigger 0036) liga el archivo.
  insert into public.custody_events
    (packing_unit_id, shipment_id, stage, event_type, actor_id, occurred_at,
     geo_lat, geo_lng, geo_accuracy_m, geo_source, device_ref, notes, evidence_sha256)
  values
    (p_packing_unit_id, p_shipment_id, p_stage, p_event_type, auth.uid(), coalesce(p_occurred_at, now()),
     p_geo_lat, p_geo_lng, p_geo_accuracy_m, p_geo_source, p_device_ref, p_notes, p_sha256)
  returning id, public_id into v_event_id, v_pub;

  -- EVIDENCIA (archivo en Storage).
  insert into public.custody_evidence
    (event_id, kind, storage_bucket, storage_path, file_name, mime_type, size_bytes,
     sha256, captured_at, exif, retention_class, retention_until, created_by)
  values
    (v_event_id, p_kind, p_bucket, p_storage_path, p_file_name, p_mime_type, p_size_bytes,
     p_sha256, p_captured_at, p_exif, v_ret_class, v_ret_until, auth.uid())
  returning id into v_evi_id;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'custody_evidence', v_evi_id, 'custody.attach',
          jsonb_build_object('event_id', v_event_id, 'event_public_id', v_pub,
                             'kind', p_kind, 'bucket', p_bucket, 'path', p_storage_path,
                             'sha256', p_sha256, 'retention_class', v_ret_class));

  return jsonb_build_object('event_id', v_event_id, 'event_public_id', v_pub, 'evidence_id', v_evi_id);
end;
$$;

-- =========================================================================
-- 2. register_custody_event — evento SIN archivo (cargado / en_transito / etc.).
-- =========================================================================
create or replace function public.register_custody_event(
  p_packing_unit_id uuid,
  p_shipment_id     uuid,
  p_stage           custody_stage_t,
  p_event_type      custody_event_type_t,
  p_geo_lat         double precision default null,
  p_geo_lng         double precision default null,
  p_geo_accuracy_m  numeric default null,
  p_geo_source      text default null,
  p_device_ref      text default null,
  p_notes           text default null,
  p_occurred_at     timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_pub text;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  -- packing_unit_id XOR shipment_id.
  if num_nonnulls(p_packing_unit_id, p_shipment_id) <> 1 then
    raise exception 'indicar exactamente uno de packing_unit_id / shipment_id';
  end if;
  if p_packing_unit_id is not null
     and not exists (select 1 from public.packing_units where id = p_packing_unit_id) then
    raise exception 'packing_unit % inexistente', p_packing_unit_id using errcode = 'no_data_found';
  end if;
  if p_shipment_id is not null
     and not exists (select 1 from public.shipments where id = p_shipment_id) then
    raise exception 'shipment % inexistente', p_shipment_id using errcode = 'no_data_found';
  end if;

  -- event_type permitido / stage consistente.
  if not (
        (p_stage = 'packing'    and p_event_type = 'foto_packing')
     or (p_stage = 'despacho'   and p_event_type = 'cargado')
     or (p_stage = 'transporte' and p_event_type = 'en_transito')
     or (p_stage = 'entrega'    and p_event_type in ('foto_entrega','firmado'))
     or (p_stage = 'pod'        and p_event_type = 'pod')
  ) then
    raise exception 'event_type % no es válido para stage %', p_event_type, p_stage;
  end if;

  -- Inserta el evento → la hash-chain intacta la garantiza el trigger de 0036.
  insert into public.custody_events
    (packing_unit_id, shipment_id, stage, event_type, actor_id, occurred_at,
     geo_lat, geo_lng, geo_accuracy_m, geo_source, device_ref, notes)
  values
    (p_packing_unit_id, p_shipment_id, p_stage, p_event_type, auth.uid(), coalesce(p_occurred_at, now()),
     p_geo_lat, p_geo_lng, p_geo_accuracy_m, p_geo_source, p_device_ref, p_notes)
  returning id, public_id into v_event_id, v_pub;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'custody_event', v_event_id, 'custody.event',
          jsonb_build_object('public_id', v_pub, 'stage', p_stage, 'event_type', p_event_type,
                             'scope', case when p_packing_unit_id is not null then 'packing_unit' else 'shipment' end));

  return v_event_id;
end;
$$;

-- =========================================================================
-- 3. verify_custody_chain — recorre la cadena de una entidad y verifica integridad.
--    Recompute idéntico a custody_event_hashchain (0036). Devuelve {valid, events_checked, first_error}.
-- =========================================================================
create or replace function public.verify_custody_chain(
  p_packing_unit_id uuid default null,
  p_shipment_id     uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_total int := 0;
  v_valid boolean := true;
  v_first_error jsonb := null;
  v_expected_prev text := null;
  v_canon text;
  v_expected_row text;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;
  if num_nonnulls(p_packing_unit_id, p_shipment_id) <> 1 then
    raise exception 'indicar exactamente uno de packing_unit_id / shipment_id';
  end if;

  for r in
    select * from public.custody_events
    where (p_packing_unit_id is not null and packing_unit_id = p_packing_unit_id)
       or (p_shipment_id is not null and shipment_id = p_shipment_id)
    order by chain_seq asc
  loop
    v_total := v_total + 1;
    v_canon := concat_ws('|',
      coalesce(r.packing_unit_id::text, ''),
      coalesce(r.shipment_id::text, ''),
      r.stage::text,
      r.event_type::text,
      coalesce(r.actor_id::text, ''),
      to_char(r.occurred_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS.US'),
      coalesce(r.geo_lat::text, ''),
      coalesce(r.geo_lng::text, ''),
      coalesce(r.evidence_sha256, ''),
      coalesce(r.notes, ''));
    v_expected_row := encode(sha256(convert_to(coalesce(v_expected_prev, '') || '||' || v_canon, 'UTF8')), 'hex');

    -- Continuidad: prev_hash debe encadenar al row_hash del evento anterior.
    if r.prev_hash is distinct from v_expected_prev then
      v_valid := false;
      v_first_error := jsonb_build_object('public_id', r.public_id, 'chain_seq', r.chain_seq,
                         'reason', 'prev_hash discontinuo');
      exit;
    end if;
    -- Integridad: row_hash recomputado debe coincidir.
    if r.row_hash <> v_expected_row then
      v_valid := false;
      v_first_error := jsonb_build_object('public_id', r.public_id, 'chain_seq', r.chain_seq,
                         'reason', 'row_hash no coincide (tamper)');
      exit;
    end if;

    v_expected_prev := r.row_hash;
  end loop;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(),
          case when p_packing_unit_id is not null then 'packing_unit' else 'shipment' end,
          coalesce(p_packing_unit_id, p_shipment_id),
          'custody.chain_verify',
          jsonb_build_object('valid', v_valid, 'events_checked', v_total, 'first_error', v_first_error));

  return jsonb_build_object('valid', v_valid, 'events_checked', v_total, 'first_error', v_first_error);
end;
$$;

-- =========================================================================
-- 4. redact_custody_evidence — erasure de PII. NO borra la fila. Preserva sha256/cadena.
-- =========================================================================
create or replace function public.redact_custody_evidence(
  p_evidence_id uuid,
  p_reason      text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket text;
  v_path   text;
  v_redacted boolean;
begin
  -- Erasure de PII → gating MÁS estricto (admin/supervisor), no operaciones.
  if public.current_role() is null
     or public.current_role() not in ('admin','supervisor') then
    raise exception 'redacción restringida a admin/supervisor' using errcode = 'insufficient_privilege';
  end if;

  select storage_bucket, storage_path, redacted into v_bucket, v_path, v_redacted
    from public.custody_evidence where id = p_evidence_id;
  if not found then
    raise exception 'evidencia % inexistente', p_evidence_id using errcode = 'no_data_found';
  end if;
  if v_redacted then
    raise exception 'evidencia % ya redactada', p_evidence_id;
  end if;

  -- Flip de redacción (permitido por el trigger de 0036): preserva sha256 y la cadena.
  -- El BORRADO FÍSICO del binario en Storage es APP-SIDE (admin · Supabase SDK).
  update public.custody_evidence
    set redacted = true, redacted_at = now(), redacted_by = auth.uid()
    where id = p_evidence_id;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'custody_evidence', p_evidence_id, 'custody.redact',
          jsonb_build_object('reason', p_reason, 'bucket', v_bucket, 'path', v_path));
end;
$$;

-- ---- Grants ----
revoke all on function public.attach_custody_evidence(uuid,uuid,custody_stage_t,custody_event_type_t,evidence_kind_t,text,text,text,text,text,bigint,timestamptz,jsonb,double precision,double precision,numeric,text,text,text,timestamptz) from public, anon;
revoke all on function public.register_custody_event(uuid,uuid,custody_stage_t,custody_event_type_t,double precision,double precision,numeric,text,text,text,timestamptz) from public, anon;
revoke all on function public.verify_custody_chain(uuid,uuid) from public, anon;
revoke all on function public.redact_custody_evidence(uuid,text) from public, anon;

grant execute on function public.attach_custody_evidence(uuid,uuid,custody_stage_t,custody_event_type_t,evidence_kind_t,text,text,text,text,text,bigint,timestamptz,jsonb,double precision,double precision,numeric,text,text,text,timestamptz) to authenticated, service_role;
grant execute on function public.register_custody_event(uuid,uuid,custody_stage_t,custody_event_type_t,double precision,double precision,numeric,text,text,text,timestamptz) to authenticated, service_role;
grant execute on function public.verify_custody_chain(uuid,uuid) to authenticated, service_role;
grant execute on function public.redact_custody_evidence(uuid,text) to authenticated, service_role;

notify pgrst, 'reload schema';
