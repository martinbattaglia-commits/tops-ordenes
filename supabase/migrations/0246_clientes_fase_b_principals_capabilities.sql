-- CLIENTES FASE B · Principales, capacidades y neutralización del rol legacy.
-- Lease: 0245 está ocupado en worktrees hermanos; 0246 es el primer slot libre
-- verificado contra origin/main, todos los worktrees y el ledger productivo.

do $guard$
declare
  v_role_id uuid;
  v_count integer;
begin
  select count(*), (array_agg(id))[1] into v_count, v_role_id
  from public.roles
  where slug = 'jefe_deposito' and name = 'Jefe de Deposito';
  if v_count <> 1 then
    raise exception 'FASE B: rol jefe_deposito no canónico' using errcode = 'check_violation';
  end if;

  select count(*) into v_count
  from auth.users
  where (id, lower(email)) in (
    ('4cf9b607-36bb-4ed9-ab31-82823d625b8d'::uuid, 'despachos-lujan@logisticatops.com'),
    ('3873f156-02de-4424-af48-3e590536cc1d'::uuid, 'despachos-magaldi@logisticatops.com')
  );
  if v_count <> 2 then
    raise exception 'FASE B: usuarios canónicos ausentes o duplicados' using errcode = 'check_violation';
  end if;

  select count(*) into v_count
  from auth.users u
  join public.profiles p on p.id = u.id
  join public.user_roles ur on ur.user_id = u.id and ur.role_id = v_role_id
  where (u.id, lower(u.email)) in (
    ('4cf9b607-36bb-4ed9-ab31-82823d625b8d'::uuid, 'despachos-lujan@logisticatops.com'),
    ('3873f156-02de-4424-af48-3e590536cc1d'::uuid, 'despachos-magaldi@logisticatops.com')
  ) and p.active is not distinct from true;
  if v_count <> 2 then
    raise exception 'FASE B: perfil activo o asignación canónica no verificable' using errcode = 'check_violation';
  end if;

  select count(*) into v_count
  from auth.users u
  join public.profiles p on p.id=u.id
  join public.user_roles ur on ur.user_id=u.id and ur.role_id=v_role_id
  where (u.id,lower(u.email)) in (
    ('4cf9b607-36bb-4ed9-ab31-82823d625b8d'::uuid,'despachos-lujan@logisticatops.com'),
    ('3873f156-02de-4424-af48-3e590536cc1d'::uuid,'despachos-magaldi@logisticatops.com')
  ) and p.depot is null and ur.depot is null;
  if v_count <> 2 then
    raise exception 'FASE B: la proyección de sede previa no coincide con origin/main'
      using errcode='check_violation';
  end if;

  select count(*) into v_count
  from public.user_roles ur
  where ur.role_id = v_role_id;
  if v_count <> 2 then
    raise exception 'FASE B: jefe_deposito tiene asignaciones fuera del alcance canónico'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_count
  from public.role_permissions rp
  join public.permissions p on p.id=rp.permission_id
  where rp.role_id=v_role_id
    and p.slug in (
      'cockpit.view','connect.create','connect.edit','connect.view',
      'knowledge.view','mi_espacio.view','nexus_link.internal_chat.read',
      'nexus_link.internal_chat.send','nexus_link.internal_chat.media',
      'servicios.create','servicios.sign','servicios.view','wms.edit','wms.view'
    );
  if v_count <> 14 or exists(
    select 1 from public.role_permissions rp
    join public.permissions p on p.id=rp.permission_id
    where rp.role_id=v_role_id and p.slug not in (
      'cockpit.view','connect.create','connect.edit','connect.view',
      'knowledge.view','mi_espacio.view','nexus_link.internal_chat.read',
      'nexus_link.internal_chat.send','nexus_link.internal_chat.media',
      'servicios.create','servicios.sign','servicios.view','wms.edit','wms.view'
    )
  ) then
    raise exception 'FASE B: permisos previos de jefe_deposito no coinciden con origin/main'
      using errcode='check_violation';
  end if;

  select count(*) into v_count
  from public.warehouses
  where code in ('PEDRO_LUJAN_3159', 'MAGALDI_1765');
  if v_count <> 2 then
    raise exception 'FASE B: sedes WMS canónicas no verificables' using errcode = 'check_violation';
  end if;
end
$guard$;

-- El rol queda con un conjunto cerrado. No se heredan connect.*, cockpit,
-- conocimiento ni futuros permisos agregados por accidente.
delete from public.role_permissions rp
using public.roles r, public.permissions p
where rp.role_id = r.id
  and rp.permission_id = p.id
  and r.slug = 'jefe_deposito'
  and p.slug not in (
    'nexus_link.internal_chat.read',
    'nexus_link.internal_chat.send',
    'nexus_link.internal_chat.media',
    'servicios.view',
    'servicios.create',
    'servicios.sign',
    'wms.view',
    'wms.edit',
    'wms.clients.create'
  );

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.slug in (
  'nexus_link.internal_chat.read',
  'nexus_link.internal_chat.send',
  'nexus_link.internal_chat.media',
  'servicios.view',
  'servicios.create',
  'servicios.sign',
  'wms.view',
  'wms.edit',
  'wms.clients.create'
)
where r.slug = 'jefe_deposito'
on conflict do nothing;

