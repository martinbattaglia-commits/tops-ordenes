-- ENTREGADA — F0.5.2 Knowledge Layer · 0138 — E2.2 adaptador CUSTODY (custody_events).
-- D-E2.2-3: entidad principal = shipment (fallback robusto a packing_unit / id si shipment_id es NULL,
-- ya que ambas FK son nullable); packing_unit en payload. occurred_at del evento (hash-chain). visibility 'staff'.
-- Hardening completo.

create or replace function public.knowledge_custody_events_to_canonical(p public.custody_events)
returns public.knowledge_event_canonical
language sql stable set search_path = public, pg_temp
as $$
  select row(
    'custody.' || p.event_type::text,                                     -- event_type
    p.occurred_at,                                                        -- occurred_at
    case when p.actor_id is null then 'system' else 'user' end,           -- actor_kind
    p.actor_id,                                                           -- actor_id
    null,                                                                 -- actor_label
    case when p.shipment_id is not null then 'shipment'
         when p.packing_unit_id is not null then 'packing_unit'
         else 'custody_event' end,                                        -- entity_type (shipment primario)
    coalesce(p.shipment_id::text, p.packing_unit_id::text, p.id::text),   -- entity_id
    'custody ' || p.event_type::text || ' (' || p.stage::text || ')',     -- summary
    jsonb_build_object('stage', p.stage::text, 'packing_unit_id', p.packing_unit_id,
                       'shipment_id', p.shipment_id, 'chain_seq', p.chain_seq,
                       'evidence_sha256', p.evidence_sha256, 'row_hash', p.row_hash,
                       'notes', p.notes, 'geo_lat', p.geo_lat, 'geo_lng', p.geo_lng),  -- payload (auditoría)
    public.knowledge_visibility_for(
      case when p.shipment_id is not null then 'shipment'
           when p.packing_unit_id is not null then 'packing_unit'
           else 'custody_event' end,
      coalesce(p.shipment_id::text, p.packing_unit_id::text, p.id::text)),  -- visibility_key (-> 'staff')
    'custody_events',                                                     -- source_table
    p.id::text,                                                          -- source_pk
    null                                                                 -- correlation_id
  )::public.knowledge_event_canonical
$$;

create or replace function public.project_custody_events()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  begin
    if coalesce((select enabled from public.knowledge_sources where source_table='custody_events'), false) then
      perform public.knowledge_emit_event(public.knowledge_custody_events_to_canonical(NEW));
    end if;
  exception when others then
    raise log 'KnowledgeProjectFailed %', json_build_object(
      'component','project_custody_events','source_pk',NEW.id::text,'error',sqlerrm);
  end;
  return null;
end;
$$;

do $$ begin
  if to_regclass('public.custody_events') is not null then
    drop trigger if exists tg_project_custody_events on public.custody_events;
    create trigger tg_project_custody_events
      after insert on public.custody_events
      for each row execute function public.project_custody_events();
  end if;
end $$;

create or replace function public.knowledge_backfill_custody_events(p_limit int default null)
returns int language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.custody_events; v_id uuid; v_count int := 0; v_fail int := 0;
begin
  if to_regclass('public.custody_events') is null then return 0; end if;
  if not coalesce((select enabled from public.knowledge_sources where source_table='custody_events'), false) then return 0; end if;
  perform set_config('knowledge.correlation_id', gen_random_uuid()::text, true);
  for a in select * from public.custody_events order by occurred_at, id limit p_limit loop
    begin
      v_id := public.knowledge_emit_event(public.knowledge_custody_events_to_canonical(a));
      if v_id is not null then v_count := v_count + 1; end if;
    exception when others then
      v_fail := v_fail + 1;
      raise log 'KnowledgeBackfillRowFailed %', json_build_object(
        'component','knowledge_backfill_custody_events','source_pk',a.id::text,'error',sqlerrm);
    end;
  end loop;
  update public.knowledge_sources set last_backfill_at = now() where source_table='custody_events';
  raise log 'KnowledgeBackfillCustody %', json_build_object('materialized',v_count,'failed',v_fail);
  return v_count;
end;
$$;

insert into public.knowledge_sources (source_table, enabled, notes)
values ('custody_events', true, 'Fuente E2.2 — custody (timeline de cadena de custodia)')
on conflict (source_table) do nothing;

revoke all     on function public.knowledge_custody_events_to_canonical(public.custody_events) from public;
revoke execute on function public.knowledge_custody_events_to_canonical(public.custody_events) from anon, authenticated;
revoke all     on function public.project_custody_events() from public;
revoke execute on function public.project_custody_events() from anon, authenticated;
revoke all     on function public.knowledge_backfill_custody_events(int) from public;
revoke execute on function public.knowledge_backfill_custody_events(int) from anon, authenticated;
grant  execute on function public.knowledge_backfill_custody_events(int) to service_role;

select pg_notify('pgrst', 'reload schema');
