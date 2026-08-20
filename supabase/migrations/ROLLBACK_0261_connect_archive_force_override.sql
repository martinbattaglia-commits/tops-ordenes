-- ROLLBACK_0261_connect_archive_force_override.sql
-- Remediación: eliminar explícitamente la firma bi-argumento de 0261
-- antes de restaurar la firma mono-argumento de 0260.

-- 1. Eliminar la firma bi-argumento de 0261
drop function if exists public.connect_archive_conversation(uuid, boolean);

-- 2. Restaurar la firma mono-argumento de 0260
create or replace function public.connect_archive_conversation(p_conversation_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_my_role public.connect_member_role_t;
begin
  select member_role into v_my_role from public.connect_participants
   where conversation_id = p_conversation_id and profile_id = auth.uid();
  if v_my_role not in ('owner','moderator')
     and not public.is_admin()
     and not public.has_permission('connect.edit')
     and not public._connect_is_member(p_conversation_id) then
    raise exception 'sin permiso para archivar' using errcode = 'insufficient_privilege';
  end if;
  update public.connect_conversations set archived_at = now() where id = p_conversation_id;
end;
$$;

revoke all on function public.connect_archive_conversation(uuid) from public, anon, authenticated;
grant execute on function public.connect_archive_conversation(uuid) to authenticated;

notify pgrst, 'reload schema';
