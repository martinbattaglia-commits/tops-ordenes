-- 0157_fix_connect_search_union_order_by.sql — Nexus Link F3 · HOTFIX búsqueda (parte 2).
-- ENTREGADA, NO APLICADA. Completa el fix de connect_search: corrige un SEGUNDO bug
-- pre-existente (mig 0153) que quedó ENMASCARADO por el primero (42702) y salió a la luz
-- tras aplicar 0156.
-- ─────────────────────────────────────────────────────────────────────────
-- BUG #2: tras corregir la ambigüedad de conversation_id (0156), connect_search lanzaba:
--   ERROR 0A000: invalid UNION/INTERSECT/EXCEPT ORDER BY clause
--   DETAIL: Only result column names can be used, not expressions or functions.
--   Causa: `order by sort_rank asc, occurred_at desc nulls last` sobre el UNION referencia
--   nombres que NO son columnas del resultado del UNION (los SELECT no llevan alias) y que
--   colisionan con las variables OUT del RETURNS TABLE → inválido en un UNION.
-- FIX (quirúrgico): usar ORDER BY POSICIONAL — `order by 10 asc, 9 desc nulls last`
--   (10 = sort_rank, 9 = occurred_at). Posicional es válido en UNION e INMUNE a la colisión
--   con variables OUT (no hay identificadores que resolver). Validado read-only: devuelve el
--   mensaje de prueba sin lanzar 0A000.
-- Incluye además la calificación `mc.conversation_id` de 0156 (definición completa y coherente).
-- NO cambia firma pública, RETURNS TABLE, lógica, permisos, SECDEF ni search_path.
-- CREATE OR REPLACE preserva owner (postgres) y ACL. Idempotente. Reversible (re-aplicar 0156/0153).
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.connect_search(p_query text, p_limit int default 30)
returns table (
  result_type     text,
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
  select 'message'::text, m.conversation_id, c.context_id, c.kind::text,
         coalesce(c.title, c.slug, 'Mensaje')::text,
         left(m.body, 180), null::text, null::text, m.created_at, 3
    from public.connect_messages m
    join public.connect_conversations c on c.id = m.conversation_id
   where m.deleted_at is null
     and m.conversation_id in (select mc.conversation_id from my_convs mc)
     and to_tsvector('spanish', coalesce(m.body, '')) @@ v_q
  union all
  select 'attachment'::text, a.conversation_id, c.context_id, c.kind::text,
         coalesce(a.file_name, 'Adjunto')::text,
         a.mime_type, null::text, null::text, a.created_at, 4
    from public.connect_attachments a
    join public.connect_conversations c on c.id = a.conversation_id
   where a.conversation_id in (select mc.conversation_id from my_convs mc)
     and a.file_name ilike v_like
  order by 10 asc, 9 desc nulls last  -- posicional: 10=sort_rank, 9=occurred_at (evita colisión con vars OUT)
  limit v_lim;
end;
$$;
revoke all on function public.connect_search(text, int) from public, anon, authenticated;
grant execute on function public.connect_search(text, int) to authenticated;

notify pgrst, 'reload schema';
