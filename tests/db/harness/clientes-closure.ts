/**
 * Cierre acotado COMPARTIDO de las suites del Carril A (0240/0241).
 *
 * ─── POR QUÉ EXISTE ────────────────────────────────────────────────────────
 *
 * La revisión adversarial C4 1/2 encontró que los dos cierres acotados del
 * candidato original declaraban reproducir «las MISMAS restricciones que
 * 0001» y omitían justamente `unique (module, action)` de `public.permissions`
 * —que vive en 0009_rbac.sql, no en 0001—. Con esa omisión, ningún test podía
 * detectar que `on conflict (slug)` deja escapar el segundo índice único.
 *
 * Un cierre acotado que dice replicar producción y omite la restricción que
 * rompe es el mecanismo exacto por el que un falso verde se vuelve creíble.
 * Por eso ahora hay UNA sola definición, compartida, y cada pieza declara de
 * qué migración real proviene.
 *
 * Todo lo de acá abajo es copia FIEL de su origen. Si alguien cambia el
 * original y no esto, los tests dejan de medir producción — es una deuda
 * conocida e inherente a cualquier cierre acotado.
 */

/** Origen de cada bloque, para poder auditarlo contra el archivo real. */
export const ORIGEN = {
  clients: "0001_init.sql:38-56 + 0004_extended_schema.sql:14 + 0011_arca_billing.sql:60",
  profiles: "0001_init.sql:28-35",
  currentRole: "0001_init.sql / 0005_fix_rls_recursion.sql",
  permissions: "0009_rbac.sql:42-51 (incluye unique (module, action))",
  touchUpdatedAt: "0004_extended_schema.sql:24-31",
} as const;

export const CIERRE_ACOTADO = `
  -- 0241 concede privilegios y define policies para \`authenticated\`: el rol
  -- tiene que existir o la migración falla por una causa ajena a lo medido.
  -- Los TRES roles de Supabase. Sin \`anon\` y \`service_role\`, el revoke de
  -- 0241 no tendría a quién revocarle y la prueba de privilegios mediría una
  -- base que no se parece a producción.
  do $r$ begin
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $r$;

  -- BOOTSTRAP DE SUPABASE, reproducido a propósito. El proyecto real ejecuta
  -- \`alter default privileges ... grant all on tables to anon, authenticated,
  -- service_role\`. Sin esto, cualquier tabla nueva parecería nacer sin
  -- privilegios y un \`revoke\` incompleto pasaría inadvertido: es exactamente
  -- el falso verde que la revisión C4 2/2 detectó (N-03).
  alter default privileges in schema public
    grant all on tables to anon, authenticated, service_role;

  create schema if not exists extensions;
  create extension if not exists pgcrypto;
  create extension if not exists unaccent with schema extensions;
  create extension if not exists pg_trgm with schema extensions;

  create schema if not exists auth;
  create table auth.users (id uuid primary key);
  -- Observador intercambiable por GUC, para cambiar de identidad sin recrear.
  create or replace function auth.uid() returns uuid language sql stable as $fn$
    select nullif(current_setting('test.observer', true), '')::uuid
  $fn$;
  grant usage on schema auth to authenticated;

  create type public.depot_t as enum ('MAGALDI','LUJAN');
  create type public.user_role_t as enum ('admin','operaciones','supervisor','cliente');

  -- ${"profiles"} — 0001_init.sql:28-35. Necesario para el scoping por client_id.
  create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    role public.user_role_t not null default 'operaciones',
    depot public.depot_t,
    client_id uuid,
    active boolean not null default true,
    created_at timestamptz not null default now()
  );

  -- current_role() — SECURITY DEFINER como en 0005, para evitar recursión RLS.
  create or replace function public.current_role() returns text
    language sql stable security definer set search_path = public as $fn$
      select coalesce((select role::text from public.profiles where id = auth.uid()), 'anon')
  $fn$;

  create table public.clients (
    id uuid primary key default gen_random_uuid(),
    razon text not null,
    cuit text not null unique,
    domicilio text,
    telefono text,
    contacto text,
    email text,
    tags text[] not null default '{}',
    created_at timestamptz not null default now(),
    created_by uuid references auth.users(id) on delete set null,
    deposito_asignado public.depot_t,
    activo boolean not null default true,
    updated_at timestamptz not null default now(),
    localidad text
  );

  -- Trigger PREEXISTENTE de 0004. Está acá a propósito: sin él, el cierre no
  -- reproduce que \`updated_at\` ya tiene dueño, y no se podría comprobar que
  -- 0241 NO lo duplica.
  create or replace function public.tg_touch_updated_at() returns trigger
    language plpgsql as $fn$ begin new.updated_at := now(); return new; end $fn$;
  create trigger clients_touch_updated_at
    before update on public.clients
    for each row execute function public.tg_touch_updated_at();

  alter table public.clients enable row level security;
  create policy "clients read internal" on public.clients for select to authenticated
    using (
      public.current_role() in ('admin','operaciones','supervisor')
      or id = (select client_id from public.profiles where id = auth.uid())
    );
  grant select on public.clients to authenticated;
  -- La RLS se evalúa DESPUÉS del privilegio de tabla. Sin este grant, todo
  -- fallaría por "permission denied" antes de llegar a la policy, y no se
  -- podría medir el aislamiento.
  grant select on public.profiles to authenticated;

  create type public.permission_module_t as enum ('cockpit','compras','servicios','wms');
  create type public.permission_action_t as enum ('view','create','edit','delete','sign','export','admin');

  -- permissions — 0009_rbac.sql:42-51. La restricción \`unique (module, action)\`
  -- es la que hace fallar a \`on conflict (slug)\`: NO se puede omitir.
  create table public.permissions (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique,
    module public.permission_module_t not null,
    action public.permission_action_t not null,
    label text not null,
    description text,
    created_at timestamptz not null default now(),
    unique (module, action)
  );
`;
