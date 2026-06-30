-- 0151_connect_moderation_failclose.sql — Nexus Link RC1.2 (HARDENING de seguridad).
-- ENTREGADA, NO APLICADA (G3). Parte del bloque RC1 (se aplica junto al resto, DESPUÉS de 0144).
-- ─────────────────────────────────────────────────────────────────────────
-- Corrige FAIL-OPEN de las 7 RPC de moderación de 0144 (hallazgo RC12-008). El guard original
--   `if v_role not in ('owner','moderator') and not is_admin() then raise`
-- es NULL-inseguro: para un NO-miembro v_role = NULL → `NULL not in (...)` = NULL → el if NO dispara
-- → la operación PROCEDE (escalada: un staff no-miembro podía moderar conversaciones ajenas).
-- 100% ADITIVA: `create or replace` de las mismas funciones (NO edita el archivo 0144; respeta RC1.0
-- byte a byte). Solo cambia el guard a FAIL-CLOSED explícito:
--   `if not is_admin() and (v_role is null or v_role not in ('owner','moderator')) then raise`.
-- Política permanente P-1 (ver docs/superpowers/NEXUS-ENGINEERING-POLICY.md): toda SECDEF maneja NULL
-- explícito; prohibido depender de NOT IN (puede devolver NULL); todo guard fail-closed.
-- DEPENDE de 0143/0144 (las funciones y tablas). Cuerpos idénticos a 0144 salvo el guard.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) connect_add_member
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
  insert into public.connect_participants (conversation_id, participant_type, profile_id, member_role)
  values (p_conversation_id, 'staff', p_profile_id, coalesce(p_role,'member'))
  on conflict (conversation_id, profile_id) do nothing;
end;
$$;
revoke all on function public.connect_add_member(uuid, uuid, public.connect_member_role_t) from public, anon, authenticated;
grant execute on function public.connect_add_member(uuid, uuid, public.connect_member_role_t) to authenticated;

-- 2) connect_remove_member (la auto-baja del propio usuario sigue permitida)
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
  delete from public.connect_participants
   where conversation_id = p_conversation_id and profile_id = p_profile_id;
end;
$$;
revoke all on function public.connect_remove_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.connect_remove_member(uuid, uuid) to authenticated;

-- 3) connect_set_member_role (solo owner o admin)
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
  update public.connect_participants set member_role = p_role
   where conversation_id = p_conversation_id and profile_id = p_profile_id;
end;
$$;
revoke all on function public.connect_set_member_role(uuid, uuid, public.connect_member_role_t) from public, anon, authenticated;
grant execute on function public.connect_set_member_role(uuid, uuid, public.connect_member_role_t) to authenticated;

-- 4) connect_archive_conversation
create or replace function public.connect_archive_conversation(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_my_role public.connect_member_role_t;
begin
  select member_role into v_my_role from public.connect_participants
   where conversation_id = p_conversation_id and profile_id = auth.uid();
  if not public.is_admin() and (v_my_role is null or v_my_role not in ('owner','moderator')) then
    raise exception 'sin permiso para archivar' using errcode = 'insufficient_privilege';
  end if;
  update public.connect_conversations set archived_at = now() where id = p_conversation_id;
end;
$$;
revoke all on function public.connect_archive_conversation(uuid) from public, anon, authenticated;
grant execute on function public.connect_archive_conversation(uuid) to authenticated;

-- 5) connect_set_topic
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
  update public.connect_conversations set topic = p_topic where id = p_conversation_id;
end;
$$;
revoke all on function public.connect_set_topic(uuid, text) from public, anon, authenticated;
grant execute on function public.connect_set_topic(uuid, text) to authenticated;

-- 6) connect_pin_message
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
  insert into public.connect_pinned (conversation_id, message_id, pinned_by)
  values (v_conv, p_message_id, auth.uid())
  on conflict (conversation_id, message_id) do nothing;
end;
$$;
revoke all on function public.connect_pin_message(uuid) from public, anon, authenticated;
grant execute on function public.connect_pin_message(uuid) to authenticated;

-- 7) connect_unpin_message
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
  delete from public.connect_pinned where conversation_id = v_conv and message_id = p_message_id;
end;
$$;
revoke all on function public.connect_unpin_message(uuid) from public, anon, authenticated;
grant execute on function public.connect_unpin_message(uuid) to authenticated;

notify pgrst, 'reload schema';
