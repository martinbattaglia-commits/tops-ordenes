-- =========================================================================
-- TOPS NEXUS — RBAC gestionable
-- Roles y permisos editables desde la UI por administradores.
--
-- Modelo:
--   - permissions: catálogo fijo de permisos (módulo + acción), seeded
--   - roles: roles gestionables (Director, Operaciones, Compliance, etc.)
--   - role_permissions: qué permisos tiene cada rol (M:N)
--   - user_roles: qué rol tiene cada usuario (M:N — un usuario puede tener
--     varios roles si su cargo es híbrido, ej DT + Compliance)
--   - audit en profiles.role queda como fallback para mantener compat con
--     el RBAC simple de migrations 0001-0007.
-- =========================================================================

-- ---- Permissions catalog ----------------------------------------------
do $$ begin
  create type permission_module_t as enum (
    'cockpit',
    'compras',
    'servicios',
    'comercial',
    'compliance',
    'cctv',
    'documental',
    'analytics',
    'sistema'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type permission_action_t as enum (
    'view',
    'create',
    'edit',
    'delete',
    'sign',
    'export',
    'admin'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  module permission_module_t not null,
  action permission_action_t not null,
  label text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (module, action)
);

-- ---- Roles -------------------------------------------------------------
create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  /** Color para chip en UI. */
  color text not null default '#214576',
  /** Roles del sistema (no editables/borrables). */
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_roles_updated_at on public.roles;
create trigger trg_roles_updated_at
before update on public.roles
for each row execute function public.touch_updated_at();

-- ---- Role × Permission --------------------------------------------------
create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id),
  created_at timestamptz not null default now()
);

-- ---- User × Role --------------------------------------------------------
create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  /** Cargo organizacional libre (ej "Director Operaciones", "Jefe Magaldi"). */
  position_title text,
  /** Depósito asignado para roles operativos. */
  depot depot_t,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null,
  primary key (user_id, role_id)
);

create index if not exists user_roles_user_idx on public.user_roles(user_id);
create index if not exists user_roles_role_idx on public.user_roles(role_id);

-- =========================================================================
-- RLS
-- =========================================================================
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;

drop policy if exists "perms read all auth" on public.permissions;
create policy "perms read all auth"
  on public.permissions for select
  using (auth.role() = 'authenticated');

drop policy if exists "roles read all auth" on public.roles;
create policy "roles read all auth"
  on public.roles for select
  using (auth.role() = 'authenticated');

drop policy if exists "roles admin write" on public.roles;
create policy "roles admin write"
  on public.roles for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

drop policy if exists "role_perms read auth" on public.role_permissions;
create policy "role_perms read auth"
  on public.role_permissions for select
  using (auth.role() = 'authenticated');

drop policy if exists "role_perms admin write" on public.role_permissions;
create policy "role_perms admin write"
  on public.role_permissions for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

drop policy if exists "user_roles read self or admin" on public.user_roles;
create policy "user_roles read self or admin"
  on public.user_roles for select
  using (user_id = auth.uid() or public.current_role() in ('admin','supervisor'));

drop policy if exists "user_roles admin write" on public.user_roles;
create policy "user_roles admin write"
  on public.user_roles for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- =========================================================================
-- Helpers
-- =========================================================================

/** Permisos efectivos del usuario actual (unión de todos sus roles). */
create or replace view public.my_permissions as
select distinct p.slug, p.module, p.action, p.label
from public.user_roles ur
join public.role_permissions rp on rp.role_id = ur.role_id
join public.permissions p on p.id = rp.permission_id
where ur.user_id = auth.uid();

/** Helper: chequea si el usuario actual tiene un permiso específico. */
create or replace function public.has_permission(p_slug text)
returns boolean
language sql stable
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = auth.uid() and p.slug = p_slug
  ) or public.current_role() = 'admin';
$$;