update public.user_roles ur
set depot = case u.id
  when '4cf9b607-36bb-4ed9-ab31-82823d625b8d'::uuid then 'LUJAN'::public.depot_t
  when '3873f156-02de-4424-af48-3e590536cc1d'::uuid then 'MAGALDI'::public.depot_t
end
from auth.users u, public.roles r
where ur.user_id = u.id
  and ur.role_id = r.id
  and r.slug = 'jefe_deposito'
  and (u.id, lower(u.email)) in (
    ('4cf9b607-36bb-4ed9-ab31-82823d625b8d'::uuid, 'despachos-lujan@logisticatops.com'),
    ('3873f156-02de-4424-af48-3e590536cc1d'::uuid, 'despachos-magaldi@logisticatops.com')
  );

-- profiles.depot se conserva como proyección para documentos/UX. Nunca es la
-- autoridad de FASE B; la función de alcance exige user_roles.depot.
update public.profiles p
set depot = case u.id
  when '4cf9b607-36bb-4ed9-ab31-82823d625b8d'::uuid then 'LUJAN'::public.depot_t
  when '3873f156-02de-4424-af48-3e590536cc1d'::uuid then 'MAGALDI'::public.depot_t
end
from auth.users u
where p.id = u.id
  and (u.id, lower(u.email)) in (
    ('4cf9b607-36bb-4ed9-ab31-82823d625b8d'::uuid, 'despachos-lujan@logisticatops.com'),
    ('3873f156-02de-4424-af48-3e590536cc1d'::uuid, 'despachos-magaldi@logisticatops.com')
  );

create or replace function public.nexus_is_depot_manager_principal()
returns boolean
language sql stable security definer set search_path = public, auth, pg_temp
as $$
  select coalesce(
    auth.uid() is not null and exists (
      select 1 from auth.users u
      where u.id = auth.uid()
        and (
          u.id in (
            '4cf9b607-36bb-4ed9-ab31-82823d625b8d'::uuid,
            '3873f156-02de-4424-af48-3e590536cc1d'::uuid
          ) or lower(u.email) in (
          'despachos-lujan@logisticatops.com',
          'despachos-magaldi@logisticatops.com'
          )
        )
    ), false
  );
$$;
revoke all on function public.nexus_is_depot_manager_principal() from public, anon;
grant execute on function public.nexus_is_depot_manager_principal() to authenticated, service_role;

create or replace function public.nexus_depot_manager_scope()
returns table (
  is_principal boolean,
  is_authorized boolean,
  depot public.depot_t,
  warehouse_id uuid,
  warehouse_code text
)
language sql stable security definer set search_path = public, auth, pg_temp
as $$
  with identity as (
    select
      u.id,
      lower(u.email) as email,
      case
        when u.id = '4cf9b607-36bb-4ed9-ab31-82823d625b8d'::uuid
          or lower(u.email) = 'despachos-lujan@logisticatops.com'
          then '4cf9b607-36bb-4ed9-ab31-82823d625b8d'::uuid
        when u.id = '3873f156-02de-4424-af48-3e590536cc1d'::uuid
          or lower(u.email) = 'despachos-magaldi@logisticatops.com'
          then '3873f156-02de-4424-af48-3e590536cc1d'::uuid
      end as expected_id,
      case
        when u.id = '4cf9b607-36bb-4ed9-ab31-82823d625b8d'::uuid
          or lower(u.email) = 'despachos-lujan@logisticatops.com'
          then 'despachos-lujan@logisticatops.com'
        when u.id = '3873f156-02de-4424-af48-3e590536cc1d'::uuid
          or lower(u.email) = 'despachos-magaldi@logisticatops.com'
          then 'despachos-magaldi@logisticatops.com'
      end as expected_email,
      case
        when u.id = '4cf9b607-36bb-4ed9-ab31-82823d625b8d'::uuid
          or lower(u.email) = 'despachos-lujan@logisticatops.com' then 'LUJAN'::public.depot_t
        when u.id = '3873f156-02de-4424-af48-3e590536cc1d'::uuid
          or lower(u.email) = 'despachos-magaldi@logisticatops.com' then 'MAGALDI'::public.depot_t
      end as expected_depot,
      case
        when u.id = '4cf9b607-36bb-4ed9-ab31-82823d625b8d'::uuid
          or lower(u.email) = 'despachos-lujan@logisticatops.com' then 'PEDRO_LUJAN_3159'
        when u.id = '3873f156-02de-4424-af48-3e590536cc1d'::uuid
          or lower(u.email) = 'despachos-magaldi@logisticatops.com' then 'MAGALDI_1765'
      end as expected_warehouse
    from auth.users u
    where u.id = auth.uid()
      and (u.id in (
        '4cf9b607-36bb-4ed9-ab31-82823d625b8d'::uuid,
        '3873f156-02de-4424-af48-3e590536cc1d'::uuid
      ) or lower(u.email) in (
        'despachos-lujan@logisticatops.com',
        'despachos-magaldi@logisticatops.com'
      ))
  ), resolved as (
    select
      i.*,
      p.active,
      p.id as profile_id,
      w.id as resolved_warehouse_id,
      w.code as resolved_warehouse_code,
      (select count(*) from public.user_roles ur where ur.user_id = i.id) as assignment_count,
      (select count(*)
         from public.user_roles ur
         join public.roles r on r.id = ur.role_id
        where ur.user_id = i.id
          and r.slug = 'jefe_deposito'
          and ur.depot = i.expected_depot) as exact_scope_count,
      (select count(*)
         from public.role_permissions rp
         join public.roles r on r.id = rp.role_id
         join public.permissions cap on cap.id = rp.permission_id
        where r.slug = 'jefe_deposito'
          and cap.slug in (
            'nexus_link.internal_chat.read', 'nexus_link.internal_chat.send',
            'nexus_link.internal_chat.media', 'servicios.view', 'servicios.create',
            'servicios.sign', 'wms.view', 'wms.edit', 'wms.clients.create'
          )) as required_cap_count,
      (select count(*)
         from public.role_permissions rp
         join public.roles r on r.id = rp.role_id
         join public.permissions cap on cap.id = rp.permission_id
        where r.slug = 'jefe_deposito'
          and cap.slug not in (
            'nexus_link.internal_chat.read', 'nexus_link.internal_chat.send',
            'nexus_link.internal_chat.media', 'servicios.view', 'servicios.create',
            'servicios.sign', 'wms.view', 'wms.edit', 'wms.clients.create'
          )) as forbidden_cap_count
    from identity i
    left join public.profiles p on p.id = i.id
    left join public.warehouses w on w.code = i.expected_warehouse and w.active is not distinct from true
  )
  select
    exists(select 1 from identity),
    coalesce(
      r.profile_id is not null
      and r.id = r.expected_id
      and r.email = r.expected_email
      and r.active is not distinct from true
      and r.assignment_count = 1
      and r.exact_scope_count = 1
      and r.required_cap_count = 9
      and r.forbidden_cap_count = 0
      and r.resolved_warehouse_id is not null,
      false
    ),
    case when r.profile_id is not null then r.expected_depot end,
    r.resolved_warehouse_id,
    r.resolved_warehouse_code
  from (select 1) seed
  left join resolved r on true;
