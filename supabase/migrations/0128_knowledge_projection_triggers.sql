-- ENTREGADA, NO APLICADA — F0.5.1 Knowledge Layer · AuditLogAdapter (0128)
-- Verificar numeración contra prod arsksytgdnzukbmfgkju antes de aplicar.
-- Toda la lógica de la fuente audit_log (Opción A): mapeo único + trigger + backfill + registro.
-- NO inserta directo en knowledge_events: construye KnowledgeEventCanonical y llama a knowledge_emit_event (R-A).
-- Trigger defensivo (exception when others) — jamás aborta la tx de negocio (G11).

-- =========================================================================
-- 1) Registro de la fuente en el Source Registry (idempotente)
-- =========================================================================
insert into public.knowledge_sources (source_table, enabled, notes)
values ('audit_log', true, 'Fuente #1 — F0.5.1 timeline (AuditLogAdapter)')
on conflict (source_table) do nothing;

-- =========================================================================
-- 2) Mapeo ÚNICO audit_log -> KnowledgeEventCanonical (DRY: 1 sola definición,
--    reutilizada por el trigger y por el backfill). Determinístico/STABLE.
--    Columnas reales de public.audit_log (0001:154): id, ts, user_id, entity,
--    entity_id, action, payload (ip se ignora por diseño).
-- =========================================================================
create or replace function public.knowledge_audit_log_to_canonical(p public.audit_log)
returns public.knowledge_event_canonical
language sql
stable
set search_path = public, pg_temp
as $$
  select row(
    'audit.' || p.action,                                                 -- event_type
    p.ts,                                                                 -- occurred_at
    case when p.user_id is null then 'system' else 'user' end,           -- actor_kind
    p.user_id,                                                           -- actor_id
    null,                                                                -- actor_label
    p.entity,                                                            -- entity_type
    coalesce(p.entity_id::text, '∅'),                                    -- entity_id
    p.entity || ' ' || p.action,                                         -- summary
    coalesce(p.payload, '{}'::jsonb),                                    -- payload
    public.knowledge_visibility_for(p.entity, p.entity_id::text),        -- visibility_key
    'audit_log',                                                         -- source_table
    p.id::text,                                                          -- source_pk
    null                                                                 -- correlation_id (lo resuelve el emisor)
  )::public.knowledge_event_canonical
$$;

-- =========================================================================
-- 3) Trigger function: proyecta cada fila nueva de audit_log vía el emisor.
--    DEFENSIVA (G11): jamás propaga error; nunca aborta la tx de negocio.
-- =========================================================================
create or replace function public.project_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    if coalesce((select enabled from public.knowledge_sources where source_table = 'audit_log'), false) then
      perform public.knowledge_emit_event(public.knowledge_audit_log_to_canonical(NEW));
    end if;
  exception when others then
    raise log 'KnowledgeProjectFailed %', json_build_object(
      'component', 'project_audit_log',
      'source_pk', NEW.id::text,
      'error', sqlerrm
    );
  end;
  return null;  -- AFTER trigger: el valor de retorno se ignora.
end;
$$;

-- =========================================================================
-- 4) Trigger AFTER INSERT (idempotente, con guard to_regclass)
-- =========================================================================
do $$ begin
  if to_regclass('public.audit_log') is not null then
    drop trigger if exists tg_project_audit_log on public.audit_log;
    create trigger tg_project_audit_log
      after insert on public.audit_log
      for each row execute function public.project_audit_log();
  end if;
end $$;

-- =========================================================================
-- 5) Backfill (vía emisor, idempotente, defensivo, EOL audit).
--    Reutiliza el MISMO mapeo (DRY). correlation_id por lote (R-C/EOL).
-- =========================================================================
create or replace function public.knowledge_backfill_audit_log(p_limit int default null)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a       public.audit_log;
  v_id    uuid;
  v_count int := 0;
  v_fail  int := 0;
begin
  -- Guard de existencia de la fuente.
  if to_regclass('public.audit_log') is null then
    return 0;
  end if;

  -- Gate por habilitación en el Source Registry.
  if not coalesce((select enabled from public.knowledge_sources where source_table = 'audit_log'), false) then
    return 0;
  end if;

  -- correlation_id por lote (R-C/EOL): el emisor lo lee desde la GUC.
  perform set_config('knowledge.correlation_id', gen_random_uuid()::text, true);

  -- Recorrido determinístico por id; defensivo per-fila (no aborta el lote).
  for a in
    select * from public.audit_log order by id limit p_limit
  loop
    begin
      v_id := public.knowledge_emit_event(public.knowledge_audit_log_to_canonical(a));
      if v_id is not null then
        v_count := v_count + 1;  -- materializado (no duplicado).
      end if;
    exception when others then
      v_fail := v_fail + 1;
      raise log 'KnowledgeBackfillRowFailed %', json_build_object(
        'component', 'knowledge_backfill_audit_log',
        'source_pk', a.id::text,
        'error', sqlerrm
      );
    end;
  end loop;

  update public.knowledge_sources
     set last_backfill_at = now()
   where source_table = 'audit_log';

  -- EOL audit del lote completo.
  raise log 'KnowledgeBackfillAuditLog %', json_build_object(
    'component', 'knowledge_backfill_audit_log',
    'limit', p_limit,
    'materialized', v_count,
    'failed', v_fail,
    'correlation_id', current_setting('knowledge.correlation_id', true)
  );

  return v_count;
end;
$$;

revoke all on function public.knowledge_backfill_audit_log(int) from public;
grant execute on function public.knowledge_backfill_audit_log(int) to service_role;

-- =========================================================================
-- 6) Recargar el cache de esquema de PostgREST.
-- =========================================================================
select pg_notify('pgrst', 'reload schema');
