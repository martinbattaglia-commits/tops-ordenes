-- 0261_connect_archive_force_override.sql — Nexus Link · EXP-WA-WEBHOOKS-ARCH-LEGEND-UX24H-V1
-- ─────────────────────────────────────────────────────────────────────────
-- Actualizar `connect_archive_conversation` aceptando `p_force boolean DEFAULT false`
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.connect_archive_conversation(
  p_conversation_id uuid,
  p_force boolean default false
)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_my_role public.connect_member_role_t;
  v_has_open_task boolean := false;
begin
  select member_role into v_my_role from public.connect_participants
   where conversation_id = p_conversation_id and profile_id = auth.uid();

  if v_my_role not in ('owner','moderator')
     and not public.is_admin()
     and not public.has_permission('connect.edit')
     and not public._connect_is_member(p_conversation_id) then
    raise exception 'sin permiso para archivar' using errcode = 'insufficient_privilege';
  end if;

  -- Si p_force es false, verificar si existen tareas asociadas no cerradas
  if not p_force then
    select exists (
      select 1
        from public.connect_conversation_links cl
        join public.connect_tasks t on cl.entity_type = 'task' and cl.entity_id = t.id
       where cl.conversation_id = p_conversation_id
         and t.estado not in ('completada', 'cancelada')
    ) into v_has_open_task;

    if v_has_open_task then
      raise exception 'esta conversación pertenece a una tarea abierta' using errcode = 'check_violation';
    end if;
  end if;

  update public.connect_conversations set archived_at = now() where id = p_conversation_id;
end;
$$;

revoke all on function public.connect_archive_conversation(uuid, boolean) from public, anon, authenticated;
grant execute on function public.connect_archive_conversation(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
