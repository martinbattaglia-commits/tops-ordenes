-- =========================================================================
-- 0100_billing_draft_invoice.sql — Fase 13.F · Borrador de factura desde
--   billing run (sin emisión ARCA, sin contabilizar)
--
-- Convierte los billing_run_items APROBADOS de un cliente en un customer_invoice
-- en estado BORRADOR. NO solicita CAE, NO emite ARCA, NO contabiliza (BORRADOR
-- no entra en libro_iva_ventas ni en v_comprobantes_sin_asiento, que filtran
-- AUTORIZADO_ARCA). La emisión real sigue el flujo de ventas existente.
--
-- Trazabilidad: se agregan columnas aditivas a invoice_items (source_type,
-- source_id, service_id, cost_center_id, billing_run_item_id) y se vincula cada
-- item al billing_run_item.
--
-- NATURALEZA: ADITIVA. Reusa el dominio canónico (customer_invoice_vat_lines).
-- Requiere 0096-0098. No aplica migraciones.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Columnas de origen en invoice_items (aditivas; ventas_persist_invoice las
--    deja NULL — sin romper). Trazabilidad billing/orden/servicio/CC.
-- -------------------------------------------------------------------------
alter table public.invoice_items
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists service_id uuid references public.billable_services(id) on delete set null,
  add column if not exists cost_center_id uuid references public.cost_centers(id) on delete set null,
  add column if not exists billing_run_item_id uuid references public.billing_run_items(id) on delete set null;
create index if not exists invoice_items_bri_idx on public.invoice_items (billing_run_item_id);
create index if not exists invoice_items_service_idx on public.invoice_items (service_id);

