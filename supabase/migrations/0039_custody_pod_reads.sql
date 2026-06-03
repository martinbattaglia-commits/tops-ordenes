-- =========================================================================
-- 0039_custody_pod_reads.sql — GATE 5.3: POD + READS de la Cadena de Custodia.
--
-- Cierra Gate 5: genera el POD canónico y expone las LECTURAS (timeline, resolución
-- de QR, resumen ejecutivo). ADDITIVE sobre 0036/0037/0038. NO reabre nada.
-- SIN React/TS/Server Actions/escaneo-QR-frontend/cámara/firma-UI/PDF-server/etiquetas
-- (eso es la capa de aplicación posterior).
--
-- RPC (autorizadas · todas SECURITY DEFINER · authz current_role()):
--   1. generate_delivery_pod        — crea delivery_pods (1 por shipment) + audit. MUTACIÓN.
--   2. get_custody_timeline         — timeline cronológico (eventos+evidencias+POD). LECTURA.
--   3. get_custody_by_token         — resuelve un QR (token de packing_unit o shipment). LECTURA · SIN PII.
--   4. get_shipment_custody_summary — resumen ejecutivo del shipment. LECTURA.
--
-- DECISIONES:
--   · generate_delivery_pod crea SOLO delivery_pods + audit (lo autorizado). NO inserta un
--     custody_event 'pod' (no extiende la hash-chain): el POD se DERIVA en el timeline desde
--     delivery_pods. Así la cadena de eventos queda gobernada solo por 0036/0038.
--   · get_custody_by_token NO expone PII (sin receiver_name/document, sin paths de binarios):
--     un QR impreso puede ser escaneado por cualquiera con la etiqueta.
--   · El acceso al BINARIO de cada evidencia sigue siendo por emit_custody_signed_url (0037,
--     auditado). Estas lecturas devuelven METADATOS (evidence_id/kind/bucket/sha256/redacted).
--
-- Re-ejecutable: create or replace / revoke/grant idempotentes.
-- ⚠️ Requiere 0036 + 0037 + 0038 APLICADAS. Backup manual previo (PITR off).
-- =========================================================================

-- =========================================================================
-- 1. generate_delivery_pod — POD canónico (1 por shipment). MUTACIÓN.
-- =========================================================================
create or replace function public.generate_delivery_pod(
  p_shipment_id          uuid,
  p_receiver_name        text,
  p_receiver_document    text default null,
  p_observations         text default null,
  p_signature_evidence_id uuid default null,
  p_pod_storage_path     text default null,
  p_signed_at            timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   shipment_status_t;
  v_pod_id   uuid;
  v_pub      text;
  v_sig_kind evidence_kind_t;
  v_sig_red  boolean;
  v_sig_ship uuid;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  -- shipment existente + estado despachado/entregado.
  select status into v_status from public.shipments where id = p_shipment_id;
  if not found then
    raise exception 'shipment % inexistente', p_shipment_id using errcode = 'no_data_found';
  end if;
  if v_status not in ('despachado','entregado') then
    raise exception 'shipment % no está despachado/entregado (estado %) — no se puede generar POD',
      p_shipment_id, v_status;
  end if;

  -- POD inexistente para ese shipment (1:1).
  if exists (select 1 from public.delivery_pods where shipment_id = p_shipment_id) then
    raise exception 'el shipment % ya tiene POD', p_shipment_id;
  end if;

  -- receiver obligatorio.
  if p_receiver_name is null or length(trim(p_receiver_name)) = 0 then
    raise exception 'receiver_name obligatorio';
  end if;

  -- firma válida cuando corresponda: kind='firma', no redactada, del MISMO shipment.
  if p_signature_evidence_id is not null then
    select ce.kind, ce.redacted, ev.shipment_id
      into v_sig_kind, v_sig_red, v_sig_ship
      from public.custody_evidence ce
      join public.custody_events ev on ev.id = ce.event_id
      where ce.id = p_signature_evidence_id;
    if not found then
      raise exception 'firma % inexistente', p_signature_evidence_id using errcode = 'no_data_found';
    end if;
    if v_sig_kind <> 'firma' then
      raise exception 'la evidencia % no es una firma', p_signature_evidence_id;
    end if;
    if v_sig_red then
      raise exception 'la firma % está redactada', p_signature_evidence_id;
    end if;
    if v_sig_ship is distinct from p_shipment_id then
      raise exception 'la firma % no pertenece al shipment %', p_signature_evidence_id, p_shipment_id;
    end if;
  end if;

  insert into public.delivery_pods
    (shipment_id, receiver_name, receiver_document, observations,
     signature_evidence_id, pod_storage_path, signed_at, created_by)
  values
    (p_shipment_id, p_receiver_name, p_receiver_document, p_observations,
     p_signature_evidence_id, p_pod_storage_path, coalesce(p_signed_at, now()), auth.uid())
  returning id, public_id into v_pod_id, v_pub;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'delivery_pod', v_pod_id, 'custody.pod_generate',
          jsonb_build_object('shipment_id', p_shipment_id, 'public_id', v_pub,
                             'has_signature', p_signature_evidence_id is not null));

  return jsonb_build_object('pod_id', v_pod_id, 'public_id', v_pub);
