-- =========================================================================
-- TOPS Nexus — FASE 4B: Modelo físico del Digital Twin Logístico (WMS).
--
-- Congela la jerarquía física oficial de 6 niveles derivada de los planos de
-- incendio aprobados por GCABA (ver docs/digital-twin-blueprint.md):
--
--   warehouses < warehouse_floors < warehouse_sectors < warehouse_zones
--             < warehouse_racks < warehouse_positions
--
-- ADDITIVE ONLY. No toca ninguna tabla existente. Las posiciones
-- (warehouse_positions.id) son la clave de integración con WMS/Pedidos/Mapa.
--
-- Seed: SOLO datos oficiales del plano → 2 sedes + pisos + sectores de incendio
-- (Magaldi S1–S5, Luján D1–D8). NO se siembran zones/racks/positions: no están
-- en los planos, requieren relevamiento operativo y se cargan después por UI/CSV.
-- =========================================================================

create extension if not exists "pgcrypto";

-- ---- Enums --------------------------------------------------------------
do $$ begin
  create type warehouse_type_t as enum ('general', 'anmat', 'mixed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type warehouse_position_status_t as enum (
    'disponible',    -- verde
    'reservado',     -- amarillo
    'ocupado',       -- rojo
    'mantenimiento'  -- gris
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type warehouse_sector_type_t as enum (
    'almacenamiento', 'recepcion', 'despacho', 'picking',
    'cuarentena', 'oficinas', 'servicios'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type warehouse_zone_type_t as enum (
    'almacenamiento', 'picking', 'recepcion', 'despacho',
    'cuarentena', 'refrigerado'
  );
exception when duplicate_object then null; end $$;

-- ---- Nivel 1: Sedes -----------------------------------------------------
create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                 -- 'MAGALDI_1765'
  name text not null,
  warehouse_type warehouse_type_t not null default 'general',
  address text,
  owner text,                                -- titular registral (Verotin / Climac)
  surface_m2 numeric(12,2),                  -- nullable: Luján provisional
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists warehouses_code_idx on public.warehouses (code);

-- ---- Nivel 2: Pisos -----------------------------------------------------
create table if not exists public.warehouse_floors (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  code text not null,                        -- 'PB','EP','PA','P1','P2'
  name text not null,
  level int,                                 -- orden vertical (0 = PB)
  surface_m2 numeric(12,2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (warehouse_id, code)
);
create index if not exists warehouse_floors_wh_idx on public.warehouse_floors (warehouse_id);

-- ---- Nivel 3: Sectores (= sectores de incendio oficiales) ---------------
create table if not exists public.warehouse_sectors (
  id uuid primary key default gen_random_uuid(),
  floor_id uuid not null references public.warehouse_floors(id) on delete cascade,
  code text not null,                        -- 'S1','D1'
  name text not null,
  sector_type warehouse_sector_type_t not null default 'almacenamiento',
  surface_m2 numeric(12,2),                  -- m² oficial del plano
  perimeter_m numeric(10,2),                 -- perímetro del plano (Luján lo trae)
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (floor_id, code)
);
create index if not exists warehouse_sectors_floor_idx on public.warehouse_sectors (floor_id);

-- ---- Nivel 4: Zonas (subdivisión operativa interna) ---------------------
create table if not exists public.warehouse_zones (
  id uuid primary key default gen_random_uuid(),
  sector_id uuid not null references public.warehouse_sectors(id) on delete cascade,
  code text not null,
  name text not null,
  zone_type warehouse_zone_type_t,           -- nullable
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (sector_id, code)
);
create index if not exists warehouse_zones_sector_idx on public.warehouse_zones (sector_id);

-- ---- Nivel 5: Racks -----------------------------------------------------
create table if not exists public.warehouse_racks (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.warehouse_zones(id) on delete cascade,
  code text not null,
  name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (zone_id, code)
);
create index if not exists warehouse_racks_zone_idx on public.warehouse_racks (zone_id);

-- ---- Nivel 6: Posiciones (hoja · clave de integración) ------------------
create table if not exists public.warehouse_positions (
  id uuid primary key default gen_random_uuid(),
  rack_id uuid not null references public.warehouse_racks(id) on delete cascade,
  code text not null,                        -- 'N1-C03'
  rack_level int,                            -- nivel/altura del rack
  rack_column int,                           -- columna
  status warehouse_position_status_t not null default 'disponible',
  surface_m2 numeric(10,2),                  -- OBLIGATORIO (capacidad física)
  volume_m3 numeric(10,2),                   -- OBLIGATORIO
  capacity int,                              -- unidades/pallets (nullable)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (rack_id, code)
);
create index if not exists warehouse_positions_rack_idx on public.warehouse_positions (rack_id);
create index if not exists warehouse_positions_status_idx on public.warehouse_positions (status);

-- =========================================================================
-- RLS — misma política que el resto del ERP (0014 cost_centers): lectura para
-- autenticados, escritura interna (admin/operaciones/supervisor).
-- =========================================================================
alter table public.warehouses          enable row level security;
alter table public.warehouse_floors    enable row level security;
alter table public.warehouse_sectors   enable row level security;
alter table public.warehouse_zones     enable row level security;
alter table public.warehouse_racks     enable row level security;
alter table public.warehouse_positions enable row level security;

-- warehouses
drop policy if exists "warehouses read" on public.warehouses;
create policy "warehouses read" on public.warehouses for select
  using (auth.role() = 'authenticated');
drop policy if exists "warehouses write" on public.warehouses;
create policy "warehouses write" on public.warehouses for all
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

-- warehouse_floors
drop policy if exists "warehouse_floors read" on public.warehouse_floors;
create policy "warehouse_floors read" on public.warehouse_floors for select
  using (auth.role() = 'authenticated');
drop policy if exists "warehouse_floors write" on public.warehouse_floors;
create policy "warehouse_floors write" on public.warehouse_floors for all
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

-- warehouse_sectors
drop policy if exists "warehouse_sectors read" on public.warehouse_sectors;
create policy "warehouse_sectors read" on public.warehouse_sectors for select
  using (auth.role() = 'authenticated');
drop policy if exists "warehouse_sectors write" on public.warehouse_sectors;
create policy "warehouse_sectors write" on public.warehouse_sectors for all
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

-- warehouse_zones
drop policy if exists "warehouse_zones read" on public.warehouse_zones;
create policy "warehouse_zones read" on public.warehouse_zones for select
  using (auth.role() = 'authenticated');
drop policy if exists "warehouse_zones write" on public.warehouse_zones;
create policy "warehouse_zones write" on public.warehouse_zones for all
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

-- warehouse_racks
drop policy if exists "warehouse_racks read" on public.warehouse_racks;
create policy "warehouse_racks read" on public.warehouse_racks for select
  using (auth.role() = 'authenticated');
drop policy if exists "warehouse_racks write" on public.warehouse_racks;
create policy "warehouse_racks write" on public.warehouse_racks for all
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

-- warehouse_positions
drop policy if exists "warehouse_positions read" on public.warehouse_positions;
create policy "warehouse_positions read" on public.warehouse_positions for select
  using (auth.role() = 'authenticated');
drop policy if exists "warehouse_positions write" on public.warehouse_positions;
create policy "warehouse_positions write" on public.warehouse_positions for all
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

-- =========================================================================
-- SEED — SOLO datos oficiales del plano. Idempotente.
-- =========================================================================

-- ---- Sedes --------------------------------------------------------------
insert into public.warehouses (code, name, warehouse_type, address, owner, surface_m2) values
  ('MAGALDI_1765', 'Sede Central — Agustín Magaldi 1765', 'mixed',
   'Agustín Magaldi 1765 / Osvaldo de la Cruz 3201, CABA', 'VEROTIN S.A.', 6893.87),
  ('PEDRO_LUJAN_3159', 'Sede Anexa — Pedro de Luján 3159', 'anmat',
   'Pedro de Luján 3159, CABA', 'CLIMAC S.A.', null)   -- m² oficial a validar
on conflict (code) do nothing;

-- ---- Pisos: Magaldi -----------------------------------------------------
insert into public.warehouse_floors (warehouse_id, code, name, level)
select w.id, f.code, f.name, f.level
from public.warehouses w
cross join (values ('PB','Planta Baja',0), ('EP','Entrepiso',1), ('PA','Planta Alta',2))
  as f(code, name, level)
where w.code = 'MAGALDI_1765'
on conflict (warehouse_id, code) do nothing;

-- ---- Pisos: Pedro de Luján ----------------------------------------------
insert into public.warehouse_floors (warehouse_id, code, name, level)
select w.id, f.code, f.name, f.level
from public.warehouses w
cross join (values ('PB','Planta Baja',0), ('P1','Planta 1° Piso',1), ('P2','Planta 2° Piso',2))
  as f(code, name, level)
where w.code = 'PEDRO_LUJAN_3159'
on conflict (warehouse_id, code) do nothing;

-- ---- Sectores: Magaldi · PB (s/PLANILLA DE INCENDIO cert. 460/19) --------
insert into public.warehouse_sectors (floor_id, code, name, sector_type, surface_m2, notes)
select fl.id, s.code, s.name, 'almacenamiento'::warehouse_sector_type_t, s.m2, s.notes
from public.warehouse_floors fl
join public.warehouses w on w.id = fl.warehouse_id
cross join (values
  ('S1','Sector 1', 564.68, 's/planilla incendio 460/19'),
  ('S2','Sector 2', 786.02, 's/planilla incendio 460/19'),
  ('S3','Sector 3', 793.30, 's/planilla incendio 460/19 — abarca PB+PA'),
  ('S4','Sector 4', 306.31, 's/planilla incendio 460/19'),
  ('S5','Sector 5', 990.27, 's/planilla incendio 460/19')
) as s(code, name, m2, notes)
where w.code = 'MAGALDI_1765' and fl.code = 'PB'
on conflict (floor_id, code) do nothing;

-- ---- Sectores: Pedro de Luján · PB (s/plano 717/11, provisional) ---------
insert into public.warehouse_sectors (floor_id, code, name, sector_type, surface_m2, perimeter_m, notes)
select fl.id, s.code, s.name, 'almacenamiento'::warehouse_sector_type_t, s.m2, s.per, s.notes
from public.warehouse_floors fl
join public.warehouses w on w.id = fl.warehouse_id
cross join (values
  ('D1','Depósito 1', 895.05, 123.54, 'provisional s/plano 717/11'),
  ('D2','Depósito 2', null,    73.43, 'provisional — superficie a verificar'),
  ('D3','Depósito 3', 885.85, 152.83, 'provisional s/plano 717/11'),
  ('D4','Depósito 4', 970.56, 125.00, 'provisional s/plano 717/11'),
  ('D5','Depósito 5', 806.50, 150.76, 'provisional s/plano 717/11 — claraboya'),
  ('D8','Depósito 8', 356.85,  83.16, 'provisional s/plano 717/11')
) as s(code, name, m2, per, notes)
where w.code = 'PEDRO_LUJAN_3159' and fl.code = 'PB'
on conflict (floor_id, code) do nothing;

-- ---- Sectores: Pedro de Luján · P1 --------------------------------------
insert into public.warehouse_sectors (floor_id, code, name, sector_type, surface_m2, notes)
select fl.id, 'D7', 'Depósito 7', 'almacenamiento'::warehouse_sector_type_t, 189.47,
       'provisional s/plano 717/11'
from public.warehouse_floors fl
join public.warehouses w on w.id = fl.warehouse_id
where w.code = 'PEDRO_LUJAN_3159' and fl.code = 'P1'
on conflict (floor_id, code) do nothing;

-- ---- Sectores: Pedro de Luján · P2 --------------------------------------
insert into public.warehouse_sectors (floor_id, code, name, sector_type, surface_m2, perimeter_m, notes)
select fl.id, 'D6', 'Depósito 6', 'almacenamiento'::warehouse_sector_type_t, 350.78, 81.96,
       'provisional s/plano 717/11'
from public.warehouse_floors fl
join public.warehouses w on w.id = fl.warehouse_id
where w.code = 'PEDRO_LUJAN_3159' and fl.code = 'P2'
on conflict (floor_id, code) do nothing;

-- Zonas, racks y posiciones NO se siembran: requieren relevamiento operativo
-- (no están en los planos de incendio). Se cargan después por UI/CSV.

notify pgrst, 'reload schema';
