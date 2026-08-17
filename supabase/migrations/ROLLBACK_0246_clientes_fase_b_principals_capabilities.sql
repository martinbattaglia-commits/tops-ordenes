-- Inversa exacta de 0246 sobre el estado preflight de origin/main 8f538a7.
-- Debe ejecutarse después de 0249. Retirado el aislamiento por sede, 0247 y
-- 0248 ya no existen y no hay nada que deshacer antes.

do $$
declare v_role uuid; v_count integer;
begin
  select id into strict v_role from public.roles where slug='jefe_deposito';
  select count(*) into v_count from public.role_permissions where role_id=v_role;
  if v_count<>9 or exists(
    select 1 from public.role_permissions rp join public.permissions p on p.id=rp.permission_id
    where rp.role_id=v_role and p.slug not in (
      'nexus_link.internal_chat.read','nexus_link.internal_chat.send',
      'nexus_link.internal_chat.media','servicios.view','servicios.create',
      'servicios.sign','wms.view','wms.edit','wms.clients.create'
    )
  ) then raise exception 'ROLLBACK_0246_BLOCKED: capacidades FASE B divergentes'; end if;
  if (select count(*) from public.user_roles ur join auth.users u on u.id=ur.user_id
      where ur.role_id=v_role and (u.id,lower(u.email)) in (
        ('4cf9b607-36bb-4ed9-ab31-82823d625b8d'::uuid,'despachos-lujan@logisticatops.com'),
        ('3873f156-02de-4424-af48-3e590536cc1d'::uuid,'despachos-magaldi@logisticatops.com')
      ))<>2 then raise exception 'ROLLBACK_0246_BLOCKED: identidades canónicas divergentes'; end if;
end $$;

-- Restaura las policies vigentes al terminar 0239a.
drop policy if exists "connect_conversations select" on public.connect_conversations;
create policy "connect_conversations select" on public.connect_conversations for select to authenticated using (
  public.has_permission('connect.view')
  and (public._connect_is_member(id) or (kind='channel' and visibility='public') or public.is_admin())
  and (kind<>'whatsapp' or public.nexus_link_can('nexus_link.whatsapp.read'))
);
drop policy if exists "connect_participants select" on public.connect_participants;
create policy "connect_participants select" on public.connect_participants for select to authenticated using (
  public.has_permission('connect.view')
  and (public._connect_is_member(conversation_id) or public.is_admin())
  and public._connect_channel_allowed(conversation_id)
);
drop policy if exists "connect_messages select" on public.connect_messages;
create policy "connect_messages select" on public.connect_messages for select to authenticated using (
  public.has_permission('connect.view') and public._connect_is_member(conversation_id)
  and public._connect_channel_allowed(conversation_id)
);
drop policy if exists "connect_messages insert" on public.connect_messages;
create policy "connect_messages insert" on public.connect_messages for insert to authenticated with check (
  public.has_permission('connect.create') and public._connect_is_member(conversation_id)
  and author_profile_id=auth.uid() and public._wa_insert_sin_evidencia(meta,external_msg_id)
);
drop policy if exists "connect_attachments select" on public.connect_attachments;
create policy "connect_attachments select" on public.connect_attachments for select to authenticated using (
  public.has_permission('connect.view') and public._connect_is_member(conversation_id)
  and public._connect_channel_allowed(conversation_id)
);
drop policy if exists "connect_attachments insert" on public.connect_attachments;
create policy "connect_attachments insert" on public.connect_attachments for insert to authenticated with check (
  public.has_permission('connect.create') and public._connect_is_member(conversation_id)
  and uploaded_by=auth.uid()
);
drop policy if exists "connect_message_edits select" on public.connect_message_edits;
create policy "connect_message_edits select" on public.connect_message_edits for select to authenticated using (
  public.has_permission('connect.view') and exists(select 1 from public.connect_messages m
    where m.id=connect_message_edits.message_id and public._connect_is_member(m.conversation_id))
);
drop policy if exists "connect_message_reactions select" on public.connect_message_reactions;
create policy "connect_message_reactions select" on public.connect_message_reactions for select to authenticated using (
  public.has_permission('connect.view') and exists(select 1 from public.connect_messages m
    where m.id=connect_message_reactions.message_id and public._connect_is_member(m.conversation_id))
);
drop policy if exists "connect_message_mentions select" on public.connect_message_mentions;
create policy "connect_message_mentions select" on public.connect_message_mentions for select to authenticated using (
  public.has_permission('connect.view') and exists(select 1 from public.connect_messages m
    where m.id=connect_message_mentions.message_id and public._connect_is_member(m.conversation_id))
);
drop policy if exists "connect_conversation_links select" on public.connect_conversation_links;
create policy "connect_conversation_links select" on public.connect_conversation_links for select to authenticated using (
  public.has_permission('connect.view') and public._connect_is_member(conversation_id)
);
drop policy if exists "connect-files read members" on storage.objects;
create policy "connect-files read members" on storage.objects for select to authenticated using (
  bucket_id='connect-files' and public.has_permission('connect.view')
  and public._connect_storage_object_allowed(bucket_id,name)
);

