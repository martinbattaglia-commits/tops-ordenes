-- ============================================================================
-- OC-FIRMANTE-POR-PERMISO · CIERRE ACOTADO para el par rojo→verde del firmante.
-- ============================================================================
--
-- Reproduce SÓLO lo que el preludio de `purchase_order_issue` toca al resolver
-- quién firma: la identidad de sesión, el perfil activo, el gate de permisos y
-- las dos tablas de las que sale el firmante.
--
-- ⚠ LÍMITE DECLARADO: `public.has_permission` acá es una versión REDUCIDA de la
--   productiva — conserva el join user_roles→role_permissions→permissions y el
--   bypass `profiles.role='admin'`, y omite la rama de jefe de depósito, que
--   este expediente no toca. El gate de permisos del preludio no cambia entre
--   0243 y 0259 (el diff lo demuestra byte a byte); este cierre existe para
--   ejercitar el bloque del FIRMANTE contra un PostgreSQL real.

create schema if not exists auth;

create table auth.users (
  id    uuid primary key,
  email text
);

-- `auth.uid()` de la sesión, dirigida por GUC para poder actuar como cada
-- usuario del escenario sin montar GoTrue.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('harness.actor', true), '')::uuid
$$;

create table public.profiles (
  id        uuid primary key references auth.users(id),
  full_name text,
  email     text,
  role      text not null default 'operaciones',
  active    boolean not null default true
);

create table public.roles (
  id   uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null
);

create table public.permissions (
  id     uuid primary key default gen_random_uuid(),
  slug   text unique not null,
  module text not null default 'compras',
  action text not null default 'x'
);

create table public.role_permissions (
  role_id       uuid not null references public.roles(id),
  permission_id uuid not null references public.permissions(id),
  primary key (role_id, permission_id)
);

create table public.user_roles (
  user_id        uuid not null references auth.users(id),
  role_id        uuid not null references public.roles(id),
  position_title text,
  primary key (user_id, role_id)
);

create or replace function public.has_permission(p_slug text)
returns boolean language plpgsql stable security definer
set search_path = public, pg_temp as $$
begin
  return coalesce(exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = auth.uid() and p.slug = p_slug
  ) or (select role = 'admin' from public.profiles where id = auth.uid()), false);
end;
$$;

-- ── PERMISOS Y ROLES, con la forma medida en producción ─────────────────────
insert into public.permissions (slug) values ('compras.create'), ('compras.sign'), ('compras.view');

insert into public.roles (slug, name) values
  ('super_admin',   'Super Administrador'),
  ('director_ops',  'Director de Operaciones'),
  ('gerencia',      'Gerencia (acceso total sin RRHH)'),
  ('jefe_deposito', 'Jefe de Deposito');

-- super_admin y director_ops SÍ tienen compras.sign; gerencia NO (H-B medido).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
 where (r.slug in ('super_admin','director_ops') and p.slug in ('compras.create','compras.sign','compras.view'))
    or (r.slug = 'gerencia' and p.slug in ('compras.create','compras.view'));

-- ── TIPOS Y TABLAS que sólo aparecen en el DECLARE del preludio ─────────────
--
-- El bloque `declare` de `purchase_order_issue` se copia entero para no alterar
-- el texto que se prueba. Declara variables de tipos que este cierre no
-- ejercita (el preludio del firmante nunca las lee); existen acá sólo para que
-- la función compile con su declaración REAL, sin recortarla.

create type public.po_price_state_t as enum ('planning','partial','real');
create type public.depot_t as enum ('MAGALDI','LUJAN');

create table public.vendors (
  id        uuid primary key default gen_random_uuid(),
  razon     text,
  cuit      text,
  domicilio text,
  telefono  text,
  contacto  text,
  email     text,
  categoria text,
  cond_pago text,
  active    boolean default true
);
