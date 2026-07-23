-- ENTREGADA — F0.5.2 Knowledge Layer · 0135 — E2.2 adaptador RECON (recon_events).
-- Patrón AuditLogAdapter (molde 0128): mapeo STABLE + trigger defensivo + backfill DRY + seed.
-- Emisión sincrónica 'processed' (no usa worker). Visibility 'staff' (default del CASE, D-E2.2-1).
-- Hardening H-E1-1 desde el inicio. 100% aditiva; emisor/worker/E1 intactos.

-- 1) Mapeo recon_events -> knowledge_event_canonical (STABLE, DRY).
create or replace function public.knowledge_recon_events_to_canonical(p public.recon_events)
returns public.knowledge_event_canonical
language sql stable set search_path = public, pg_temp
as $$
  select row(
    'recon.' || p.action,                                                 -- event_type
    p.ts,                                                                 -- occurred_at
    'user',                                                               -- actor_kind (user_id NOT NULL)
    p.user_id,                                                            -- actor_id
    null,                                                                 -- actor_label
    'reconciliation',                                                     -- entity_type
    p.reconciliation_id::text,                                            -- entity_id
    'reconciliation ' || p.action,                                        -- summary
    jsonb_build_object('from_status', p.from_status, 'to_status', p.to_status,
                       'note', p.note, 'meta', coalesce(p.meta, '{}'::jsonb)),  -- payload
    public.knowledge_visibility_for('reconciliation', p.reconciliation_id::text), -- visibility_key (-> 'staff')
    'recon_events',                                                       -- source_table
    p.id::text,                                                           -- source_pk
    null                                                                  -- correlation_id
  )::public.knowledge_event_canonical
$$;

-- 2) Trigger fn defensiva (SECDEF, gate enabled, jamás aborta la tx de negocio).
create or replace function public.project_recon_events()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  begin
    if coalesce((select enabled from public.knowledge_sources where source_table='recon_events'), false) then
      perform public.knowledge_emit_event(public.knowledge_recon_events_to_canonical(NEW));
    end if;
  exception when others then
    raise log 'KnowledgeProjectFailed %', json_build_object(
      'component','project_recon_events','source_pk',NEW.id::text,'error',sqlerrm);
  end;
  return null;
end;
$$;

-- 3) Trigger AFTER INSERT (guard to_regclass).
do $$ begin
  if to_regclass('public.recon_events') is not null then
    drop trigger if exists tg_project_recon_events on public.recon_events;
    create trigger tg_project_recon_events
      after insert on public.recon_events
      for each row execute function public.project_recon_events();
  end if;
end $$;

-- 4) Backfill (DRY, defensivo, EOL).
create or replace function public.knowledge_backfill_recon_events(p_limit int default null)
returns int language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.recon_events; v_id uuid; v_count int := 0; v_fail int := 0;
begin
  if to_regclass('public.recon_events') is null then return 0; end if;
  if not coalesce((select enabled from public.knowledge_sources where source_table='recon_events'), false) then return 0; end if;
  perform set_config('knowledge.correlation_id', gen_random_uuid()::text, true);
  for a in select * from public.recon_events order by id limit p_limit loop
    begin
      v_id := public.knowledge_emit_event(public.knowledge_recon_events_to_canonical(a));
      if v_id is not null then v_count := v_count + 1; end if;
    exception when others then
      v_fail := v_fail + 1;
      raise log 'KnowledgeBackfillRowFailed %', json_build_object(
        'component','knowledge_backfill_recon_events','source_pk',a.id::text,'error',sqlerrm);
    end;
  end loop;
  update public.knowledge_sources set last_backfill_at = now() where source_table='recon_events';
  raise log 'KnowledgeBackfillReconEvents %', json_build_object('materialized',v_count,'failed',v_fail);
  return v_count;
end;
$$;

-- 5) Seed en el Source Registry (enabled=true; recon no es PII).
insert into public.knowledge_sources (source_table, enabled, notes)
values ('recon_events', true, 'Fuente E2.2 — recon (timeline de conciliaciones)')
on conflict (source_table) do nothing;

-- 6) Hardening (H-E1-1).
-- Hardening completo (H-E1-1): revoke all from public (quita el grant default a PUBLIC)
-- + revoke execute from anon, authenticated (quita los grants directos de Supabase). AMBOS son necesarios.
revoke all     on function public.knowledge_backfill_recon_events(int) from public;
revoke execute on function public.knowledge_backfill_recon_events(int) from anon, authenticated;
grant  execute on function public.knowledge_backfill_recon_events(int) to service_role;
revoke all     on function public.project_recon_events() from public;
revoke execute on function public.project_recon_events() from anon, authenticated;
revoke all     on function public.knowledge_recon_events_to_canonical(public.recon_events) from public;
revoke execute on function public.knowledge_recon_events_to_canonical(public.recon_events) from anon, authenticated;

select pg_notify('pgrst', 'reload schema');
