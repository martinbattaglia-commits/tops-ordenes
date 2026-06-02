-- =========================================================================
-- 0017_tracking_geofences.sql
-- OPERACIONES → Tracking de Flota · Geocercas (geofencing).
--
-- Requiere 0016 aplicada (PostGIS en schema extensions, RLS pattern).
-- Aditivo e idempotente. NO usa el valor de enum 'operaciones' → puede correr
-- antes del seed RBAC (0019).
--
-- Una geocerca es CIRCLE (center + radius_m) o POLYGON (area). Un CHECK
-- garantiza coherencia. La evaluación ENTER/EXIT vive en el Tracking Engine
-- (fase de eventos), no en esta migración.
-- =========================================================================

do $$ begin
  create type geofence_kind_t as enum ('circle', 'polygon');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.geofences (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  kind        geofence_kind_t not null,
  active      boolean not null default true,
  color       text,                                   -- hint de display para el mapa (Fase UI)
  description text,
  -- Representación CIRCLE:
  center      extensions.geometry(Point, 4326),
  radius_m    double precision,
  -- Representación POLYGON:
  area        extensions.geometry(Polygon, 4326),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint geofences_shape_ck check (
    (kind = 'circle'  and center is not null and radius_m is not null and radius_m > 0)
    or
    (kind = 'polygon' and area is not null)
  )
);

create index if not exists geofences_active_idx on public.geofences (active);
create index if not exists geofences_center_gist on public.geofences using gist (center);
create index if not exists geofences_area_gist   on public.geofences using gist (area);

drop trigger if exists geofences_touch_updated_at on public.geofences;
create trigger geofences_touch_updated_at
  before update on public.geofences
  for each row execute function public.tg_touch_updated_at();

-- -------------------------------------------------------------------------
-- RLS: lectura para staff autenticado; gestión para staff operativo.
-- -------------------------------------------------------------------------
alter table public.geofences enable row level security;

drop policy if exists geofences_select on public.geofences;
create policy geofences_select on public.geofences
  for select using (auth.uid() is not null);

drop policy if exists geofences_write on public.geofences;
create policy geofences_write on public.geofences
  for all
  using (public.current_role() in ('admin', 'operaciones', 'supervisor'))
  with check (public.current_role() in ('admin', 'operaciones', 'supervisor'));

-- =========================================================================
-- Seed: 2 sedes operativas TOPS como geocercas circulares (radio 150 m).
--
-- ⛔ COORDENADAS PROVISIONALES — NO USAR EN PRODUCCIÓN TAL CUAL.
--    Los valores de center salen de src/components/ejecutivo/AmbaMap.tsx, que
--    son APROXIMADOS (precisión a nivel barrio, no sub-cuadra). Por eso ambas
--    se siembran con active=false: existen como placeholders del roadmap pero
--    NO disparan geofencing hasta que se verifiquen las coords reales.
--
-- TODO(geocercas-reales): reemplazar center por lat/lng VERIFICADAS (GPS real
--    en sitio o geocoding confiable) y recién ahí poner active=true:
--      · 'Administración Central' → Agustín Magaldi 1765, Barracas, CABA
--      · 'Depósito Luján'         → Pedro de Luján <nro>, <localidad> (confirmar
--        si es CABA o Luján/Pcia. Bs. As. — hay ambigüedad en la fuente actual)
--    Fix posterior (sin migración): update public.geofences set
--      center = extensions.ST_SetSRID(extensions.ST_MakePoint(<lng>,<lat>),4326),
--      radius_m = <m>, active = true where name = '<nombre>';
-- =========================================================================
insert into public.geofences (name, kind, active, color, description, center, radius_m)
values
  (
    'Administración Central',
    'circle', false, '#C90812',
    'PROVISIONAL · Agustín Magaldi 1765 · Barracas · CABA — verificar coords',
    extensions.ST_SetSRID(extensions.ST_MakePoint(-58.3781, -34.6443), 4326),  -- ⛔ aprox AmbaMap
    150
  ),
  (
    'Depósito Luján',
    'circle', false, '#214576',
    'PROVISIONAL · Pedro de Luján · verificar coords y localidad',
    extensions.ST_SetSRID(extensions.ST_MakePoint(-58.4625, -34.6447), 4326),  -- ⛔ aprox AmbaMap
    150
  )
on conflict (name) do nothing;

notify pgrst, 'reload schema';