$$;
revoke all on function public.nexus_depot_manager_scope() from public, anon;
grant execute on function public.nexus_depot_manager_scope() to authenticated, service_role;

create or replace function public.nexus_depot_manager_valid()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce((select s.is_authorized from public.nexus_depot_manager_scope() s), false);
$$;
revoke all on function public.nexus_depot_manager_valid() from public, anon;
grant execute on function public.nexus_depot_manager_valid() to authenticated, service_role;

-- Para estas identidades, el permiso es la intersección entre el allowlist y
-- el rol/sede válidos. Otros usuarios conservan exactamente la semántica previa.
create or replace function public.has_permission(p_slug text)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if public.nexus_is_depot_manager_principal() then
    if public.nexus_depot_manager_valid() is distinct from true then return false; end if;
    if p_slug not in (
      'nexus_link.internal_chat.read', 'nexus_link.internal_chat.send',
      'nexus_link.internal_chat.media', 'servicios.view', 'servicios.create',
      'servicios.sign', 'wms.view', 'wms.edit', 'wms.clients.create'
    ) then return false; end if;
    return exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id and r.slug = 'jefe_deposito'
      join public.role_permissions rp on rp.role_id = r.id
      join public.permissions p on p.id = rp.permission_id
      where ur.user_id = auth.uid() and p.slug = p_slug
    );
  end if;
  return coalesce(exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = auth.uid() and p.slug = p_slug
  ) or (select role = 'admin' from public.profiles where id = auth.uid()), false);
end;
$$;
revoke all on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated, service_role;

-- Un profiles.role manipulado nunca devuelve staff/admin para los encargados.
-- El único ascenso temporal a operaciones ocurre dentro de wrappers WMS 0248.
-- H-1 · La elevación transaccional NO puede apoyarse en una GUC.
--
-- `nexus.wms_scope` es una GUC placeholder, es decir PGC_USERSET: cualquier rol
-- puede setearla con SET o set_config. Un centinela así sirve para RESTRINGIR
-- —como treasury.via_rpc, que deniega mientras no esté puesta— pero no para
-- CONCEDER, porque lo que concede es `current_role() = 'operaciones'`, la llave
-- de ciento sesenta cláusulas de policy. Que hoy no exista un camino desde
-- PostgREST para ejecutar SET no cierra el punto: la seguridad no puede
-- depender de que ese camino no aparezca.
--
-- La concesión pasa a exigir una fila que SÓLO este definer puede escribir:
-- la tabla no tiene policies y está revocada, de modo que un `SET` a mano ya
-- no eleva nada.
create table if not exists public.nexus_wms_scope_grants (
  xid8_txn text primary key,
  granted_to uuid not null,
  granted_at timestamptz not null default now()
);
alter table public.nexus_wms_scope_grants enable row level security;
revoke all on table public.nexus_wms_scope_grants from public, anon, authenticated;


/** Verdadero sólo dentro de una transacción que pasó por begin_scope. */
create or replace function public.nexus_wms_scope_active()
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$
  select exists (
    select 1 from public.nexus_wms_scope_grants g
    where g.xid8_txn = pg_current_xact_id_if_assigned()::text
      and g.granted_to = auth.uid()
  );
$$;
revoke all on function public.nexus_wms_scope_active() from public, anon;
grant execute on function public.nexus_wms_scope_active() to authenticated, service_role;

