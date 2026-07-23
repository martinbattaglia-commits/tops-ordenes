-- 0163_connect_archived_guards.sql — Nexus Link F4.1D (Higiene F3 · R-3 ampliado).
-- ENTREGADA, NO APLICADA (G3). Aplicar a mano en el SQL Editor de prod (arsksytgdnzukbmfgkju).
-- ─────────────────────────────────────────────────────────────────────────
-- R-3 (matriz D-F41-5 aprobada): guarda server-side de archivado en las RPCs de escritura.
-- Hasta acá el "solo lectura" de una conversación archivada era SOLO UI (bypasseable por RPC
-- directa). Se agrega `perform public._connect_assert_not_archived(<conv>)` (helper de 0161).
--
-- ⚠️ REGLA DE ORO (hallazgo crítico del plan v1.1): la base de cada CREATE OR REPLACE es el
-- cuerpo VIGENTE en prod — NUNCA el histórico de 0144 para las funciones que 0151 endureció
-- (RC12-008: guards fail-open NULL-inseguros). Fuentes por función:
--   · 0151 (fail-closed P-1): connect_add_member, connect_remove_member, connect_set_member_role,
--     connect_set_topic, connect_pin_message, connect_unpin_message.
--   · 0150: connect_join_channel (unirse a un canal público ARCHIVADO pasaba — se bloquea).
--   · 0144: connect_edit_message, connect_react, connect_unreact, connect_flag_message,
--     connect_unflag_message, connect_link_entity, connect_unlink_entity.
--   · connect_post_message ya guarda desde 0161 (consolidación declarada).
-- EXENTAS por diseño (D-F41-5): connect_mark_read y connect_toggle_favorite (estado por-usuario:
-- leer/desmarcar un archivado es legítimo), connect_delete_message (la moderación debe poder
-- actuar sobre archivados), connect_archive_conversation (obvio), connect_set_title (ya guarda, 0159).
-- COMPORTAMIENTO: intacto para conversaciones NO archivadas; sobre archivadas pasa a rechazar
-- con check_violation — cambio DELIBERADO (D-F41-5), no un no-cambio.
-- Cambio mínimo extra en connect_unflag_message: se agrega lookup de conversación (el cuerpo
-- 0144 no la resolvía) para poder aplicar la guarda.
-- Misma aridad en todas → CREATE OR REPLACE seguro (sin overloads). Grants re-asertados.
-- IDEMPOTENTE. DEPENDE de 0144/0150/0151/0161 (helper + cuerpos vigentes).
-- ─────────────────────────────────────────────────────────────────────────

-- ═════ Grupo 0144 (cuerpos vigentes de 0144) ═════

-- (1) connect_edit_message
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
  perform public._connect_assert_not_archived(v_conv);

  insert into public.connect_message_edits (message_id, prev_body, edited_by)
  values (p_message_id, v_prev, auth.uid());

  update public.connect_messages
     set body = nullif(p_body,''), edited_at = now()
   where id = p_message_id;
end;
$$;
revoke all on function public.connect_edit_message(uuid, text) from public, anon, authenticated;
grant execute on function public.connect_edit_message(uuid, text) to authenticated;

-- (2) connect_react
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
  perform public._connect_assert_not_archived(v_conv);
  v_part := public._connect_my_participant(v_conv);
  insert into public.connect_message_reactions (message_id, participant_id, emoji)
  values (p_message_id, v_part, p_emoji)
  on conflict (message_id, participant_id, emoji) do nothing;
end;
$$;
revoke all on function public.connect_react(uuid, text) from public, anon, authenticated;
grant execute on function public.connect_react(uuid, text) to authenticated;

