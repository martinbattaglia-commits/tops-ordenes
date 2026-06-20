-- =========================================================================
-- 0093_logistics_billing.sql — Fase 12.D/E · Vínculo logistics_orders →
--   facturación (implementación parcial SEGURA)
--
-- DIAGNÓSTICO (12.A): logistics_orders (0030) NO tiene client_id (solo
-- client_name text), NI precio/tarifa/monto, y sus líneas no tienen precio →
-- DATOS INSUFICIENTES para auto-tarifar/auto-emitir. Por eso esta capa:
--   · NO crea customer_invoices automáticamente.
--   · NO emite ARCA.
--   · NO contabiliza órdenes (solo se contabiliza la FACTURA, por el flujo de
--     ventas existente 0072/0085/0089).
--   · SÍ detecta órdenes facturables, permite marcarlas (no_facturable, etc.) y
--     VINCULAR una orden a una factura YA emitida (trazabilidad, sin duplicar).
--
-- NATURALEZA: ADITIVA e idempotente. No toca logistics_orders/customer_invoices.
-- =========================================================================

create extension if not exists "pgcrypto";

-- -------------------------------------------------------------------------
-- 1. Enum de estado de facturación de la orden.
-- -------------------------------------------------------------------------
do $$ begin
  create type public.logistics_billing_status_t as enum (
    'pending',           -- elegible, sin decisión
    'ready_to_invoice',  -- lista para facturar (monto preparado)
    'invoiced',          -- ya facturada (vinculada a customer_invoice)
    'cancelled',         -- vínculo cancelado
    'not_billable'       -- marcada como no facturable
  );
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------------------
-- 2. logistics_order_billing_links — 1 vínculo por orden (no duplica facturación)
-- -------------------------------------------------------------------------
create table if not exists public.logistics_order_billing_links (
  id uuid primary key default gen_random_uuid(),
  logistics_order_id  uuid not null references public.logistics_orders(id) on delete restrict,
  customer_invoice_id uuid references public.customer_invoices(id) on delete set null,
  billing_status      public.logistics_billing_status_t not null default 'pending',
  billable_amount     numeric(15,2),
  currency            text not null default 'ARS',
  billing_period_start date,
  billing_period_end   date,
  cost_center_id       uuid references public.cost_centers(id) on delete set null,
  notes               text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  -- Una sola fila por orden → imposible facturar la misma orden dos veces.
  unique (logistics_order_id)
);
create index if not exists lobl_order_idx   on public.logistics_order_billing_links (logistics_order_id);
create index if not exists lobl_invoice_idx on public.logistics_order_billing_links (customer_invoice_id);
create index if not exists lobl_status_idx  on public.logistics_order_billing_links (billing_status);

comment on table public.logistics_order_billing_links is
  'Trazabilidad orden logística → factura de venta. UNIQUE(logistics_order_id) evita facturación duplicada. Varias órdenes pueden compartir customer_invoice_id (facturación agrupada).';

drop trigger if exists trg_lobl_updated_at on public.logistics_order_billing_links;
create trigger trg_lobl_updated_at
before update on public.logistics_order_billing_links
for each row execute function public.touch_updated_at();

-- -------------------------------------------------------------------------
-- 3. RLS — lectura interna / pedidos.view / contabilidad.view; escritura
--    admin/operaciones (+ pedidos.edit). El alta efectiva pasa por RPC.
-- -------------------------------------------------------------------------
alter table public.logistics_order_billing_links enable row level security;
drop policy if exists "lobl read" on public.logistics_order_billing_links;
create policy "lobl read" on public.logistics_order_billing_links for select
  using (public.current_role() in ('admin','operaciones','supervisor')
         or public.has_permission('pedidos.view')
         or public.has_permission('contabilidad.view'));
drop policy if exists "lobl write" on public.logistics_order_billing_links;
create policy "lobl write" on public.logistics_order_billing_links for all
  using (public.current_role() in ('admin','operaciones')
         or public.has_permission('pedidos.edit'))
  with check (public.current_role() in ('admin','operaciones')
         or public.has_permission('pedidos.edit'));

