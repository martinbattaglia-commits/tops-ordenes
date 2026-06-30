-- ENTREGADA — F0.5.2 Knowledge Layer · 0134 — E2.2 fundación: fix del sentinel '∅'.
-- create or replace del mapeo de audit_log (prereq #5): usa el id de la fila origen como
-- entity_id cuando audit_log.entity_id es NULL, en vez del símbolo '∅' (que colapsaba
-- identidades distintas en v_knowledge_entity_360). FORWARD-ONLY: knowledge_events es
-- append-only; las filas '∅' ya materializadas no se modifican (idempotencia por
-- source_table+source_pk+event_type, que no incluye entity_id). No toca el archivo 0128.
-- Idéntica al original salvo la línea del coalesce. STABLE (no SECDEF), conserva la ACL existente.

create or replace function public.knowledge_audit_log_to_canonical(p public.audit_log)
returns public.knowledge_event_canonical
language sql
stable
set search_path = public, pg_temp
as $$
  select row(
    'audit.' || p.action,                                          -- event_type
    p.ts,                                                          -- occurred_at
    case when p.user_id is null then 'system' else 'user' end,    -- actor_kind
    p.user_id,                                                    -- actor_id
    null,                                                         -- actor_label
    p.entity,                                                     -- entity_type
    coalesce(p.entity_id::text, p.id::text),                      -- entity_id (FIX: id como fallback, antes '∅')
    p.entity || ' ' || p.action,                                  -- summary
    coalesce(p.payload, '{}'::jsonb),                             -- payload
    public.knowledge_visibility_for(p.entity, p.entity_id::text), -- visibility_key
    'audit_log',                                                  -- source_table
    p.id::text,                                                   -- source_pk
    null                                                          -- correlation_id
  )::public.knowledge_event_canonical
$$;

select pg_notify('pgrst', 'reload schema');
