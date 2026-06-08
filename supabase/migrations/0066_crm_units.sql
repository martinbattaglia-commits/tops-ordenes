-- CRM360 · P1 · E1 — crm_units: fuente ÚNICA de verdad del inventario reservable.
-- Resuelve la doble reserva: estado por unidad + unique(site, unit_code).
-- CRM360 y los mapas (Digital Twin) deben leer/escribir ESTA tabla.
-- NO aplicado a producción desde la sesión. Idempotente.

-- Estados de unidad (los 5 aprobados por Presidencia).
do $$ begin
  create type public.crm_unit_state_t as enum
    ('disponible','reservada','ocupada','bloqueada','no_comercializable');
exception when duplicate_object then null; end $$;

create table if not exists public.crm_units (
  id             uuid primary key default gen_random_uuid(),
  site           text not null check (site in ('MAGALDI_1765','PEDRO_LUJAN_3159')),
  unit_code      text not null,                       -- alineado al `code`/`id` del mapa
  name           text,
  tipo           text,                                -- sector | cubiculo | oficina | coworking | servicio | maniobra
  category       public.crm_service_t,                -- anmat | general | oficinas (nullable)
  floor          text,
  m2             numeric(12,2),
  state          public.crm_unit_state_t not null default 'disponible',
  opportunity_id uuid references public.crm_opportunities(id) on delete set null,
  ocupado_por    text,                                -- cliente actual (del relevamiento físico)
  nota           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- INVARIANTE CLAVE: una sola fila por unidad física → imposible doble reserva.
  unique (site, unit_code)
);

create index if not exists crm_units_site_idx     on public.crm_units(site);
create index if not exists crm_units_state_idx    on public.crm_units(state);
create index if not exists crm_units_category_idx on public.crm_units(category);
create index if not exists crm_units_opp_idx      on public.crm_units(opportunity_id) where opportunity_id is not null;

alter table public.crm_units enable row level security;
drop policy if exists "crm_units read" on public.crm_units;
create policy "crm_units read" on public.crm_units for select to authenticated using (true);
drop policy if exists "crm_units write admin" on public.crm_units;
create policy "crm_units write admin" on public.crm_units for all to authenticated
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

comment on table public.crm_units is 'Inventario reservable (fuente única). CRM360 + mapas Magaldi/Luján derivan de acá. P1.';
