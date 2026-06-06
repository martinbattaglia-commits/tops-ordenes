-- =========================================================================
-- 0049_crm_list_commercial_users.sql — CRM Comercial F2.2-3 · usuarios comerciales
--
-- ADDITIVE ONLY · SOLO FUNCIÓN. Helper para poblar el dropdown de REASIGNACIÓN de
-- la bandeja de leads: devuelve los usuarios ACTIVOS con rol RBAC 'comercial',
-- PII-safe (id + full_name, SIN email — mandato 0040).
--
-- SECURITY DEFINER: leer user_roles/profiles de OTROS usuarios bajo RLS de
-- sesión puede no resolver; este helper acota la salida a id+full_name de
-- comerciales activos (mismo criterio que profiles_public). search_path fijo.
--
-- Requiere: profiles (0001), roles/user_roles (0009). NO PROD. Solo staging.
-- =========================================================================

create or replace function public.crm_list_commercial_users()
returns table (id uuid, full_name text)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select p.id, p.full_name
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id
  join public.roles r on r.id = ur.role_id and r.slug = 'comercial'
  where p.active = true
  order by p.full_name nulls last, p.id;
$$;

revoke all on function public.crm_list_commercial_users() from public;
grant execute on function public.crm_list_commercial_users() to authenticated, service_role;

notify pgrst, 'reload schema';
