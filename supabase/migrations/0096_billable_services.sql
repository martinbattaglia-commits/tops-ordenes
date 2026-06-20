-- =========================================================================
-- 0096_billable_services.sql — Fase 13.B · Catálogo de servicios facturables
--
-- DIAGNÓSTICO (13.A): services_catalog (0001) es el catálogo OPERATIVO de
-- Órdenes de Servicio (rate global único, service_unit_t) — NO tiene IVA, ni
-- cuenta contable, ni centro de costo. Para facturación/tarifas se crea un
-- catálogo fiscal SEPARADO (sin tocar services_catalog, validado).
--
-- NATURALEZA: ADITIVA e idempotente. No aplica migraciones (las aplica Martín).
-- =========================================================================

create extension if not exists "pgcrypto";

create table if not exists public.billable_services (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  service_type text not null default 'servicio_especial',
  unit text not null default 'unidad',                  -- m2|m3|pallet|posicion|unidad|hora|mes|...
  default_vat_rate numeric(5,2) not null default 21,
  default_account_id uuid references public.chart_of_accounts(id) on delete set null,
  default_cost_center_id uuid references public.cost_centers(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billable_services_type_chk check (
    service_type in (
      'almacenaje_mensual','movimiento_inbound','movimiento_outbound',
      'preparacion_pedido','picking','packing','pallet','posicion','m2','m3',
      'servicio_anmat','servicio_cargas_generales','servicio_especial',
      'bonificacion_descuento'
    )
  ),
  constraint billable_services_vat_chk check (default_vat_rate in (0, 2.5, 5, 10.5, 21, 27))
);
create index if not exists bsvc_active_idx on public.billable_services (is_active);
create index if not exists bsvc_type_idx   on public.billable_services (service_type);

drop trigger if exists trg_bsvc_updated_at on public.billable_services;
create trigger trg_bsvc_updated_at
before update on public.billable_services
for each row execute function public.touch_updated_at();

alter table public.billable_services enable row level security;
drop policy if exists "bsvc read" on public.billable_services;
create policy "bsvc read" on public.billable_services for select
  using (public.current_role() in ('admin','operaciones','supervisor')
         or public.has_permission('contabilidad.view')
         or public.has_permission('comercial.view'));
drop policy if exists "bsvc write" on public.billable_services;
create policy "bsvc write" on public.billable_services for all
  using (public.current_role() = 'admin' or public.has_permission('contabilidad.edit'))
  with check (public.current_role() = 'admin' or public.has_permission('contabilidad.edit'));

-- -------------------------------------------------------------------------
-- Seed mínimo (configurable/editable). Mapea a cuentas de ingreso (0084) y a
-- unidades de negocio (0092). default_account_id/cost_center_id por código.
-- -------------------------------------------------------------------------
insert into public.billable_services (code, name, service_type, unit, default_vat_rate, default_account_id, default_cost_center_id, is_active)
select v.code, v.name, v.service_type, v.unit, v.vat,
       (select id from public.chart_of_accounts where code = v.acc_code),
       (select id from public.cost_centers where code = v.cc_code),
       true
from (values
  ('SVC-ALM-M2',     'Almacenaje por m²',            'm2',                       'm2',     21::numeric, '4.1.01', 'UN-ALMACENAJE'),
  ('SVC-ALM-M3',     'Almacenaje por m³',            'm3',                       'm3',     21::numeric, '4.1.01', 'UN-ALMACENAJE'),
  ('SVC-ALM-PALLET', 'Almacenaje por pallet/mes',    'almacenaje_mensual',       'pallet', 21::numeric, '4.1.01', 'UN-ALMACENAJE'),
  ('SVC-ALM-ANMAT',  'Almacenaje ANMAT',             'servicio_anmat',           'm2',     21::numeric, '4.1.02', 'UN-ANMAT'),
  ('SVC-IN',         'Movimiento inbound',           'movimiento_inbound',       'pallet', 21::numeric, '4.1.05', 'UN-LOGISTICA'),
  ('SVC-OUT',        'Movimiento outbound',          'movimiento_outbound',      'pallet', 21::numeric, '4.1.05', 'UN-LOGISTICA'),
  ('SVC-PREP',       'Preparación de pedido',        'preparacion_pedido',       'unidad', 21::numeric, '4.1.05', 'UN-LOGISTICA'),
  ('SVC-CARGAS',     'Servicio cargas generales',    'servicio_cargas_generales','unidad', 21::numeric, '4.1.01', 'UN-CARGAS'),
  ('SVC-TRANSPORTE', 'Transporte / distribución',    'servicio_especial',        'unidad', 21::numeric, '4.1.06', 'UN-TRANSPORTE'),
  ('SVC-OFICINA',    'Alquiler de oficina / coworking','servicio_especial',      'mes',    21::numeric, '4.1.03', 'UN-OFICINAS'),
  ('SVC-BONIF',      'Bonificación / descuento',     'bonificacion_descuento',   'unidad', 21::numeric, '4.2.01', null)
) as v(code, name, service_type, unit, vat, acc_code, cc_code)
on conflict (code) do nothing;

notify pgrst, 'reload schema';
