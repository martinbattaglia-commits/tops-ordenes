-- Rollback 0243. Conserva los importes utilizables; elimina sólo el modelo nuevo.

-- El schema legado no representa ausencia/estimación. Se detiene ANTES de
-- modificar objetos si todavía existe una OC no conciliada; para las ya
-- conciliadas se conservará el precio real de factura.
do $$
begin
  lock table public.purchase_orders, public.po_items, public.po_events,
             public.po_email_sends, public.po_signature_evidence,
             storage.objects, storage.buckets
    in share row exclusive mode;
  if exists (select 1 from public.po_signature_evidence)
     or exists (
       select 1 from public.purchase_orders
       where pdf_sha256 is not null or pdf_size_bytes is not null
     )
     or exists (select 1 from public.po_email_sends where attempt_key is not null)
     or exists (select 1 from storage.objects where bucket_id='po-pdfs-private') then
    raise exception 'ROLLBACK_0243_BLOCKED: existe evidencia documental o de entrega que no puede perderse';
  end if;
  if exists (
    select 1 from public.po_items
     where price_state <> 'known' and price_reconciled_at is null
  ) then
    raise exception 'ROLLBACK_0243_BLOCKED: existen precios estimados/pendientes sin conciliar';
  end if;
  if exists (
    select 1 from public.purchase_orders
     where neto is null or iva is null or total is null
  ) then
    raise exception 'ROLLBACK_0243_BLOCKED: existen cabeceras sin importe real';
  end if;
end;
$$;

-- La reversa vuelve a habilitar exclusivamente el camino legado ejecutado con
-- la sesión del usuario. No reabre service_role, DELETE ni TRUNCATE. Las
-- policies separadas evitan que una regla FOR ALL vuelva a ampliar SELECT.
revoke insert, update, delete, truncate
  on public.purchase_orders, public.po_items, public.po_events, public.po_email_sends
  from public, anon, authenticated, service_role;
grant insert, update on public.purchase_orders to authenticated;
grant insert, update on public.po_items to authenticated;
grant insert on public.po_events to authenticated;
grant insert, update on public.po_email_sends to authenticated;

drop policy if exists "po_items write" on public.po_items;
drop policy if exists "po_items insert legacy rollback" on public.po_items;
create policy "po_items insert legacy rollback"
  on public.po_items for insert to authenticated
  with check (
    coalesce(public.has_permission('compras.create'), false)
    and coalesce(public.has_permission('compras.sign'), false)
  );
drop policy if exists "po_items update legacy rollback" on public.po_items;
create policy "po_items update legacy rollback"
  on public.po_items for update to authenticated
  using (coalesce(public.has_permission('compras.edit'), false))
  with check (coalesce(public.has_permission('compras.edit'), false));

drop policy if exists "po_email write" on public.po_email_sends;
drop policy if exists "po_email insert legacy rollback" on public.po_email_sends;
create policy "po_email insert legacy rollback"
  on public.po_email_sends for insert to authenticated
  with check (
    coalesce(public.has_permission('compras.create'), false)
    and coalesce(public.has_permission('compras.sign'), false)
  );
drop policy if exists "po_email update legacy rollback" on public.po_email_sends;
create policy "po_email update legacy rollback"
  on public.po_email_sends for update to authenticated
  using (coalesce(public.has_permission('compras.edit'), false))
  with check (coalesce(public.has_permission('compras.edit'), false));

drop function if exists public.po_reconcile_prices(uuid, uuid, jsonb, text);
drop function if exists public.purchase_order_finalize_email_delivery(uuid,text,text,text,text);
drop function if exists public.purchase_order_begin_email_delivery(uuid,text);
drop function if exists public.purchase_order_prepare_email_delivery(uuid);
drop function if exists public.purchase_order_finalize_document(uuid,text,text,integer);
drop function if exists public.purchase_order_record_delivery_event(uuid,text,jsonb);
drop function if exists public.purchase_order_list_metrics(text,text,uuid,text,timestamptz,timestamptz);
drop function if exists public.purchase_order_issue(jsonb, jsonb);
drop function if exists public._po_png_is_valid(bytea);
drop function if exists public._po_png_crc32(bytea);
-- 0243 reemplazo estas funciones y ambas leen `price_state`. Deben salir
-- antes que las columnas, y se restauran con su definicion pre-0243 abajo.
drop function if exists public.ai_purchase_orders_overview(text, text, int);
drop function if exists public.ai_supplier_spend_overview(text, text, int);
drop trigger if exists trg_recon_requires_real_purchase_price on public.po_reconciliations;
drop function if exists public._recon_requires_real_purchase_price();

