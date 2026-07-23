-- 0156_fix_connect_search_ambiguous_conversation_id.sql — Nexus Link F3 · HOTFIX búsqueda.
-- ENTREGADA, NO APLICADA. Corrige F-SEARCH detectado en el smoke del piloto (2026-07-01).
-- ─────────────────────────────────────────────────────────────────────────
-- BUG: connect_search(text,int) lanzaba en TODA ejecución:
--   ERROR 42703/42702: column reference "conversation_id" is ambiguous
--   (colisión entre la columna OUT `conversation_id` del RETURNS TABLE y las
--    referencias NO calificadas `select conversation_id from my_convs`).
--   Efecto: la búsqueda global fallaba SIEMPRE (todos los usuarios); la UI lo
--   mostraba como "sin resultados" (enmascaraba la excepción).
-- FIX (quirúrgico): calificar las 4 subqueries con alias explícito `mc`
--   (`select mc.conversation_id from my_convs mc`). NO cambia firma pública,
--   RETURNS TABLE, lógica, permisos, SECDEF ni search_path. Idéntica a 0153
--   salvo la calificación. CREATE OR REPLACE preserva owner (postgres) y ACL.
-- Idempotente (CREATE OR REPLACE). Reversible: re-aplicar 0153 restaura el
--   estado previo (búsqueda rota, no peor que antes del hotfix).
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.connect_search(p_query text, p_limit int default 30)
returns table (
  result_type     text,    -- 'conversation' | 'erp_context' | 'message' | 'attachment'
  conversation_id uuid,
  context_id      text,
  kind            text,
  title           text,
  snippet         text,
  entity_type     text,
  entity_ref      text,
  occurred_at     timestamptz,
  sort_rank       int
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_q   tsquery;
  v_like text;
  v_lim int := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  -- Guard fail-closed (P-1): permiso explícito.
  if not public.has_permission('connect.view') then
    raise exception 'Sin permiso connect.view' using errcode = 'insufficient_privilege';
  end if;
  if p_query is null or length(btrim(p_query)) = 0 then
    return;
  end if;
  v_like := '%' || btrim(p_query) || '%';
  v_q := websearch_to_tsquery('spanish', p_query);

  return query
  with my_convs as (
    select p.conversation_id from public.connect_participants p where p.profile_id = v_uid
  )
  -- 1) Conversaciones (dm/group/channel): miembro, o canal público discoverable.
  select 'conversation'::text, c.id, c.context_id, c.kind::text,
         coalesce(c.title, c.slug, 'Conversación')::text,
         c.topic, null::text, null::text, c.last_message_at, 1
    from public.connect_conversations c
   where c.kind in ('dm','group','channel')
     and c.archived_at is null
     and (c.id in (select mc.conversation_id from my_convs mc)
          or (c.kind = 'channel' and c.visibility = 'public'))
     and (c.title ilike v_like or c.topic ilike v_like or c.slug ilike v_like or c.context_id ilike v_like)
  union all
  -- 2) Contextos ERP (kind erp) + entidad vinculada: solo miembro.
  select 'erp_context'::text, c.id, c.context_id, c.kind::text,
         coalesce(c.title, 'Contexto ERP')::text,
         c.topic, l.entity_type, coalesce(l.entity_id::text, l.entity_id_text), c.last_message_at, 2
    from public.connect_conversations c
    join public.connect_conversation_links l on l.conversation_id = c.id
   where c.kind = 'erp'
     and c.id in (select mc.conversation_id from my_convs mc)
     and (c.title ilike v_like or c.context_id ilike v_like or l.entity_type ilike v_like
          or l.entity_id_text ilike v_like)
  union all
  -- 3) Mensajes: FTS español indexada sobre body; solo en conversaciones donde soy miembro.
  select 'message'::text, m.conversation_id, c.context_id, c.kind::text,
         coalesce(c.title, c.slug, 'Mensaje')::text,
         left(m.body, 180), null::text, null::text, m.created_at, 3
    from public.connect_messages m
    join public.connect_conversations c on c.id = m.conversation_id
   where m.deleted_at is null
     and m.conversation_id in (select mc.conversation_id from my_convs mc)
     and to_tsvector('spanish', coalesce(m.body, '')) @@ v_q
  union all
  -- 4) Adjuntos: por nombre de archivo; solo en conversaciones donde soy miembro.
  select 'attachment'::text, a.conversation_id, c.context_id, c.kind::text,
         coalesce(a.file_name, 'Adjunto')::text,
         a.mime_type, null::text, null::text, a.created_at, 4
    from public.connect_attachments a
    join public.connect_conversations c on c.id = a.conversation_id
   where a.conversation_id in (select mc.conversation_id from my_convs mc)
     and a.file_name ilike v_like
  order by sort_rank asc, occurred_at desc nulls last
  limit v_lim;
end;
$$;
revoke all on function public.connect_search(text, int) from public, anon, authenticated;
grant execute on function public.connect_search(text, int) to authenticated;

notify pgrst, 'reload schema';
