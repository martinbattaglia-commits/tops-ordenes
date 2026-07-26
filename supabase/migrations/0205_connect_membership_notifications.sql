-- 0205_connect_membership_notifications.sql — LINK-UX-001 · UX-1a
-- ─────────────────────────────────────────────────────────────────────────
-- ENTREGADA, NO APLICADA. Aplicar a mano en el SQL Editor de prod
-- (arsksytgdnzukbmfgkju) EJECUTANDO EL ARCHIVO COMPLETO COMO UN SOLO BATCH.
-- Numeración local 0205 (0195-0204 consumidas por Caja Chica / Ventas r3);
-- el stamp real de prod es el timestamp del apply (R-N1).
--
-- Problema (auditoría LINK-UX-001 §2): ser agregado a una conversación no
-- genera NINGÚN aviso — `connect_add_member` (0144/0163) y la membresía
-- inicial de `connect_create_conversation` no insertan en `notifications`.
-- La @mención quedó como único mecanismo percibido de aviso.
--
-- Cambio (resolución de Dirección 2026-07-26, §3.3 INCLUIDO):
--   (1) Helper `_connect_membership_notify` — molde EXACTO de
--       `_connect_task_notify` (0169): síncrono, actor excluido, sin PII
--       (título de conversación + nombre del actor; nunca contenido).
--       kind='connect_membership', entity='connect',
--       entity_id=conversation_id (convención 0147:15 → hrefFor ya rutea
--       al hilo SIN cambios de UI en campana/Centro).
--   (2) Helper `_connect_post_system_message` — registro en actividad DENTRO
--       del hilo ("X agregó a Y"). `connect_messages.seq` es GENERATED
--       ALWAYS AS IDENTITY (verificado en vivo) ⇒ insert plano; el trigger
--       `trg_connect_messages_enqueue` actualiza last_message_* y publica
--       'connect.message.posted' al outbox por sí solo. La rama DM del
--       trigger sólo notifica kind='text' ⇒ el mensaje de sistema NO genera
--       notificaciones de DM (cero ruido doble).
--   (3) `connect_add_member`: notifica + mensaje de sistema SOLO `if found`
--       (el ON CONFLICT DO NOTHING existente deja FOUND=false en re-adds ⇒
--       idempotente, cero duplicados). Cuerpo base = DEFINICIÓN VIVA DE PROD
--       leída 2026-07-26 (incluye guard de archivado 0163 — NO la versión
--       del archivo 0144).
--   (4) `connect_create_conversation`: notifica a cada miembro inicial
--       (creador excluido por el helper) + UN mensaje de sistema agregado.
--       Cuerpo base = definición viva de prod.
--       ⚠️ Las conversaciones kind='dm' quedan EXCLUIDAS de aviso y mensaje
--       de sistema: el aviso de DM ya existe vía coalescing (0161) y el
--       "X agregó a Y" en un DM 1:1 es ruido sin valor de trazabilidad.
--
-- FUERA DE ALCANCE (resolución): email (LINK-NOTIFY-001) · WhatsApp · IA ·
-- Clientify. `connect_task_follow` NO se toca: la versión viva de prod YA
-- notifica al seguidor agregado por un tercero (verificado 2026-07-26).
--
-- Firmas: NINGUNA aridad cambia ⇒ CREATE OR REPLACE seguro (no aplica el
-- riesgo D-F41-4 de sobrecarga). IDEMPOTENTE: re-ejecutar = mismo estado.
-- DEPENDE de: 0143/0144/0147/0161/0163.
-- ─────────────────────────────────────────────────────────────────────────

-- ===== (1) Helper: notificación de membresía (molde _connect_task_notify) =====

