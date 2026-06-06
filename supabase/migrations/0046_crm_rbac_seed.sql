-- =========================================================================
-- 0046_crm_rbac_seed.sql — CRM Comercial F2.1-3 · RBAC seed + profiles_public
--
-- ADDITIVE ONLY · Idempotente (on conflict do nothing). ⚠️ Requiere 0009 (RBAC:
-- permissions/roles/role_permissions, has_permission), 0040 (lockdown profiles).
--
-- El módulo 'comercial' ya existe en permission_module_t (0009) y tiene
-- comercial.view / comercial.edit sembrados. Acá se agregan los permisos finos
-- (create/delete/admin) que el RLS de 0042-0045 (has_permission) y la UI usarán,
-- y se crea la vista profiles_public(id, full_name) SIN email (mandato 0040 — para
-- mostrar "owner/vendedor asignado" sin exponer PII).
--
-- NO aplicar a Supabase PROD. Rama de feature, sin deploy.
-- =========================================================================

-- ---- Permisos finos del módulo comercial --------------------------------
insert into public.permissions (slug, module, action, label, description) values
  ('comercial.create', 'comercial', 'create', 'Crear oportunidades / cotizaciones', 'Alta de leads→oportunidades, cotizaciones y propuestas'),
  ('comercial.delete', 'comercial', 'delete', 'Borrar registros comerciales',       'Soft-delete / borrado (restringido)'),
  ('comercial.admin',  'comercial', 'admin',  'Administrar módulo comercial',        'Configuración del módulo, overrides, contratos')
on conflict (slug) do nothing;

-- ---- Mapeo role × permission (coherente con 0009 / 0022) ----------------

-- Director de Operaciones: acceso total al módulo comercial.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'director_ops' and p.module = 'comercial'
on conflict do nothing;

-- Admin (RBAC): acceso total al módulo comercial.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'admin' and p.module = 'comercial'
on conflict do nothing;

-- Comercial (CRM/ventas): ver + editar + crear (sin delete/admin).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'comercial' and p.slug in ('comercial.view', 'comercial.edit', 'comercial.create')
on conflict do nothing;

-- Operaciones (onboarding): ver + editar (opera el checklist de alta).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'operaciones' and p.slug in ('comercial.view', 'comercial.edit')
on conflict do nothing;

-- =========================================================================
-- Vista profiles_public(id, full_name) — SIN email (mandato 0040).
-- Permite resolver el nombre del owner/vendedor sin exponer PII (email/role).
-- Vista SECURITY DEFINER por defecto: lee profiles bajo el dueño de la vista,
-- evitando el lockdown de SELECT de 0040, pero exponiendo SOLO id + full_name.
-- =========================================================================
create or replace view public.profiles_public as
  select id, full_name
  from public.profiles
  where active is true;

revoke all on public.profiles_public from public, anon;
grant select on public.profiles_public to authenticated, service_role;

notify pgrst, 'reload schema';
