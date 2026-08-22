-- Rollback operativo de la frontera exclusiva de Dirección.
-- Restaura la matriz RBAC y las policies históricas por permiso.

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
    for v_policy in
      select polname
      from pg_policy
      where polrelid = format('public.%I', v_table.relname)::regclass
    loop
      execute format('drop policy %I on public.%I', v_policy.polname, v_table.relname);
    end loop;
    execute format(
      'create policy %I on public.%I for select to authenticated using (coalesce(public.has_permission(''finanzas.view''), false))',
      v_table.relname || ' read',
      v_table.relname
    );
    execute format(
      'create policy %I on public.%I for all to authenticated using (coalesce(public.has_permission(''finanzas.plan''), false) or coalesce(public.has_permission(''finanzas.admin''), false)) with check (coalesce(public.has_permission(''finanzas.plan''), false) or coalesce(public.has_permission(''finanzas.admin''), false))',
      v_table.relname || ' write',
      v_table.relname
    );
  end loop;
end
$do$;

delete from public.role_permissions rp
using public.roles r
where rp.role_id = r.id
  and r.slug = 'finance_director';

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.slug in ('admin', 'gerencia_comercial', 'administracion_finanzas')
  and p.slug like 'finanzas.%'
on conflict do nothing;

delete from public.user_roles ur
using public.roles r
where ur.role_id = r.id
  and r.slug = 'finance_director';

delete from public.roles where slug = 'finance_director';

-- Restaura exactamente la semántica de has_permission() previa a esta
-- migración (0246): allowlist especial de depot manager y atajo admin global.
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

drop function if exists public.is_finance_director();

notify pgrst, 'reload schema';