-- -------------------------------------------------------------------------
-- 2. RPC · crear factura BORRADOR desde los ítems aprobados de un cliente.
-- -------------------------------------------------------------------------
create or replace function public.billing_run_create_draft_invoice(
  p_run_id uuid, p_customer_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  v_cli public.clients;
  v_subtotal numeric(15,2); v_iva numeric(15,2); v_total numeric(15,2);
  v_n int; v_pv int; v_cc uuid; v_cc_count int;
  v_tipo public.comprobante_tipo_t; v_cbte smallint;
begin
  perform public.billing_require_edit();

  select * into v_cli from public.clients where id = p_customer_id;
  if v_cli.id is null then raise exception 'CLIENT_NOT_FOUND: %', p_customer_id using errcode='no_data_found'; end if;

  -- Totales de los ítems aprobados aún no facturados.
  select coalesce(sum(net_amount),0), coalesce(sum(vat_amount),0), coalesce(sum(gross_amount),0), count(*),
         count(distinct cost_center_id)
    into v_subtotal, v_iva, v_total, v_n, v_cc_count
  from public.billing_run_items
  where billing_run_id = p_run_id and customer_id = p_customer_id
    and status = 'approved' and customer_invoice_id is null;

  if v_n = 0 then
    raise exception 'NO_APPROVED_ITEMS: no hay ítems aprobados sin facturar para ese cliente en el run' using errcode='check_violation';
  end if;

  -- Centro de costo de cabecera: el común si todos coinciden, si no NULL.
  if v_cc_count = 1 then
    select distinct cost_center_id into v_cc from public.billing_run_items
    where billing_run_id = p_run_id and customer_id = p_customer_id and status='approved' and customer_invoice_id is null;
  else
    v_cc := null;
  end if;

  -- Punto de venta por defecto (fiscal_config) y tipo de comprobante por condición IVA.
  select coalesce(default_punto_venta, 3) into v_pv from public.fiscal_config where id = 1;
  if v_cli.condicion_iva = 'RESPONSABLE_INSCRIPTO' then
    v_tipo := 'FACTURA_A'; v_cbte := 1;
  else
    v_tipo := 'FACTURA_B'; v_cbte := 6;
  end if;

  perform set_config('ventas.via_rpc', 'on', true);

  -- Cabecera BORRADOR (sin número, sin CAE).
  insert into public.customer_invoices (
    id, client_id, cuit_cliente, razon_social, condicion_iva, domicilio_cliente, doc_tipo,
    tipo_comprobante, cbte_tipo_arca, concepto, punto_venta, periodo,
    subtotal, importe_no_gravado, importe_exento, iva, percepciones, tributos, total,
    moneda, estado_arca, ambiente, cost_center_id, observ, emitido_por, created_at, updated_at
  ) values (
    v_id, v_cli.id, v_cli.cuit, v_cli.razon, v_cli.condicion_iva, v_cli.domicilio, coalesce(v_cli.tipo_doc, 80),
    v_tipo, v_cbte, 2, v_pv, to_char(current_date,'YYYY-MM'),
    v_subtotal, 0, 0, v_iva, 0, 0, v_total,
    'PES', 'BORRADOR', public.fiscal_ambiente(), v_cc,
    'Borrador generado desde billing run '||p_run_id, auth.uid(), now(), now()
  );

  -- Renglones (con trazabilidad a billing_run_item / servicio / CC).
  insert into public.invoice_items
    (invoice_id, descripcion, cantidad, precio_unitario, alicuota_iva, alic_iva_id,
     importe_neto, importe_iva, importe_total, orden,
     source_type, source_id, service_id, cost_center_id, billing_run_item_id)
  select
    v_id, s.name, i.quantity, i.unit_price, i.vat_rate,
    case round(i.vat_rate,2) when 0 then 3 when 10.5 then 4 when 21 then 5 when 27 then 6 when 5 then 8 when 2.5 then 9 else 5 end,
    i.net_amount, i.vat_amount, i.gross_amount, row_number() over (order by s.code),
    'billing_run', p_run_id, i.service_id, i.cost_center_id, i.id
  from public.billing_run_items i
  join public.billable_services s on s.id = i.service_id
  where i.billing_run_id = p_run_id and i.customer_id = p_customer_id
    and i.status = 'approved' and i.customer_invoice_id is null;

  -- Líneas de IVA canónicas (agrupadas por alícuota) → satisface check_ci_vat_identity.
  insert into public.customer_invoice_vat_lines (invoice_id, alic_iva_id, alicuota_iva, neto_gravado, iva_importe)
  select v_id,
    case round(i.vat_rate,2) when 0 then 3 when 10.5 then 4 when 21 then 5 when 27 then 6 when 5 then 8 when 2.5 then 9 else 5 end,
    i.vat_rate, sum(i.net_amount), sum(i.vat_amount)
  from public.billing_run_items i
  where i.billing_run_id = p_run_id and i.customer_id = p_customer_id
    and i.status = 'approved' and i.customer_invoice_id is null
  group by i.vat_rate;

  -- Auditoría.
  insert into public.invoice_audit (invoice_id, user_id, action, estado)
  values (v_id, auth.uid(), 'borrador_billing_run', 'BORRADOR');

  -- Marcar los ítems como facturados (borrador) + vínculo.
  update public.billing_run_items
    set status = 'invoiced', customer_invoice_id = v_id
  where billing_run_id = p_run_id and customer_id = p_customer_id
    and status = 'approved' and customer_invoice_id is null;

  return jsonb_build_object('ok', true, 'invoice_id', v_id, 'estado', 'BORRADOR',
    'items', v_n, 'subtotal', v_subtotal, 'iva', v_iva, 'total', v_total,
    'nota', 'Borrador NO fiscal: no se solicitó CAE ni se emitió ARCA. Revisar y emitir por el flujo de ventas existente.');
end; $$;
revoke all on function public.billing_run_create_draft_invoice(uuid, uuid) from public;
grant execute on function public.billing_run_create_draft_invoice(uuid, uuid) to authenticated;

-- -------------------------------------------------------------------------
-- 3. Vistas de trazabilidad y diferencias billing ↔ factura.
-- -------------------------------------------------------------------------
create or replace view public.v_facturas_borrador_billing
with (security_invoker = true) as
select distinct
  ci.id as invoice_id, ci.razon_social, ci.estado_arca, ci.total, ci.created_at::date as fecha,
  ii.billing_run_item_id is not null as desde_billing_run
from public.customer_invoices ci
join public.invoice_items ii on ii.invoice_id = ci.id
where ii.source_type = 'billing_run';

comment on view public.v_facturas_borrador_billing is
  'Facturas (incl. borradores) originadas en billing runs, vía invoice_items.source_type=billing_run.';

create or replace view public.v_billing_vs_factura_diff
with (security_invoker = true) as
with run_tot as (
  select customer_invoice_id, sum(gross_amount) as billing_gross
  from public.billing_run_items
  where customer_invoice_id is not null and status = 'invoiced'
  group by customer_invoice_id
),
inv_tot as (
  select ii.invoice_id, sum(ii.importe_total) as factura_gross
  from public.invoice_items ii
  where ii.billing_run_item_id is not null
  group by ii.invoice_id
)
select
  coalesce(r.customer_invoice_id, i.invoice_id) as invoice_id,
  coalesce(r.billing_gross, 0) as billing_gross,
  coalesce(i.factura_gross, 0) as factura_gross,
  round(coalesce(r.billing_gross,0) - coalesce(i.factura_gross,0), 2) as diferencia
from run_tot r
full outer join inv_tot i on i.invoice_id = r.customer_invoice_id;

comment on view public.v_billing_vs_factura_diff is
  'Diferencia entre el bruto de los billing_run_items y el de los invoice_items de la factura (debe ser 0).';

grant select on public.v_facturas_borrador_billing to authenticated;
grant select on public.v_billing_vs_factura_diff   to authenticated;

notify pgrst, 'reload schema';