end;
$$;

-- =========================================================================
-- 2. get_custody_timeline — eventos + evidencias + POD, orden cronológico asc.
--    LECTURA (metadatos; binarios vía emit_custody_signed_url 0037).
-- =========================================================================
create or replace function public.get_custody_timeline(
  p_packing_unit_id uuid default null,
  p_shipment_id     uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nodes jsonb;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;
  if num_nonnulls(p_packing_unit_id, p_shipment_id) <> 1 then
    raise exception 'indicar exactamente uno de packing_unit_id / shipment_id';
  end if;

  select coalesce(jsonb_agg(node order by ord_ts asc, nkind asc), '[]'::jsonb) into v_nodes
  from (
    -- EVENTOS (con sus evidencias)
    select e.occurred_at as ord_ts, 0 as nkind,
      jsonb_build_object(
        'type', 'event',
        'event_id', e.id,
        'public_id', e.public_id,
        'stage', e.stage,
        'event_type', e.event_type,
        'actor_id', e.actor_id,
        'occurred_at', e.occurred_at,
        'geo', case when e.geo_lat is not null
                    then jsonb_build_object('lat', e.geo_lat, 'lng', e.geo_lng, 'source', e.geo_source)
                    else null end,
        'notes', e.notes,
        'evidences', (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'evidence_id', ce.id, 'kind', ce.kind, 'bucket', ce.storage_bucket,
                   'sha256', ce.sha256, 'redacted', ce.redacted) order by ce.created_at asc), '[]'::jsonb)
          from public.custody_evidence ce where ce.event_id = e.id)
      ) as node
    from public.custody_events e
    where (p_packing_unit_id is not null and e.packing_unit_id = p_packing_unit_id)
       or (p_shipment_id is not null and (
              e.shipment_id = p_shipment_id
              or e.packing_unit_id in (select pu.id from public.packing_units pu where pu.shipment_id = p_shipment_id)))

    union all

    -- POD (solo scope shipment; derivado de delivery_pods)
    select dp.signed_at as ord_ts, 1 as nkind,
      jsonb_build_object(
        'type', 'pod',
        'pod_id', dp.id,
        'public_id', dp.public_id,
        'signed_at', dp.signed_at,
        'receiver_name', dp.receiver_name,
        'has_document', dp.receiver_document is not null,
        'signature_evidence_id', dp.signature_evidence_id
      ) as node
    from public.delivery_pods dp
    where p_shipment_id is not null and dp.shipment_id = p_shipment_id
  ) t;

  return jsonb_build_object(
    'scope', case when p_packing_unit_id is not null then 'packing_unit' else 'shipment' end,
    'entity_id', coalesce(p_packing_unit_id, p_shipment_id),
    'nodes', v_nodes
  );
end;
$$;

