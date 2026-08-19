-- ============================================================================
-- OC-FIRMANTE-POR-PERMISO · CIERRE ACOTADO para el par rojo→verde del firmante.
-- ============================================================================
--
-- Reproduce el ESTADO PREVIO de producción —medido, no supuesto— en lo que el
-- expediente toca: la identidad de sesión, el perfil activo, el gate de
-- permisos, el reparto real de `compras.sign` y las dos tablas de las que sale
-- el firmante. Sobre este estado corre el lado ROJO; el lado VERDE se obtiene
-- aplicando encima los bloques de datos de la propia 0259.
--
-- ⚠ LÍMITE DECLARADO: `public.has_permission` acá es una versión REDUCIDA de la
--   productiva — conserva el join user_roles→role_permissions→permissions y el
--   bypass `profiles.role='admin'`, y omite la rama de jefe de depósito, que
--   este expediente no toca. El bypass SÍ se reproduce, porque es justamente el
--   cerrojo que el gate directo del firmante tiene que esquivar.

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

-- ⚠ LÍMITE DECLARADO Nº2: las tres tablas de RBAC de abajo son una copia A MANO
--   del esquema productivo, y NADA las mantiene sincronizadas. Se replican con
--   sus constraints y su nulabilidad tal como se midieron en producción
--   (`arsksytgdnzukbmfgkju`) antes de escribir 0259 — PK compuestas en
--   `user_roles` y `role_permissions`, unique en `roles.slug`, y toda columna
--   NOT NULL con su default— justamente porque son las que la migración
--   ESCRIBE: un `insert` que omita una columna NOT NULL sin default fallaría en
--   la ventana de aplicación con estos corredores igual en verde. Las columnas
--   que la migración no toca están acá sólo para que esa forma sea fiel.
create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  description text,
  color       text not null default '#214576',
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid
);

create table public.permissions (
  id     uuid primary key default gen_random_uuid(),
  slug   text unique not null,
  module text not null default 'compras',
  action text not null default 'x'
);

create table public.role_permissions (
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create table public.user_roles (
  user_id        uuid not null references auth.users(id) on delete cascade,
  role_id        uuid not null references public.roles(id) on delete cascade,
  position_title text,
  assigned_at    timestamptz not null default now(),
  assigned_by    uuid,
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
insert into public.permissions (slug) values
  ('compras.create'), ('compras.sign'), ('compras.view');

insert into public.roles (slug, name, is_system) values
  ('super_admin',              'Super Administrador',       true),
  ('director_ops',             'Director de Operaciones',   true),
  ('admin_sin_rrhh',           'Administración sin RRHH',   true),
  ('administracion_finanzas',  'Administración y Finanzas', true),
  ('gerencia_comercial',       'Gerencia Comercial',        true),
  ('gerencia',                 'Gerencia',                  true),
  ('facturacion_ventas',       'Facturación y Ventas',      true),
  ('rrhh_admin',               'RRHH Admin',                true),
  ('ai_docs_pilot',            'Piloto de documentos IA',   true),
  ('jefe_deposito',            'Jefe de Deposito',          true);

-- EL REPARTO REAL DE `compras.sign`, medido en producción antes de la
-- migración: CINCO roles lo portan. `gerencia` NO lo tiene (medido: H-B).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
 where p.slug = 'compras.sign'
   and r.slug in ('super_admin','director_ops','admin_sin_rrhh',
                  'administracion_finanzas','gerencia_comercial');

-- `compras.create` y `compras.view` tienen un reparto más ancho; se siembra el
-- de los roles que participan de los escenarios.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
 where p.slug in ('compras.create','compras.view')
   and r.slug in ('super_admin','director_ops','admin_sin_rrhh',
                  'administracion_finanzas','gerencia_comercial','gerencia');

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