-- (3) connect_unreact
create or replace function public.connect_unreact(p_message_id uuid, p_emoji text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_conv uuid; v_part uuid;
begin
  select conversation_id into v_conv from public.connect_messages where id = p_message_id;
  perform public._connect_assert_not_archived(v_conv);
  v_part := public._connect_my_participant(v_conv);
  delete from public.connect_message_reactions
   where message_id = p_message_id and participant_id = v_part and emoji = p_emoji;
end;
$$;
revoke all on function public.connect_unreact(uuid, text) from public, anon, authenticated;
grant execute on function public.connect_unreact(uuid, text) to authenticated;

-- (4) connect_flag_message
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
  perform public._connect_assert_not_archived(v_conv);
  insert into public.connect_message_flags (message_id, profile_id, flag)
  values (p_message_id, auth.uid(), coalesce(p_flag,'important'))
  on conflict (message_id, profile_id, flag) do nothing;
end;
$$;
revoke all on function public.connect_flag_message(uuid, text) from public, anon, authenticated;
grant execute on function public.connect_flag_message(uuid, text) to authenticated;

-- (5) connect_unflag_message (+lookup de conversación para la guarda)
create or replace function public.connect_unflag_message(p_message_id uuid, p_flag text)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_conv uuid;
begin
  select conversation_id into v_conv from public.connect_messages where id = p_message_id;
  perform public._connect_assert_not_archived(v_conv);
  delete from public.connect_message_flags
   where message_id = p_message_id and profile_id = auth.uid() and flag = coalesce(p_flag,'important');
end;
$$;
revoke all on function public.connect_unflag_message(uuid, text) from public, anon, authenticated;
grant execute on function public.connect_unflag_message(uuid, text) to authenticated;

-- (6) connect_link_entity
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
  perform public._connect_assert_not_archived(p_conversation_id);

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

-- (7) connect_unlink_entity
create or replace function public.connect_unlink_entity(
  p_conversation_id uuid, p_entity_type text, p_entity_id uuid, p_entity_id_text text
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('connect.edit') then
    raise exception 'Sin permiso connect.edit' using errcode = 'insufficient_privilege';
  end if;
  perform public._connect_assert_not_archived(p_conversation_id);
  delete from public.connect_conversation_links
   where conversation_id = p_conversation_id
     and entity_type = p_entity_type
     and entity_id is not distinct from p_entity_id
     and entity_id_text is not distinct from p_entity_id_text;
end;
$$;
revoke all on function public.connect_unlink_entity(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.connect_unlink_entity(uuid, text, uuid, text) to authenticated;

-- ═════ Grupo 0151 (cuerpos vigentes FAIL-CLOSED de 0151 — NO los de 0144) ═════

-- (8) connect_add_member
create or replace function public.connect_add_member(
  p_conversation_id uuid, p_profile_id uuid, p_role public.connect_member_role_t
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_my_role public.connect_member_role_t;
begin
  select member_role into v_my_role from public.connect_participants
   where conversation_id = p_conversation_id and profile_id = auth.uid();
  if not public.is_admin() and (v_my_role is null or v_my_role not in ('owner','moderator')) then
    raise exception 'solo owner/moderator/admin agrega miembros' using errcode = 'insufficient_privilege';
  end if;
  perform public._connect_assert_not_archived(p_conversation_id);
  insert into public.connect_participants (conversation_id, participant_type, profile_id, member_role)
  values (p_conversation_id, 'staff', p_profile_id, coalesce(p_role,'member'))
  on conflict (conversation_id, profile_id) do nothing;
end;
$$;
revoke all on function public.connect_add_member(uuid, uuid, public.connect_member_role_t) from public, anon, authenticated;
grant execute on function public.connect_add_member(uuid, uuid, public.connect_member_role_t) to authenticated;

-- (9) connect_remove_member (la auto-baja del propio usuario sigue permitida)
create or replace function public.connect_remove_member(p_conversation_id uuid, p_profile_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_my_role public.connect_member_role_t;
begin
  select member_role into v_my_role from public.connect_participants
   where conversation_id = p_conversation_id and profile_id = auth.uid();
  if p_profile_id <> auth.uid()
     and not public.is_admin()
     and (v_my_role is null or v_my_role not in ('owner','moderator')) then
    raise exception 'sin permiso para remover miembro' using errcode = 'insufficient_privilege';
  end if;
  perform public._connect_assert_not_archived(p_conversation_id);
  delete from public.connect_participants
   where conversation_id = p_conversation_id and profile_id = p_profile_id;
end;
$$;
revoke all on function public.connect_remove_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.connect_remove_member(uuid, uuid) to authenticated;

-- (10) connect_set_member_role (solo owner o admin)
create or replace function public.connect_set_member_role(
  p_conversation_id uuid, p_profile_id uuid, p_role public.connect_member_role_t
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_my_role public.connect_member_role_t;
begin
  select member_role into v_my_role from public.connect_participants
   where conversation_id = p_conversation_id and profile_id = auth.uid();
  if not public.is_admin() and (v_my_role is null or v_my_role <> 'owner') then
    raise exception 'solo owner/admin cambia roles' using errcode = 'insufficient_privilege';
  end if;
  perform public._connect_assert_not_archived(p_conversation_id);
  update public.connect_participants set member_role = p_role
   where conversation_id = p_conversation_id and profile_id = p_profile_id;
end;
$$;
revoke all on function public.connect_set_member_role(uuid, uuid, public.connect_member_role_t) from public, anon, authenticated;
grant execute on function public.connect_set_member_role(uuid, uuid, public.connect_member_role_t) to authenticated;

-- (11) connect_set_topic
create or replace function public.connect_set_topic(p_conversation_id uuid, p_topic text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_my_role public.connect_member_role_t;
begin
  select member_role into v_my_role from public.connect_participants
   where conversation_id = p_conversation_id and profile_id = auth.uid();
  if not public.is_admin() and (v_my_role is null or v_my_role not in ('owner','moderator')) then
    raise exception 'sin permiso para editar tema' using errcode = 'insufficient_privilege';
  end if;
  perform public._connect_assert_not_archived(p_conversation_id);
  update public.connect_conversations set topic = p_topic where id = p_conversation_id;
end;
$$;
revoke all on function public.connect_set_topic(uuid, text) from public, anon, authenticated;
grant execute on function public.connect_set_topic(uuid, text) to authenticated;

-- (12) connect_pin_message
create or replace function public.connect_pin_message(p_message_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_conv uuid; v_role public.connect_member_role_t;
begin
  select conversation_id into v_conv from public.connect_messages where id = p_message_id;
  if not found then raise exception 'mensaje inexistente'; end if;
  select member_role into v_role from public.connect_participants
   where conversation_id = v_conv and profile_id = auth.uid();
  if not public.is_admin() and (v_role is null or v_role not in ('owner','moderator')) then
    raise exception 'solo owner/moderator fija mensajes' using errcode = 'insufficient_privilege';
  end if;
  perform public._connect_assert_not_archived(v_conv);
  insert into public.connect_pinned (conversation_id, message_id, pinned_by)
  values (v_conv, p_message_id, auth.uid())
  on conflict (conversation_id, message_id) do nothing;
end;
$$;
revoke all on function public.connect_pin_message(uuid) from public, anon, authenticated;
grant execute on function public.connect_pin_message(uuid) to authenticated;

-- (13) connect_unpin_message
create or replace function public.connect_unpin_message(p_message_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_conv uuid; v_role public.connect_member_role_t;
begin
  select conversation_id into v_conv from public.connect_messages where id = p_message_id;
  if not found then raise exception 'mensaje inexistente'; end if;
  select member_role into v_role from public.connect_participants
   where conversation_id = v_conv and profile_id = auth.uid();
  if not public.is_admin() and (v_role is null or v_role not in ('owner','moderator')) then
    raise exception 'solo owner/moderator desfija mensajes' using errcode = 'insufficient_privilege';
  end if;
  perform public._connect_assert_not_archived(v_conv);
  delete from public.connect_pinned where conversation_id = v_conv and message_id = p_message_id;
end;
$$;
revoke all on function public.connect_unpin_message(uuid) from public, anon, authenticated;
grant execute on function public.connect_unpin_message(uuid) to authenticated;

-- ═════ Grupo 0150 ═════

-- (14) connect_join_channel (unirse a un canal público ARCHIVADO ahora se rechaza)
create or replace function public.connect_join_channel(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_kind public.connect_conversation_kind_t;
  v_vis  text;
begin
  if not public.has_permission('connect.create') then
    raise exception 'Sin permiso connect.create' using errcode = 'insufficient_privilege';
  end if;

  select kind, visibility into v_kind, v_vis
    from public.connect_conversations
   where id = p_conversation_id;
  if not found then
    raise exception 'conversación inexistente' using errcode = 'no_data_found';
  end if;

  -- Solo canales públicos. Privados/grupos/dm/etc → denegado (la membresía la da un owner/moderator).
  if v_kind <> 'channel' or coalesce(v_vis, '') <> 'public' then
    raise exception 'solo se puede unir a canales públicos' using errcode = 'insufficient_privilege';
  end if;
  perform public._connect_assert_not_archived(p_conversation_id);

  insert into public.connect_participants (conversation_id, participant_type, profile_id, member_role)
  values (p_conversation_id, 'staff', auth.uid(), 'member')
  on conflict (conversation_id, profile_id) do nothing;
end;
$$;
revoke all on function public.connect_join_channel(uuid) from public, anon, authenticated;
grant execute on function public.connect_join_channel(uuid) to authenticated;

notify pgrst, 'reload schema';
