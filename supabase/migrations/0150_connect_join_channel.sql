-- 0150_connect_join_channel.sql — Nexus Link RC1.2.
-- ENTREGADA, NO APLICADA (G3). Parte del bloque RC1 (se aplica junto al resto al cierre de RC1).
-- ─────────────────────────────────────────────────────────────────────────
-- Auto-unión a canales PÚBLICOS (D-RC1.2-1): un usuario con connect.create se agrega a sí mismo
-- como 'member' de un canal kind='channel' AND visibility='public'. FAIL-CLOSED para canales
-- privados / grupos / no-canales (raise). RPC-first por sesión (audita al usuario real; el insert
-- queda gobernado por la validación interna, no por el front).
-- DEPENDE de 0143 (connect_conversations/participants + enums), 0146 (permiso connect.create).
-- NO toca RC1.0 (solo agrega esta función) ni RC1.1.
-- ─────────────────────────────────────────────────────────────────────────

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

  insert into public.connect_participants (conversation_id, participant_type, profile_id, member_role)
  values (p_conversation_id, 'staff', auth.uid(), 'member')
  on conflict (conversation_id, profile_id) do nothing;
end;
$$;
revoke all on function public.connect_join_channel(uuid) from public, anon, authenticated;
grant execute on function public.connect_join_channel(uuid) to authenticated;

notify pgrst, 'reload schema';
