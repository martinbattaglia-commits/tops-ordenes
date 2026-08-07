# ROLLBACK 0205 — connect_membership_notifications (LINK-UX-001 · UX-1a)

**Efecto de la reversión:** las 2 RPCs vuelven a sus cuerpos previos (definiciones vivas de prod
al 2026-07-26, capturadas por `pg_get_functiondef` antes de escribir 0205) y se eliminan los
3 helpers nuevos. Las notificaciones `connect_membership` y los mensajes `kind='system'` ya
insertados **quedan como datos históricos inofensivos** (no se borran: son trazabilidad real).

**Ejecutar como UN SOLO BATCH en el SQL Editor de prod.**

```sql
-- (1) connect_add_member — cuerpo previo (0144 + guard 0163, capturado en vivo)
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

-- (2) connect_create_conversation — cuerpo previo (capturado en vivo)
create or replace function public.connect_create_conversation(
  p_kind public.connect_conversation_kind_t, p_title text, p_slug text, p_visibility text,
  p_member_profile_ids uuid[], p_entity_type text default null,
  p_entity_id uuid default null, p_entity_id_text text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_conv_id uuid;
  v_pid     uuid;
begin
  if not public.has_permission('connect.create') then
    raise exception 'Sin permiso connect.create' using errcode = 'insufficient_privilege';
  end if;

  insert into public.connect_conversations (kind, title, slug, visibility, created_by)
  values (p_kind, nullif(trim(p_title),''), nullif(trim(p_slug),''),
          nullif(p_visibility,''), auth.uid())
  returning id into v_conv_id;

  insert into public.connect_participants (conversation_id, participant_type, profile_id, member_role)
  values (v_conv_id, 'staff', auth.uid(), 'owner')
  on conflict (conversation_id, profile_id) do nothing;

  if p_member_profile_ids is not null then
    foreach v_pid in array p_member_profile_ids loop
      if v_pid is not null and v_pid <> auth.uid() then
        insert into public.connect_participants (conversation_id, participant_type, profile_id, member_role)
        values (v_conv_id, 'staff', v_pid, 'member')
        on conflict (conversation_id, profile_id) do nothing;
      end if;
    end loop;
  end if;

  if p_entity_type is not null then
    if p_entity_type = 'compliance_items' then
      if p_entity_id_text is null then
        raise exception 'compliance_items requiere entity_id_text' using errcode = 'check_violation';
      end if;
      insert into public.connect_conversation_links (conversation_id, entity_type, entity_id_text, linked_by)
      values (v_conv_id, p_entity_type, p_entity_id_text, auth.uid()) on conflict do nothing;
    else
      if p_entity_id is null then
        raise exception 'entidad % requiere entity_id uuid', p_entity_type using errcode = 'check_violation';
      end if;
      insert into public.connect_conversation_links (conversation_id, entity_type, entity_id, linked_by)
      values (v_conv_id, p_entity_type, p_entity_id, auth.uid()) on conflict do nothing;
    end if;
  end if;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'connect_conversation', v_conv_id, 'connect.create',
          jsonb_build_object('kind', p_kind, 'members', coalesce(array_length(p_member_profile_ids,1),0),
                             'entity_type', p_entity_type));

  return v_conv_id;
end;
$$;
revoke all on function public.connect_create_conversation(public.connect_conversation_kind_t, text, text, text, uuid[], text, uuid, text) from public, anon, authenticated;
grant execute on function public.connect_create_conversation(public.connect_conversation_kind_t, text, text, text, uuid[], text, uuid, text) to authenticated;

-- (3) Helpers nuevos — eliminación
drop function if exists public._connect_membership_notify(uuid, uuid, text, text);
drop function if exists public._connect_post_system_message(uuid, text);
drop function if exists public._connect_profile_display_name(uuid);
```

## Verificación post-rollback (read-only)

```sql
select count(*) = 0 as helpers_eliminados
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('_connect_membership_notify','_connect_post_system_message','_connect_profile_display_name');

select prosrc not like '%_connect_membership_notify%' as add_member_revertido
  from pg_proc where proname = 'connect_add_member';
```

**El frontend no requiere rollback:** el render de `kind='system'` en `ThreadView` es inerte
sin mensajes de sistema nuevos, y la campana/Centro nunca dependieron del kind.
