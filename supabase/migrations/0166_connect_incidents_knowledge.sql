-- 0166_connect_incidents_knowledge.sql — Nexus Link F4.2 · adapter Knowledge (Incidentes).
-- ENTREGADA, NO APLICADA (G3). Aplicar a mano en el SQL Editor de prod (arsksytgdnzukbmfgkju).
-- ─────────────────────────────────────────────────────────────────────────
-- Connect Incidents como FUENTE de knowledge_events (patrón AuditLogAdapter,
-- molde 0135/0149). UNIDIRECCIONAL (SoR→SoK). Eventos alto-valor / bajo-ruido:
--   · connect.incident.opened   (INSERT)
--   · connect.incident.resolved (UPDATE estado → 'resuelto')
-- NO emite por cambio de asignación/severidad/estados intermedios (viven en
-- audit_log). Idempotencia natural: knowledge_events_idem_uq
-- (source_table, source_pk, event_type) — re-resolución tras reapertura NO
-- re-emite (deduplicada; decisión de bajo-ruido, documentada).
--
-- ⚠️ D5 RATIFICADA: el adapter queda PREPARADO pero APAGADO —
-- knowledge_sources.enabled = FALSE. Cero emisión hasta que Dirección active en
-- piloto con:  update knowledge_sources set enabled = true
--              where source_table = 'connect_incidents';
-- (+ opcional backfill vía service_role: select knowledge_backfill_connect_incidents();)
-- NO toca Knowledge drain, NO depende del scheduler (la emisión, si se activa,
-- es síncrona en la tx del incidente, defensiva y jamás aborta la tx origen).
--
-- visibility_key = 'staff' (incidentes son internos; no heredan de entidad ERP).
-- payload = IDs/estados, SIN texto libre (ni titulo ni resolucion_text).
-- IDEMPOTENTE. DEPENDE de: 0164 (tabla) + Knowledge en prod (0125-0140).
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Mapeo connect_incidents -> knowledge_event_canonical (STABLE, DRY).
create or replace function public.knowledge_connect_incidents_to_canonical(
  p public.connect_incidents,
  p_event_type text
) returns public.knowledge_event_canonical
language sql stable set search_path = public, pg_temp
as $$
  select row(
    p_event_type,                                                    -- event_type
    case when p_event_type = 'connect.incident.resolved'
         then coalesce(p.resuelto_at, p.updated_at)
         else p.created_at end,                                      -- occurred_at
    case when auth.uid() is not null then 'user' else 'system' end,  -- actor_kind
    auth.uid(),                                                      -- actor_id
    null,                                                            -- actor_label
    'connect_incident',                                              -- entity_type
    p.id::text,                                                      -- entity_id
    'Incidente ' || coalesce(p.public_id, p.id::text) ||
      case when p_event_type = 'connect.incident.resolved'
           then ' resuelto' else ' abierto' end,                     -- summary (sin texto libre)
    jsonb_build_object(
      'incident_id', p.id,
      'public_id', p.public_id,
      'estado', p.estado,
      'severidad', p.severidad,
      'sector', p.sector,
      'conversation_id', p.conversation_id,
      'context_id', (select cc.context_id from public.connect_conversations cc
                      where cc.id = p.conversation_id)
    ),                                                               -- payload (IDs/estados; SIN titulo/resolucion)
    'staff',                                                         -- visibility_key (interno)
    'connect_incidents',                                             -- source_table
    p.id::text,                                                      -- source_pk (idem_uq incluye event_type)
    null                                                             -- correlation_id (GUC)
  )::public.knowledge_event_canonical
$$;

