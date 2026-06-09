-- 0070_rbac_gerencia_finanzas.sql
-- RBAC — GERENCIA_COMERCIAL + ADMINISTRACION_FINANZAS (decisión 2026-06-08).
--
-- Política aprobada (DEROGA la separación de poderes F3): ambos roles operan
-- prácticamente TODO Nexus; se bloquea SOLO:
--   · Sistema (todos los permisos `sistema.*`)
--   · RRHH → Documentación (`rrhh.documentacion.view`)
-- Estrategia B (enforcement dirigido por-usuario): solo afecta a los usuarios
-- asignados a estos 2 roles; el resto queda en bootstrap (sin cambios).
--
-- ⚠️ NO EJECUTAR sin autorización. Aplicar en SQL Editor de prod
--    (arsksytgdnzukbmfgkju). Aditiva e idempotente.

begin;

-- 1) Permisos granulares nuevos -------------------------------------------------
insert into public.permissions (slug, module, action, label, description)
values
  ('sistema.view', 'sistema', 'view', 'Ver sección Sistema',
   'Organigrama, Roles, Usuarios, Centros de costo, Tracking, Plantillas, Configuración'),
  ('rrhh.documentacion.view', 'rrhh', 'view', 'Ver RRHH → Documentación',
   'Repositorio documental de RRHH (separado de rrhh.view)')
on conflict (slug) do nothing;

-- 2) Roles definitivos (si no existen) -----------------------------------------
insert into public.roles (slug, name, description, color, is_system)
values
  ('gerencia_comercial',      'Gerencia Comercial',        'Acceso casi-total; bloqueado solo Sistema y RRHH→Documentación.', '#B45309', true),
  ('administracion_finanzas', 'Administración y Finanzas', 'Acceso casi-total; bloqueado solo Sistema y RRHH→Documentación.', '#214576', true)
on conflict (slug) do nothing;

-- 3) Grants: TODOS los permisos EXCEPTO sistema.* y rrhh.documentacion.view ------
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.slug in ('gerencia_comercial', 'administracion_finanzas')
  and p.slug not like 'sistema.%'
  and p.slug <> 'rrhh.documentacion.view'
on conflict (role_id, permission_id) do nothing;

-- (Defensa) Asegurar que NO queden grants de los permisos bloqueados ------------
delete from public.role_permissions rp
using public.roles r, public.permissions p
where rp.role_id = r.id and rp.permission_id = p.id
  and r.slug in ('gerencia_comercial', 'administracion_finanzas')
  and (p.slug like 'sistema.%' or p.slug = 'rrhh.documentacion.view');

commit;

-- 4) ASIGNACIÓN DE USUARIOS (paso del usuario — requiere UUIDs reales) ----------
-- Sin esto NO hay enforcement (los roles quedan definidos pero sin asignar).
-- Reemplazar los emails por los reales de cada perfil:
--
-- insert into public.user_roles (user_id, role_id)
-- select u.id, r.id
-- from auth.users u, public.roles r
-- where r.slug = 'gerencia_comercial'
--   and u.email in ('comercial1@logisticatops.com', 'comercial2@...')
-- on conflict do nothing;
--
-- insert into public.user_roles (user_id, role_id)
-- select u.id, r.id
-- from auth.users u, public.roles r
-- where r.slug = 'administracion_finanzas'
--   and u.email in ('finanzas1@logisticatops.com', ...)
-- on conflict do nothing;
--
-- NOTA: con Estrategia B (fallback per-usuario en check.ts/guard.ts) NO hace falta
-- RBAC_ENFORCE=1 global: el enforcement aplica a estos usuarios asignados; el resto
-- sigue en bootstrap. (Si en el futuro se quiere fail-closed global, setear RBAC_ENFORCE=1
-- recién cuando TODOS los usuarios estén asignados, o quedan sin acceso.)
