-- 0144_connect_rpc.sql — Nexus Link RC1.0.
-- ENTREGADA, NO APLICADA (G3).
-- ─────────────────────────────────────────────────────────────────────────
-- RPCs de Nexus Link (Connect): única vía de escritura crítica. SECURITY DEFINER,
-- search_path fijo (public, pg_temp), revoke public/anon/authenticated + grant
-- selectivo. Incluye trigger AFTER INSERT en connect_messages → connect_outbox.
-- Reconciliación RC1 del spec §B 5.3 (+36) más:
--   · D-RC1-5: connect_create_conversation acepta vínculo opcional a entidad ERP al crear
--     (atómico → dispara el adapter Knowledge de 0149).
--   · Addendum A1: connect_toggle_favorite / connect_pin_message / connect_unpin_message /
--     connect_flag_message / connect_unflag_message.
-- DEPENDE de 0143.
-- ─────────────────────────────────────────────────────────────────────────

-- ===== Helper: participant_id del usuario actual en una conversación =====
create or replace function public._connect_my_participant(p_conversation_id uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$
  select cp.id from public.connect_participants cp
  where cp.conversation_id = p_conversation_id and cp.profile_id = auth.uid()
  limit 1;
$$;
revoke all on function public._connect_my_participant(uuid) from public, anon;
grant execute on function public._connect_my_participant(uuid) to authenticated, service_role;

-- ===== Fan-out: encola en connect_outbox y denormaliza puntero de último mensaje =====
create or replace function public._connect_enqueue_message()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.connect_conversations
     set last_message_seq = new.seq,
         last_message_at  = new.created_at
   where id = new.conversation_id;

  insert into public.connect_outbox (topic, payload)
  values (
    'connect.message.posted',
    jsonb_build_object(
      'conversation_id', new.conversation_id,
      'message_id',      new.id,
      'seq',             new.seq,
      'author_profile_id', new.author_profile_id,
      'kind',            new.kind
    )
  );
  return new;
end;
$$;
revoke all on function public._connect_enqueue_message() from public, anon, authenticated;

drop trigger if exists trg_connect_messages_enqueue on public.connect_messages;
create trigger trg_connect_messages_enqueue
  after insert on public.connect_messages
  for each row execute function public._connect_enqueue_message();

-- ===== connect_create_conversation (+ vínculo opcional al crear, D-RC1-5) =====
create or replace function public.connect_create_conversation(
  p_kind               public.connect_conversation_kind_t,
  p_title              text,
  p_slug               text,
  p_visibility         text,
  p_member_profile_ids uuid[],
  p_entity_type        text default null,
  p_entity_id          uuid default null,
  p_entity_id_text     text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_conv_id uuid;
  v_pid     uuid;
begin
  if not public.has_permission('connect.create') then
    raise exception 'Sin permiso connect.create' using errcode = 'insufficient_privilege';
  end if;

  insert into public.connect_conversations (kind, title, slug, visibility, created_by)
  values (p_kind, nullif(trim(p_title),''), nullif(trim(p_slug),''),
          nullif(p_visibility,''), auth.uid())
  returning id into v_conv_id;

  -- Creador = owner.
  insert into public.connect_participants (conversation_id, participant_type, profile_id, member_role)
  values (v_conv_id, 'staff', auth.uid(), 'owner')
  on conflict (conversation_id, profile_id) do nothing;

  -- Miembros iniciales (staff RC1).
  if p_member_profile_ids is not null then
    foreach v_pid in array p_member_profile_ids loop
      if v_pid is not null and v_pid <> auth.uid() then
        insert into public.connect_participants (conversation_id, participant_type, profile_id, member_role)
        values (v_conv_id, 'staff', v_pid, 'member')
        on conflict (conversation_id, profile_id) do nothing;
      end if;
    end loop;
  end if;

  -- D-RC1-5 (contexto): vínculo opcional a entidad ERP al crear (atómico → dispara adapter Knowledge).
  if p_entity_type is not null then
    if p_entity_type = 'compliance_items' then
      if p_entity_id_text is null then
        raise exception 'compliance_items requiere entity_id_text' using errcode = 'check_violation';
      end if;
      insert into public.connect_conversation_links (conversation_id, entity_type, entity_id_text, linked_by)
      values (v_conv_id, p_entity_type, p_entity_id_text, auth.uid()) on conflict do nothing;
    else
      if p_entity_id is null then
        raise exception 'entidad % requiere entity_id uuid', p_entity_type using errcode = 'check_violation';
      end if;
      insert into public.connect_conversation_links (conversation_id, entity_type, entity_id, linked_by)
      values (v_conv_id, p_entity_type, p_entity_id, auth.uid()) on conflict do nothing;
    end if;
  end if;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'connect_conversation', v_conv_id, 'connect.create',
          jsonb_build_object('kind', p_kind, 'members', coalesce(array_length(p_member_profile_ids,1),0),
                             'entity_type', p_entity_type));

  return v_conv_id;
end;
$$;
revoke all on function public.connect_create_conversation(public.connect_conversation_kind_t, text, text, text, uuid[], text, uuid, text) from public, anon, authenticated;
grant execute on function public.connect_create_conversation(public.connect_conversation_kind_t, text, text, text, uuid[], text, uuid, text) to authenticated;

-- ===== connect_post_message (idempotente por client_msg_id) =====
create or replace function public.connect_post_message(
  p_conversation_id uuid,
  p_body            text,
  p_reply_to        uuid,
  p_client_msg_id   text,
  p_attachment_ids  uuid[]
) returns table (id uuid, seq bigint)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_msg_id uuid;
  v_seq    bigint;
  v_part   uuid;
  v_att    uuid;
begin
  if not public.has_permission('connect.create') then
    raise exception 'Sin permiso connect.create' using errcode = 'insufficient_privilege';
  end if;
  if not public._connect_is_member(p_conversation_id) then
    raise exception 'No es miembro de la conversación' using errcode = 'insufficient_privilege';
  end if;

  if p_client_msg_id is not null then
    select m.id, m.seq into v_msg_id, v_seq
      from public.connect_messages m
     where m.conversation_id = p_conversation_id
       and m.author_profile_id = auth.uid()
       and m.client_msg_id = p_client_msg_id;
    if v_msg_id is not null then
      id := v_msg_id; seq := v_seq; return next;
      return;
    end if;
  end if;

  v_part := public._connect_my_participant(p_conversation_id);

  insert into public.connect_messages
    (conversation_id, author_participant_id, author_profile_id, kind, body,
     reply_to_message_id, client_msg_id)
  values
    (p_conversation_id, v_part, auth.uid(), 'text', nullif(p_body,''),
     p_reply_to, p_client_msg_id)
  returning connect_messages.id, connect_messages.seq into v_msg_id, v_seq;

  if p_attachment_ids is not null then
    foreach v_att in array p_attachment_ids loop
      update public.connect_attachments
         set message_id = v_msg_id
       where connect_attachments.id = v_att
         and conversation_id = p_conversation_id and message_id is null;
    end loop;
  end if;

  id := v_msg_id; seq := v_seq; return next;
end;
$$;
revoke all on function public.connect_post_message(uuid, text, uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.connect_post_message(uuid, text, uuid, text, uuid[]) to authenticated;

-- ===== connect_edit_message (append-only: snapshot a connect_message_edits) =====
create or replace function public.connect_edit_message(p_message_id uuid, p_body text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_conv uuid; v_author uuid; v_prev text;
begin
  select conversation_id, author_profile_id, body
    into v_conv, v_author, v_prev
    from public.connect_messages where id = p_message_id for update;
  if not found then raise exception 'mensaje inexistente'; end if;
  if v_author <> auth.uid() and not public.is_admin() then
    raise exception 'solo el autor o admin puede editar' using errcode = 'insufficient_privilege';
  end if;

  insert into public.connect_message_edits (message_id, prev_body, edited_by)
  values (p_message_id, v_prev, auth.uid());

  update public.connect_messages
     set body = nullif(p_body,''), edited_at = now()
   where id = p_message_id;
end;
$$;
revoke all on function public.connect_edit_message(uuid, text) from public, anon, authenticated;
grant execute on function public.connect_edit_message(uuid, text) to authenticated;

-- ===== connect_delete_message (soft + redacción) =====
create or replace function public.connect_delete_message(p_message_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_author uuid;
begin
  select author_profile_id into v_author
    from public.connect_messages where id = p_message_id for update;
  if not found then raise exception 'mensaje inexistente'; end if;
  if v_author <> auth.uid() and not public.is_admin() then
    raise exception 'solo el autor o admin puede borrar' using errcode = 'insufficient_privilege';
  end if;

  update public.connect_messages
     set deleted_at = now(), redacted = true, body = null
   where id = p_message_id;
end;
$$;
revoke all on function public.connect_delete_message(uuid) from public, anon, authenticated;
grant execute on function public.connect_delete_message(uuid) to authenticated;

-- ===== connect_react / connect_unreact =====
create or replace function public.connect_react(p_message_id uuid, p_emoji text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_conv uuid; v_part uuid;
begin
  select conversation_id into v_conv from public.connect_messages where id = p_message_id;
  if not found then raise exception 'mensaje inexistente'; end if;
  if not public._connect_is_member(v_conv) then
    raise exception 'no es miembro' using errcode = 'insufficient_privilege';
  end if;
  v_part := public._connect_my_participant(v_conv);
  insert into public.connect_message_reactions (message_id, participant_id, emoji)
  values (p_message_id, v_part, p_emoji)
  on conflict (message_id, participant_id, emoji) do nothing;
end;
$$;
revoke all on function public.connect_react(uuid, text) from public, anon, authenticated;
grant execute on function public.connect_react(uuid, text) to authenticated;

create or replace function public.connect_unreact(p_message_id uuid, p_emoji text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_conv uuid; v_part uuid;
begin
  select conversation_id into v_conv from public.connect_messages where id = p_message_id;
  v_part := public._connect_my_participant(v_conv);
  delete from public.connect_message_reactions
   where message_id = p_message_id and participant_id = v_part and emoji = p_emoji;
end;
$$;
revoke all on function public.connect_unreact(uuid, text) from public, anon, authenticated;
grant execute on function public.connect_unreact(uuid, text) to authenticated;

-- ===== connect_mark_read =====
create or replace function public.connect_mark_read(p_conversation_id uuid, p_up_to_seq bigint)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.connect_participants
     set last_read_seq = greatest(last_read_seq, p_up_to_seq)
   where conversation_id = p_conversation_id and profile_id = auth.uid();
end;
$$;
revoke all on function public.connect_mark_read(uuid, bigint) from public, anon, authenticated;
grant execute on function public.connect_mark_read(uuid, bigint) to authenticated;

-- ===== connect_add_member / connect_remove_member / connect_set_member_role =====
create or replace function public.connect_add_member(
  p_conversation_id uuid, p_profile_id uuid, p_role public.connect_member_role_t
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_my_role public.connect_member_role_t;
begin
  select member_role into v_my_role from public.connect_participants
   where conversation_id = p_conversation_id and profile_id = auth.uid();
  if v_my_role not in ('owner','moderator') and not public.is_admin() then
    raise exception 'solo owner/moderator/admin agrega miembros' using errcode = 'insufficient_privilege';
  end if;
  insert into public.connect_participants (conversation_id, participant_type, profile_id, member_role)
  values (p_conversation_id, 'staff', p_profile_id, coalesce(p_role,'member'))
  on conflict (conversation_id, profile_id) do nothing;
end;
$$;
revoke all on function public.connect_add_member(uuid, uuid, public.connect_member_role_t) from public, anon, authenticated;
grant execute on function public.connect_add_member(uuid, uuid, public.connect_member_role_t) to authenticated;

create or replace function public.connect_remove_member(p_conversation_id uuid, p_profile_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_my_role public.connect_member_role_t;
begin
  select member_role into v_my_role from public.connect_participants
   where conversation_id = p_conversation_id and profile_id = auth.uid();
  if v_my_role not in ('owner','moderator') and not public.is_admin()
     and p_profile_id <> auth.uid() then
    raise exception 'sin permiso para remover miembro' using errcode = 'insufficient_privilege';
  end if;
  delete from public.connect_participants
   where conversation_id = p_conversation_id and profile_id = p_profile_id;
end;
$$;
revoke all on function public.connect_remove_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.connect_remove_member(uuid, uuid) to authenticated;

create or replace function public.connect_set_member_role(
  p_conversation_id uuid, p_profile_id uuid, p_role public.connect_member_role_t
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_my_role public.connect_member_role_t;
begin
  select member_role into v_my_role from public.connect_participants
   where conversation_id = p_conversation_id and profile_id = auth.uid();
  if v_my_role <> 'owner' and not public.is_admin() then
    raise exception 'solo owner/admin cambia roles' using errcode = 'insufficient_privilege';
  end if;
  update public.connect_participants set member_role = p_role
   where conversation_id = p_conversation_id and profile_id = p_profile_id;
end;
$$;
revoke all on function public.connect_set_member_role(uuid, uuid, public.connect_member_role_t) from public, anon, authenticated;
grant execute on function public.connect_set_member_role(uuid, uuid, public.connect_member_role_t) to authenticated;

-- ===== connect_archive_conversation / connect_set_topic =====
create or replace function public.connect_archive_conversation(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_my_role public.connect_member_role_t;
begin
  select member_role into v_my_role from public.connect_participants
   where conversation_id = p_conversation_id and profile_id = auth.uid();
  if v_my_role not in ('owner','moderator') and not public.is_admin() then
    raise exception 'sin permiso para archivar' using errcode = 'insufficient_privilege';
  end if;
  update public.connect_conversations set archived_at = now() where id = p_conversation_id;
end;
$$;
revoke all on function public.connect_archive_conversation(uuid) from public, anon, authenticated;
grant execute on function public.connect_archive_conversation(uuid) to authenticated;

create or replace function public.connect_set_topic(p_conversation_id uuid, p_topic text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_my_role public.connect_member_role_t;
begin
  select member_role into v_my_role from public.connect_participants
   where conversation_id = p_conversation_id and profile_id = auth.uid();
  if v_my_role not in ('owner','moderator') and not public.is_admin() then
    raise exception 'sin permiso para editar tema' using errcode = 'insufficient_privilege';
  end if;
  update public.connect_conversations set topic = p_topic where id = p_conversation_id;
end;
$$;
revoke all on function public.connect_set_topic(uuid, text) from public, anon, authenticated;
grant execute on function public.connect_set_topic(uuid, text) to authenticated;

-- ===== connect_link_entity / connect_unlink_entity (manejo dual de PK) — D-RC1-5 =====
create or replace function public.connect_link_entity(
  p_conversation_id uuid,
  p_entity_type     text,
  p_entity_id       uuid,
  p_entity_id_text  text
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('connect.edit') then
    raise exception 'Sin permiso connect.edit' using errcode = 'insufficient_privilege';
  end if;
  if not public._connect_is_member(p_conversation_id) then
    raise exception 'no es miembro' using errcode = 'insufficient_privilege';
  end if;

  if p_entity_type = 'compliance_items' then
    if p_entity_id_text is null then
      raise exception 'compliance_items requiere entity_id_text' using errcode = 'check_violation';
    end if;
    insert into public.connect_conversation_links
      (conversation_id, entity_type, entity_id_text, linked_by)
    values (p_conversation_id, p_entity_type, p_entity_id_text, auth.uid())
    on conflict do nothing;
  else
    if p_entity_id is null then
      raise exception 'entidad % requiere entity_id uuid', p_entity_type using errcode = 'check_violation';
    end if;
    insert into public.connect_conversation_links
      (conversation_id, entity_type, entity_id, linked_by)
    values (p_conversation_id, p_entity_type, p_entity_id, auth.uid())
    on conflict do nothing;
  end if;
end;
$$;
revoke all on function public.connect_link_entity(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.connect_link_entity(uuid, text, uuid, text) to authenticated;

create or replace function public.connect_unlink_entity(
  p_conversation_id uuid, p_entity_type text, p_entity_id uuid, p_entity_id_text text
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('connect.edit') then
    raise exception 'Sin permiso connect.edit' using errcode = 'insufficient_privilege';
  end if;
  delete from public.connect_conversation_links
   where conversation_id = p_conversation_id
     and entity_type = p_entity_type
     and entity_id is not distinct from p_entity_id
     and entity_id_text is not distinct from p_entity_id_text;
end;
$$;
revoke all on function public.connect_unlink_entity(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.connect_unlink_entity(uuid, text, uuid, text) to authenticated;

-- ===== connect_emit_attachment_signed_url (PORTÓN auth + AUDITORÍA) =====
create or replace function public.connect_emit_attachment_signed_url(p_attachment_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
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

  -- AV (flag SEC-AV-1): desde F5/F6 (uploads externos) exigir scan_status='clean' antes de firmar.

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'connect_attachment', p_attachment_id, 'connect.attachment.access',
          jsonb_build_object('bucket', v_bucket, 'path', v_path, 'scan', v_scan,
                             'actor', coalesce(auth.uid()::text, 'system')));

  return jsonb_build_object('bucket', v_bucket, 'path', v_path);
end;
$$;
revoke all on function public.connect_emit_attachment_signed_url(uuid) from public, anon;
grant execute on function public.connect_emit_attachment_signed_url(uuid) to authenticated, service_role;

-- ===== Addendum A1: favoritos / fijados / importantes =====
create or replace function public.connect_toggle_favorite(p_conversation_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.connect_participants set is_favorite = coalesce(p_on, false)
   where conversation_id = p_conversation_id and profile_id = auth.uid();
end;
$$;
revoke all on function public.connect_toggle_favorite(uuid, boolean) from public, anon, authenticated;
grant execute on function public.connect_toggle_favorite(uuid, boolean) to authenticated;

create or replace function public.connect_pin_message(p_message_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_conv uuid; v_role public.connect_member_role_t;
begin
  select conversation_id into v_conv from public.connect_messages where id = p_message_id;
  if not found then raise exception 'mensaje inexistente'; end if;
  select member_role into v_role from public.connect_participants
   where conversation_id = v_conv and profile_id = auth.uid();
  if v_role not in ('owner','moderator') and not public.is_admin() then
    raise exception 'solo owner/moderator fija mensajes' using errcode = 'insufficient_privilege';
  end if;
  insert into public.connect_pinned (conversation_id, message_id, pinned_by)
  values (v_conv, p_message_id, auth.uid())
  on conflict (conversation_id, message_id) do nothing;
end;
$$;
revoke all on function public.connect_pin_message(uuid) from public, anon, authenticated;
grant execute on function public.connect_pin_message(uuid) to authenticated;

create or replace function public.connect_unpin_message(p_message_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_conv uuid; v_role public.connect_member_role_t;
begin
  select conversation_id into v_conv from public.connect_messages where id = p_message_id;
  if not found then raise exception 'mensaje inexistente'; end if;
  select member_role into v_role from public.connect_participants
   where conversation_id = v_conv and profile_id = auth.uid();
  if v_role not in ('owner','moderator') and not public.is_admin() then
    raise exception 'solo owner/moderator desfija mensajes' using errcode = 'insufficient_privilege';
  end if;
  delete from public.connect_pinned where conversation_id = v_conv and message_id = p_message_id;
end;
$$;
revoke all on function public.connect_unpin_message(uuid) from public, anon, authenticated;
grant execute on function public.connect_unpin_message(uuid) to authenticated;

create or replace function public.connect_flag_message(p_message_id uuid, p_flag text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_conv uuid;
begin
  select conversation_id into v_conv from public.connect_messages where id = p_message_id;
  if not found then raise exception 'mensaje inexistente'; end if;
  if not public._connect_is_member(v_conv) then
    raise exception 'no es miembro' using errcode = 'insufficient_privilege';
  end if;
  insert into public.connect_message_flags (message_id, profile_id, flag)
  values (p_message_id, auth.uid(), coalesce(p_flag,'important'))
  on conflict (message_id, profile_id, flag) do nothing;
end;
$$;
revoke all on function public.connect_flag_message(uuid, text) from public, anon, authenticated;
grant execute on function public.connect_flag_message(uuid, text) to authenticated;

create or replace function public.connect_unflag_message(p_message_id uuid, p_flag text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  delete from public.connect_message_flags
   where message_id = p_message_id and profile_id = auth.uid() and flag = coalesce(p_flag,'important');
end;
$$;
revoke all on function public.connect_unflag_message(uuid, text) from public, anon, authenticated;
grant execute on function public.connect_unflag_message(uuid, text) to authenticated;

notify pgrst, 'reload schema';
