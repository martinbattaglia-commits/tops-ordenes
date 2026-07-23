-- ============================================================
-- Migración 0124 — Permisos RBAC de Contabilidad (reconciliación)
-- ------------------------------------------------------------
-- Los slugs contabilidad.* y sus grants existen en PROD pero fueron
-- insertados fuera de banda (vía MCP); ninguna migración los seedea.
-- Sin esto, una reconstrucción limpia desde migraciones dejaría las RLS
-- de chart_of_accounts / accounting_rules / mipyme_config accesibles solo
-- al rol admin (vía la cláusula current_role()='admin'), y un rol contable
-- no-admin (Contadora) quedaría sin acceso.
--
-- Idempotente (ON CONFLICT DO NOTHING): NO-OP en prod; reproduce el RBAC
-- vigente en entornos nuevos. Espeja exactamente prod (slugs + grants).
-- ============================================================

INSERT INTO public.permissions (slug, module, action, label, description) VALUES
  ('contabilidad.view',   'contabilidad', 'view',   'Ver contabilidad',           'Plan de cuentas, libro diario, mayor, balance, posición IVA'),
  ('contabilidad.create', 'contabilidad', 'create', 'Contabilizar / asientos',    'Generar asientos automáticos y manuales, backfill'),
  ('contabilidad.edit',   'contabilidad', 'edit',   'Editar plan de cuentas',     'ABM de cuentas y reglas de imputación'),
  ('contabilidad.export', 'contabilidad', 'export', 'Exportar contabilidad',      'Exportar libros y reportes contables'),
  ('contabilidad.admin',  'contabilidad', 'admin',  'Administrar / cerrar período','Cierre/bloqueo de períodos contables')
ON CONFLICT (slug) DO NOTHING;

-- Grants (espejo de prod):
--   view/export → admin, compliance, director_ops, gerencia
--   create/edit/admin → admin, director_ops, gerencia
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.slug IN ('contabilidad.view', 'contabilidad.export')
WHERE r.slug IN ('admin', 'compliance', 'director_ops', 'gerencia')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.slug IN ('contabilidad.create', 'contabilidad.edit', 'contabilidad.admin')
WHERE r.slug IN ('admin', 'director_ops', 'gerencia')
ON CONFLICT (role_id, permission_id) DO NOTHING;
