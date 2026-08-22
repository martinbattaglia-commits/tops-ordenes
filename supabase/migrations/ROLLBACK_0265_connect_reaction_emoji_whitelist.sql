-- ROLLBACK_0265_connect_reaction_emoji_whitelist.sql — Nexus Link · EXP-NEXUS-LINK-MAX-RECOVERY
-- ─────────────────────────────────────────────────────────────────────────
-- Revierte la migración 0265 restableciendo el esquema y RPCs al estado de 0246.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Elimina check constraint de emojis
alter table public.connect_message_reactions
  drop constraint if exists connect_message_reactions_emoji_check;

-- 2. Restaura connect_react_pre_0246 sin allowlist
create or replace function public.connect_react_pre_0246(
  p_message_id uuid,
  p_emoji text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conv uuid;
  v_part uuid;
begin
  select conversation_id into v_conv from public.connect_messages where id = p_message_id;
  if not found then
    raise exception 'mensaje inexistente';
  end if;

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

revoke all on function public.connect_react_pre_0246(uuid, text)
  from public, anon, authenticated, service_role;

-- 3. Restaura connect_react wrapper de 0246
drop function if exists public.connect_react(uuid, text);

create or replace function public.connect_react(uuid, text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.nexus_depot_manager_reject_legacy_connect();
  perform public.connect_react_pre_0246($1, $2);
end;
$$;

revoke all on function public.connect_react(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.connect_react(uuid, text) to authenticated;

notify pgrst, 'reload schema';
