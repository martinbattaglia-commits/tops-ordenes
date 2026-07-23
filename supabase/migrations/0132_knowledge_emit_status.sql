-- ENTREGADA — F0.5.2 Knowledge Layer · 0132 — E2.0: p_status en el emisor + índice de timeline.
-- 100% ADITIVA. knowledge_event_canonical NO cambia. Contratos de lectura intactos.
-- La firma de knowledge_emit_event crece por el final (p_status text default 'processed');
-- se DROPea el overload de 1 arg para que exista UNA sola función (sin ambigüedad de overload, RE2-1):
-- las llamadas legacy de 1 arg (trigger/backfill de audit_log) resuelven contra la nueva usando el default.
-- Hardening H-E1-1: revoke explícito anon/authenticated. Idempotente.

-- 1) Emisor con p_status (default 'processed' => backward-compatible).
create or replace function public.knowledge_emit_event(
  p_event  public.knowledge_event_canonical,
  p_status text default 'processed'
)
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
  if p_event.event_type is null
     or p_event.occurred_at is null
     or p_event.entity_type is null
     or p_event.entity_id is null
     or p_event.visibility_key is null
     or p_event.source_table is null then
    raise exception using errcode = '23502',
      message = 'knowledge_emit_event: contrato inválido (campo obligatorio nulo)';
  end if;

  if p_status not in ('pending','processing','processed','failed','dead') then
    raise exception using errcode = '22023',
      message = 'knowledge_emit_event: p_status inválido (' || coalesce(p_status,'<null>') || ')';
  end if;

  v_actor_kind := coalesce(p_event.actor_kind, 'system');
  v_payload    := coalesce(p_event.payload, '{}'::jsonb);
  v_corr := coalesce(p_event.correlation_id, nullif(current_setting('knowledge.correlation_id', true), ''));

  insert into public.knowledge_events (
    event_type, occurred_at, actor_kind, actor_id, actor_label,
    entity_type, entity_id, summary, payload, visibility_key,
    source_table, source_pk, correlation_id, status
  ) values (
    p_event.event_type, p_event.occurred_at, v_actor_kind, p_event.actor_id, p_event.actor_label,
    p_event.entity_type, p_event.entity_id, p_event.summary, v_payload, p_event.visibility_key,
    p_event.source_table, p_event.source_pk, v_corr, p_status
  )
  on conflict (source_table, source_pk, event_type) do nothing
  returning id into v_id;

  raise log 'KnowledgeEmit %', json_build_object(
    'component', 'knowledge_emit_event',
    'source_table', p_event.source_table,
    'event_type', p_event.event_type,
    'entity_type', p_event.entity_type,
    'status', case when v_id is null then 'skipped_duplicate' else p_status end,
    'correlation_id', v_corr
  );

  return v_id;
end;
$$;

-- Hardening (H-E1-1) sobre la firma de 2 args.
revoke all     on function public.knowledge_emit_event(public.knowledge_event_canonical, text) from public;
revoke execute on function public.knowledge_emit_event(public.knowledge_event_canonical, text) from anon, authenticated;
grant  execute on function public.knowledge_emit_event(public.knowledge_event_canonical, text) to service_role;

-- 2) Eliminar el overload de 1 arg: queda una sola función (la de 2 args con default).
--    Las llamadas legacy de 1 arg resuelven contra la nueva usando el default 'processed'.
drop function if exists public.knowledge_emit_event(public.knowledge_event_canonical);

-- 3) Índice de timeline (prereq #4): home ordena por seq desc sobre eventos 'processed'.
create index if not exists knowledge_events_timeline_idx
  on public.knowledge_events (status, seq desc)
  where status = 'processed';

-- 4) PostgREST: refrescar caché de esquema.
select pg_notify('pgrst', 'reload schema');
