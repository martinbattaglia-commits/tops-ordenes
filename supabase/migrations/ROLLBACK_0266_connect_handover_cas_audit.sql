-- ROLLBACK_0266_connect_handover_cas_audit.sql — Nexus Link · EXP-NEXUS-LINK-MAX-RECOVERY
-- ─────────────────────────────────────────────────────────────────────────
-- Inversa data-preserving de 0266: restaura la función previa de 0260.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Data-preserving: se retira la columna handover_by únicamente si no contiene datos históricos de auditoría.
do $$
begin
  if not exists (select 1 from public.connect_conversations where handover_by is not null) then
    alter table public.connect_conversations drop column if exists handover_by;
  end if;
end;
$$;

-- 2. Elimina la firma de 0266 con CAS
drop function if exists public.connect_set_handover_state(uuid, text, text);

-- 3. Restaura connect_set_handover_state con la firma y comportamiento de 0260
create or replace function public.connect_set_handover_state(
  p_conversation_id uuid,
  p_state text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_state not in ('BOT_ACTIVE', 'PAUSED_HUMAN') then
    raise exception 'Estado de handover inválido: %', p_state using errcode = 'check_violation';
  end if;

  if not (public.has_permission('connect.edit') or public._connect_is_member(p_conversation_id) or public.is_admin()) then
    raise exception 'sin permiso para modificar handover' using errcode = 'insufficient_privilege';
  end if;

  update public.connect_conversations
     set handover_state = p_state,
         handover_at = case when p_state = 'PAUSED_HUMAN' then now() else handover_at end
   where id = p_conversation_id;
end;
$$;

revoke all on function public.connect_set_handover_state(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.connect_set_handover_state(uuid, text) to authenticated;

notify pgrst, 'reload schema';
