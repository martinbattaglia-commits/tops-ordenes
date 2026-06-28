-- ENTREGADA, NO APLICADA — F0.5 Knowledge Layer; verificar numeración contra prod arsksytgdnzukbmfgkju
-- 0110 — Permisos knowledge.* + grant a roles staff. Molde 0087 / 0089:419-440.
--        permission_action_t es CERRADO → solo view/create/edit/delete/admin.
--        Respeta unique(module,action) (0009:50) y unique(slug). on conflict do nothing.

insert into public.permissions (slug, module, action, label, description) values
  ('knowledge.view',   'knowledge', 'view',   'Ver conocimiento',
   'Timeline corporativo + Búsqueda Universal'),
  ('knowledge.create', 'knowledge', 'create', 'Anotar conocimiento',
   'Crear anotaciones/etiquetas entidad↔concepto'),
  ('knowledge.edit',   'knowledge', 'edit',   'Editar conocimiento',
   'Editar entidades/anotaciones de la capa de conocimiento'),
  ('knowledge.delete', 'knowledge', 'delete', 'Depurar conocimiento',
   'Marcar/depurar anotaciones (eventos son append-only)'),
  ('knowledge.admin',  'knowledge', 'admin',  'Administrar knowledge',
   'Gestionar fuentes, backfills y configuración de la capa')
on conflict (slug) do nothing;

-- Lectura (knowledge.view) para TODO rol interno (excluye cliente_b2b). Molde 0087:13-19.
insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id
from public.roles ro
cross join public.permissions p
where p.slug = 'knowledge.view'
  and ro.slug <> 'cliente_b2b'
on conflict do nothing;

-- create/edit a roles operativos reales: director_ops, admin, operaciones, compliance, comercial, seguridad
insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id
from public.roles ro
join public.permissions p
  on p.slug in ('knowledge.create','knowledge.edit')
where ro.slug in ('director_ops','admin','operaciones','compliance','comercial','seguridad')
on conflict do nothing;

-- delete + admin solo a director_ops y admin
insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id
from public.roles ro
join public.permissions p
  on p.slug in ('knowledge.delete','knowledge.admin')
where ro.slug in ('director_ops','admin')
on conflict do nothing;

select pg_notify('pgrst', 'reload schema');
