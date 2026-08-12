-- =========================================================================
-- CORRECTIVA FORWARD-ONLY · `0070_rbac_gerencia_finanzas.sql`
--
-- ─── QUÉ CORRIGE ────────────────────────────────────────────────────────
--
-- `0070` no aplica sobre una base nueva. Dos defectos:
--
--  1. `public.permissions` tiene `unique (module, action)` desde `0009`, pero
--     el seed usa `on conflict (slug) do nothing`. `rrhh.documentacion.view`
--     lleva (module='rrhh', action='view'), par que `rrhh.view` ya ocupa: el
--     conflicto NO cae en el slug y explota con
--     «duplicate key value violates unique constraint permissions_module_action_key».
--
--  2. Un `commit;` suelto a mitad del archivo, incompatible con la aplicación
--     transaccional que usa el mecanismo de release.
--
-- `0070` no está registrada en producción (evidencia de ledger 2026-08-11):
-- nunca llegó a aplicarse, y esto explica por qué.
--
-- ─── CÓMO LO CIERRA ─────────────────────────────────────────────────────
--
-- `on conflict do nothing` SIN target: cubre cualquier restricción única, no
-- sólo el slug. Es lo que el seed quiso decir.
--
-- Consecuencia explícita y querida: bajo `unique (module, action)`,
-- `rrhh.documentacion.view` NO puede coexistir con `rrhh.view` y por lo tanto
-- no se crea. El estado final es el mismo que `0070` perseguía —nadie tiene
-- ese permiso—, porque el propio `0070` lo excluye de los grants y borra
-- cualquier grant que lo mencione. Separar «RRHH → Documentación» exige otra
-- `action`, y eso es una decisión de modelo de permisos, no de linaje.
--
-- Idempotente. No edita, renombra ni renumera `0070`.
-- =========================================================================

-- 1) Permisos granulares. Sin target: tolera slug Y (module, action).
insert into public.permissions (slug, module, action, label, description)
values
  ('sistema.view', 'sistema', 'view', 'Ver sección Sistema',
   'Organigrama, Roles, Usuarios, Centros de costo, Tracking, Plantillas, Configuración'),
  ('rrhh.documentacion.view', 'rrhh', 'view', 'Ver RRHH → Documentación',
   'Repositorio documental de RRHH (separado de rrhh.view)')
on conflict do nothing;

-- 2) Roles definitivos.
insert into public.roles (slug, name, description, color, is_system)
values
  ('gerencia_comercial',      'Gerencia Comercial',        'Acceso casi-total; bloqueado solo Sistema y RRHH→Documentación.', '#B45309', true),
  ('administracion_finanzas', 'Administración y Finanzas', 'Acceso casi-total; bloqueado solo Sistema y RRHH→Documentación.', '#214576', true)
on conflict (slug) do nothing;

-- 3) Grants: TODOS los permisos EXCEPTO sistema.* y rrhh.documentacion.view.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.slug in ('gerencia_comercial', 'administracion_finanzas')
  and p.slug not like 'sistema.%'
  and p.slug <> 'rrhh.documentacion.view'
on conflict (role_id, permission_id) do nothing;

-- 4) Defensa: ningún grant de los permisos bloqueados.
delete from public.role_permissions rp
using public.roles r, public.permissions p
where rp.role_id = r.id and rp.permission_id = p.id
  and r.slug in ('gerencia_comercial', 'administracion_finanzas')
  and (p.slug like 'sistema.%' or p.slug = 'rrhh.documentacion.view');
