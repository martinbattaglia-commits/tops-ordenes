-- =========================================================================
-- 0019_tracking_rbac_seed.sql
-- Seed RBAC del módulo OPERACIONES → Tracking de Flota.
--
-- ⚠️ REQUIERE que 0016 esté aplicada y COMMITEADA: usa el valor 'operaciones'
--    del enum permission_module_t agregado en 0016. Si se corre en la misma
--    transacción que el ALTER TYPE, Postgres aborta con
--    "unsafe use of new value of enum type". Ejecutar como script separado.
--
-- Idempotente (on conflict do nothing). action ∈ permission_action_t
-- ('view','create','edit','delete','sign','export','admin').
-- =========================================================================

-- -------------------------------------------------------------------------
-- Catálogo de permisos del módulo.
-- -------------------------------------------------------------------------
insert into public.permissions (slug, module, action, label, description) values
  ('operaciones.view',  'operaciones', 'view',  'Ver tracking de flota',       'Acceso al mapa y posiciones en /operaciones/tracking'),
  ('operaciones.edit',  'operaciones', 'edit',  'Gestionar vehículos / flota', 'Alta y edición de vehículos, choferes y dispositivos'),
  ('operaciones.admin', 'operaciones', 'admin', 'Configurar tracking',         'Geocercas, integración Traccar y settings del módulo')
on conflict (slug) do nothing;

-- -------------------------------------------------------------------------
-- Mapeo role × permission (coherente con el seed base de 0009).
-- -------------------------------------------------------------------------

-- Director de Operaciones: acceso total al módulo.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'director_ops' and p.module = 'operaciones'
on conflict do nothing;

-- Administración: ver + gestionar flota (sin admin de config).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'admin' and p.slug in ('operaciones.view', 'operaciones.edit')
on conflict do nothing;

-- Operaciones (depósito): ver + gestionar flota.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'operaciones' and p.slug in ('operaciones.view', 'operaciones.edit')
on conflict do nothing;

-- Seguridad / CCTV: solo lectura (monitoreo 24/7).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'seguridad' and p.slug in ('operaciones.view')
on conflict do nothing;

notify pgrst, 'reload schema';