drop trigger if exists trg_po_price_summary_immutable on public.purchase_orders;
drop function if exists public._po_price_summary_immutable();
drop trigger if exists trg_po_items_issued_price_immutable on public.po_items;
drop function if exists public._po_items_issued_price_immutable();
drop trigger if exists trg_po_items_price_audit on public.po_items;
drop function if exists public._po_items_price_audit();
drop trigger if exists trg_po_items_price_prepare on public.po_items;
drop function if exists public._po_items_price_prepare();
drop trigger if exists trg_po_price_events_immutable on public.po_price_events;
drop trigger if exists trg_po_signature_evidence_immutable on public.po_signature_evidence;
drop table if exists public.po_signature_evidence;
drop function if exists public._po_price_events_immutable();
drop trigger if exists trg_po_events_immutable on public.po_events;
drop function if exists public._po_events_immutable();
drop trigger if exists trg_po_email_sends_guard on public.po_email_sends;
drop function if exists public._po_email_sends_guard();
drop index if exists public.po_email_order_attempt_uq;
alter table public.po_email_sends
  drop constraint if exists po_email_attempt_key_ck,
  drop column if exists attempt_key;
drop table if exists public.po_price_events;

-- Primero se retiran las reglas del modelo nuevo. Una línea `pending` exige
-- price/subtotal NULL mientras esa constraint siga activa.
alter table public.po_items
  drop constraint if exists po_items_actual_price_ck,
  drop constraint if exists po_items_price_subtotal_ck,
  drop constraint if exists po_items_price_semantics_ck;

update public.po_items
set price = actual_unit_price,
    subtotal = actual_subtotal
where price_state <> 'known';

alter table public.po_items
  drop constraint if exists po_items_actual_price_ck,
  drop constraint if exists po_items_price_subtotal_ck,
  drop constraint if exists po_items_price_semantics_ck,
  drop column if exists price_reconciled_by,
  drop column if exists price_reconciled_at,
  drop column if exists actual_subtotal,
  drop column if exists actual_unit_price,
  drop column if exists price_responsible_name,
  drop column if exists price_responsible_user_id,
  drop column if exists price_reason,
  drop column if exists price_state,
  alter column price set not null,
  alter column subtotal set not null;

drop index if exists public.po_price_reconciled_invoice_uq;

alter table public.purchase_orders
  drop constraint if exists purchase_orders_pdf_evidence_ck,
  drop constraint if exists purchase_orders_currency_ars_ck,
  drop column if exists pdf_size_bytes,
  drop column if exists pdf_sha256,
  drop column if exists vendor_snapshot,
  drop column if exists issued_total,
  drop column if exists issued_iva,
  drop column if exists issued_neto,
  drop column if exists price_reconciliation_reason,
  drop column if exists price_reconciled_invoice_id,
  drop column if exists price_reconciled_by,
  drop column if exists price_reconciled_at,
  drop column if exists pending_price_lines,
  drop column if exists known_partial_neto,
  drop column if exists planning_total,
  drop column if exists planning_iva,
  drop column if exists planning_neto,
  drop column if exists price_state,
  drop column if exists currency,
  alter column neto set default 0,
  alter column iva set default 0,
  alter column total set default 0,
  alter column neto set not null,
  alter column iva set not null,
  alter column total set not null;

drop type if exists public.po_price_state_t;

-- El bucket dedicado sólo puede llegar vacío por el preflight. El bucket
-- legado `po-pdfs` y sus policies nunca fueron mutados por 0243.
delete from storage.buckets where id='po-pdfs-private';

