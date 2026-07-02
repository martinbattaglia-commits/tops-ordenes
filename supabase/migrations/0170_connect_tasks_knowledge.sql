-- 0170_connect_tasks_knowledge.sql — Nexus Link F4.3D · adapter Knowledge (Tareas).
-- ENTREGADA, NO APLICADA (G3). Aplicar a mano en el SQL Editor de prod (arsksytgdnzukbmfgkju).
-- ─────────────────────────────────────────────────────────────────────────
-- Tareas como FUENTE de knowledge_events (molde 0149/0166). Eventos alto-valor:
--   · connect.task.created   (INSERT)
--   · connect.task.completed (UPDATE estado → 'completada')
-- Idempotencia natural: knowledge_events_idem_uq (source_table, source_pk,
-- event_type) — re-completar tras reapertura NO re-emite (bajo-ruido documentado).
--
-- ⚠️ D-F43-9 RATIFICADA: PREPARADO pero APAGADO (knowledge_sources.enabled=FALSE).
-- Activación futura (piloto, decisión Dirección):
--   update knowledge_sources set enabled = true where source_table = 'connect_tasks';
--   (+ backfill opcional service_role: select knowledge_backfill_connect_tasks();)
-- NO toca Knowledge drain, NO depende del scheduler (emisión síncrona defensiva
-- en la tx origen, jamás la aborta). visibility_key='staff'.
-- Payload = IDs/estados, SIN titulo/descripcion/motivo (texto libre bajo RLS).
-- IDEMPOTENTE. DEPENDE de: 0168 (tabla) + Knowledge en prod (0125-0140).
-- Rollback: ROLLBACK_0167_0170.md.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Mapeo connect_tasks -> knowledge_event_canonical (STABLE, DRY).
create or replace function public.knowledge_connect_tasks_to_canonical(
  p public.connect_tasks,
  p_event_type text
) returns public.knowledge_event_canonical
language sql stable set search_path = public, pg_temp
as $$
  select row(
    p_event_type,                                                    -- event_type
    case when p_event_type = 'connect.task.completed'
         then coalesce(p.completed_at, p.updated_at)
         else p.created_at end,                                      -- occurred_at
    case when auth.uid() is not null then 'user' else 'system' end,  -- actor_kind
    auth.uid(),                                                      -- actor_id
    null,                                                            -- actor_label
    'connect_task',                                                  -- entity_type
    p.id::text,                                                      -- entity_id
    'Tarea ' || coalesce(p.public_id, p.id::text) ||
      case when p_event_type = 'connect.task.completed'
           then ' completada' else ' creada' end,                    -- summary (sin texto libre)
    jsonb_build_object(
      'task_id', p.id,
      'public_id', p.public_id,
      'estado', p.estado,
      'prioridad', p.prioridad,
      'incident_id', p.incident_id,
      'workflow_instance_id', p.workflow_instance_id,
      'step_no', p.step_no,
      'conversation_id', p.conversation_id,
      'context_id', (select cc.context_id from public.connect_conversations cc
                      where cc.id = p.conversation_id)
    ),                                                               -- payload (IDs/estados; context_id = contrato 0149/0166)
    'staff',                                                         -- visibility_key (interno)
    'connect_tasks',                                                 -- source_table
    p.id::text,                                                      -- source_pk (idem_uq incluye event_type)
    null                                                             -- correlation_id (GUC)
  )::public.knowledge_event_canonical
$$;

-- 2) Trigger fn defensiva (gate enabled=FALSE por D-F43-9, jamás aborta la tx).
create or replace function public.project_connect_tasks()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  begin
    if coalesce((select enabled from public.knowledge_sources
                  where source_table = 'connect_tasks'), false) then
      if tg_op = 'INSERT' then
        perform public.knowledge_emit_event(
          public.knowledge_connect_tasks_to_canonical(NEW, 'connect.task.created'));
      elsif tg_op = 'UPDATE' and NEW.estado = 'completada' and OLD.estado is distinct from 'completada' then
        perform public.knowledge_emit_event(
          public.knowledge_connect_tasks_to_canonical(NEW, 'connect.task.completed'));
      end if;
    end if;
  exception when others then
    raise log 'KnowledgeProjectFailed %', json_build_object(
      'component','project_connect_tasks','source_pk',NEW.id::text,'error',sqlerrm);
  end;
  return null;
end;
$$;

-- 3) Trigger AFTER (guard to_regclass).
do $$ begin
  if to_regclass('public.connect_tasks') is not null then
    drop trigger if exists tg_project_connect_tasks on public.connect_tasks;
    create trigger tg_project_connect_tasks
      after insert or update of estado on public.connect_tasks
      for each row execute function public.project_connect_tasks();
  end if;
end $$;

-- 4) Backfill (DRY, defensivo). Solo corre con la fuente HABILITADA.
create or replace function public.knowledge_backfill_connect_tasks(p_limit int default null)
returns int language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.connect_tasks; v_id uuid; v_count int := 0; v_fail int := 0;
begin
  if to_regclass('public.connect_tasks') is null then return 0; end if;
  if not coalesce((select enabled from public.knowledge_sources
                    where source_table = 'connect_tasks'), false) then return 0; end if;
  perform set_config('knowledge.correlation_id', gen_random_uuid()::text, true);
  for a in select * from public.connect_tasks order by created_at limit p_limit loop
    begin
      v_id := public.knowledge_emit_event(
        public.knowledge_connect_tasks_to_canonical(a, 'connect.task.created'));
      if v_id is not null then v_count := v_count + 1; end if;
      if a.estado = 'completada' and a.completed_at is not null then
        v_id := public.knowledge_emit_event(
          public.knowledge_connect_tasks_to_canonical(a, 'connect.task.completed'));
        if v_id is not null then v_count := v_count + 1; end if;
      end if;
    exception when others then
      v_fail := v_fail + 1;
      raise log 'KnowledgeBackfillRowFailed %', json_build_object(
        'component','knowledge_backfill_connect_tasks','source_pk',a.id::text,'error',sqlerrm);
    end;
  end loop;
  update public.knowledge_sources set last_backfill_at = now()
   where source_table = 'connect_tasks';
  raise log 'KnowledgeBackfillConnectTasks %', json_build_object('materialized',v_count,'failed',v_fail);
  return v_count;
end;
$$;

-- 5) Seed en el Source Registry — APAGADO (D-F43-9).
insert into public.knowledge_sources (source_table, enabled, notes)
values ('connect_tasks', false,
        'Fuente F4.3 — Tareas colaborativas (created/completed). DESHABILITADA por D-F43-9: activar en piloto con update enabled=true (+ backfill opcional).')
on conflict (source_table) do nothing;

-- 6) Hardening (H-E1-1).
revoke all     on function public.knowledge_backfill_connect_tasks(int) from public;
revoke execute on function public.knowledge_backfill_connect_tasks(int) from anon, authenticated;
grant  execute on function public.knowledge_backfill_connect_tasks(int) to service_role;
revoke all     on function public.project_connect_tasks() from public;
revoke execute on function public.project_connect_tasks() from anon, authenticated;
revoke all     on function public.knowledge_connect_tasks_to_canonical(public.connect_tasks, text) from public;
revoke execute on function public.knowledge_connect_tasks_to_canonical(public.connect_tasks, text) from anon, authenticated;

select pg_notify('pgrst', 'reload schema');