-- -------------------------------------------------------------------------
-- 4. RPC · fijar estado de facturación (upsert; NO marca 'invoiced').
-- -------------------------------------------------------------------------
create or replace function public.logistics_set_billing_status(
  p_order_id uuid,
  p_status   text,                       -- pending | ready_to_invoice | not_billable | cancelled
  p_billable_amount numeric default null,
  p_period_start date default null,
  p_period_end   date default null,
  p_cost_center_id uuid default null,
  p_notes text default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if not (public.has_permission('pedidos.edit') or public.current_role() in ('admin','operaciones')) then
    raise exception 'FORBIDDEN: requiere permiso pedidos.edit' using errcode='42501';
  end if;
  if p_status not in ('pending','ready_to_invoice','not_billable','cancelled') then
    raise exception 'INVALID_STATUS: % (usar invoiced solo vía logistics_link_invoice)', p_status using errcode='check_violation';
  end if;
  if not exists (select 1 from public.logistics_orders where id = p_order_id) then
    raise exception 'ORDER_NOT_FOUND: %', p_order_id using errcode='no_data_found';
  end if;

  insert into public.logistics_order_billing_links
    (logistics_order_id, billing_status, billable_amount, currency, billing_period_start, billing_period_end, cost_center_id, notes, created_by)
  values
    (p_order_id, p_status::public.logistics_billing_status_t, p_billable_amount, 'ARS', p_period_start, p_period_end, p_cost_center_id, p_notes, auth.uid())
  on conflict (logistics_order_id) do update set
    billing_status = excluded.billing_status,
    billable_amount = coalesce(excluded.billable_amount, public.logistics_order_billing_links.billable_amount),
    billing_period_start = coalesce(excluded.billing_period_start, public.logistics_order_billing_links.billing_period_start),
    billing_period_end = coalesce(excluded.billing_period_end, public.logistics_order_billing_links.billing_period_end),
    cost_center_id = coalesce(excluded.cost_center_id, public.logistics_order_billing_links.cost_center_id),
    notes = coalesce(excluded.notes, public.logistics_order_billing_links.notes)
  where public.logistics_order_billing_links.billing_status <> 'invoiced'  -- no degradar una orden ya facturada
  returning id into v_id;

  if v_id is null then
    raise exception 'ORDER_ALREADY_INVOICED: la orden % ya está facturada (no se puede cambiar su estado)', p_order_id using errcode='check_violation';
  end if;
  return jsonb_build_object('ok', true, 'link_id', v_id, 'order_id', p_order_id, 'status', p_status);
end; $$;
revoke all on function public.logistics_set_billing_status(uuid,text,numeric,date,date,uuid,text) from public;
grant execute on function public.logistics_set_billing_status(uuid,text,numeric,date,date,uuid,text) to authenticated;

-- -------------------------------------------------------------------------
-- 5. RPC · vincular órdenes a una factura YA emitida (sin duplicar).
--    Permite agrupar varias órdenes en una factura. No crea ni emite facturas.
-- -------------------------------------------------------------------------
create or replace function public.logistics_link_invoice(
  p_order_ids uuid[],
  p_customer_invoice_id uuid,
  p_period_start date default null,
  p_period_end   date default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_oid uuid; v_existing uuid; v_linked int := 0; v_skipped int := 0;
begin
  if not (public.has_permission('pedidos.edit') or public.current_role() in ('admin','operaciones')) then
    raise exception 'FORBIDDEN: requiere permiso pedidos.edit' using errcode='42501';
  end if;
  if p_customer_invoice_id is null or not exists (select 1 from public.customer_invoices where id = p_customer_invoice_id) then
    raise exception 'INVOICE_NOT_FOUND: %', p_customer_invoice_id using errcode='no_data_found';
  end if;
  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    raise exception 'NO_ORDERS' using errcode='check_violation';
  end if;

  foreach v_oid in array p_order_ids loop
    if not exists (select 1 from public.logistics_orders where id = v_oid) then
      raise exception 'ORDER_NOT_FOUND: %', v_oid using errcode='no_data_found';
    end if;
    -- ¿ya facturada con OTRA factura? → bloquear (evita doble facturación).
    select customer_invoice_id into v_existing
    from public.logistics_order_billing_links
    where logistics_order_id = v_oid and billing_status = 'invoiced';
    if v_existing is not null and v_existing <> p_customer_invoice_id then
      raise exception 'ORDER_ALREADY_INVOICED: la orden % ya está facturada por otra factura %', v_oid, v_existing using errcode='check_violation';
    end if;
    if v_existing = p_customer_invoice_id then
      v_skipped := v_skipped + 1;
      continue;  -- idempotente
    end if;

    insert into public.logistics_order_billing_links
      (logistics_order_id, customer_invoice_id, billing_status, billing_period_start, billing_period_end, created_by)
    values
      (v_oid, p_customer_invoice_id, 'invoiced', p_period_start, p_period_end, auth.uid())
    on conflict (logistics_order_id) do update set
      customer_invoice_id = excluded.customer_invoice_id,
      billing_status = 'invoiced',
      billing_period_start = coalesce(excluded.billing_period_start, public.logistics_order_billing_links.billing_period_start),
      billing_period_end = coalesce(excluded.billing_period_end, public.logistics_order_billing_links.billing_period_end);
    v_linked := v_linked + 1;
  end loop;

  return jsonb_build_object('ok', true, 'invoice_id', p_customer_invoice_id, 'linked', v_linked, 'skipped', v_skipped);
end; $$;
revoke all on function public.logistics_link_invoice(uuid[],uuid,date,date) from public;
grant execute on function public.logistics_link_invoice(uuid[],uuid,date,date) to authenticated;

-- -------------------------------------------------------------------------
-- 6. Vistas de estado de facturación de órdenes (security_invoker).
--    Facturable = orden activa, despachada/entregada, sin vínculo o vínculo
--    pending/ready_to_invoice.
-- -------------------------------------------------------------------------
create or replace view public.v_logistics_orders_facturables
with (security_invoker = true) as
select
  lo.id as order_id, lo.public_id, lo.client_name, lo.customer_ref,
  lo.status, lo.requested_date, lo.created_at::date as fecha,
  coalesce(l.billing_status, 'pending') as billing_status,
  l.billable_amount, l.cost_center_id
from public.logistics_orders lo
left join public.logistics_order_billing_links l on l.logistics_order_id = lo.id
where lo.active = true
  and lo.status in ('despachado','entregado')
  and coalesce(l.billing_status, 'pending') in ('pending','ready_to_invoice');

comment on view public.v_logistics_orders_facturables is
  'Órdenes logísticas elegibles para facturar (despachadas/entregadas) sin factura vinculada.';

create or replace view public.v_logistics_orders_facturadas
with (security_invoker = true) as
select
  lo.id as order_id, lo.public_id, lo.client_name,
  l.customer_invoice_id,
  ci.tipo_comprobante, ci.punto_venta, ci.numero_comprobante, ci.total as factura_total,
  l.billing_period_start, l.billing_period_end, l.updated_at
from public.logistics_order_billing_links l
join public.logistics_orders lo on lo.id = l.logistics_order_id
left join public.customer_invoices ci on ci.id = l.customer_invoice_id
where l.billing_status = 'invoiced';

comment on view public.v_logistics_orders_facturadas is
  'Órdenes logísticas ya facturadas, con su factura de venta vinculada.';

create or replace view public.v_logistics_orders_no_facturables
with (security_invoker = true) as
select lo.id as order_id, lo.public_id, lo.client_name, l.notes, l.updated_at
from public.logistics_order_billing_links l
join public.logistics_orders lo on lo.id = l.logistics_order_id
where l.billing_status = 'not_billable';

create or replace view public.v_facturas_desde_ordenes
with (security_invoker = true) as
select
  ci.id as invoice_id, ci.tipo_comprobante, ci.punto_venta, ci.numero_comprobante,
  ci.razon_social, ci.total, ci.created_at::date as fecha,
  count(l.logistics_order_id) as ordenes_vinculadas
from public.customer_invoices ci
join public.logistics_order_billing_links l on l.customer_invoice_id = ci.id and l.billing_status = 'invoiced'
group by ci.id;

comment on view public.v_facturas_desde_ordenes is
  'Facturas de venta generadas/vinculadas desde órdenes logísticas (con cantidad de órdenes).';

grant select on public.v_logistics_orders_facturables   to authenticated;
grant select on public.v_logistics_orders_facturadas    to authenticated;
grant select on public.v_logistics_orders_no_facturables to authenticated;
grant select on public.v_facturas_desde_ordenes         to authenticated;

notify pgrst, 'reload schema';
