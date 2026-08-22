-- Finanzas queda reservada end-to-end a las dos identidades de Dirección.
-- La UI no es una frontera de seguridad: este cambio cierra PostgREST, RLS y
-- las RPC SECURITY DEFINER que todavía dependían de permisos de roles amplios.

create or replace function public.is_finance_director()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in (
    'martin@logisticatops.com',
    'martin.battaglia@logisticatops.com'
  );
$$;

revoke all on function public.is_finance_director() from public, anon;
grant execute on function public.is_finance_director() to authenticated;

-- has_permission() conserva la semántica vigente para todos los módulos, pero
-- el atajo histórico de profiles.role = 'admin' deja de aplicar únicamente a
-- finanzas.*. Esto también protege RPC SECURITY DEFINER heredadas: aunque un
-- administrador invoque la RPC directamente, no puede anular ni reconciliar
-- una previsión si no es una de las dos identidades exactas de Dirección.
create or replace function public.has_permission(p_slug text)
returns boolean
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if p_slug like 'finanzas.%' then
    return public.is_finance_director();
  end if;

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

-- Las RPC financieras heredadas consultan has_permission(). Se retiran los
-- permisos de los roles compartidos y se asignan sólo a un rol individual de
-- Dirección, ligado a las dos cuentas exactas existentes en auth.users.
delete from public.role_permissions rp
using public.permissions p
where rp.permission_id = p.id
  and p.slug like 'finanzas.%';

insert into public.roles (slug, name, description, is_system)
values (
  'finance_director',
  'Dirección de Finanzas',
  'Acceso exclusivo de Martín Battaglia al módulo Finanzas.',
  true
)
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    is_system = true;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.slug = 'finance_director'
  and p.slug like 'finanzas.%'
on conflict do nothing;

delete from public.user_roles ur
using public.roles r
where ur.role_id = r.id
  and r.slug = 'finance_director';

insert into public.user_roles (user_id, role_id, assigned_by)
select u.id, r.id, null
from auth.users u
cross join public.roles r
where r.slug = 'finance_director'
  and lower(coalesce(u.email, '')) in (
    'martin@logisticatops.com',
    'martin.battaglia@logisticatops.com'
  )
on conflict do nothing;

-- Sustituye todas las policies de las tablas finance_* por una frontera única,
-- exacta y fail-closed. service_role conserva su bypass administrativo nativo.
do $do$
declare
  v_table record;
  v_policy record;
begin
  for v_table in
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind = 'r'
      and c.relname like 'finance\_%' escape '\'
  loop
    execute format('alter table public.%I enable row level security', v_table.relname);
    for v_policy in
      select polname
      from pg_policy
      where polrelid = format('public.%I', v_table.relname)::regclass
    loop
      execute format('drop policy %I on public.%I', v_policy.polname, v_table.relname);
    end loop;
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_finance_director()) with check (public.is_finance_director())',
      v_table.relname || ' director exclusive',
      v_table.relname
    );
  end loop;
end
$do$;

notify pgrst, 'reload schema';
