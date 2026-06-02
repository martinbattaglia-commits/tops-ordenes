-- =========================================================================
-- 0016_tracking_foundation.sql
-- OPERACIONES → Tracking de Flota · Fase 2 (capa de datos, fundación PostGIS).
--
-- Aditivo e idempotente. NO toca filas ni columnas de tablas existentes.
-- Único efecto sobre objetos existentes: extiende el enum permission_module_t
-- con el valor 'operaciones' (consumido por 0019_tracking_rbac_seed).
--
-- ⚠️ ORDEN OBLIGATORIO: 0016 → 0017 → 0018 → 0019, en ejecuciones SEPARADAS.
--    Postgres no permite USAR un valor de enum recién agregado en la misma
--    transacción en que se lo agrega; 0016 solo lo AGREGA, 0019 lo USA.
--
-- ⚠️ PostGIS: se instala en el schema `extensions` (convención Supabase) y se
--    referencia schema-qualified (extensions.ST_*, extensions.geometry) para
--    no depender del search_path. Si tu proyecto ya tiene PostGIS en otro
--    schema, ajustá el prefijo. Ver reporte de riesgos.
-- =========================================================================

create extension if not exists pgcrypto;

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

-- -------------------------------------------------------------------------
-- Estado ADMINISTRATIVO del vehículo (alta/baja/mantenimiento).
-- El estado LIVE (en movimiento / detenido / offline) NO se persiste acá:
-- se deriva en tiempo real de fleet_positions (recency + velocidad).
-- -------------------------------------------------------------------------
do $$ begin
  create type fleet_vehicle_status_t as enum ('active', 'inactive', 'maintenance');
exception
  when duplicate_object then null;
end $$;

-- -------------------------------------------------------------------------
-- Vehículos de la flota.
-- device_identifier = ID del dispositivo Traccar Client (iPhone) / GPS.
-- -------------------------------------------------------------------------
create table if not exists public.fleet_vehicles (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  plate             text,
  type              text,
  status            fleet_vehicle_status_t not null default 'active',
  driver_name       text,
  device_identifier text unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists fleet_vehicles_status_idx
  on public.fleet_vehicles (status);

-- -------------------------------------------------------------------------
-- Posiciones (serie temporal append-only, preparada para millones de filas).
--
-- `geom` es una columna GENERADA a partir de longitude/latitude → el path de
-- ingesta (Provider/Engine) nunca necesita conocer PostGIS: solo inserta
-- lat/lng y la geometría se computa sola. SRID 4326 = WGS84.
-- -------------------------------------------------------------------------
create table if not exists public.fleet_positions (
  id          bigint generated always as identity primary key,
  vehicle_id  uuid not null references public.fleet_vehicles(id) on delete cascade,
  latitude    double precision not null,
  longitude   double precision not null,
  geom        extensions.geometry(Point, 4326)
                generated always as (
                  extensions.ST_SetSRID(extensions.ST_MakePoint(longitude, latitude), 4326)
                ) stored,
  speed       double precision,            -- cruda del dispositivo; unidad normalizada en el Provider (Fase UI)
  battery     smallint,                    -- 0..100
  heading     double precision,            -- grados 0..360
  accuracy    double precision,            -- metros
  recorded_at timestamptz not null,        -- timestamp del dispositivo
  created_at  timestamptz not null default now()
);

-- Consulta más caliente: última posición por vehículo.
create index if not exists fleet_positions_vehicle_recorded_idx
  on public.fleet_positions (vehicle_id, recorded_at desc);

-- BRIN para barridos históricos por tiempo (escala masiva, índice barato).
create index if not exists fleet_positions_recorded_brin
  on public.fleet_positions using brin (recorded_at);

-- Índice geoespacial para consultas por proximidad / geocercas (PostGIS GIST).
create index if not exists fleet_positions_geom_gist
  on public.fleet_positions using gist (geom);

-- -------------------------------------------------------------------------
-- updated_at automático (reusa la función existente public.tg_touch_updated_at).
-- -------------------------------------------------------------------------
drop trigger if exists fleet_vehicles_touch_updated_at on public.fleet_vehicles;
create trigger fleet_vehicles_touch_updated_at
  before update on public.fleet_vehicles
  for each row execute function public.tg_touch_updated_at();

-- -------------------------------------------------------------------------
-- RLS.
--  · Lectura: cualquier usuario autenticado del staff.
--  · Escritura de vehículos: staff operativo vía public.current_role()
--    (enum user_role_t: 'admin','operaciones','supervisor'). Patrón idéntico
--    al resto del schema (no se inventa una autorización nueva).
--  · Inserción de posiciones: SOLO service_role (el endpoint de ingesta usa la
--    service key y bypassa RLS). Sin policy de insert → ningún cliente con
--    sesión puede inyectar posiciones falsas.
-- -------------------------------------------------------------------------
alter table public.fleet_vehicles  enable row level security;
alter table public.fleet_positions enable row level security;

drop policy if exists fleet_vehicles_select on public.fleet_vehicles;
create policy fleet_vehicles_select on public.fleet_vehicles
  for select using (auth.uid() is not null);

drop policy if exists fleet_vehicles_write on public.fleet_vehicles;
create policy fleet_vehicles_write on public.fleet_vehicles
  for all
  using (public.current_role() in ('admin', 'operaciones', 'supervisor'))
  with check (public.current_role() in ('admin', 'operaciones', 'supervisor'));

drop policy if exists fleet_positions_select on public.fleet_positions;
create policy fleet_positions_select on public.fleet_positions
  for select using (auth.uid() is not null);

-- -------------------------------------------------------------------------
-- Realtime: publicar fleet_positions en la publicación supabase_realtime para
-- que la suscripción CDC (Fase UI) reciba cada INSERT sin polling. Idempotente.
-- -------------------------------------------------------------------------
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'fleet_positions'
  ) then
    alter publication supabase_realtime add table public.fleet_positions;
  end if;
exception
  when undefined_object then null;  -- publicación inexistente (entorno no-Supabase)
end $$;

-- -------------------------------------------------------------------------
-- RBAC: nuevo módulo 'operaciones' en el catálogo de permisos.
-- Solo se AGREGA el valor del enum; el seed de permisos/roles va en 0019.
-- -------------------------------------------------------------------------
alter type public.permission_module_t add value if not exists 'operaciones';

-- PostgREST: refrescar el cache de esquema para que vea las tablas nuevas.
notify pgrst, 'reload schema';
