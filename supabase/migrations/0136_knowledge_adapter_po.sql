-- ENTREGADA — F0.5.2 Knowledge Layer · 0136 — E2.2 adaptador COMPRAS/PO (po_events).
-- Patrón AuditLogAdapter. Emisión 'processed'. entity_type='purchase_order' (CASE -> 'staff', D-1).
-- knowledge_nodes (grafo) DIFERIDO (D-E2.2-5). Hardening completo (revoke from public + anon/authenticated).

create or replace function public.knowledge_po_events_to_canonical(p public.po_events)
returns public.knowledge_event_canonical
language sql stable set search_path = public, pg_temp
as $$
  select row(
    'po.' || p.kind::text,                                                 -- event_type
    p.ts,                                                                  -- occurred_at
    case
      when p.actor ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then 'user'
      when p.actor is null or p.actor ilike 'system%' then 'system'
      else 'integration'
    end,                                                                   -- actor_kind
    case when p.actor ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         then p.actor::uuid else null end,                                 -- actor_id
    coalesce(p.actor_email, p.actor),                                      -- actor_label
    'purchase_order',                                                      -- entity_type
    p.order_id::text,                                                      -- entity_id
    'purchase_order ' || p.kind::text,                                     -- summary
    coalesce(p.meta, '{}'::jsonb),                                         -- payload (minimal; sin ip)
    public.knowledge_visibility_for('purchase_order', p.order_id::text),   -- visibility_key (-> 'staff')
    'po_events',                                                           -- source_table
    p.id::text,                                                            -- source_pk
    null                                                                   -- correlation_id
  )::public.knowledge_event_canonical
$$;

create or replace function public.project_po_events()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  begin
    if coalesce((select enabled from public.knowledge_sources where source_table='po_events'), false) then
      perform public.knowledge_emit_event(public.knowledge_po_events_to_canonical(NEW));
    end if;
  exception when others then
    raise log 'KnowledgeProjectFailed %', json_build_object(
      'component','project_po_events','source_pk',NEW.id::text,'error',sqlerrm);
  end;
  return null;
end;
$$;

do $$ begin
  if to_regclass('public.po_events') is not null then
    drop trigger if exists tg_project_po_events on public.po_events;
    create trigger tg_project_po_events
      after insert on public.po_events
      for each row execute function public.project_po_events();
  end if;
end $$;

create or replace function public.knowledge_backfill_po_events(p_limit int default null)
returns int language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.po_events; v_id uuid; v_count int := 0; v_fail int := 0;
begin
  if to_regclass('public.po_events') is null then return 0; end if;
  if not coalesce((select enabled from public.knowledge_sources where source_table='po_events'), false) then return 0; end if;
  perform set_config('knowledge.correlation_id', gen_random_uuid()::text, true);
  for a in select * from public.po_events order by id limit p_limit loop
    begin
      v_id := public.knowledge_emit_event(public.knowledge_po_events_to_canonical(a));
      if v_id is not null then v_count := v_count + 1; end if;
    exception when others then
      v_fail := v_fail + 1;
      raise log 'KnowledgeBackfillRowFailed %', json_build_object(
        'component','knowledge_backfill_po_events','source_pk',a.id::text,'error',sqlerrm);
    end;
  end loop;
  update public.knowledge_sources set last_backfill_at = now() where source_table='po_events';
  raise log 'KnowledgeBackfillPoEvents %', json_build_object('materialized',v_count,'failed',v_fail);
  return v_count;
end;
$$;

insert into public.knowledge_sources (source_table, enabled, notes)
values ('po_events', true, 'Fuente E2.2 — compras/OC (timeline de órdenes de compra)')
on conflict (source_table) do nothing;

-- Hardening completo (H-E1-1): revoke from public + anon/authenticated en las 3 funciones.
revoke all     on function public.knowledge_po_events_to_canonical(public.po_events) from public;
revoke execute on function public.knowledge_po_events_to_canonical(public.po_events) from anon, authenticated;
revoke all     on function public.project_po_events() from public;
revoke execute on function public.project_po_events() from anon, authenticated;
revoke all     on function public.knowledge_backfill_po_events(int) from public;
revoke execute on function public.knowledge_backfill_po_events(int) from anon, authenticated;
grant  execute on function public.knowledge_backfill_po_events(int) to service_role;

select pg_notify('pgrst', 'reload schema');