-- 2) Trigger fn defensiva (SECDEF, gate enabled=FALSE por D5, jamás aborta la tx).
create or replace function public.project_connect_incidents()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  begin
    if coalesce((select enabled from public.knowledge_sources
                  where source_table = 'connect_incidents'), false) then
      if tg_op = 'INSERT' then
        perform public.knowledge_emit_event(
          public.knowledge_connect_incidents_to_canonical(NEW, 'connect.incident.opened'));
      elsif tg_op = 'UPDATE' and NEW.estado = 'resuelto' and OLD.estado is distinct from 'resuelto' then
        perform public.knowledge_emit_event(
          public.knowledge_connect_incidents_to_canonical(NEW, 'connect.incident.resolved'));
      end if;
    end if;
  exception when others then
    raise log 'KnowledgeProjectFailed %', json_build_object(
      'component','project_connect_incidents','source_pk',NEW.id::text,'error',sqlerrm);
  end;
  return null;
end;
$$;

-- 3) Triggers AFTER (guard to_regclass).
do $$ begin
  if to_regclass('public.connect_incidents') is not null then
    drop trigger if exists tg_project_connect_incidents on public.connect_incidents;
    create trigger tg_project_connect_incidents
      after insert or update of estado on public.connect_incidents
      for each row execute function public.project_connect_incidents();
  end if;
end $$;

-- 4) Backfill (DRY, defensivo, EOL). Solo corre con la fuente HABILITADA.
create or replace function public.knowledge_backfill_connect_incidents(p_limit int default null)
returns int language plpgsql security definer set search_path = public, pg_temp
as $$
declare a public.connect_incidents; v_id uuid; v_count int := 0; v_fail int := 0;
begin
  if to_regclass('public.connect_incidents') is null then return 0; end if;
  if not coalesce((select enabled from public.knowledge_sources
                    where source_table = 'connect_incidents'), false) then return 0; end if;
  perform set_config('knowledge.correlation_id', gen_random_uuid()::text, true);
  for a in select * from public.connect_incidents order by created_at limit p_limit loop
    begin
      v_id := public.knowledge_emit_event(
        public.knowledge_connect_incidents_to_canonical(a, 'connect.incident.opened'));
      if v_id is not null then v_count := v_count + 1; end if;
      if a.estado in ('resuelto','cerrado') and a.resuelto_at is not null then
        v_id := public.knowledge_emit_event(
          public.knowledge_connect_incidents_to_canonical(a, 'connect.incident.resolved'));
        if v_id is not null then v_count := v_count + 1; end if;
      end if;
    exception when others then
      v_fail := v_fail + 1;
      raise log 'KnowledgeBackfillRowFailed %', json_build_object(
        'component','knowledge_backfill_connect_incidents','source_pk',a.id::text,'error',sqlerrm);
    end;
  end loop;
  update public.knowledge_sources set last_backfill_at = now()
   where source_table = 'connect_incidents';
  raise log 'KnowledgeBackfillConnectIncidents %', json_build_object('materialized',v_count,'failed',v_fail);
  return v_count;
end;
$$;

-- 5) Seed en el Source Registry — APAGADO (D5: activar recién en piloto, decisión Dirección).
insert into public.knowledge_sources (source_table, enabled, notes)
values ('connect_incidents', false,
        'Fuente F4.2 — Centro de Incidentes (opened/resolved). DESHABILITADA por D5: activar en piloto con update enabled=true (+ backfill opcional).')
on conflict (source_table) do nothing;

-- 6) Hardening (H-E1-1).
revoke all     on function public.knowledge_backfill_connect_incidents(int) from public;
revoke execute on function public.knowledge_backfill_connect_incidents(int) from anon, authenticated;
grant  execute on function public.knowledge_backfill_connect_incidents(int) to service_role;
revoke all     on function public.project_connect_incidents() from public;
revoke execute on function public.project_connect_incidents() from anon, authenticated;
revoke all     on function public.knowledge_connect_incidents_to_canonical(public.connect_incidents, text) from public;
revoke execute on function public.knowledge_connect_incidents_to_canonical(public.connect_incidents, text) from anon, authenticated;

select pg_notify('pgrst', 'reload schema');
