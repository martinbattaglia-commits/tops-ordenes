-- ROLLBACK_0237_nexus_link_channel_rls.sql
--
-- Restituye textualmente las policies y funciones tal como estaban antes de
-- 0237 (medidas del catálogo productivo el 2026-08-14).
--
-- ⚠️ Al revertir vuelve a abrirse todo lo que 0237 cerró: realtime, búsqueda y
-- descarga de material de WhatsApp para cualquier participante, y la lectura
-- del bucket `connect-files` sin verificación de membresía. Es el estado previo
-- —no una degradación nueva—, pero conviene tenerlo presente.

-- (7) Búsqueda, sin el predicado de canal.
create or replace function public.connect_search(p_query text, p_limit integer default 30)
returns table(result_type text, conversation_id uuid, context_id text, kind text, title text,
              snippet text, entity_type text, entity_ref text,
              occurred_at timestamp with time zone, sort_rank integer)
language plpgsql security definer set search_path = public, pg_temp
as $fn$
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
  order by 10 asc, 9 desc nulls last
  limit v_lim;
end;
$fn$;

-- (6) Storage: vuelve la policy de 0148, sin membresía ni canal.
drop policy if exists "connect-files read members" on storage.objects;
create policy "connect-files read members"
  on storage.objects for select to authenticated
  using (bucket_id = 'connect-files' and has_permission('connect.view'));
drop function if exists public._connect_storage_object_allowed(text, text);

-- (5) Portón de descarga, sin canal.
create or replace function public.connect_emit_attachment_signed_url(p_attachment_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  v_conv   uuid;
  v_bucket text;
  v_path   text;
  v_scan   text;
begin
  select conversation_id, storage_bucket, storage_path, scan_status
    into v_conv, v_bucket, v_path, v_scan
    from public.connect_attachments where id = p_attachment_id;
  if not found then raise exception 'adjunto inexistente' using errcode = 'no_data_found'; end if;

  if not (public.has_permission('connect.view') and public._connect_is_member(v_conv)) then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'connect_attachment', p_attachment_id, 'connect.attachment.access',
          jsonb_build_object('bucket', v_bucket, 'scan_status', v_scan));

  return jsonb_build_object('bucket', v_bucket, 'path', v_path, 'scan_status', v_scan);
end;
$fn$;

-- (4)(3)(2) Policies sin predicado de canal.
drop policy if exists "connect_conversations select" on public.connect_conversations;
create policy "connect_conversations select"
  on public.connect_conversations for select
  using (
    has_permission('connect.view')
    and (
      public._connect_is_member(id)
      or (kind = 'channel' and visibility = 'public')
      or is_admin()
    )
  );

drop policy if exists "connect_attachments select" on public.connect_attachments;
create policy "connect_attachments select"
  on public.connect_attachments for select
  using (has_permission('connect.view') and public._connect_is_member(conversation_id));

drop policy if exists "connect_messages select" on public.connect_messages;
create policy "connect_messages select"
  on public.connect_messages for select
  using (has_permission('connect.view') and public._connect_is_member(conversation_id));

-- (1) Predicado de canal.
drop function if exists public._connect_channel_allowed(uuid);

notify pgrst, 'reload schema';
