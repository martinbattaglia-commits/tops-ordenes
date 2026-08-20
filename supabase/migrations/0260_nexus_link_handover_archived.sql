-- 0260_nexus_link_handover_archived.sql — Nexus Link · EXP-NEXUS-LINK-24H-HANDOVER-ARCHIVE-V1
-- ─────────────────────────────────────────────────────────────────────────
-- 1. Campos `handover_state` y `handover_at` en `connect_conversations`.
-- 2. Trigger en `connect_messages` para alternar a `PAUSED_HUMAN` cuando un operador humano
--    (Martín, Cynthia, Ruth, José Luis u otro operador staff) envía un mensaje.
-- 3. RPC `connect_set_handover_state` para control manual desde la UI.
-- 4. Actualización de `connect_archive_conversation` para asegurar persistencia y permisos.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.connect_conversations
  add column if not exists handover_state text not null default 'BOT_ACTIVE' check (handover_state in ('BOT_ACTIVE', 'PAUSED_HUMAN')),
  add column if not exists handover_at timestamptz;

-- Index para búsquedas de conversaciones con bot pausado
create index if not exists connect_conversations_handover_idx
  on public.connect_conversations (handover_state) where handover_state = 'PAUSED_HUMAN';

-- Trigger: al insertar un mensaje de tipo staff en un hilo WhatsApp/connect, pausar Max Bot automáticamente
create or replace function public._connect_trg_handover_human_message()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_kind public.connect_conversation_kind_t;
  v_part_type public.connect_participant_type_t;
begin
  -- Obtener kind de conversación
  select kind into v_kind from public.connect_conversations where id = new.conversation_id;
  if not found then return new; end if;

  -- Solo evaluar hilos de whatsapp / connect
  if v_kind in ('whatsapp', 'dm', 'group', 'channel') then
    if new.author_participant_id is not null then
      select participant_type into v_part_type
        from public.connect_participants
       where id = new.author_participant_id;

      if v_part_type = 'staff' then
        update public.connect_conversations
           set handover_state = 'PAUSED_HUMAN',
               handover_at = now()
         where id = new.conversation_id
           and (handover_state is distinct from 'PAUSED_HUMAN');
      end if;
    elsif new.author_profile_id is not null then
      -- Mensaje enviado por perfil de usuario autenticado (staff)
      update public.connect_conversations
         set handover_state = 'PAUSED_HUMAN',
             handover_at = now()
       where id = new.conversation_id
         and (handover_state is distinct from 'PAUSED_HUMAN');
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_connect_messages_handover on public.connect_messages;
create trigger trg_connect_messages_handover
  after insert on public.connect_messages
  for each row execute function public._connect_trg_handover_human_message();

-- RPC para cambiar el estado de handover (ej. reanudar bot o pausar manualmente)
create or replace function public.connect_set_handover_state(
  p_conversation_id uuid,
  p_state text
) returns void
language plpgsql security definer set search_path = public, pg_temp
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
revoke all on function public.connect_set_handover_state(uuid, text) from public, anon, authenticated;
grant execute on function public.connect_set_handover_state(uuid, text) to authenticated;

-- RPC `connect_archive_conversation` permisible para staff/miembros con permiso `connect.edit`
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
