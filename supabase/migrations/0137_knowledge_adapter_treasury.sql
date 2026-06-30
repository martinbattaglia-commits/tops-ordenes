-- ENTREGADA — F0.5.2 Knowledge Layer · 0137 — E2.2 adaptador TESORERÍA (treasury_movements).
-- Tabla de estado → proyecta en INSERT (creación del movimiento). entity_type='treasury_movement'
-- (D-E2.2-2). PAYLOAD MÍNIMO: SIN amount (dato sensible). visibility 'staff'. Hardening completo.

create or replace function public.knowledge_treasury_movements_to_canonical(p public.treasury_movements)
returns public.knowledge_event_canonical
language sql stable set search_path = public, pg_temp
as $$
  select row(
    'treasury.' || p.type::text,                                          -- event_type
    p.created_at,                                                         -- occurred_at
    case when p.created_by is null then 'system' else 'user' end,        -- actor_kind
    p.created_by,                                                        -- actor_id
    null,                                                                -- actor_label
    'treasury_movement',                                                 -- entity_type
    p.id::text,                                                          -- entity_id
    'treasury ' || p.type::text || ' ' || p.public_id,                   -- summary
    jsonb_build_object('type', p.type::text, 'direction', p.direction::text,
                       'status', p.status::text, 'public_id', p.public_id,
                       'reference_type', p.reference_type),              -- payload (SIN amount)
    public.knowledge_visibility_for('treasury_movement', p.id::text),    -- visibility_key (-> 'staff')
    'treasury_movements',                                                -- source_table
    p.id::text,                                                          -- source_pk
    null                                                                 -- correlation_id
  )::public.knowledge_event_canonical
$$;

create or replace function public.project_treasury_movements()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  begin
    if coalesce((select enabled from public.knowledge_sources where source_table='treasury_movements'), false) then
      perform public.knowledge_emit_event(public.knowledge_treasury_movements_to_canonical(NEW));
    end if;
  exception when others then
    raise log 'KnowledgeProjectFailed %', json_build_object(
      'component','project_treasury_movements','source_pk',NEW.id::text,'error',sqlerrm);
  end;
  return null;
end;
$$;

do $$ begin
  if to_regclass('public.treasury_movements') is not null then
    drop trigger if exists tg_project_treasury_movements on public.treasury_movements;
    create trigger tg_project_treasury_movements
      after insert on public.treasury_movements
      for each row execute function public.project_treasury_movements();
  end if;
end $$;

create or replace function public.knowledge_backfill_treasury_movements(p_limit int default null)
returns int language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.treasury_movements; v_id uuid; v_count int := 0; v_fail int := 0;
begin
  if to_regclass('public.treasury_movements') is null then return 0; end if;
  if not coalesce((select enabled from public.knowledge_sources where source_table='treasury_movements'), false) then return 0; end if;
  perform set_config('knowledge.correlation_id', gen_random_uuid()::text, true);
  for a in select * from public.treasury_movements order by created_at, id limit p_limit loop
    begin
      v_id := public.knowledge_emit_event(public.knowledge_treasury_movements_to_canonical(a));
      if v_id is not null then v_count := v_count + 1; end if;
    exception when others then
      v_fail := v_fail + 1;
      raise log 'KnowledgeBackfillRowFailed %', json_build_object(
        'component','knowledge_backfill_treasury_movements','source_pk',a.id::text,'error',sqlerrm);
    end;
  end loop;
  update public.knowledge_sources set last_backfill_at = now() where source_table='treasury_movements';
  raise log 'KnowledgeBackfillTreasury %', json_build_object('materialized',v_count,'failed',v_fail);
  return v_count;
end;
$$;

insert into public.knowledge_sources (source_table, enabled, notes)
values ('treasury_movements', true, 'Fuente E2.2 — tesorería (timeline de movimientos, payload sin monto)')
on conflict (source_table) do nothing;

revoke all     on function public.knowledge_treasury_movements_to_canonical(public.treasury_movements) from public;
revoke execute on function public.knowledge_treasury_movements_to_canonical(public.treasury_movements) from anon, authenticated;
revoke all     on function public.project_treasury_movements() from public;
revoke execute on function public.project_treasury_movements() from anon, authenticated;
revoke all     on function public.knowledge_backfill_treasury_movements(int) from public;
revoke execute on function public.knowledge_backfill_treasury_movements(int) from anon, authenticated;
grant  execute on function public.knowledge_backfill_treasury_movements(int) to service_role;

select pg_notify('pgrst', 'reload schema');