drop function if exists public.nexus_depot_manager_connect_search(text,integer);
drop function if exists public.nexus_depot_manager_connect_mark_read(uuid,bigint);
drop function if exists public.nexus_depot_manager_connect_post_message(uuid,text,uuid,text,uuid[],uuid[]);
drop function if exists public.nexus_depot_manager_connect_create_conversation(
  public.connect_conversation_kind_t,text,text,text,uuid[]
);

drop function if exists public.connect_edit_message(uuid,text);
drop function if exists public.connect_delete_message(uuid);
drop function if exists public.connect_react(uuid,text);
drop function if exists public.connect_unreact(uuid,text);
drop function if exists public.connect_mark_read(uuid,bigint);
drop function if exists public.connect_add_member(uuid,uuid,public.connect_member_role_t);
drop function if exists public.connect_remove_member(uuid,uuid);
drop function if exists public.connect_set_member_role(uuid,uuid,public.connect_member_role_t);
drop function if exists public.connect_archive_conversation(uuid);
drop function if exists public.connect_set_topic(uuid,text);
drop function if exists public.connect_set_title(uuid,text);
drop function if exists public.connect_toggle_favorite(uuid,boolean);
drop function if exists public.connect_pin_message(uuid);
drop function if exists public.connect_unpin_message(uuid);
drop function if exists public.connect_flag_message(uuid,text);
drop function if exists public.connect_unflag_message(uuid,text);
drop function if exists public.connect_join_channel(uuid);
drop function if exists public.nexus_depot_manager_reject_legacy_connect();

alter function public.connect_edit_message_pre_0246(uuid,text) rename to connect_edit_message;
alter function public.connect_delete_message_pre_0246(uuid) rename to connect_delete_message;
alter function public.connect_react_pre_0246(uuid,text) rename to connect_react;
alter function public.connect_unreact_pre_0246(uuid,text) rename to connect_unreact;
alter function public.connect_mark_read_pre_0246(uuid,bigint) rename to connect_mark_read;
alter function public.connect_add_member_pre_0246(uuid,uuid,public.connect_member_role_t) rename to connect_add_member;
alter function public.connect_remove_member_pre_0246(uuid,uuid) rename to connect_remove_member;
alter function public.connect_set_member_role_pre_0246(uuid,uuid,public.connect_member_role_t) rename to connect_set_member_role;
alter function public.connect_archive_conversation_pre_0246(uuid) rename to connect_archive_conversation;
alter function public.connect_set_topic_pre_0246(uuid,text) rename to connect_set_topic;
alter function public.connect_set_title_pre_0246(uuid,text) rename to connect_set_title;
alter function public.connect_toggle_favorite_pre_0246(uuid,boolean) rename to connect_toggle_favorite;
alter function public.connect_pin_message_pre_0246(uuid) rename to connect_pin_message;
alter function public.connect_unpin_message_pre_0246(uuid) rename to connect_unpin_message;
alter function public.connect_flag_message_pre_0246(uuid,text) rename to connect_flag_message;
alter function public.connect_unflag_message_pre_0246(uuid,text) rename to connect_unflag_message;
alter function public.connect_join_channel_pre_0246(uuid) rename to connect_join_channel;
grant execute on function public.connect_edit_message(uuid,text),public.connect_delete_message(uuid),public.connect_react(uuid,text),public.connect_unreact(uuid,text),public.connect_mark_read(uuid,bigint),public.connect_add_member(uuid,uuid,public.connect_member_role_t),public.connect_remove_member(uuid,uuid),public.connect_set_member_role(uuid,uuid,public.connect_member_role_t),public.connect_archive_conversation(uuid),public.connect_set_topic(uuid,text),public.connect_set_title(uuid,text),public.connect_toggle_favorite(uuid,boolean),public.connect_pin_message(uuid),public.connect_unpin_message(uuid),public.connect_flag_message(uuid,text),public.connect_unflag_message(uuid,text),public.connect_join_channel(uuid) to authenticated;

