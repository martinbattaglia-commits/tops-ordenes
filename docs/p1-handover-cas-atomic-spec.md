# Especificación de Transición Atómica y CAS de Handover (P1 / HIGH 1)

**Estado:** `PREPARADA / PENDIENTE DE DIRECCIÓN — AUTORIZACIÓN DE MIGRACIÓN/INFRAESTRUCTURA`
**Expediente:** `HOTFIX-LINK-V2` / `NEXUS-LINK-MAX-RECOVERY`

---

## 1. Alcance Canónico

Para evitar carreras concurrentes entre dos operadores simultáneos o ante dobles clics rápidos, el control de handover implementa:
1. **Compare-And-Swap (CAS) Obligatorio:** Verificación de estado esperado (`p_expected_state`). Si el estado actual difiere, se rechaza la mutación reportando conflicto sin sobrescribir el estado confirmado del otro operador.
2. **Autorización Empresarial Exacta:** Exige dentro de la base `nexus_link_can('nexus_link.whatsapp.send')` y valida que la conversación sea de `kind = 'whatsapp'`.
3. **Auditoría de Actor y Fecha en Todas las Transiciones:** Registro de `handover_by = auth.uid()` y `handover_at = now()` tanto en pausa como en reactivación.
4. **Sincronización Realtime:** `ThreadView` reconcilia el estado mediante suscripción a `connect_conversations`.

---

## 2. Migración Forward (Preparada — No aplicada)

```sql
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
```

---

## 3. Rollback de Migración

```sql
-- ROLLBACK_0266_connect_handover_cas_audit.sql
-- Inversa data-preserving de 0266: restaura la función previa de 0260.

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
```
