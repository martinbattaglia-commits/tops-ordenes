-- Rollback controlado de 0244. Es estructural solamente mientras la migracion
-- no tenga datos dependientes. Una vez emitido cualquier snapshot o programada
-- una vigencia, aborta fail-closed: la compensacion debe hacerse con una nueva
-- version y nunca borrando historia.

do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('tops:service-pricing:tariff:v1', 0));
  perform pg_advisory_xact_lock(hashtextextended('tops:service-pricing:client-rate:v1', 0));
  lock table public.orders, public.order_services,
    public.service_tariff_versions, public.client_service_rates,
    public.service_order_events, public.service_order_billing_adjustments,
    public.service_order_signatures, public.email_sends
    in share row exclusive mode;
  if exists (select 1 from public.orders where tariff_version_id is not null)
     or exists (select 1 from public.service_order_events)
     or exists (select 1 from public.service_order_billing_adjustments)
     or exists (select 1 from public.service_order_signatures)
     or exists (select 1 from public.client_service_rates)
     or exists (
       select 1 from public.service_tariff_versions
       where code <> 'TOPS-OS-2026-01'
     ) then
    raise exception 'ROLLBACK_0244_BLOCKED: existen snapshots o vigencias que deben preservarse';
  end if;
end;
$$;

-- Restaura el DML mínimo realmente consumido por el runtime pre-0244. No
-- reabre ANON, ALL ni TRUNCATE.
revoke update (status, signature_url, pdf_url, invoice_id)
  on public.orders from authenticated, service_role;
grant insert, update, delete on public.orders to authenticated;
grant insert, update, delete on public.order_services to authenticated;
grant delete on public.orders to service_role;
grant update (signature_url, pdf_url) on public.orders to service_role;
grant insert on public.order_services to service_role;
grant insert, update on public.email_sends to service_role;

drop function if exists public.service_order_finalize_email_delivery(uuid,text,text,text,text,text);
drop function if exists public.service_order_prepare_email_delivery(uuid,text,text,boolean);
drop trigger if exists trg_service_order_email_sends_guard on public.email_sends;
drop function if exists public._service_order_email_sends_guard();

drop function if exists public.service_order_adjust_billing(uuid,numeric,numeric,text);
drop function if exists public.service_order_record_fulfillment(uuid,numeric,text);
drop function if exists public.service_order_issue(jsonb,jsonb);
drop function if exists public._service_order_png_is_valid(bytea);
drop function if exists public._service_order_png_crc32(bytea);
drop function if exists public.service_tariff_publish(text,text,date,text,text,jsonb);
drop function if exists public.client_service_rate_set(uuid,text,text,numeric,numeric,numeric,date,text);

drop trigger if exists trg_client_service_rate_timeline_ck on public.client_service_rates;
drop function if exists public._client_service_rate_timeline_ck();
drop trigger if exists trg_service_tariff_timeline_ck on public.service_tariff_versions;
drop function if exists public._service_tariff_timeline_ck();
drop function if exists public._service_pricing_boundary(date,timestamptz);

drop trigger if exists trg_service_order_header_snapshot_immutable on public.orders;
drop function if exists public._service_order_header_snapshot_immutable();
drop trigger if exists trg_service_order_snapshot_immutable on public.order_services;
drop function if exists public._service_order_snapshot_immutable();

drop trigger if exists trg_service_order_adjustments_immutable on public.service_order_billing_adjustments;
drop trigger if exists trg_service_order_events_immutable on public.service_order_events;
drop trigger if exists trg_service_order_signatures_no_truncate on public.service_order_signatures;
drop trigger if exists trg_service_order_signatures_immutable on public.service_order_signatures;
drop table if exists public.service_order_signatures;
drop function if exists public._service_order_append_only();

drop table if exists public.service_order_billing_adjustments;
drop table if exists public.service_order_events;

alter table public.order_services
  drop constraint if exists order_services_price_source_ck,
  drop constraint if exists order_services_pricing_formula_ck;
alter table public.order_services
  drop column if exists currency_snapshot,
  drop column if exists pricing_snapshot_at,
  drop column if exists line_sequence,
  drop column if exists subtotal_billed,
  drop column if exists qty_billed,
  drop column if exists subtotal_provided,
  drop column if exists qty_provided,
  drop column if exists subtotal_requested,
  drop column if exists rate_snapshot,
  drop column if exists qty_effective,
  drop column if exists qty_requested,
  drop column if exists min_billing_snapshot,
  drop column if exists min_qty_snapshot,
  drop column if exists pricing_formula_snapshot,
  drop column if exists pricing_reason,
  drop column if exists price_source,
  drop column if exists client_rate_id,
  drop column if exists tariff_rate_id;

alter table public.orders
  drop column if exists billed_total,
  drop column if exists provided_total,
  drop column if exists issued_total,
  drop column if exists pricing_snapshot_at,
  drop column if exists pricing_currency,
  drop column if exists tariff_version_id;

drop table if exists public.client_service_rates;
drop table if exists public.service_tariff_rates;
drop table if exists public.service_tariff_versions;
drop type if exists public.service_tariff_status_t;

delete from public.role_permissions
where permission_id = (select id from public.permissions where slug = 'servicios.edit');
delete from public.permissions where slug = 'servicios.edit';