-- =========================================================================
-- Seed: catálogo de permisos
-- =========================================================================
insert into public.permissions (slug, module, action, label, description) values
  -- Cockpit
  ('cockpit.view',          'cockpit',    'view',   'Ver cockpit ejecutivo',         'Acceso al panel /ejecutivo'),
  ('cockpit.export',        'cockpit',    'export', 'Exportar reportes ejecutivos',  'Descargar reportes consolidados'),
  -- Compras
  ('compras.view',          'compras',    'view',   'Ver órdenes de compra',         'Listar y consultar OC'),
  ('compras.create',        'compras',    'create', 'Crear OC',                      'Cargar nueva OC desde el wizard'),
  ('compras.edit',          'compras',    'edit',   'Editar OC en borrador',         'Modificar OC antes de firma'),
  ('compras.sign',          'compras',    'sign',   'Firmar OC',                     'Único permiso para emitir firma digital'),
  ('compras.export',        'compras',    'export', 'Exportar CSV / PDF',            'Bajar reporte de OC'),
  ('compras.delete',        'compras',    'delete', 'Anular OC',                     'Marcar como anulada'),
  -- Servicios
  ('servicios.view',        'servicios',  'view',   'Ver órdenes de servicio',       'Listar OS'),
  ('servicios.create',      'servicios',  'create', 'Crear OS',                      'Nueva OS desde wizard'),
  ('servicios.sign',        'servicios',  'sign',   'Firmar OS',                     'Cliente o supervisor firma'),
  -- Comercial
  ('comercial.view',        'comercial',  'view',   'Ver pipeline + contactos',      'Acceso lectura al módulo Clientify'),
  ('comercial.edit',        'comercial',  'edit',   'Editar contactos / deals',      'Sync bidireccional a Clientify'),
  -- Compliance
  ('compliance.view',       'compliance', 'view',   'Ver ANMAT cockpit',             'Acceso al panel /anmat'),
  ('compliance.edit',       'compliance', 'edit',   'Editar credenciales ANMAT',     'Subir docs, marcar auditorías'),
  -- CCTV
  ('cctv.view',             'cctv',       'view',   'Ver cámaras',                   'Acceso al centro de monitoreo'),
  ('cctv.admin',            'cctv',       'admin',  'Administrar NVR',               'Asignar cámaras a sectores'),
  -- Documental
  ('documental.view',       'documental', 'view',   'Ver centro documental',         'Listar documentos corporativos'),
  ('documental.create',     'documental', 'create', 'Subir documentos',              'Upload de PDFs / contratos'),
  ('documental.delete',     'documental', 'delete', 'Borrar documentos',             'Eliminar archivos del repositorio'),
  -- Analytics
  ('analytics.view',        'analytics',  'view',   'Ver reportes & finanzas',       'Acceso a /reports y /billing'),
  -- Sistema
  ('sistema.admin',         'sistema',    'admin',  'Administración del sistema',    'Roles, permisos, usuarios')
on conflict (slug) do nothing;

-- =========================================================================
-- Seed: roles base (system)
-- =========================================================================
insert into public.roles (slug, name, description, color, is_system) values
  ('director_ops',  'Director de Operaciones', 'Único habilitado a firmar OC. Acceso total operativo.', '#C90812', true),
  ('admin',         'Administración',          'Equipo de administración financiera y compliance.',     '#214576', true),
  ('operaciones',   'Operaciones',             'Encargados de depósito, picking, recepción.',           '#050555', true),
  ('compliance',    'Compliance / DT',         'Director técnico, auditorías ANMAT, documental.',       '#0E7C3A', true),
  ('comercial',     'Comercial',               'Equipo CRM, ventas, pipeline Clientify.',               '#B45309', true),
  ('seguridad',     'Seguridad / CCTV',        'Monitoreo Verisure 24/7, eventos CCTV.',                '#3a6db0', true),
  ('cliente_b2b',   'Cliente B2B',             'Solo lectura de sus propias OS/OC (rol futuro F3).',    '#8A94A6', true)
on conflict (slug) do nothing;

-- =========================================================================
-- Seed: mapeo role × permission (base coherente)
-- =========================================================================
-- Director de Operaciones: TODO
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'director_ops'
on conflict do nothing;

-- Admin financiero/compliance: todo menos firmar OC
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'admin' and p.slug not in ('compras.sign')
on conflict do nothing;

-- Operaciones: compras view/create + servicios + cctv view + documental view
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'operaciones' and p.slug in (
  'cockpit.view',
  'compras.view', 'compras.create',
  'servicios.view', 'servicios.create', 'servicios.sign',
  'cctv.view',
  'documental.view'
)
on conflict do nothing;

-- Compliance / DT: compliance + documental + cockpit view
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'compliance' and p.slug in (
  'cockpit.view',
  'compliance.view', 'compliance.edit',
  'documental.view', 'documental.create',
  'cctv.view'
)
on conflict do nothing;

-- Comercial: comercial + cockpit view
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'comercial' and p.slug in (
  'cockpit.view',
  'comercial.view', 'comercial.edit'
)
on conflict do nothing;

-- Seguridad CCTV: cctv + cockpit view
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'seguridad' and p.slug in (
  'cockpit.view',
  'cctv.view', 'cctv.admin'
)
on conflict do nothing;

-- Cliente B2B: por ahora solo view de su propio dominio
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'cliente_b2b' and p.slug in (
  'servicios.view'
)
on conflict do nothing;
