-- =============================================================================
-- NEXUS · RBAC Seed real · 6 roles + 22 permisos + role_permissions
-- =============================================================================
-- Genera idempotentemente los 6 roles reales de Logística TOPS:
--   1. director
--   2. administracion
--   3. operaciones
--   4. comercial
--   5. deposito
--   6. auditor
--
-- + 22 permisos seedeados + matriz role_permissions.
--
-- NO incluye INSERT a user_roles. Las asignaciones reales se hacen
-- después, con datos verificados del staff de Verotin S.A.
--
-- Uso (manual, bajo gate ejecutivo):
--   psql $SUPABASE_DB_URL -f scripts/seed-rbac-real-roles.sql
-- o desde el SQL editor del dashboard Supabase.
--
-- Requisitos:
--   - migraciones 0009_rbac.sql (o equivalente) ya aplicadas
--   - tablas: roles, permissions, role_permissions
--
-- Seguridad:
--   - Idempotente (uses ON CONFLICT)
--   - NO escribe a user_roles
--   - NO afecta a sesiones activas
--   - Es revertible: DELETE FROM role_permissions WHERE ...; DELETE FROM roles WHERE slug IN (...)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. PERMISSIONS — 22 permisos
-- ---------------------------------------------------------------------------

INSERT INTO permissions (slug, module, action, label, description) VALUES
  ('cockpit.view',         'cockpit',    'view',   'Ver cockpit ejecutivo',           'Acceso al panel /ejecutivo'),
  ('cockpit.export',       'cockpit',    'export', 'Exportar reportes ejecutivos',    NULL),
  ('compras.view',         'compras',    'view',   'Ver órdenes de compra',           NULL),
  ('compras.create',       'compras',    'create', 'Crear OC',                        NULL),
  ('compras.edit',         'compras',    'edit',   'Editar OC en borrador',           NULL),
  ('compras.sign',         'compras',    'sign',   'Firmar OC',                       'Único permiso para emitir firma digital'),
  ('compras.export',       'compras',    'export', 'Exportar CSV / PDF',              NULL),
  ('compras.delete',       'compras',    'delete', 'Anular OC',                       NULL),
  ('servicios.view',       'servicios',  'view',   'Ver órdenes de servicio',         NULL),
  ('servicios.create',     'servicios',  'create', 'Crear OS',                        NULL),
  ('servicios.sign',       'servicios',  'sign',   'Firmar OS',                       NULL),
  ('comercial.view',       'comercial',  'view',   'Ver pipeline + contactos',        NULL),
  ('comercial.edit',       'comercial',  'edit',   'Editar contactos / deals',        NULL),
  ('compliance.view',      'compliance', 'view',   'Ver ANMAT cockpit',               NULL),
  ('compliance.edit',      'compliance', 'edit',   'Editar credenciales ANMAT',       NULL),
  ('cctv.view',            'cctv',       'view',   'Ver cámaras',                     NULL),
  ('cctv.admin',           'cctv',       'admin',  'Administrar NVR',                 NULL),
  ('documental.view',      'documental', 'view',   'Ver centro documental',           NULL),
  ('documental.create',    'documental', 'create', 'Subir documentos',                NULL),
  ('documental.delete',    'documental', 'delete', 'Borrar documentos',               NULL),
  ('analytics.view',       'analytics',  'view',   'Ver reportes & finanzas',         NULL),
  ('sistema.admin',        'sistema',    'admin',  'Administración del sistema',      NULL)
ON CONFLICT (slug) DO UPDATE
  SET label       = EXCLUDED.label,
      description = EXCLUDED.description,
      module      = EXCLUDED.module,
      action      = EXCLUDED.action;

-- ---------------------------------------------------------------------------
-- 2. ROLES — 6 roles reales
-- ---------------------------------------------------------------------------

