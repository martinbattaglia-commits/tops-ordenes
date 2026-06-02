-- =========================================================================
-- 0022_wms_rbac_seed.sql
-- Seed RBAC del módulo WMS (Digital Twin / inventario de terceros).
--
-- ⚠️ REQUIERE que 0021 esté aplicada y COMMITEADA: usa el valor 'wms' del enum
--    permission_module_t. Ejecutar como script separado de 0021.
--
-- Idempotente (on conflict do nothing). action ∈ permission_action_t
-- ('view','create','edit','delete','sign','export','admin').
-- =========================================================================

-- ---- Catálogo de permisos del módulo ------------------------------------
insert into public.permissions (slug, module, action, label, description) values
  ('wms.view',  'wms', 'view',  'Ver WMS / inventario',  'Acceso a inventario, depósitos y Mapa Inteligente'),
  ('wms.edit',  'wms', 'edit',  'Operar WMS',            'Recepciones, movimientos, picking, packing y despachos'),
  ('wms.admin', 'wms', 'admin', 'Administrar WMS',       'Estructura física (depósitos/sectores), configuración del módulo')
on conflict (slug) do nothing;

-- ---- Mapeo role × permission (coherente con 0009 / 0019) ----------------

-- Director de Operaciones: acceso total al módulo.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'director_ops' and p.module = 'wms'
on conflict do nothing;

-- Administración: ver + operar (sin admin de estructura física).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'admin' and p.slug in ('wms.view', 'wms.edit')
on conflict do nothing;

-- Operaciones (depósito): ver + operar.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'operaciones' and p.slug in ('wms.view', 'wms.edit')
on conflict do nothing;

-- Compliance / DT: solo lectura (control ANMAT de lotes/vencimientos).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'compliance' and p.slug in ('wms.view')
on conflict do nothing;

notify pgrst, 'reload schema';
