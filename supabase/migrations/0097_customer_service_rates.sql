-- =========================================================================
-- 0097_customer_service_rates.sql — Fase 13.C · Matriz de tarifas por cliente
--
-- Tarifa por (cliente, servicio) con vigencia temporal. Evita solapamientos
-- activos con una EXCLUDE constraint (btree_gist) sobre el rango de fechas.
-- Resolver de tarifa aplicable para una fecha. Trazabilidad: el rate_id viaja
-- a billing_run_items (0098) e invoice_items (0100).
--
-- NATURALEZA: ADITIVA e idempotente. Requiere 0096 (billable_services).
-- =========================================================================

create extension if not exists "pgcrypto";
create extension if not exists btree_gist;   -- para EXCLUDE con = + rango

create table if not exists public.customer_service_rates (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.clients(id) on delete restrict,
  service_id  uuid not null references public.billable_services(id) on delete restrict,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  currency text not null default 'ARS',
  unit_price numeric(15,4) not null,
  vat_rate numeric(5,2) not null default 21,
  valid_from date not null default current_date,
  valid_to   date,                                  -- null = vigente indefinido
  minimum_amount numeric(15,2),
  maximum_amount numeric(15,2),
  billing_frequency text not null default 'monthly',
  billing_day int,                                  -- día de facturación (1-28)
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint csr_freq_chk check (billing_frequency in ('one_time','daily','weekly','monthly','quarterly','yearly')),
  constraint csr_vat_chk check (vat_rate in (0, 2.5, 5, 10.5, 21, 27)),
  constraint csr_dates_chk check (valid_to is null or valid_to >= valid_from),
  constraint csr_billing_day_chk check (billing_day is null or billing_day between 1 and 28),
  -- Sin solapamiento de tarifas ACTIVAS para el mismo (cliente, servicio).
  constraint csr_no_overlap exclude using gist (
    customer_id with =,
    service_id with =,
    daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') with &&
  ) where (is_active)
);
create index if not exists csr_customer_idx on public.customer_service_rates (customer_id);
create index if not exists csr_service_idx  on public.customer_service_rates (service_id);
create index if not exists csr_active_idx   on public.customer_service_rates (is_active);

comment on table public.customer_service_rates is
  'Tarifa por cliente y servicio con vigencia. csr_no_overlap impide solapamientos de tarifas activas para el mismo cliente/servicio. El rate_id se guarda en billing_run_items/invoice_items (trazabilidad).';

drop trigger if exists trg_csr_updated_at on public.customer_service_rates;
create trigger trg_csr_updated_at
before update on public.customer_service_rates
for each row execute function public.touch_updated_at();

alter table public.customer_service_rates enable row level security;
drop policy if exists "csr read" on public.customer_service_rates;
create policy "csr read" on public.customer_service_rates for select
  using (public.current_role() in ('admin','operaciones','supervisor')
         or public.has_permission('contabilidad.view')
         or public.has_permission('comercial.view'));
drop policy if exists "csr write" on public.customer_service_rates;
create policy "csr write" on public.customer_service_rates for all
  using (public.current_role() = 'admin' or public.has_permission('contabilidad.edit'))
  with check (public.current_role() = 'admin' or public.has_permission('contabilidad.edit'));

-- -------------------------------------------------------------------------
-- Resolver: tarifa vigente de (cliente, servicio) a una fecha (NULL si no hay).
-- -------------------------------------------------------------------------
create or replace function public.customer_service_rate_for(
  p_customer_id uuid, p_service_id uuid, p_date date default current_date
) returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select id from public.customer_service_rates
  where customer_id = p_customer_id and service_id = p_service_id and is_active
    and valid_from <= p_date and (valid_to is null or valid_to >= p_date)
  order by valid_from desc
  limit 1;
$$;
revoke all on function public.customer_service_rate_for(uuid, uuid, date) from public;
grant execute on function public.customer_service_rate_for(uuid, uuid, date) to authenticated, service_role;

-- -------------------------------------------------------------------------
-- Vistas: tarifas vigentes / vencidas (security_invoker).
-- -------------------------------------------------------------------------
create or replace view public.v_tarifas_vigentes
with (security_invoker = true) as
select
  r.id as rate_id, r.customer_id, c.razon as cliente,
  r.service_id, s.code as servicio_code, s.name as servicio,
  r.currency, r.unit_price, r.vat_rate, r.billing_frequency,
  r.valid_from, r.valid_to, r.cost_center_id
from public.customer_service_rates r
join public.clients c on c.id = r.customer_id
join public.billable_services s on s.id = r.service_id
where r.is_active
  and r.valid_from <= current_date
  and (r.valid_to is null or r.valid_to >= current_date);

comment on view public.v_tarifas_vigentes is 'Tarifas activas vigentes hoy, por cliente y servicio.';

create or replace view public.v_tarifas_vencidas
with (security_invoker = true) as
select
  r.id as rate_id, r.customer_id, c.razon as cliente,
  s.code as servicio_code, s.name as servicio,
  r.unit_price, r.valid_from, r.valid_to
from public.customer_service_rates r
join public.clients c on c.id = r.customer_id
join public.billable_services s on s.id = r.service_id
where r.is_active and r.valid_to is not null and r.valid_to < current_date;

comment on view public.v_tarifas_vencidas is 'Tarifas activas cuya vigencia ya venció (requieren renovación).';

grant select on public.v_tarifas_vigentes to authenticated;
grant select on public.v_tarifas_vencidas to authenticated;

notify pgrst, 'reload schema';
