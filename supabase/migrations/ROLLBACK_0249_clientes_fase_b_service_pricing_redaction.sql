-- Inversa exacta de 0249. Una vez usada cualquier semántica nueva, aborta:
-- el snapshot firmado y su auditoría nunca se destruyen para forzar rollback.

do $$
begin
  perform pg_advisory_xact_lock(hashtextextended('tops:clientes-fase-b:service-pricing:0249',0));
  lock table public.orders,public.order_services,public.service_order_price_audit
    in share row exclusive mode;
  if exists(select 1 from public.service_order_price_audit)
     or exists(select 1 from public.orders where pricing_complete is distinct from true)
     or exists(select 1 from public.order_services where pricing_status<>'resolved')
     or exists(select 1 from public.order_services where price_source in (
       'client_rate_historical','manual_override','pending_quote'
     ))
     or exists(select 1 from public.order_services where pricing_formula_snapshot->>'kind' in (
       'historical_v1','pending_quote_v1'
     )) then
    raise exception 'ROLLBACK_0249_BLOCKED: existen snapshots o auditoria FASE B que deben preservarse';
  end if;
end $$;

drop function if exists public.service_order_record_fulfillment(uuid,numeric,text);
alter function public.service_order_record_fulfillment_0244(uuid,numeric,text)
  rename to service_order_record_fulfillment;
revoke all on function public.service_order_record_fulfillment(uuid,numeric,text)
  from public,anon,authenticated,service_role;
grant execute on function public.service_order_record_fulfillment(uuid,numeric,text)
  to authenticated;

