-- RRHH RBAC ENFORCEMENT (Opción A) — permiso independiente "Mi Espacio".
-- Crea el permiso mi_espacio.view (autoservicio), desacoplado de rrhh.*.
-- NO concede grants ni asigna roles (eso es parte de la activación con los 6 roles
-- definitivos, fuera de esta migración). Idempotente.
insert into public.permissions (slug, module, action, label, description) values
  ('mi_espacio.view', 'mi_espacio', 'view',
   'Ver Mi Espacio (autoservicio)',
   'Legajo/datos/solicitudes/vacaciones/documentacion propios. Independiente de rrhh.*')
on conflict (slug) do nothing;