create or replace function public.current_role()
returns public.user_role_t
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when public.nexus_is_depot_manager_principal() then
      case
        -- H-1 · La elevación ya no depende de una GUC que el propio usuario
        -- puede setear: exige una concesión escrita por nexus_wms_begin_scope
        -- en una tabla sin policies y revocada, dentro de esta misma
        -- transacción. Sin esa fila, un principal es 'cliente'.
        when public.nexus_wms_scope_active()
         and public.nexus_depot_manager_valid() is not distinct from true
        then 'operaciones'::public.user_role_t
        else 'cliente'::public.user_role_t
      end
    else (select p.role from public.profiles p where p.id = auth.uid())
  end;
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select case when public.nexus_is_depot_manager_principal() then false else coalesce(
    (select role in ('admin','operaciones','supervisor') from public.profiles where id = auth.uid()), false
  ) end;
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select case when public.nexus_is_depot_manager_principal() then false else coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()), false
  ) end;
$$;

revoke all on function public.current_role() from public;
revoke all on function public.is_staff() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.current_role() to authenticated, anon, service_role;
grant execute on function public.is_staff() to authenticated, anon, service_role;
grant execute on function public.is_admin() to authenticated, anon, service_role;

-- Nexus Link queda habilitado por CAPACIDAD DE CANAL, nunca mediante los
-- permisos coarse connect.view/create/edit. La misma función cierra lectura,
-- realtime, búsqueda, adjuntos y signed URLs a conversaciones internas donde
-- el actor es miembro.
create or replace function public.nexus_depot_manager_internal_conversation_allowed(
  p_conversation_id uuid,
  p_capability text
) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    public.nexus_depot_manager_valid() is not distinct from true
    and p_capability in (
      'nexus_link.internal_chat.read',
      'nexus_link.internal_chat.send',
      'nexus_link.internal_chat.media'
    )
    and public.nexus_link_can(p_capability) is not distinct from true
    and exists (
      select 1
      from public.connect_conversations c
      where c.id = p_conversation_id
        and c.kind in ('dm','group','channel')
        and public._connect_is_member(c.id)
    ), false
  );
$$;
revoke all on function public.nexus_depot_manager_internal_conversation_allowed(uuid,text)
  from public, anon;
grant execute on function public.nexus_depot_manager_internal_conversation_allowed(uuid,text)
  to authenticated, service_role;

drop policy if exists "connect_conversations select" on public.connect_conversations;
create policy "connect_conversations select" on public.connect_conversations
for select to authenticated using (
  (
    public.nexus_is_depot_manager_principal() is distinct from true
    and public.has_permission('connect.view')
    and (public._connect_is_member(id) or (kind='channel' and visibility='public') or public.is_admin())
    and (kind <> 'whatsapp' or public.nexus_link_can('nexus_link.whatsapp.read'))
  ) or public.nexus_depot_manager_internal_conversation_allowed(id,'nexus_link.internal_chat.read')
);

drop policy if exists "connect_participants select" on public.connect_participants;
create policy "connect_participants select" on public.connect_participants
for select to authenticated using (
  (
    public.nexus_is_depot_manager_principal() is distinct from true
    and public.has_permission('connect.view')
    and (public._connect_is_member(conversation_id) or public.is_admin())
    and public._connect_channel_allowed(conversation_id)
  ) or public.nexus_depot_manager_internal_conversation_allowed(conversation_id,'nexus_link.internal_chat.read')
);

drop policy if exists "connect_messages select" on public.connect_messages;
create policy "connect_messages select" on public.connect_messages
for select to authenticated using (
  (
    public.nexus_is_depot_manager_principal() is distinct from true
    and public.has_permission('connect.view')
    and public._connect_is_member(conversation_id)
    and public._connect_channel_allowed(conversation_id)
  ) or public.nexus_depot_manager_internal_conversation_allowed(conversation_id,'nexus_link.internal_chat.read')
);

drop policy if exists "connect_messages insert" on public.connect_messages;
create policy "connect_messages insert" on public.connect_messages
for insert to authenticated with check (
  author_profile_id = auth.uid()
  and public._wa_insert_sin_evidencia(meta, external_msg_id)
  and (
    (
      public.nexus_is_depot_manager_principal() is distinct from true
      and public.has_permission('connect.create')
      and public._connect_is_member(conversation_id)
    ) or public.nexus_depot_manager_internal_conversation_allowed(conversation_id,'nexus_link.internal_chat.send')
  )
);

drop policy if exists "connect_attachments select" on public.connect_attachments;
create policy "connect_attachments select" on public.connect_attachments
for select to authenticated using (
  (
    public.nexus_is_depot_manager_principal() is distinct from true
    and public.has_permission('connect.view')
    and public._connect_is_member(conversation_id)
    and public._connect_channel_allowed(conversation_id)
  ) or public.nexus_depot_manager_internal_conversation_allowed(conversation_id,'nexus_link.internal_chat.read')
);

drop policy if exists "connect_attachments insert" on public.connect_attachments;
create policy "connect_attachments insert" on public.connect_attachments
for insert to authenticated with check (
  uploaded_by = auth.uid() and (
    (
      public.nexus_is_depot_manager_principal() is distinct from true
      and public.has_permission('connect.create')
      and public._connect_is_member(conversation_id)
    ) or public.nexus_depot_manager_internal_conversation_allowed(conversation_id,'nexus_link.internal_chat.media')
  )
);