-- =========================================================================
-- 3. get_custody_by_token — resuelve un QR (token de packing_unit o shipment). SIN PII.
-- =========================================================================
create or replace function public.get_custody_by_token(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope text;
  v_id uuid;
  v_pub text;
  v_status text;
  v_summary jsonb;
  v_pod_present boolean := false;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  -- Resuelve por token (packing_unit primero, luego shipment).
  select 'packing_unit', id, public_id, status::text
    into v_scope, v_id, v_pub, v_status
    from public.packing_units where custody_token = p_token;
  if not found then
    select 'shipment', id, public_id, status::text
      into v_scope, v_id, v_pub, v_status
      from public.shipments where custody_token = p_token;
  end if;
  if v_scope is null then
    raise exception 'token no resuelto' using errcode = 'no_data_found';
  end if;

  -- Timeline RESUMIDO sin PII (stage/event_type/fecha; sin nombres/documentos/paths).
  select coalesce(jsonb_agg(jsonb_build_object(
            'stage', stage, 'event_type', event_type, 'occurred_at', occurred_at) order by occurred_at asc), '[]'::jsonb)
    into v_summary
    from public.custody_events
    where (v_scope = 'packing_unit' and packing_unit_id = v_id)
       or (v_scope = 'shipment' and (shipment_id = v_id
            or packing_unit_id in (select pu.id from public.packing_units pu where pu.shipment_id = v_id)));

  if v_scope = 'shipment' then
    v_pod_present := exists (select 1 from public.delivery_pods where shipment_id = v_id);
  end if;

  -- Auditoría de resolución de token (NO se registra el token en claro).
  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), v_scope, v_id, 'custody.token_resolve',
          jsonb_build_object('public_id', v_pub, 'scope', v_scope));

  return jsonb_build_object(
    'scope', v_scope,
    'public_id', v_pub,          -- BLT- / DSP-
    'status', v_status,
    'pod_present', v_pod_present,
    'events', v_summary          -- resumen sin PII
  );
end;
$$;

-- =========================================================================
-- 4. get_shipment_custody_summary — resumen ejecutivo del shipment. LECTURA.
-- =========================================================================
create or replace function public.get_shipment_custody_summary(p_shipment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_events int;
  v_evidences int;
  v_pod boolean;
  v_chain jsonb;
  v_last timestamptz;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  select exists(select 1 from public.shipments where id = p_shipment_id) into v_exists;
  if not v_exists then
    raise exception 'shipment % inexistente', p_shipment_id using errcode = 'no_data_found';
  end if;

  -- Eventos (del shipment + de sus packing_units) y evidencias ligadas.
  select count(*) into v_events
    from public.custody_events e
    where e.shipment_id = p_shipment_id
       or e.packing_unit_id in (select pu.id from public.packing_units pu where pu.shipment_id = p_shipment_id);

  select count(*) into v_evidences
    from public.custody_evidence ce
    join public.custody_events e on e.id = ce.event_id
    where e.shipment_id = p_shipment_id
       or e.packing_unit_id in (select pu.id from public.packing_units pu where pu.shipment_id = p_shipment_id);

  select exists(select 1 from public.delivery_pods where shipment_id = p_shipment_id) into v_pod;

  -- Validez de la cadena del shipment (reusa verify_custody_chain de 0038 · audita).
  select public.verify_custody_chain(null, p_shipment_id) into v_chain;

  -- Última actividad (evento más reciente o firma del POD).
  select greatest(
           (select max(occurred_at) from public.custody_events
              where shipment_id = p_shipment_id
                 or packing_unit_id in (select pu.id from public.packing_units pu where pu.shipment_id = p_shipment_id)),
           (select max(signed_at) from public.delivery_pods where shipment_id = p_shipment_id)
         ) into v_last;

  return jsonb_build_object(
    'shipment_id', p_shipment_id,
    'events', v_events,
    'evidences', v_evidences,
    'pod_present', v_pod,
    'chain_valid', (v_chain->>'valid')::boolean,
    'chain_events_checked', (v_chain->>'events_checked')::int,
    'last_activity', v_last
  );
end;
$$;

-- ---- Grants ----
revoke all on function public.generate_delivery_pod(uuid,text,text,text,uuid,text,timestamptz) from public, anon;
revoke all on function public.get_custody_timeline(uuid,uuid) from public, anon;
revoke all on function public.get_custody_by_token(uuid) from public, anon;
revoke all on function public.get_shipment_custody_summary(uuid) from public, anon;

grant execute on function public.generate_delivery_pod(uuid,text,text,text,uuid,text,timestamptz) to authenticated, service_role;
grant execute on function public.get_custody_timeline(uuid,uuid) to authenticated, service_role;
grant execute on function public.get_custody_by_token(uuid) to authenticated, service_role;
grant execute on function public.get_shipment_custody_summary(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