drop function if exists public.connect_emit_attachment_signed_url(uuid);
alter function public.connect_emit_attachment_signed_url_0237(uuid)
  rename to connect_emit_attachment_signed_url;
revoke all on function public.connect_emit_attachment_signed_url(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.connect_emit_attachment_signed_url(uuid) to authenticated;

drop function if exists public.connect_search_profiles(text,int);
alter function public.connect_search_profiles_0158(text,int) rename to connect_search_profiles;
revoke all on function public.connect_search_profiles(text,int)
  from public,anon,authenticated,service_role;
grant execute on function public.connect_search_profiles(text,int) to authenticated;

drop function if exists public.nexus_depot_manager_internal_conversation_allowed(uuid,text);

-- current_role() NO se toca: retirado el aislamiento, 0246 ya no la modifica,
-- así que su inversa tampoco. Sigue siendo la de 0005_fix_rls_recursion.sql.
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select coalesce((select role in ('admin','operaciones','supervisor') from public.profiles where id=auth.uid()),false) $$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select coalesce((select role='admin' from public.profiles where id=auth.uid()),false) $$;
create or replace function public.has_permission(p_slug text)
returns boolean language sql stable set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.user_roles ur
    join public.role_permissions rp on rp.role_id=ur.role_id
    join public.permissions p on p.id=rp.permission_id
    where ur.user_id=auth.uid() and p.slug=p_slug
  ) or public.current_role()='admin'
$$;
revoke all on function public.current_role() from public;
revoke all on function public.is_staff() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.current_role() to authenticated,anon,service_role;
grant execute on function public.is_staff() to authenticated,anon,service_role;
grant execute on function public.is_admin() to authenticated,anon,service_role;
revoke all on function public.has_permission(text) from public,anon,authenticated,service_role;
grant execute on function public.has_permission(text) to public;

delete from public.role_permissions rp using public.roles r
where rp.role_id=r.id and r.slug='jefe_deposito';
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.slug in (
  'cockpit.view','connect.create','connect.edit','connect.view',
  'knowledge.view','mi_espacio.view','nexus_link.internal_chat.read',
  'nexus_link.internal_chat.send','nexus_link.internal_chat.media',
  'servicios.create','servicios.sign','servicios.view','wms.edit','wms.view'
) where r.slug='jefe_deposito';

update public.user_roles ur set depot=null
from auth.users u,public.roles r
where ur.user_id=u.id and ur.role_id=r.id and r.slug='jefe_deposito'
  and (u.id,lower(u.email)) in (
    ('4cf9b607-36bb-4ed9-ab31-82823d625b8d'::uuid,'despachos-lujan@logisticatops.com'),
    ('3873f156-02de-4424-af48-3e590536cc1d'::uuid,'despachos-magaldi@logisticatops.com')
  );
update public.profiles p set depot=null from auth.users u
where p.id=u.id and (u.id,lower(u.email)) in (
  ('4cf9b607-36bb-4ed9-ab31-82823d625b8d'::uuid,'despachos-lujan@logisticatops.com'),
  ('3873f156-02de-4424-af48-3e590536cc1d'::uuid,'despachos-magaldi@logisticatops.com')
);

drop function if exists public.nexus_depot_manager_valid();
drop function if exists public.nexus_depot_manager_scope();
drop function if exists public.nexus_is_depot_manager_principal();

notify pgrst,'reload schema';