create or replace function public._connect_membership_notify(
  p_user uuid, p_conversation_id uuid, p_conv_label text, p_actor_name text
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  insert into public.notifications (user_id, kind, title, message, entity, entity_id, priority)
  values (
    p_user,
    'connect_membership',
    'Te agregaron a ' || coalesce(nullif(trim(p_conv_label), ''), 'una conversación'),
    coalesce(nullif(trim(p_actor_name), ''), 'Un usuario') || ' te agregó como participante.',
    'connect',
    p_conversation_id,
    'normal'
  );
end;
$$;
revoke all on function public._connect_membership_notify(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public._connect_membership_notify(uuid, uuid, text, text) to service_role;

-- ===== (2) Helper: mensaje de sistema en el hilo (registro en actividad) =====
-- seq = IDENTITY; autores NULL; el AFTER trigger hace last_message_* + outbox.

create or replace function public._connect_post_system_message(
  p_conversation_id uuid, p_body text
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_body is null or trim(p_body) = '' then return; end if;
  insert into public.connect_messages (conversation_id, kind, body)
  values (p_conversation_id, 'system', trim(p_body));
end;
$$;
revoke all on function public._connect_post_system_message(uuid, text) from public, anon, authenticated;
grant execute on function public._connect_post_system_message(uuid, text) to service_role;

-- ===== Helper interno: nombre visible de un perfil (patrón de 0161) =====

create or replace function public._connect_profile_display_name(p_profile uuid)
returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select nullif(btrim(coalesce(p.full_name, '') || ' ' || coalesce(p.apellido, '')), '')
    from public.profiles p where p.id = p_profile;
$$;
revoke all on function public._connect_profile_display_name(uuid) from public, anon, authenticated;
grant execute on function public._connect_profile_display_name(uuid) to service_role;

-- ===== (3) connect_add_member — base: DEFINICIÓN VIVA DE PROD (0144+0163) =====

create or replace function public.connect_add_member(
  p_conversation_id uuid, p_profile_id uuid, p_role public.connect_member_role_t
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_my_role    public.connect_member_role_t;
  v_kind       public.connect_conversation_kind_t;
  v_conv_label text;
  v_actor_name text;
  v_added_name text;
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

  -- UX-1a: aviso + registro en el hilo SOLO si el insert ocurrió de verdad
  -- (FOUND=false en re-add por el ON CONFLICT ⇒ idempotente). DMs excluidos.
  if found then
    select c.kind, coalesce(c.title, case when c.slug is not null then '#' || c.slug end)
      into v_kind, v_conv_label
      from public.connect_conversations c where c.id = p_conversation_id;
    if v_kind is distinct from 'dm' then
      v_actor_name := public._connect_profile_display_name(auth.uid());
      v_added_name := public._connect_profile_display_name(p_profile_id);
      perform public._connect_membership_notify(
        p_profile_id, p_conversation_id, v_conv_label, v_actor_name);
      perform public._connect_post_system_message(
        p_conversation_id,
        coalesce(v_actor_name, 'Un usuario') || ' agregó a '
          || coalesce(v_added_name, 'un usuario') || ' a la conversación.');
    end if;
  end if;
end;
$$;
revoke all on function public.connect_add_member(uuid, uuid, public.connect_member_role_t) from public, anon, authenticated;
grant execute on function public.connect_add_member(uuid, uuid, public.connect_member_role_t) to authenticated;

-- ===== (4) connect_create_conversation — base: DEFINICIÓN VIVA DE PROD =====

create or replace function public.connect_create_conversation(
  p_kind public.connect_conversation_kind_t, p_title text, p_slug text, p_visibility text,
  p_member_profile_ids uuid[], p_entity_type text default null,
  p_entity_id uuid default null, p_entity_id_text text default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_conv_id     uuid;
  v_pid         uuid;
  v_conv_label  text;
  v_actor_name  text;
  v_member_name text;
  v_added_names text[] := '{}';
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
    v_conv_label := coalesce(nullif(trim(p_title),''),
                             case when nullif(trim(p_slug),'') is not null then '#' || trim(p_slug) end);
    v_actor_name := public._connect_profile_display_name(auth.uid());
    foreach v_pid in array p_member_profile_ids loop
      if v_pid is not null and v_pid <> auth.uid() then
        insert into public.connect_participants (conversation_id, participant_type, profile_id, member_role)
        values (v_conv_id, 'staff', v_pid, 'member')
        on conflict (conversation_id, profile_id) do nothing;
        -- UX-1a: aviso por miembro realmente insertado (FOUND cubre ids
        -- duplicados dentro del array). DMs excluidos (aviso ya cubierto
        -- por el coalescing de DM de 0161 al primer mensaje).
        if found and p_kind is distinct from 'dm' then
          perform public._connect_membership_notify(v_pid, v_conv_id, v_conv_label, v_actor_name);
          v_member_name := public._connect_profile_display_name(v_pid);
          if v_member_name is not null then
            v_added_names := v_added_names || v_member_name;
          end if;
        end if;
      end if;
    end loop;
    -- UX-1a: UN solo mensaje de sistema agregado (trazabilidad de conformación).
    if p_kind is distinct from 'dm' and coalesce(array_length(v_added_names, 1), 0) > 0 then
      perform public._connect_post_system_message(
        v_conv_id,
        coalesce(v_actor_name, 'Un usuario') || ' agregó a '
          || array_to_string(v_added_names, ', ') || ' a la conversación.');
    end if;
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

-- ===== Verificación post-apply (read-only, correr aparte) ==================
-- select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--  where n.nspname='public' and proname in
--  ('_connect_membership_notify','_connect_post_system_message','_connect_profile_display_name');
-- -- debe devolver 3 filas.
-- select prosrc like '%_connect_membership_notify%' as add_member_ok
--   from pg_proc where proname='connect_add_member';         -- true
-- select prosrc like '%_connect_membership_notify%' as create_conv_ok
--   from pg_proc where proname='connect_create_conversation'; -- true
