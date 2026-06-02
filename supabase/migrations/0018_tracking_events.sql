-- =========================================================================
-- 0018_tracking_events.sql
-- OPERACIONES → Tracking de Flota · Eventos (log histórico).
--
-- Requiere 0016 (fleet_vehicles, fleet_positions) y 0017 (geofences).
-- Aditivo e idempotente. NO usa el valor de enum 'operaciones'.
--
-- Tabla append-only de eventos. El enum se siembra YA con el roadmap completo
-- de tipos para evitar migraciones posteriores (los valores extra existen pero
-- su lógica de emisión se implementa más adelante). La ESCRITURA la hace el
-- Tracking Engine vía service_role; no hay policy de insert para clientes.
--
-- Roadmap de tipos (valores reservados desde el día 1):
--   geofence_enter / geofence_exit  → transición de geocerca (contrato listo)
--   vehicle_online / vehicle_offline → cambio de presencia por recency
--   vehicle_idle / vehicle_moving    → cambio de movimiento por velocidad
--   speeding                         → exceso de velocidad (umbral futuro)
-- =========================================================================

do $$ begin
  create type fleet_event_type_t as enum (
    'geofence_enter',
    'geofence_exit',
    'vehicle_online',
    'vehicle_offline',
    'vehicle_idle',
    'vehicle_moving',
    'speeding'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.fleet_events (
  id          bigint generated always as identity primary key,
  vehicle_id  uuid not null references public.fleet_vehicles(id) on delete cascade,
  geofence_id uuid references public.geofences(id) on delete set null,
  position_id bigint references public.fleet_positions(id) on delete set null,
  type        fleet_event_type_t not null,
  recorded_at timestamptz not null,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists fleet_events_vehicle_recorded_idx
  on public.fleet_events (vehicle_id, recorded_at desc);

create index if not exists fleet_events_geofence_recorded_idx
  on public.fleet_events (geofence_id, recorded_at desc);

create index if not exists fleet_events_recorded_brin
  on public.fleet_events using brin (recorded_at);

-- -------------------------------------------------------------------------
-- RLS: lectura para staff autenticado. Inserción SOLO service_role (Engine).
-- -------------------------------------------------------------------------
alter table public.fleet_events enable row level security;

drop policy if exists fleet_events_select on public.fleet_events;
create policy fleet_events_select on public.fleet_events
  for select using (auth.uid() is not null);

notify pgrst, 'reload schema';