create or replace function public.ai_purchase_orders_overview(
  p_mode text default 'recientes', p_query text default null, p_limit int default 30
) returns table (
  public_id text, proveedor text, total numeric, fecha date, estado text, detalle text
)
language sql stable security invoker set search_path = public, pg_temp as $$
  select
    coalesce(nullif(btrim(po.public_id), ''), 'OC#' || left(po.id::text, 8)),
    public.ai_docs_redact(coalesce(v.razon, 'Proveedor')),
    po.total, po.date::date, po.status::text,
    public.ai_docs_redact(concat_ws(' · ',
      'Orden de compra',
      'proveedor ' || coalesce(nullif(btrim(v.razon), ''), 's/d'),
      'total ARS ' || to_char(coalesce(po.total, 0), 'FM999G999G990D00'),
      'estado ' || coalesce(po.status::text, 's/d'),
      case when po.date is not null then to_char(po.date, 'YYYY-MM-DD') end
    ))
  from public.purchase_orders po
  left join public.vendors v on v.id = po.vendor_id
  where (p_query is null or btrim(p_query) = ''
      or v.razon ilike '%' || btrim(p_query) || '%'
      or coalesce(po.public_id, '') ilike '%' || btrim(p_query) || '%')
    and case coalesce(nullif(btrim(p_mode), ''), 'recientes')
      when 'por_proveedor' then (p_query is not null and btrim(p_query) <> '')
      else true end
  order by po.date desc nulls last
  limit case when coalesce(nullif(btrim(p_mode), ''), 'recientes') = 'ultima'
             then 1 else least(greatest(coalesce(p_limit, 30), 1), 50) end
$$;

create or replace function public.ai_supplier_spend_overview(
  p_base text default 'gasto', p_periodo text default 'todo', p_limit int default 10
) returns table (
  proveedor text, total numeric, cantidad int, periodo text, base text, detalle text
)
language sql stable security invoker set search_path = public, pg_temp as $$
  with params as (
    select case when coalesce(nullif(btrim(p_base), ''), 'gasto') = 'compromiso'
                then 'compromiso' else 'gasto' end as base,
           coalesce(nullif(btrim(p_periodo), ''), 'todo') as periodo
  ),
  gasto as (
    select public.ai_docs_redact(coalesce(v.razon, 'Proveedor')) proveedor,
           sum(si.total) total, count(*)::int cantidad
    from public.supplier_invoices si join public.vendors v on v.id = si.vendor_id
    cross join params p
    where p.base = 'gasto' and si.status::text is distinct from 'anulada'
      and case p.periodo
        when 'mes_actual' then date_trunc('month', si.fecha_emision) = date_trunc('month', current_date)
        when 'ultimo_mes' then date_trunc('month', si.fecha_emision) = date_trunc('month', current_date - interval '1 month')
        when 'ultimos_30_dias' then si.fecha_emision >= current_date - 30 else true end
    group by 1
  ),
  compromiso as (
    select public.ai_docs_redact(coalesce(v.razon, 'Proveedor')) proveedor,
           sum(po.total) total, count(*)::int cantidad
    from public.purchase_orders po join public.vendors v on v.id = po.vendor_id
    cross join params p
    where p.base = 'compromiso' and po.status::text not in ('anulada', 'borrador')
      and case p.periodo
        when 'mes_actual' then date_trunc('month', po.date) = date_trunc('month', current_date)
        when 'ultimo_mes' then date_trunc('month', po.date) = date_trunc('month', current_date - interval '1 month')
        when 'ultimos_30_dias' then po.date >= current_date - interval '30 days' else true end
    group by 1
  ), ranking as (select * from gasto union all select * from compromiso)
  select r.proveedor, r.total, r.cantidad, (select periodo from params), (select base from params),
    (case when (select base from params) = 'compromiso'
          then 'Presupuesto comprometido (OC firmadas/activas)'
          else 'Gasto (facturas de proveedor)' end)
      || ' · ' || r.proveedor || ' · ARS '
      || to_char(coalesce(r.total, 0), 'FM999G999G999G990D00')
      || ' · ' || r.cantidad
      || case when (select base from params) = 'compromiso' then ' OC' else ' facturas' end
      || ' · período: ' || (select periodo from params)
  from ranking r order by r.total desc nulls last
  limit least(greatest(coalesce(p_limit, 10), 1), 50)
$$;

revoke all on function public.ai_purchase_orders_overview(text, text, int) from public, anon;
revoke all on function public.ai_supplier_spend_overview(text, text, int) from public, anon;
grant execute on function public.ai_purchase_orders_overview(text, text, int) to authenticated;
grant execute on function public.ai_supplier_spend_overview(text, text, int) to authenticated;
notify pgrst, 'reload schema';
