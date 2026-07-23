-- 0146_connect_rbac_seed.sql — Nexus Link RC1.0.
-- ENTREGADA, NO APLICADA (G3).
-- ─────────────────────────────────────────────────────────────────────────
-- Seed RBAC del módulo connect: permisos connect.* + grants por rol staff.
-- IDEMPOTENTE (on conflict do nothing). DEPENDE de 0142 (enum 'connect' YA
-- aplicado en su propia tx) y de permissions/roles/role_permissions (0009).
-- permission_action_t (0009_rbac.sql) = {view,create,edit,delete,sign,export,admin}.
-- connect.* usa SOLO view/create/edit/delete/admin POR DISEÑO.
-- Gating invisible fail-closed: sin estas filas el módulo no se renderiza y los RPC niegan.
-- ─────────────────────────────────────────────────────────────────────────

insert into public.permissions (slug, module, action, label, description) values
  ('connect.view',   'connect', 'view',   'Ver Nexus Link',         'Acceso a conversaciones donde es miembro y canales publicos'),
  ('connect.create', 'connect', 'create', 'Crear / enviar en Link', 'Crear conversaciones, postear mensajes, reaccionar, adjuntar'),
  ('connect.edit',   'connect', 'edit',   'Editar en Link',         'Editar mensajes propios, vincular entidades, moderar (segun member_role)'),
  ('connect.delete', 'connect', 'delete', 'Eliminar en Link',       'Borrado fisico (admin)'),
  ('connect.admin',  'connect', 'admin',  'Administrar Nexus Link', 'Gestion total del modulo de colaboracion')
on conflict (slug) do nothing;

-- Staff operativo: view + create (participan en chat). Roles verificados en 0009:217-224.
insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id
from public.roles ro
join public.permissions p on p.slug in ('connect.view','connect.create')
where ro.slug in ('director_ops','admin','operaciones','compliance','comercial','seguridad')
on conflict do nothing;

-- edit: roles que moderan / vinculan entidades activamente.
insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id
from public.roles ro
join public.permissions p on p.slug = 'connect.edit'
where ro.slug in ('director_ops','admin','operaciones','compliance','comercial')
on conflict do nothing;

-- admin del módulo + borrado físico: solo admin + director_ops.
insert into public.role_permissions (role_id, permission_id)
select ro.id, p.id
from public.roles ro
join public.permissions p on p.slug in ('connect.admin','connect.delete')
where ro.slug in ('admin','director_ops')
on conflict do nothing;

-- cliente_b2b / externos: NO reciben connect.* en RC1 (entran en un RC posterior).

notify pgrst, 'reload schema';
