-- ENTREGADA, NO APLICADA — F0.5.1 Knowledge Layer · Vistas de consumo (0111)
-- Verificar numeración contra prod arsksytgdnzukbmfgkju antes de aplicar.
-- v_knowledge_timeline + v_knowledge_entity_360, ambas security_invoker → respetan RLS del usuario que consulta.
-- v_knowledge_search DIFERIDA a F0.5.2 (depende de searchable_items poblado por orders).

-- =========================================================================
-- 1. v_knowledge_timeline
-- =========================================================================
create or replace view public.v_knowledge_timeline
with (security_invoker = true) as
select
  e.id, e.seq, e.event_type, e.occurred_at, e.ingested_at,
  e.actor_kind, e.actor_id, e.actor_label,
  e.entity_type, e.entity_id, e.summary, e.payload,
  e.visibility_key, e.source_table, e.correlation_id
from public.knowledge_events e
order by e.occurred_at desc, e.seq desc;

-- =========================================================================
-- 2. v_knowledge_entity_360
-- =========================================================================
create or replace view public.v_knowledge_entity_360
with (security_invoker = true) as
select
  e.entity_type, e.entity_id,
  e.id as event_id, e.seq, e.event_type, e.occurred_at,
  e.actor_kind, e.actor_label, e.summary, e.payload, e.visibility_key,
  a.id as annotation_id, a.concept_label, a.method as annotation_method,
  ke.label as concept_entity_label, ke.kind as concept_kind
from public.knowledge_events e
left join public.knowledge_annotations a
  on a.source_type = e.entity_type and a.source_id = e.entity_id
left join public.knowledge_entities ke
  on ke.id = a.entity_id
order by e.occurred_at desc, e.seq desc;

-- =========================================================================
-- 3. Realtime (idempotente)
-- =========================================================================
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'knowledge_events'
  ) then
    alter publication supabase_realtime add table public.knowledge_events;
  end if;
exception
  when undefined_object then null;  -- publicación inexistente (entorno no-Supabase)
end $$;

-- =========================================================================
-- 4. Cierre
-- =========================================================================
select pg_notify('pgrst', 'reload schema');
