-- =========================================================================
-- 0057_rrhh_rbac_seed.sql — RRHH (RBAC Foundation · Gate R2).
-- Seed RBAC del módulo RRHH: permissions + roles + role_permissions.
--
-- PRECONDICIÓN: el valor 'rrhh' debe existir en permission_module_t
--   (migración 0056, committeada y APLICADA en producción). Reconfirmar en
--   el preflight antes de aplicar.
--
-- ALCANCE R2 (estricto): SOLO catálogo RBAC. NO crea tablas, NO RPCs, NO RLS,
--   NO buckets, NO UI. La granularidad fina (salud/bancario/recibos, niveles
--   de aprobación, propiedad) se resuelve en R3+ vía RLS/RPC/propiedad/jerarquía
--   (modelo de permisos gruesos — OPCIÓN 1 de Dirección).
--
-- Modelo aprobado: docs/handoff/RRHH_R2_ARCHITECTURE_AMENDMENT.md (§2, §3).
-- Auditoría:       docs/handoff/RRHH_R2_AMENDMENT_AUDIT.md (OPTION A, A1–A7 PASS).
-- Patrón:          0053_treasury_core.sql §11 (seed RBAC tesoreria).
-- Idempotente:     on conflict do nothing.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Permisos gruesos del módulo 'rrhh' (módulo × acción; unique(module,action)).
--    Se omiten 'delete' (RRHH es append-only) y 'sign' (N/A) — igual que tesoreria.
-- -------------------------------------------------------------------------
insert into public.permissions (slug, module, action, label, description) values
  ('rrhh.view',   'rrhh', 'view',   'Ver RRHH',                'Legajos, ausencias, recibos y reportes (alcance acotado por RLS)'),
  ('rrhh.create', 'rrhh', 'create', 'Registrar RRHH',          'Alta de solicitudes, novedades y legajos'),
  ('rrhh.edit',   'rrhh', 'edit',   'Editar / anular RRHH',    'Edición, anulación lógica (void) y aprobación de nivel RRHH'),
  ('rrhh.export', 'rrhh', 'export', 'Exportar RRHH',           'Dashboard y reportes agregados'),
  ('rrhh.admin',  'rrhh', 'admin',  'Administrar RRHH (PII)',  'Datos sensibles (salud/bancario) y gestión integral de legajo')
on conflict (slug) do nothing;

-- -------------------------------------------------------------------------
-- 2. Roles RRHH (filas en public.roles; NO se toca user_role_t).
-- -------------------------------------------------------------------------
insert into public.roles (slug, name, description, color, is_system) values
  ('rrhh_admin',            'Administrador RRHH', 'Control total de RRHH, incluida PII sensible (salud/bancario)', '#7c3aed', true),
  ('rrhh_manager',          'Responsable RRHH',   'Gestión operativa de RRHH sin acceso a salud/bancario',         '#2563eb', true),
  ('rrhh_viewer',           'Visor RRHH',         'Solo dashboard y reportes agregados (sin PII individual)',       '#0891b2', true),
  ('employee_self_service', 'Portal del Empleado','Autogestión: el empleado accede solo a lo propio',              '#16a34a', true)
on conflict (slug) do nothing;

-- -------------------------------------------------------------------------
-- 3. role_permissions (mapeo §2.2 del amendment).
--    employee_self_service: SIN permisos (acceso por propiedad en RLS — R3).
-- -------------------------------------------------------------------------
-- rrhh_admin → todos los permisos del módulo 'rrhh'.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'rrhh_admin' and p.module = 'rrhh'
on conflict do nothing;

-- rrhh_manager → view/create/edit/export (sin admin).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'rrhh_manager'
  and p.slug in ('rrhh.view','rrhh.create','rrhh.edit','rrhh.export')
on conflict do nothing;

-- rrhh_viewer → solo export (dashboard/reportes agregados).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'rrhh_viewer' and p.slug = 'rrhh.export'
on conflict do nothing;

notify pgrst, 'reload schema';