drop policy if exists "connect_message_edits select" on public.connect_message_edits;
create policy "connect_message_edits select" on public.connect_message_edits
for select to authenticated using (exists (
  select 1 from public.connect_messages m
  where m.id = connect_message_edits.message_id and (
    (
      public.nexus_is_depot_manager_principal() is distinct from true
      and public.has_permission('connect.view')
      and public._connect_is_member(m.conversation_id)
    ) or public.nexus_depot_manager_internal_conversation_allowed(m.conversation_id,'nexus_link.internal_chat.read')
  )
));

drop policy if exists "connect_message_reactions select" on public.connect_message_reactions;
create policy "connect_message_reactions select" on public.connect_message_reactions
for select to authenticated using (exists (
  select 1 from public.connect_messages m
  where m.id = connect_message_reactions.message_id and (
    (
      public.nexus_is_depot_manager_principal() is distinct from true
      and public.has_permission('connect.view')
      and public._connect_is_member(m.conversation_id)
    ) or public.nexus_depot_manager_internal_conversation_allowed(m.conversation_id,'nexus_link.internal_chat.read')
  )
));

drop policy if exists "connect_message_mentions select" on public.connect_message_mentions;
create policy "connect_message_mentions select" on public.connect_message_mentions
for select to authenticated using (exists (
  select 1 from public.connect_messages m
  where m.id = connect_message_mentions.message_id and (
    (
      public.nexus_is_depot_manager_principal() is distinct from true
      and public.has_permission('connect.view')
      and public._connect_is_member(m.conversation_id)
    ) or public.nexus_depot_manager_internal_conversation_allowed(m.conversation_id,'nexus_link.internal_chat.read')
  )
));

drop policy if exists "connect_conversation_links select" on public.connect_conversation_links;
create policy "connect_conversation_links select" on public.connect_conversation_links
for select to authenticated using (
  public.nexus_is_depot_manager_principal() is distinct from true
  and public.has_permission('connect.view')
  and public._connect_is_member(conversation_id)
);

drop policy if exists "connect-files read members" on storage.objects;
create policy "connect-files read members" on storage.objects
for select to authenticated using (
  bucket_id='connect-files'
  and public._connect_storage_object_allowed(bucket_id,name)
  and (
    (
      public.nexus_is_depot_manager_principal() is distinct from true
      and public.has_permission('connect.view')
    ) or exists (
      select 1 from public.connect_attachments a
      where a.storage_bucket=bucket_id and a.storage_path=name
        and public.nexus_depot_manager_internal_conversation_allowed(
          a.conversation_id,'nexus_link.internal_chat.media'
        )
    )
  )
);

-- Los RPC SECDEF dejan de depender de connect.* para los principales, pero
-- siguen exigiendo membresía, clase interna y capacidad exacta.
alter function public.connect_emit_attachment_signed_url(uuid)
  rename to connect_emit_attachment_signed_url_0237;
revoke all on function public.connect_emit_attachment_signed_url_0237(uuid)
  from public,anon,authenticated;
