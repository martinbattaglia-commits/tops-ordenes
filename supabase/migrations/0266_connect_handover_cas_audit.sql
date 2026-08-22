-- 0266_connect_handover_cas_audit.sql
-- Control atómico de handover con CAS obligatorio, RBAC exacto de canal WhatsApp y auditoría integral

-- 1. Agregar columna handover_by para auditoría de actor
alter table public.connect_conversations
  add column if not exists handover_by uuid references public.profiles(id);

-- 2. Limpieza de firmas previas sin CAS o con sobrecargas ambiguas
drop function if exists public.connect_set_handover_state(uuid, text);
drop function if exists public.connect_set_handover_state(uuid, text, text);

-- 3. Función canónica con CAS obligatorio, RBAC exacto nexus_link_can y auditoría integral
create or replace function public.connect_set_handover_state(
  p_conversation_id uuid,
  p_state text,
  p_expected_state text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current_state text;
  v_kind text;
  v_updated_at timestamptz;
  v_actor uuid := auth.uid();
begin
  if p_state not in ('BOT_ACTIVE', 'PAUSED_HUMAN') then
    raise exception 'Estado de handover inválido: %', p_state using errcode = 'check_violation';
  end if;

  if p_expected_state is null or p_expected_state not in ('BOT_ACTIVE', 'PAUSED_HUMAN') then
    raise exception 'p_expected_state obligatorio y válido para CAS: %', p_expected_state using errcode = 'check_violation';
  end if;

  -- Autorización empresarial exacta: exige explícitamente nexus_link.whatsapp.send
  if not public.nexus_link_can('nexus_link.whatsapp.send') then
    raise exception 'sin permiso para modificar handover de whatsapp' using errcode = 'insufficient_privilege';
  end if;

  -- Bloqueo atómico FOR UPDATE sobre la conversación
  select handover_state, kind into v_current_state, v_kind
    from public.connect_conversations
   where id = p_conversation_id
     for update;

  if not found then
    raise exception 'conversacion inexistente' using errcode = 'no_data_found';
  end if;

  if v_kind <> 'whatsapp' then
    raise exception 'la conversacion no es de tipo whatsapp' using errcode = 'check_violation';
  end if;

  -- CAS: si el estado actual difiere del esperado, conflicto sin mutar
  if v_current_state <> p_expected_state then
    return jsonb_build_object(
      'ok', false,
      'state', v_current_state,
      'conflict', true,
      'message', 'El estado fue modificado por otro operador.'
    );
  end if;

  -- Transición exitosa: audita handover_at y handover_by en TODAS las transiciones (pausa y reactivación)
  update public.connect_conversations
     set handover_state = p_state,
         handover_at = now(),
         handover_by = v_actor
   where id = p_conversation_id
  returning handover_at into v_updated_at;

  return jsonb_build_object(
    'ok', true,
    'state', p_state,
    'updated_at', v_updated_at,
    'actor', v_actor
  );
end;
$$;

revoke all on function public.connect_set_handover_state(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.connect_set_handover_state(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