INSERT INTO roles (slug, name, description, color, is_system) VALUES
  ('director',       'Director',       'Máxima autoridad operativa y financiera. Único habilitado a firmar OC.', '#C90812', TRUE),
  ('administracion', 'Administración', 'Equipo financiero, fiscalía y compliance. Todos los permisos salvo firma de OC.', '#214576', TRUE),
  ('operaciones',    'Operaciones',    'Coordinación de depósitos, picking, recepción y servicios a clientes.',    '#050555', TRUE),
  ('comercial',      'Comercial',      'Equipo CRM, ventas, gestión de pipeline en Clientify.',                    '#B45309', TRUE),
  ('deposito',       'Depósito',       'Operarios de picking, recepción, firma de OS y monitoreo de cámaras.',     '#0E7C3A', TRUE),
  ('auditor',        'Auditor',        'Acceso de SOLO LECTURA a todos los módulos. Para auditorías internas y externas.', '#8A94A6', TRUE)
ON CONFLICT (slug) DO UPDATE
  SET name        = EXCLUDED.name,
      description = EXCLUDED.description,
      color       = EXCLUDED.color,
      updated_at  = NOW();

-- ---------------------------------------------------------------------------
-- 3. ROLE_PERMISSIONS — matriz
-- ---------------------------------------------------------------------------

-- Primero, limpiar asignaciones previas SOLO de estos 6 roles (no afecta otros que pudieran existir)
DELETE FROM role_permissions
WHERE role_id IN (SELECT id FROM roles WHERE slug IN ('director','administracion','operaciones','comercial','deposito','auditor'));

-- Director · TODO
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'director';

-- Administración · TODO menos compras.sign
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'administracion'
  AND p.slug <> 'compras.sign';

-- Operaciones · subset
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'operaciones'
  AND p.slug IN (
    'cockpit.view',
    'compras.view', 'compras.create',
    'servicios.view', 'servicios.create', 'servicios.sign',
    'cctv.view',
    'documental.view', 'documental.create'
  );

-- Comercial · subset
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'comercial'
  AND p.slug IN ('cockpit.view', 'comercial.view', 'comercial.edit');

-- Depósito · subset (operario picking)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'deposito'
  AND p.slug IN ('servicios.view', 'servicios.create', 'servicios.sign', 'cctv.view');

-- Auditor · solo view en todos los módulos
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.slug = 'auditor'
  AND p.slug IN (
    'cockpit.view',
    'compras.view',
    'servicios.view',
    'comercial.view',
    'compliance.view',
    'cctv.view',
    'documental.view'
  );

-- ---------------------------------------------------------------------------
-- 4. VERIFICACIÓN
-- ---------------------------------------------------------------------------

-- Conteo esperado:
--   director       → 22 permisos
--   administracion → 21 permisos
--   operaciones    →  9 permisos
--   comercial      →  3 permisos
--   deposito       →  4 permisos
--   auditor        →  7 permisos
-- TOTAL            → 66 filas en role_permissions
--
-- SELECT r.slug, COUNT(rp.permission_id) AS perms
-- FROM roles r
-- LEFT JOIN role_permissions rp ON rp.role_id = r.id
-- WHERE r.slug IN ('director','administracion','operaciones','comercial','deposito','auditor')
-- GROUP BY r.slug
-- ORDER BY r.slug;

COMMIT;

-- =============================================================================
-- PRÓXIMO PASO MANUAL (no automatizado, requiere datos reales):
-- =============================================================================
--
-- INSERT INTO user_roles (user_id, role_id, position_title, depot, assigned_by)
-- VALUES
--   (
--     (SELECT id FROM auth.users WHERE email = 'joseluis@logisticatops.com'),
--     (SELECT id FROM roles      WHERE slug  = 'director'),
--     'Director de Operaciones',
--     NULL,
--     NULL
--   ),
--   (
--     (SELECT id FROM auth.users WHERE email = 'ruth@logisticatops.com'),
--     (SELECT id FROM roles      WHERE slug  = 'administracion'),
--     'Jefa de Administración',
--     NULL,
--     (SELECT id FROM auth.users WHERE email = 'joseluis@logisticatops.com')
--   ),
--   ...;
--
-- Antes de correr: confirmar que TODOS los emails existen en auth.users.
-- =============================================================================
