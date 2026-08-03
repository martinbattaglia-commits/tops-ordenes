-- =========================================================================
-- P3-N1A0 · BOOTSTRAP EXCLUSIVO DE TESTS — NO ES UNA MIGRACIÓN PRODUCTIVA.
--
-- Este archivo NO vive en supabase/migrations/ y NUNCA debe aplicarse a un
-- proyecto Supabase. Existe sólo para que las migraciones versionadas del
-- repositorio puedan cargarse sobre un PostgreSQL 17 vanilla efímero.
--
-- Supabase provee de fábrica los esquemas `auth` y `storage` y los roles
-- `anon` / `authenticated` / `service_role`. PostgreSQL vanilla no. Este stub
-- crea el MÍNIMO INDISPENSABLE para satisfacer las referencias que las
-- migraciones hacen a esos objetos de plataforma.
--
-- Cierre de dependencias de plataforma (derivado por grep sobre las 180
-- migraciones del repositorio, ver tests/db/harness/manifest.ts):
--   auth.users · auth.uid() · auth.role() · auth.jwt()
--   storage.buckets · storage.objects · storage.foldername()
--   roles anon / authenticated / service_role
--   extensiones pgcrypto · pg_trgm · unaccent
--
-- NO se stubea PostGIS: ninguna migración del cierre WMS lo requiere.
-- =========================================================================

create schema if not exists extensions;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- ---- Roles de plataforma -------------------------------------------------
do $$ begin create role anon nologin;          exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin;  exception when duplicate_object then null; end $$;

-- ---- Esquema auth --------------------------------------------------------
create schema if not exists auth;

-- Sólo las columnas que las migraciones referencian (destino de FK y email).
create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
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
  id                text primary key,
  name              text not null,
  owner             uuid,
  public            boolean default false,
  file_size_limit   bigint,
  allowed_mime_types text[],
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
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

create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/')
$$;

create or replace function storage.filename(name text) returns text language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;

create or replace function storage.extension(name text) returns text language sql immutable as $$
  select nullif(split_part(storage.filename(name), '.', 2), '')
$$;
