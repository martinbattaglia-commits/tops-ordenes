-- 0153_connect_search.sql — Nexus Link RC1.4 · Búsqueda Global.
-- ENTREGADA, NO APLICADA (G3). Bloque RC1. NO toca 0142-0152 (RC1.0-1.3 congeladas).
-- ─────────────────────────────────────────────────────────────────────────
-- Búsqueda apoyada EXCLUSIVAMENTE en la infraestructura existente (D-RC1.4-4):
--   · índice GIN FTS español de connect_messages.body (0143:176) — body por FTS rankeada;
--   · campos cortos (título/topic/slug/context_id/entity_type/file_name) por ILIKE.
-- NO crea motor paralelo, NO usa searchable_items (diferido F0.5.2), NO incluye incidentes (no existen).
-- Orden de resultados (D-RC1.4-4): 1) Conversaciones · 2) Contextos ERP · 3) Mensajes · 4) Adjuntos.
-- SECDEF (cruza RLS) → filtra membresía explícita (P-1 fail-closed: guard connect.view + sin fugas).
-- DEPENDE de: 0143 (tablas + índice FTS + _connect_is_member), 0146 (connect.view).
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
     and (c.id in (select conversation_id from my_convs)
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
     and c.id in (select conversation_id from my_convs)
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
     and m.conversation_id in (select conversation_id from my_convs)
     and to_tsvector('spanish', coalesce(m.body, '')) @@ v_q
  union all
  -- 4) Adjuntos: por nombre de archivo; solo en conversaciones donde soy miembro.
  select 'attachment'::text, a.conversation_id, c.context_id, c.kind::text,
         coalesce(a.file_name, 'Adjunto')::text,
         a.mime_type, null::text, null::text, a.created_at, 4
    from public.connect_attachments a
    join public.connect_conversations c on c.id = a.conversation_id
   where a.conversation_id in (select conversation_id from my_convs)
     and a.file_name ilike v_like
  order by sort_rank asc, occurred_at desc nulls last
  limit v_lim;
end;
$$;
revoke all on function public.connect_search(text, int) from public, anon, authenticated;
grant execute on function public.connect_search(text, int) to authenticated;

notify pgrst, 'reload schema';
