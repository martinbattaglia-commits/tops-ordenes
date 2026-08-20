-- =========================================================================
-- P3-N1A0 · BOOTSTRAP EXCLUSIVO DE TESTS — NO ES UNA MIGRACIÓN PRODUCTIVA.
--
-- No vive en supabase/migrations/ y NUNCA debe aplicarse a un proyecto
-- Supabase. Existe sólo para que las migraciones versionadas del repositorio
-- puedan cargarse sobre un PostgreSQL 17 vanilla efímero.
--
-- Cierre de dependencias de plataforma (derivado por grep sobre las 180
-- migraciones del repositorio):
--   auth.users · auth.uid() · auth.role() · auth.jwt()
--   storage.buckets · storage.objects · storage.foldername()
--   roles anon / authenticated / service_role
--   extensiones pgcrypto · pg_trgm · unaccent
--
-- NO se stubea PostGIS: ninguna migración del cierre WMS lo requiere.
--
-- ─────────────────────────────────────────────────────────────────────────
-- FIDELIDAD RESPECTO DE SUPABASE REAL — declaración honesta
-- ─────────────────────────────────────────────────────────────────────────
--
-- CUBIERTO (suficiente para las garantías que A0 verifica):
--   · existencia y forma de los objetos de plataforma que las migraciones
--     referencian;
--   · grants por defecto sobre `public` equivalentes a los de Supabase, de
--     modo que RLS —y no la ausencia de privilegios— sea la barrera efectiva
--     al ejecutar como `anon` / `authenticated`;
--   · `auth.uid()` / `auth.role()` conmutables por GUC, lo que permite
--     simular una sesión sin emitir un JWT real.
--
-- NO CUBIERTO (y no debe afirmarse lo contrario):
--   · GoTrue: emisión, firma y expiración de JWT reales;
--   · PostgREST: traducción HTTP→SQL, `role` switching por JWT, exposición
--     de esquemas y manejo de errores;
--   · políticas y triggers propios de `storage` en Supabase gestionado;
--   · Realtime, Edge Functions, connection pooler;
--   · roles internos de plataforma (`supabase_admin`, `authenticator`,
--     `supabase_auth_admin`) y la cadena de `SET ROLE` que usa PostgREST.
--
-- TRABAJO FUTURO: verificar el comportamiento end-to-end de PostgREST y GoTrue
-- exigiría un Supabase local completo (CLI + Docker). Queda fuera de A0 por la
-- decisión de no incorporar Docker como dependencia obligatoria.
-- =========================================================================

create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---- Roles de plataforma -------------------------------------------------
do $$ begin create role anon nologin;          exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin;  exception when duplicate_object then null; end $$;

-- ---- Esquema auth --------------------------------------------------------
create schema if not exists auth;

-- Sólo las columnas que las migraciones referencian (destino de FK, email y
-- raw_user_meta_data: 0001 instala `handle_new_user()` AFTER INSERT sobre
-- auth.users y lee `new.raw_user_meta_data->>'full_name'`. La columna existe
-- en el auth.users real de Supabase; sin ella cualquier INSERT de usuarios
-- rompe el trigger. El hueco era invisible en A0 porque ninguna prueba
-- insertaba usuarios; P3-N1B simula sesiones operativas reales y lo destapó).
create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb
);

-- En Supabase estas funciones leen el JWT del request. Acá leen GUCs, de modo
-- que un test pueda simular una sesión con set_config('request.jwt.claim.*').
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

-- ---- Esquema storage -----------------------------------------------------
create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create table if not exists storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets(id),
  name             text,
  owner            uuid,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata         jsonb,
  path_tokens      text[]
);

-- Las migraciones 0003/0010/0013 crean policies sobre storage.objects; sin RLS
-- habilitada las policies se crean pero no se evalúan y el test perdería fidelidad.
alter table storage.objects enable row level security;

-- `foldername` devuelve las CARPETAS del path, EXCLUYENDO el nombre del objeto
-- final — semántica documentada por Supabase. La versión anterior de este stub
-- devolvía el path completo partido, incluido el archivo, lo que habría hecho
-- pasar pruebas de scoping por prefijo que en producción fallarían.
--   'file.txt'      → {}
--   'a/file.txt'    → {a}
--   'a/b/file.txt'  → {a,b}
--   'a/b/'          → {a,b}
create or replace function storage.foldername(name text)
returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : array_length(_parts, 1) - 1];
end
$$;

create or replace function storage.filename(name text)
returns text language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end
$$;

create or replace function storage.extension(name text)
returns text language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(storage.filename(name), '.') into _parts;
  return _parts[array_length(_parts, 1)];
end
$$;

-- =========================================================================
-- GRANTS MÍNIMOS — reproducen el default de Supabase, no lo amplían.
--
-- En un proyecto Supabase, `anon` y `authenticated` reciben privilegios sobre
-- las tablas de `public` mediante ALTER DEFAULT PRIVILEGES; la barrera efectiva
-- es RLS, no el privilegio. Reproducirlo es CONDICIÓN para que las pruebas de
-- RLS midan algo real: sin estos grants, una consulta como `anon` fallaría por
-- falta de privilegio y no por la policy, produciendo un falso PASS.
--
-- Se emiten ANTES de las migraciones para que apliquen a las tablas que ellas
-- crean, igual que en Supabase. No se otorga nada por encima de ese default.
-- =========================================================================
grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

-- Objetos ya creados por este bootstrap.
grant usage on schema auth, storage to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
