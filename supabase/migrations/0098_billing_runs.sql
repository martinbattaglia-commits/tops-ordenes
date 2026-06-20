-- =========================================================================
-- 0098_billing_runs.sql — Fase 13.D · Ciclos de facturación recurrente
--
-- Calcula BORRADORES de ítems a facturar (no emite factura, no contabiliza, no
-- toca ARCA). Fuente recurrente: customer_service_rates mensuales (0097). El
-- billing run es revisable (aprobar/excluir ítems) antes de generar la factura
-- borrador (0100).
--
-- NATURALEZA: ADITIVA e idempotente. Requiere 0096/0097.
-- =========================================================================

create extension if not exists "pgcrypto";

do $$ begin
  create type public.billing_run_type_t as enum ('recurring','logistics','manual','mixed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.billing_run_status_t as enum ('draft','calculated','reviewed','approved','invoiced','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.billing_run_item_status_t as enum ('pending','approved','excluded','invoiced');
exception when duplicate_object then null; end $$;

create table if not exists public.billing_runs (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  run_type public.billing_run_type_t not null default 'recurring',
  status public.billing_run_status_t not null default 'draft',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_runs_period_chk check (period_end >= period_start)
);
create index if not exists brun_status_idx on public.billing_runs (status);
create index if not exists brun_period_idx on public.billing_runs (period_start, period_end);

create table if not exists public.billing_run_items (
  id uuid primary key default gen_random_uuid(),
  billing_run_id uuid not null references public.billing_runs(id) on delete cascade,
  customer_id uuid not null references public.clients(id) on delete restrict,
  service_id uuid not null references public.billable_services(id) on delete restrict,
  rate_id uuid references public.customer_service_rates(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  source_type text,                 -- 'recurring_rate' | 'logistics_order' | 'manual'
  source_id uuid,
  customer_invoice_id uuid references public.customer_invoices(id) on delete set null,  -- trazabilidad
  quantity numeric(15,3) not null default 1,
  unit_price numeric(15,4) not null default 0,
  currency text not null default 'ARS',
  net_amount numeric(15,2) not null default 0,
  vat_rate numeric(5,2) not null default 21,
  vat_amount numeric(15,2) not null default 0,
  gross_amount numeric(15,2) not null default 0,
  status public.billing_run_item_status_t not null default 'pending',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists brit_run_idx      on public.billing_run_items (billing_run_id);
create index if not exists brit_customer_idx on public.billing_run_items (customer_id);
create index if not exists brit_status_idx   on public.billing_run_items (status);
create index if not exists brit_invoice_idx  on public.billing_run_items (customer_invoice_id);
-- Sin duplicar el mismo (cliente, servicio, source) dentro de un run.
create unique index if not exists brit_dedup
  on public.billing_run_items (
    billing_run_id, customer_id, service_id,
    coalesce(source_type,''), coalesce(source_id,'00000000-0000-0000-0000-000000000000'::uuid)
  );

drop trigger if exists trg_brun_updated_at on public.billing_runs;
create trigger trg_brun_updated_at before update on public.billing_runs
for each row execute function public.touch_updated_at();
drop trigger if exists trg_brit_updated_at on public.billing_run_items;
create trigger trg_brit_updated_at before update on public.billing_run_items
for each row execute function public.touch_updated_at();

alter table public.billing_runs enable row level security;
alter table public.billing_run_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array['billing_runs','billing_run_items'] loop
    execute format('drop policy if exists "%s read" on public.%I', t, t);
    execute format($f$create policy "%s read" on public.%I for select
      using (public.current_role() in ('admin','operaciones','supervisor')
             or public.has_permission('contabilidad.view')
             or public.has_permission('comercial.view'))$f$, t, t);
    execute format('drop policy if exists "%s write" on public.%I', t, t);
    execute format($f$create policy "%s write" on public.%I for all
      using (public.current_role() = 'admin' or public.has_permission('contabilidad.edit'))
      with check (public.current_role() = 'admin' or public.has_permission('contabilidad.edit'))$f$, t, t);
  end loop;
end $$;

-- -------------------------------------------------------------------------
-- Gate de permiso común a las RPC de billing.
-- -------------------------------------------------------------------------
create or replace function public.billing_require_edit()
returns void language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.has_permission('contabilidad.edit') or public.current_role() = 'admin') then
    raise exception 'BILLING_DENIED: requiere permiso contabilidad.edit' using errcode='42501';
  end if;
end; $$;
revoke all on function public.billing_require_edit() from public;

-- -------------------------------------------------------------------------
-- RPC · crear billing run.
-- -------------------------------------------------------------------------
create or replace function public.billing_run_create(
  p_period_start date, p_period_end date, p_run_type text default 'recurring', p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  perform public.billing_require_edit();
  insert into public.billing_runs(period_start, period_end, run_type, status, notes, created_by)
  values (p_period_start, p_period_end, p_run_type::public.billing_run_type_t, 'draft', p_notes, auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'billing_run_id', v_id);
end; $$;
revoke all on function public.billing_run_create(date,date,text,text) from public;
grant execute on function public.billing_run_create(date,date,text,text) to authenticated;

-- -------------------------------------------------------------------------
-- RPC · calcular ítems recurrentes (tarifas mensuales vigentes en el período).
--    Borrador idempotente (on conflict do nothing). quantity=1 (canon/abono);
--    ajustar manualmente cantidades por consumo si corresponde.
-- -------------------------------------------------------------------------
create or replace function public.billing_run_calculate_recurring(p_run_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_start date; v_end date; v_count int;
begin
  perform public.billing_require_edit();
  select period_start, period_end into v_start, v_end from public.billing_runs where id = p_run_id;
  if v_start is null then raise exception 'RUN_NOT_FOUND: %', p_run_id using errcode='no_data_found'; end if;

  with src as (
    select r.customer_id, r.service_id, r.id as rate_id, r.cost_center_id, r.currency,
           r.unit_price, r.vat_rate,
           round(1 * r.unit_price, 2) as net
    from public.customer_service_rates r
    where r.is_active and r.billing_frequency = 'monthly'
      and r.valid_from <= v_end and (r.valid_to is null or r.valid_to >= v_start)
  ),
  ins as (
    insert into public.billing_run_items
      (billing_run_id, customer_id, service_id, rate_id, cost_center_id, source_type, source_id,
       quantity, unit_price, currency, net_amount, vat_rate, vat_amount, gross_amount, status)
    select p_run_id, customer_id, service_id, rate_id,
           coalesce(cost_center_id, (select default_cost_center_id from public.billable_services bs where bs.id = src.service_id)),
           'recurring_rate', rate_id,
           1, unit_price, currency, net,
           vat_rate, round(net * vat_rate / 100, 2), net + round(net * vat_rate / 100, 2),
           'pending'
    from src
    on conflict (billing_run_id, customer_id, service_id, coalesce(source_type,''), coalesce(source_id,'00000000-0000-0000-0000-000000000000'::uuid)) do nothing
    returning 1
  )
  select count(*) into v_count from ins;

  update public.billing_runs set status = 'calculated' where id = p_run_id and status = 'draft';
  return jsonb_build_object('ok', true, 'billing_run_id', p_run_id, 'items_creados', v_count);
end; $$;
revoke all on function public.billing_run_calculate_recurring(uuid) from public;
grant execute on function public.billing_run_calculate_recurring(uuid) to authenticated;

-- -------------------------------------------------------------------------
-- RPC · agregar ítem manual (resuelve tarifa si no se pasa unit_price).
-- -------------------------------------------------------------------------
create or replace function public.billing_run_add_item(
  p_run_id uuid, p_customer_id uuid, p_service_id uuid, p_quantity numeric,
  p_unit_price numeric default null, p_source_type text default 'manual',
  p_source_id uuid default null, p_cost_center_id uuid default null, p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid; v_rate_id uuid; v_price numeric; v_vat numeric; v_cc uuid; v_net numeric; v_vat_amt numeric; v_start date;
begin
  perform public.billing_require_edit();
  select period_start into v_start from public.billing_runs where id = p_run_id;
  if v_start is null then raise exception 'RUN_NOT_FOUND: %', p_run_id using errcode='no_data_found'; end if;

  v_rate_id := public.customer_service_rate_for(p_customer_id, p_service_id, v_start);
  if p_unit_price is not null then
    v_price := p_unit_price;
    select coalesce(vat_rate, 21) into v_vat from public.customer_service_rates where id = v_rate_id;
    if v_vat is null then select default_vat_rate into v_vat from public.billable_services where id = p_service_id; end if;
  elsif v_rate_id is not null then
    select unit_price, vat_rate, cost_center_id into v_price, v_vat, v_cc from public.customer_service_rates where id = v_rate_id;
  else
    raise exception 'NO_RATE: no hay tarifa para el cliente/servicio y no se pasó unit_price' using errcode='check_violation';
  end if;

  v_cc := coalesce(p_cost_center_id, v_cc, (select default_cost_center_id from public.billable_services where id = p_service_id));
  v_net := round(coalesce(p_quantity,0) * coalesce(v_price,0), 2);
  v_vat_amt := round(v_net * coalesce(v_vat,21) / 100, 2);

  insert into public.billing_run_items
    (billing_run_id, customer_id, service_id, rate_id, cost_center_id, source_type, source_id,
     quantity, unit_price, currency, net_amount, vat_rate, vat_amount, gross_amount, status, notes)
  values
    (p_run_id, p_customer_id, p_service_id, v_rate_id, v_cc, p_source_type, p_source_id,
     coalesce(p_quantity,0), coalesce(v_price,0), 'ARS', v_net, coalesce(v_vat,21), v_vat_amt, v_net + v_vat_amt, 'pending', p_notes)
  on conflict (billing_run_id, customer_id, service_id, coalesce(source_type,''), coalesce(source_id,'00000000-0000-0000-0000-000000000000'::uuid)) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', true, 'skipped', true, 'message', 'item_duplicado');
  end if;
  return jsonb_build_object('ok', true, 'item_id', v_id, 'net', v_net, 'vat', v_vat_amt, 'gross', v_net + v_vat_amt);
end; $$;
revoke all on function public.billing_run_add_item(uuid,uuid,uuid,numeric,numeric,text,uuid,uuid,text) from public;
grant execute on function public.billing_run_add_item(uuid,uuid,uuid,numeric,numeric,text,uuid,uuid,text) to authenticated;

-- -------------------------------------------------------------------------
-- RPC · estado de ítem (pending/approved/excluded) y de run.
-- -------------------------------------------------------------------------
create or replace function public.billing_run_set_item_status(p_item_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.billing_require_edit();
  if p_status not in ('pending','approved','excluded') then
    raise exception 'INVALID_STATUS: % (invoiced lo setea el flujo de factura)', p_status using errcode='check_violation';
  end if;
  update public.billing_run_items set status = p_status::public.billing_run_item_status_t
   where id = p_item_id and status <> 'invoiced';
  if not found then raise exception 'ITEM_NOT_FOUND_OR_INVOICED: %', p_item_id using errcode='check_violation'; end if;
  return jsonb_build_object('ok', true, 'item_id', p_item_id, 'status', p_status);
end; $$;
revoke all on function public.billing_run_set_item_status(uuid,text) from public;
grant execute on function public.billing_run_set_item_status(uuid,text) to authenticated;

create or replace function public.billing_run_set_status(p_run_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.billing_require_edit();
  if p_status not in ('draft','calculated','reviewed','approved','cancelled') then
    raise exception 'INVALID_STATUS: % (invoiced lo setea el flujo de factura)', p_status using errcode='check_violation';
  end if;
  update public.billing_runs set status = p_status::public.billing_run_status_t where id = p_run_id;
  if not found then raise exception 'RUN_NOT_FOUND: %', p_run_id using errcode='no_data_found'; end if;
  return jsonb_build_object('ok', true, 'billing_run_id', p_run_id, 'status', p_status);
end; $$;
revoke all on function public.billing_run_set_status(uuid,text) from public;
grant execute on function public.billing_run_set_status(uuid,text) to authenticated;

-- -------------------------------------------------------------------------
-- Vistas de billing.
-- -------------------------------------------------------------------------
create or replace view public.v_billing_runs
with (security_invoker = true) as
select br.id as billing_run_id, br.period_start, br.period_end, br.run_type, br.status, br.notes, br.created_at,
       count(i.id) as items, coalesce(sum(i.gross_amount) filter (where i.status <> 'excluded'), 0) as total_bruto
from public.billing_runs br
left join public.billing_run_items i on i.billing_run_id = br.id
group by br.id;

create or replace view public.v_billing_run_items
with (security_invoker = true) as
select i.id as item_id, i.billing_run_id, i.customer_id, c.razon as cliente,
       i.service_id, s.code as servicio_code, s.name as servicio,
       i.quantity, i.unit_price, i.net_amount, i.vat_rate, i.vat_amount, i.gross_amount,
       i.status, i.source_type, i.source_id, i.customer_invoice_id, i.cost_center_id, i.rate_id
from public.billing_run_items i
join public.clients c on c.id = i.customer_id
join public.billable_services s on s.id = i.service_id;

comment on view public.v_billing_run_items is 'Detalle de ítems de billing run con cliente y servicio (incluye estado y trazabilidad a factura).';

-- Servicios recurrentes pendientes de facturar este mes (tarifa mensual vigente
-- sin ítem facturado en el período actual).
create or replace view public.v_servicios_recurrentes_pendientes
with (security_invoker = true) as
select v.rate_id, v.customer_id, v.cliente, v.servicio_code, v.servicio, v.unit_price, v.vat_rate
from public.v_tarifas_vigentes v
where v.billing_frequency = 'monthly'
  and not exists (
    select 1 from public.billing_run_items i
    join public.billing_runs br on br.id = i.billing_run_id
    where i.rate_id = v.rate_id
      and i.status = 'invoiced'
      and to_char(br.period_start,'YYYY-MM') = to_char(current_date,'YYYY-MM')
  );

comment on view public.v_servicios_recurrentes_pendientes is 'Tarifas mensuales vigentes sin facturar (ítem invoiced) en el período actual.';

grant select on public.v_billing_runs to authenticated;
grant select on public.v_billing_run_items to authenticated;
grant select on public.v_servicios_recurrentes_pendientes to authenticated;

notify pgrst, 'reload schema';
