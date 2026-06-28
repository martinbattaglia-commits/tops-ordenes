-- ENTREGADA, NO APLICADA — F0.5.1 Knowledge Layer · Pipeline agnóstico (0108)
-- Verificar numeración contra prod arsksytgdnzukbmfgkju antes de aplicar.
-- Contrato: KnowledgeEventCanonical (composite type). knowledge_emit_event = ÚNICO punto de escritura en knowledge_events.
-- AGNÓSTICO: este archivo no conoce ninguna fuente (sin audit_log/recon/orders/searchable, sin CASE por source_table).
-- ADR-KNW-ADAPTER / ADR-KNW-REGISTRY / ADR-KNW-CONTRACT (docs/superpowers/adr/).

-- 1) Composite type: contrato canónico del evento de conocimiento (idempotente).
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'knowledge_event_canonical' and n.nspname = 'public'
  ) then
    create type public.knowledge_event_canonical as (
      event_type     text,
      occurred_at    timestamptz,
      actor_kind     text,
      actor_id       uuid,
      actor_label    text,
      entity_type    text,
      entity_id      text,
      summary        text,
      payload        jsonb,
      visibility_key text,
      source_table   text,
      source_pk      text,
      correlation_id text
    );
  end if;
end $$;

-- 2) Helper transversal de visibilidad: mapea entity_type -> visibility_key.
--    Regla cross-cutting (NO específica de una sola fuente); cuerpo aprobado en el spec.
create or replace function public.knowledge_visibility_for(p_entity text, p_entity_id text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_client uuid;
begin
  case p_entity
    when 'order','orders' then
      select client_id into v_client from public.orders where id::text = p_entity_id;
      return case when v_client is not null then 'client:'||v_client::text else 'staff' end;
    when 'client','clients' then
      return 'client:'||p_entity_id;
    when 'document','documents' then
      select client_id into v_client from public.documents where id::text = p_entity_id;
      return case when v_client is not null then 'client:'||v_client::text else 'staff' end;
    when 'contract','contracts' then return 'staff';
    when 'crm_lead','crm_opportunity','crm_contract' then return 'perm:comercial.view';
    when 'prospect','prospeccion_prospects' then return 'perm:prospeccion.view';
    when 'purchase_order','supplier_invoice','vendor','fleet_vehicle','warehouse','compliance_item'
      then return 'public_auth';  -- DECISIÓN Dirección: endurecer a 'staff' con cliente_b2b
    when 'rrhh_solicitud','rrhh_empleado','rrhh_document' then return 'perm:rrhh.view';
    else return 'staff';  -- default conservador
  end case;
end;
$$;
revoke all on function public.knowledge_visibility_for(text,text) from public;
grant execute on function public.knowledge_visibility_for(text,text) to service_role;

-- 3) EL EMISOR: único punto de escritura en knowledge_events. Agnóstico de la fuente.
create or replace function public.knowledge_emit_event(p_event public.knowledge_event_canonical)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_kind text;
  v_payload    jsonb;
  v_corr       text;
  v_id         uuid;
begin
  -- Validación del contrato (campos obligatorios). Un NULL aquí es bug del adaptador.
  if p_event.event_type is null
     or p_event.occurred_at is null
     or p_event.entity_type is null
     or p_event.entity_id is null
     or p_event.visibility_key is null
     or p_event.source_table is null then
    raise exception using
      errcode = '23502',
      message = 'knowledge_emit_event: contrato inválido (campo obligatorio nulo)';
  end if;

  -- Defaults.
  v_actor_kind := coalesce(p_event.actor_kind, 'system');
  v_payload    := coalesce(p_event.payload, '{}'::jsonb);

  -- correlation_id (R-C): explícito, o el de sesión, o NULL.
  v_corr := coalesce(p_event.correlation_id, nullif(current_setting('knowledge.correlation_id', true), ''));

  -- Materialización (la tabla aplica sus DEFAULTs en id/seq/ingested_at/status/etc.).
  insert into public.knowledge_events (
    event_type, occurred_at, actor_kind, actor_id, actor_label,
    entity_type, entity_id, summary, payload, visibility_key,
    source_table, source_pk, correlation_id
  ) values (
    p_event.event_type, p_event.occurred_at, v_actor_kind, p_event.actor_id, p_event.actor_label,
    p_event.entity_type, p_event.entity_id, p_event.summary, v_payload, p_event.visibility_key,
    p_event.source_table, p_event.source_pk, v_corr
  )
  on conflict (source_table, source_pk, event_type) do nothing
  returning id into v_id;

  -- Observabilidad EOL: canal técnico separado (Postgres log), NUNCA en knowledge_events.
  raise log 'KnowledgeEmit %', json_build_object(
    'component', 'knowledge_emit_event',
    'source_table', p_event.source_table,
    'event_type', p_event.event_type,
    'entity_type', p_event.entity_type,
    'status', case when v_id is null then 'skipped_duplicate' else 'materialized' end,
    'correlation_id', v_corr
  );

  return v_id;  -- puede ser NULL si hubo conflicto (válido).
end;
$$;
revoke all on function public.knowledge_emit_event(public.knowledge_event_canonical) from public;
grant execute on function public.knowledge_emit_event(public.knowledge_event_canonical) to service_role;

-- 4) Recargar el cache de esquema de PostgREST.
select pg_notify('pgrst', 'reload schema');