create function public.connect_emit_attachment_signed_url(p_attachment_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_conv uuid; v_bucket text; v_path text; v_scan text;
begin
  select conversation_id,storage_bucket,storage_path,scan_status
    into v_conv,v_bucket,v_path,v_scan
  from public.connect_attachments where id=p_attachment_id;
  if not found then raise exception 'adjunto inexistente' using errcode='no_data_found'; end if;
  if public.nexus_is_depot_manager_principal() then
    if public.nexus_depot_manager_internal_conversation_allowed(v_conv,'nexus_link.internal_chat.media')
       is distinct from true then
      raise exception 'no autorizado' using errcode='insufficient_privilege';
    end if;
  elsif not (public.has_permission('connect.view') and public._connect_is_member(v_conv)
             and public._connect_channel_allowed(v_conv)) then
    raise exception 'no autorizado' using errcode='insufficient_privilege';
  end if;
  insert into public.audit_log(user_id,entity,entity_id,action,payload)
  values(auth.uid(),'connect_attachment',p_attachment_id,'connect.attachment.access',
    jsonb_build_object('bucket',v_bucket,'scan_status',v_scan));
  return jsonb_build_object('bucket',v_bucket,'path',v_path,'scan_status',v_scan);
end $$;
revoke all on function public.connect_emit_attachment_signed_url(uuid) from public,anon;
grant execute on function public.connect_emit_attachment_signed_url(uuid) to authenticated;

alter function public.connect_search_profiles(text,int)
  rename to connect_search_profiles_0158;
revoke all on function public.connect_search_profiles_0158(text,int)
  from public,anon,authenticated;
create function public.connect_search_profiles(q text,limit_count int default 10)
returns table(profile_id uuid,full_name text)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_lim int:=least(greatest(coalesce(limit_count,10),1),25);
        v_q text:=btrim(coalesce(q,'')); v_pat text;
begin
  if public.nexus_is_depot_manager_principal() then
    if public.nexus_depot_manager_valid() is distinct from true
       or public.nexus_link_can('nexus_link.internal_chat.read') is distinct from true then
      raise exception 'Sin permiso de chat interno' using errcode='insufficient_privilege';
    end if;
  elsif public.has_permission('connect.view') is distinct from true then
    raise exception 'Sin permiso connect.view' using errcode='insufficient_privilege';
  end if;
  if length(v_q)<2 then return; end if;
  v_pat:='%'||replace(replace(replace(v_q,'\','\\'),'%','\%'),'_','\_')||'%';
  return query select p.id,nullif(btrim(coalesce(p.full_name,'')||' '||coalesce(p.apellido,'')),'')
  from public.profiles p
  where coalesce(p.active,true) and p.client_id is null
    and p.role in ('admin','operaciones','supervisor')
    and (p.full_name ilike v_pat escape '\' or p.apellido ilike v_pat escape '\'
      or p.email ilike v_pat escape '\')
  order by p.full_name nulls last,p.id limit v_lim;
end $$;
revoke all on function public.connect_search_profiles(text,int) from public,anon,authenticated;
grant execute on function public.connect_search_profiles(text,int) to authenticated;

create or replace function public.nexus_depot_manager_connect_create_conversation(
  p_kind public.connect_conversation_kind_t,
  p_title text,
  p_slug text,
  p_visibility text,
  p_member_profile_ids uuid[]
) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_conv_id uuid; v_pid uuid;
begin
  if public.nexus_depot_manager_valid() is distinct from true
     or public.nexus_link_can('nexus_link.internal_chat.send') is distinct from true
     or p_kind not in ('dm','group')
     or coalesce(p_visibility,'private') <> 'private' then
    raise exception 'no autorizado' using errcode='insufficient_privilege';
  end if;
  if coalesce(array_length(p_member_profile_ids,1),0) > 50 then
    raise exception 'demasiados miembros' using errcode='check_violation';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_member_profile_ids,array[]::uuid[])) x(id)
    left join public.profiles p on p.id=x.id
    where p.id is null or p.active is distinct from true or p.client_id is not null
  ) then
    raise exception 'miembro no elegible' using errcode='insufficient_privilege';
  end if;
  insert into public.connect_conversations(kind,title,slug,visibility,created_by)
  values(p_kind,nullif(btrim(p_title),''),nullif(btrim(p_slug),''),'private',auth.uid())
  returning id into v_conv_id;
  insert into public.connect_participants(conversation_id,participant_type,profile_id,member_role)
  values(v_conv_id,'staff',auth.uid(),'owner');
  foreach v_pid in array coalesce(p_member_profile_ids,array[]::uuid[]) loop
    if v_pid is distinct from auth.uid() then
      insert into public.connect_participants(conversation_id,participant_type,profile_id,member_role)
      values(v_conv_id,'staff',v_pid,'member') on conflict(conversation_id,profile_id) do nothing;
    end if;
  end loop;
  insert into public.audit_log(user_id,entity,entity_id,action,payload)
  values(auth.uid(),'connect_conversation',v_conv_id,'nexus_link.internal_chat.send',
    jsonb_build_object('kind',p_kind,'members',coalesce(array_length(p_member_profile_ids,1),0)));
  return v_conv_id;
end $$;
revoke all on function public.nexus_depot_manager_connect_create_conversation(
  public.connect_conversation_kind_t,text,text,text,uuid[]
) from public,anon;
grant execute on function public.nexus_depot_manager_connect_create_conversation(
  public.connect_conversation_kind_t,text,text,text,uuid[]
) to authenticated;

create or replace function public.nexus_depot_manager_connect_post_message(
  p_conversation_id uuid,p_body text,p_reply_to uuid,p_client_msg_id text,
  p_attachment_ids uuid[],p_mentions uuid[] default null
) returns table(id uuid,seq bigint)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_msg_id uuid; v_seq bigint; v_part uuid; v_att uuid;
begin
  if public.nexus_depot_manager_internal_conversation_allowed(
       p_conversation_id,'nexus_link.internal_chat.send'
     ) is distinct from true then
    raise exception 'no autorizado' using errcode='insufficient_privilege';
  end if;
  perform public._connect_assert_not_archived(p_conversation_id);
  if p_reply_to is not null and not exists(
    select 1 from public.connect_messages m
    where m.id=p_reply_to and m.conversation_id=p_conversation_id
  ) then
    raise exception 'no autorizado' using errcode='insufficient_privilege';
  end if;
  if p_mentions is not null and array_length(p_mentions,1)>20 then
    raise exception 'demasiadas menciones' using errcode='check_violation';
  end if;
  if p_client_msg_id is not null then
    select m.id,m.seq into v_msg_id,v_seq from public.connect_messages m
    where m.conversation_id=p_conversation_id and m.author_profile_id=auth.uid()
      and m.client_msg_id=p_client_msg_id;
    if v_msg_id is not null then id:=v_msg_id; seq:=v_seq; return next; return; end if;
  end if;
  v_part:=public._connect_my_participant(p_conversation_id);
  insert into public.connect_messages(
    conversation_id,author_participant_id,author_profile_id,kind,body,
    reply_to_message_id,client_msg_id,meta
  ) values(
    p_conversation_id,v_part,auth.uid(),'text',nullif(p_body,''),
    p_reply_to,p_client_msg_id,'{}'::jsonb
  ) returning connect_messages.id,connect_messages.seq into v_msg_id,v_seq;
  if p_attachment_ids is not null then
    foreach v_att in array p_attachment_ids loop
      update public.connect_attachments set message_id=v_msg_id
      where connect_attachments.id=v_att and conversation_id=p_conversation_id
        and message_id is null and uploaded_by=auth.uid();
    end loop;
  end if;
  if p_mentions is not null and array_length(p_mentions,1)>0 then
    insert into public.connect_message_mentions(message_id,mentioned_participant_id)
    select v_msg_id,cp.id from public.connect_participants cp
    where cp.conversation_id=p_conversation_id and cp.profile_id=any(p_mentions)
      and cp.profile_id is distinct from auth.uid()
    on conflict(message_id,mentioned_participant_id) do nothing;
  end if;
  id:=v_msg_id; seq:=v_seq; return next;
end $$;
revoke all on function public.nexus_depot_manager_connect_post_message(
  uuid,text,uuid,text,uuid[],uuid[]
) from public,anon;
grant execute on function public.nexus_depot_manager_connect_post_message(
  uuid,text,uuid,text,uuid[],uuid[]
) to authenticated;

create or replace function public.nexus_depot_manager_connect_mark_read(
  p_conversation_id uuid,p_up_to_seq bigint
) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_up_to_seq is null or p_up_to_seq<0
     or public.nexus_depot_manager_internal_conversation_allowed(
       p_conversation_id,'nexus_link.internal_chat.read'
     ) is distinct from true then
    raise exception 'no autorizado' using errcode='insufficient_privilege';
  end if;
  update public.connect_participants
  set last_read_seq=greatest(coalesce(last_read_seq,0),p_up_to_seq)
  where conversation_id=p_conversation_id and profile_id=auth.uid();
end $$;
revoke all on function public.nexus_depot_manager_connect_mark_read(uuid,bigint) from public,anon;
grant execute on function public.nexus_depot_manager_connect_mark_read(uuid,bigint) to authenticated;

create or replace function public.nexus_depot_manager_connect_search(
  p_query text,p_limit integer default 30
) returns table(
  result_type text,conversation_id uuid,context_id text,kind text,title text,
  snippet text,entity_type text,entity_ref text,occurred_at timestamptz,sort_rank integer
) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_q tsquery; v_like text; v_lim int:=least(greatest(coalesce(p_limit,30),1),100);
begin
  if public.nexus_depot_manager_valid() is distinct from true
     or public.nexus_link_can('nexus_link.internal_chat.read') is distinct from true then
    raise exception 'no autorizado' using errcode='insufficient_privilege';
  end if;
  if p_query is null or length(btrim(p_query))<2 then return; end if;
  v_like:='%'||btrim(p_query)||'%'; v_q:=websearch_to_tsquery('spanish',p_query);
  return query
  with my_convs as (
    select c.id from public.connect_conversations c
    join public.connect_participants p on p.conversation_id=c.id and p.profile_id=auth.uid()
    where c.kind in ('dm','group','channel') and c.archived_at is null
  )
  select 'conversation'::text,c.id,c.context_id,c.kind::text,
    coalesce(c.title,c.slug,'Conversación')::text,c.topic,null::text,null::text,
    c.last_message_at,1
  from public.connect_conversations c where c.id in(select id from my_convs)
    and (c.title ilike v_like or c.topic ilike v_like or c.slug ilike v_like)
  union all
  select 'message'::text,m.conversation_id,c.context_id,c.kind::text,
    coalesce(c.title,c.slug,'Mensaje')::text,left(m.body,180),null::text,null::text,
    m.created_at,2
  from public.connect_messages m join public.connect_conversations c on c.id=m.conversation_id
  where m.deleted_at is null and m.conversation_id in(select id from my_convs)
    and to_tsvector('spanish',coalesce(m.body,''))@@v_q
  union all
  select 'attachment'::text,a.conversation_id,c.context_id,c.kind::text,
    coalesce(a.file_name,'Adjunto')::text,a.mime_type,null::text,null::text,a.created_at,3
  from public.connect_attachments a join public.connect_conversations c on c.id=a.conversation_id
  where a.conversation_id in(select id from my_convs) and a.file_name ilike v_like
  order by 10,9 desc nulls last limit v_lim;
end $$;
revoke all on function public.nexus_depot_manager_connect_search(text,integer) from public,anon;
grant execute on function public.nexus_depot_manager_connect_search(text,integer) to authenticated;

-- RPC legacy que no usan connect.*: para las dos identidades se cierran sin
-- oráculos. El chat permitido usa exclusivamente las RPC FASE B anteriores.
alter function public.connect_edit_message(uuid,text) rename to connect_edit_message_pre_0246;
alter function public.connect_delete_message(uuid) rename to connect_delete_message_pre_0246;
alter function public.connect_react(uuid,text) rename to connect_react_pre_0246;
alter function public.connect_unreact(uuid,text) rename to connect_unreact_pre_0246;
alter function public.connect_mark_read(uuid,bigint) rename to connect_mark_read_pre_0246;
alter function public.connect_add_member(uuid,uuid,public.connect_member_role_t) rename to connect_add_member_pre_0246;
alter function public.connect_remove_member(uuid,uuid) rename to connect_remove_member_pre_0246;
alter function public.connect_set_member_role(uuid,uuid,public.connect_member_role_t) rename to connect_set_member_role_pre_0246;
alter function public.connect_archive_conversation(uuid) rename to connect_archive_conversation_pre_0246;
alter function public.connect_set_topic(uuid,text) rename to connect_set_topic_pre_0246;
alter function public.connect_set_title(uuid,text) rename to connect_set_title_pre_0246;
alter function public.connect_toggle_favorite(uuid,boolean) rename to connect_toggle_favorite_pre_0246;
alter function public.connect_pin_message(uuid) rename to connect_pin_message_pre_0246;
alter function public.connect_unpin_message(uuid) rename to connect_unpin_message_pre_0246;
alter function public.connect_flag_message(uuid,text) rename to connect_flag_message_pre_0246;
alter function public.connect_unflag_message(uuid,text) rename to connect_unflag_message_pre_0246;
alter function public.connect_join_channel(uuid) rename to connect_join_channel_pre_0246;

revoke all on function public.connect_edit_message_pre_0246(uuid,text),public.connect_delete_message_pre_0246(uuid),public.connect_react_pre_0246(uuid,text),public.connect_unreact_pre_0246(uuid,text),public.connect_mark_read_pre_0246(uuid,bigint),public.connect_add_member_pre_0246(uuid,uuid,public.connect_member_role_t),public.connect_remove_member_pre_0246(uuid,uuid),public.connect_set_member_role_pre_0246(uuid,uuid,public.connect_member_role_t),public.connect_archive_conversation_pre_0246(uuid),public.connect_set_topic_pre_0246(uuid,text),public.connect_set_title_pre_0246(uuid,text),public.connect_toggle_favorite_pre_0246(uuid,boolean),public.connect_pin_message_pre_0246(uuid),public.connect_unpin_message_pre_0246(uuid),public.connect_flag_message_pre_0246(uuid,text),public.connect_unflag_message_pre_0246(uuid,text),public.connect_join_channel_pre_0246(uuid) from public,anon,authenticated,service_role;

create function public.nexus_depot_manager_reject_legacy_connect()
returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if public.nexus_is_depot_manager_principal() then
    raise exception 'no autorizado' using errcode='insufficient_privilege';
  end if;
end $$;
revoke all on function public.nexus_depot_manager_reject_legacy_connect() from public,anon,authenticated;

create function public.connect_edit_message(uuid,text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_edit_message_pre_0246($1,$2); end $$;
create function public.connect_delete_message(uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_delete_message_pre_0246($1); end $$;
create function public.connect_react(uuid,text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_react_pre_0246($1,$2); end $$;
create function public.connect_unreact(uuid,text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_unreact_pre_0246($1,$2); end $$;
create function public.connect_mark_read(uuid,bigint) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_mark_read_pre_0246($1,$2); end $$;
create function public.connect_add_member(uuid,uuid,public.connect_member_role_t) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_add_member_pre_0246($1,$2,$3); end $$;
create function public.connect_remove_member(uuid,uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_remove_member_pre_0246($1,$2); end $$;
create function public.connect_set_member_role(uuid,uuid,public.connect_member_role_t) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_set_member_role_pre_0246($1,$2,$3); end $$;
create function public.connect_archive_conversation(uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_archive_conversation_pre_0246($1); end $$;
create function public.connect_set_topic(uuid,text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_set_topic_pre_0246($1,$2); end $$;
create function public.connect_set_title(uuid,text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_set_title_pre_0246($1,$2); end $$;
create function public.connect_toggle_favorite(uuid,boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_toggle_favorite_pre_0246($1,$2); end $$;
create function public.connect_pin_message(uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_pin_message_pre_0246($1); end $$;
create function public.connect_unpin_message(uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_unpin_message_pre_0246($1); end $$;
create function public.connect_flag_message(uuid,text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_flag_message_pre_0246($1,$2); end $$;
create function public.connect_unflag_message(uuid,text) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_unflag_message_pre_0246($1,$2); end $$;
create function public.connect_join_channel(uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_depot_manager_reject_legacy_connect(); perform public.connect_join_channel_pre_0246($1); end $$;

revoke all on function public.connect_edit_message(uuid,text),public.connect_delete_message(uuid),public.connect_react(uuid,text),public.connect_unreact(uuid,text),public.connect_mark_read(uuid,bigint),public.connect_add_member(uuid,uuid,public.connect_member_role_t),public.connect_remove_member(uuid,uuid),public.connect_set_member_role(uuid,uuid,public.connect_member_role_t),public.connect_archive_conversation(uuid),public.connect_set_topic(uuid,text),public.connect_set_title(uuid,text),public.connect_toggle_favorite(uuid,boolean),public.connect_pin_message(uuid),public.connect_unpin_message(uuid),public.connect_flag_message(uuid,text),public.connect_unflag_message(uuid,text),public.connect_join_channel(uuid) from public,anon,authenticated,service_role;
grant execute on function public.connect_edit_message(uuid,text),public.connect_delete_message(uuid),public.connect_react(uuid,text),public.connect_unreact(uuid,text),public.connect_mark_read(uuid,bigint),public.connect_add_member(uuid,uuid,public.connect_member_role_t),public.connect_remove_member(uuid,uuid),public.connect_set_member_role(uuid,uuid,public.connect_member_role_t),public.connect_archive_conversation(uuid),public.connect_set_topic(uuid,text),public.connect_set_title(uuid,text),public.connect_toggle_favorite(uuid,boolean),public.connect_pin_message(uuid),public.connect_unpin_message(uuid),public.connect_flag_message(uuid,text),public.connect_unflag_message(uuid,text),public.connect_join_channel(uuid) to authenticated;

notify pgrst, 'reload schema';