drop function if exists public.service_order_issue(jsonb,jsonb);
alter function public.service_order_issue_0244(jsonb,jsonb) rename to service_order_issue;
revoke all on function public.service_order_issue(jsonb,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.service_order_issue(jsonb,jsonb) to authenticated;

drop function if exists public.nexus_depot_manager_order(text);
drop function if exists public.nexus_depot_manager_orders(text,text,int,int);

drop policy if exists "service price audit authorized read" on public.service_order_price_audit;
drop trigger if exists trg_service_order_price_audit_no_truncate on public.service_order_price_audit;
drop trigger if exists trg_service_order_price_audit_immutable on public.service_order_price_audit;
drop table public.service_order_price_audit;

drop policy if exists "catalog read all" on public.services_catalog;
create policy "catalog read all" on public.services_catalog for select
using (auth.role()='authenticated');
drop policy if exists "ops read all" on public.operators;
create policy "ops read all" on public.operators for select using (auth.role()='authenticated');
drop policy if exists "orders read" on public.orders;
create policy "orders read" on public.orders for select using (
  public.current_role() in ('admin','operaciones','supervisor')
  or client_id=(select client_id from public.profiles where id=auth.uid())
);
drop policy if exists "order_services read" on public.order_services;
create policy "order_services read" on public.order_services for select using (
  exists(select 1 from public.orders o where o.id=order_id)
);
drop policy if exists "service tariff authenticated read" on public.service_tariff_versions;
create policy "service tariff authenticated read" on public.service_tariff_versions
for select to authenticated using (true);
drop policy if exists "service rates authenticated read" on public.service_tariff_rates;
create policy "service rates authenticated read" on public.service_tariff_rates
for select to authenticated using (true);
drop policy if exists "client service rates authorized read" on public.client_service_rates;
create policy "client service rates authorized read" on public.client_service_rates
for select to authenticated using (
  public.has_permission('servicios.create') or public.has_permission('servicios.edit')
);
drop policy if exists "service order events authorized read" on public.service_order_events;
create policy "service order events authorized read" on public.service_order_events
for select to authenticated using (public.has_permission('servicios.view'));
drop policy if exists "service billing adjustments authorized read" on public.service_order_billing_adjustments;
create policy "service billing adjustments authorized read" on public.service_order_billing_adjustments
for select to authenticated using (public.has_permission('servicios.view'));

alter view public.v_orders_dashboard reset (security_invoker);
create or replace view public.v_orders_dashboard as
select o.id,o.public_id,o.short_id,o.date,o.depot,o.status,o.total,o.hours,
  o.signed_by,o.signed_at,o.created_at,c.razon client_razon,c.cuit client_cuit,
  c.tags client_tags,op.full_name operator_name,op.avatar operator_avatar
from public.orders o
left join public.clients c on c.id=o.client_id
left join public.operators op on op.id=o.operator_id;
grant select on public.v_orders_dashboard to authenticated;

update storage.buckets set public=true where id in ('signatures','pdfs');
drop policy if exists "authenticated non-principal read signatures" on storage.objects;
drop policy if exists "authenticated non-principal read pdfs" on storage.objects;
drop policy if exists "auth read attachments" on storage.objects;
drop policy if exists "auth write signatures" on storage.objects;
drop policy if exists "auth update signatures" on storage.objects;
drop policy if exists "auth write pdfs" on storage.objects;
drop policy if exists "auth update pdfs" on storage.objects;
drop policy if exists "auth write attachments" on storage.objects;
create policy "public read signatures" on storage.objects for select
using (bucket_id='signatures');
create policy "public read pdfs" on storage.objects for select
using (bucket_id='pdfs');
create policy "auth read attachments" on storage.objects for select
using (bucket_id='attachments' and auth.role()='authenticated');
create policy "auth write signatures" on storage.objects for insert
with check (bucket_id='signatures' and auth.role()='authenticated');
create policy "auth update signatures" on storage.objects for update
using (bucket_id='signatures' and auth.role()='authenticated')
with check (bucket_id='signatures');
create policy "auth write pdfs" on storage.objects for insert
with check (bucket_id='pdfs' and auth.role()='authenticated');
create policy "auth update pdfs" on storage.objects for update
using (bucket_id='pdfs' and auth.role()='authenticated')
with check (bucket_id='pdfs');
create policy "auth write attachments" on storage.objects for insert
with check (bucket_id='attachments' and auth.role()='authenticated');

create or replace function public._service_order_snapshot_immutable()
returns trigger language plpgsql as $$
declare v_mode text:=current_setting('app.service_order_mutation',true);
begin
  if row(
    old.order_id,old.service_slug,old.label,old.qty,old.unit,old.rate,old.subtotal,
    old.tariff_rate_id,old.client_rate_id,old.price_source,old.pricing_reason,
    old.pricing_formula_snapshot,old.min_qty_snapshot,old.min_billing_snapshot,
    old.qty_requested,old.qty_effective,old.rate_snapshot,old.subtotal_requested,
    old.line_sequence,old.pricing_snapshot_at,old.currency_snapshot
  ) is distinct from row(
    new.order_id,new.service_slug,new.label,new.qty,new.unit,new.rate,new.subtotal,
    new.tariff_rate_id,new.client_rate_id,new.price_source,new.pricing_reason,
    new.pricing_formula_snapshot,new.min_qty_snapshot,new.min_billing_snapshot,
    new.qty_requested,new.qty_effective,new.rate_snapshot,new.subtotal_requested,
    new.line_sequence,new.pricing_snapshot_at,new.currency_snapshot
  ) then raise exception 'El snapshot emitido de la OS es inmutable'; end if;
  if row(old.qty_provided,old.subtotal_provided,old.qty_billed,old.subtotal_billed)
     is distinct from row(new.qty_provided,new.subtotal_provided,new.qty_billed,new.subtotal_billed)
     and v_mode not in ('fulfillment','billing') then
    raise exception 'Prestacion y facturacion solo pueden cambiar mediante RPC autorizada';
  end if;
  return new;
end $$;

create or replace function public._service_order_header_snapshot_immutable()
returns trigger language plpgsql as $$
begin
  if row(
    old.depot,old.client_id,old.operator_id,old.h_start,old.h_end,
    old.hours,old.pallets,old.units,old.km,old.observ,old.total,old.issued_total,
    old.tariff_version_id,old.pricing_currency,old.pricing_snapshot_at,old.created_by
  ) is distinct from row(
    new.depot,new.client_id,new.operator_id,new.h_start,new.h_end,
    new.hours,new.pallets,new.units,new.km,new.observ,new.total,new.issued_total,
    new.tariff_version_id,new.pricing_currency,new.pricing_snapshot_at,new.created_by
  ) and exists(select 1 from public.service_order_events e
    where e.order_id=old.id and e.event_kind='issued') then
    raise exception 'La cabecera y el total emitido de la OS son inmutables';
  end if;
  return new;
end $$;

alter table public.order_services drop constraint if exists order_services_pricing_state_ck;
alter table public.order_services drop constraint if exists order_services_price_source_ck;
alter table public.order_services add constraint order_services_price_source_ck check (
  price_source in ('legacy','general_tariff','client_rate','derived','manual','bonification')
);
alter table public.order_services drop constraint if exists order_services_pricing_formula_ck;
alter table public.order_services add constraint order_services_pricing_formula_ck check (
  jsonb_typeof(pricing_formula_snapshot)='object'
  and pricing_formula_snapshot->>'kind' in (
    'legacy','catalog_v1','transport_v1','derived_v1','manual_v1','bonification_v1'
  )
);
alter table public.order_services
  alter column rate set not null,
  alter column subtotal set not null,
  alter column rate_snapshot set not null,
  alter column subtotal_requested set not null,
  drop column price_modification_reason,
  drop column price_modified_at,
  drop column price_modified_by,
  drop column modified_rate_snapshot,
  drop column original_rate_snapshot,
  drop column base_price_source,
  drop column pricing_status;
alter table public.orders
  alter column total set default 0,
  alter column total set not null,
  alter column issued_total set default 0,
  alter column issued_total set not null,
  drop column pricing_complete;

notify pgrst,'reload schema';
