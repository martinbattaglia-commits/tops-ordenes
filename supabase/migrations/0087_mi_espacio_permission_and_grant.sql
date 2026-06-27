-- 0087 — Crea el permiso mi_espacio.view y lo concede a todos los roles internos.
--
-- Reemplaza efectivamente a 0061 (que nunca llegó a prod por faltar el valor de enum,
-- agregado en 0086). Se deja idempotente para que el orden 0061→0086→0087 sea benigno.
-- "Mi Espacio" = autoservicio del propio legajo (datos, vacaciones, documentación) →
-- corresponde a todo empleado interno. Se excluye cliente_b2b (rol externo).
insert into public.permissions (slug, module, action, label, description) values
  ('mi_espacio.view', 'mi_espacio', 'view',
   'Ver Mi Espacio (autoservicio)',
   'Legajo/datos/solicitudes/vacaciones/documentacion propios. Independiente de rrhh.*')
on conflict (slug) do nothing;

insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id
from public.roles ro
cross join public.permissions p
where p.slug = 'mi_espacio.view'
  and ro.slug <> 'cliente_b2b'
on conflict do nothing;
