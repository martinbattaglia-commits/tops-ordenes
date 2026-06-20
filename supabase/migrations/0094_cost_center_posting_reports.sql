-- =========================================================================
-- 0094_cost_center_posting_reports.sql — Fase 12.C/G · Imputación de centro de
--   costo en ventas + reportes contables por centro de costo
--
-- 1) acc_post_sales_invoice (create or replace, MISMA firma): imputa las líneas
--    de Ventas al cost_center_id de la factura (0092). Compras ya imputaba el
--    gasto al cost_center (0085/0089). Las líneas de balance (deudores, IVA,
--    banco) no llevan CC. Resto del comportamiento idéntico a 0089.
-- 2) Vistas de resultado por centro de costo (EERR, mayor, rentabilidad).
--
-- COMPATIBILIDAD: solo create-or-replace (misma firma) + vistas nuevas. No
-- modifica v_estado_resultados / v_libro_mayor de 0086. ADITIVA e idempotente.
-- =========================================================================

-- =========================================================================
-- 1. acc_post_sales_invoice — con cost_center en las líneas de Ventas
-- =========================================================================
create or replace function public.acc_post_sales_invoice(p_invoice_id uuid, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  ci public.customer_invoices;
  v_nc boolean; v_lines jsonb := '[]'::jsonb;
  v_total numeric;
  v_has_detail boolean; v_det_percep numeric; v_det_trib numeric;
  rec record; v_acct uuid; v_ln int := 10;
  v_cc uuid;
begin
  perform public.acc_require_post_permission();
  select * into ci from public.customer_invoices where id = p_invoice_id;
  if ci.id is null then
    raise exception 'ACC_DOC_NOT_FOUND: factura de venta % inexistente', p_invoice_id using errcode='no_data_found';
  end if;
  if ci.estado_arca <> 'AUTORIZADO_ARCA' or ci.anulada then
    return jsonb_build_object('ok', false, 'skipped', true, 'source_type','customer_invoice',
      'source_id', p_invoice_id, 'message', 'no_contabilizable (estado='||ci.estado_arca||', anulada='||ci.anulada||')');
  end if;
  v_nc := ci.tipo_comprobante::text like 'NOTA_CREDITO%';
  v_cc := ci.cost_center_id;  -- 0092: dimensión de la venta
  v_total := coalesce(ci.subtotal,0) + coalesce(ci.importe_no_gravado,0) + coalesce(ci.importe_exento,0)
           + coalesce(ci.iva,0) + coalesce(ci.percepciones,0) + coalesce(ci.tributos,0);

  -- Deudor + ventas (con CC) + IVA.
  v_lines := v_lines
    || public.acc_mk_line(public.acc_rule_account('customer_invoice','receivable'), 'D', v_total, v_nc, 'Deudores por ventas', null, 1)
    || public.acc_mk_line(public.acc_rule_account('customer_invoice','revenue'), 'H', coalesce(ci.subtotal,0), v_nc, 'Ventas (neto gravado)', v_cc, 2)
    || public.acc_mk_line(public.acc_rule_account('customer_invoice','revenue_exento'), 'H', coalesce(ci.importe_no_gravado,0)+coalesce(ci.importe_exento,0), v_nc, 'Ventas no gravadas/exentas', v_cc, 3)
    || public.acc_mk_line(public.acc_rule_account('customer_invoice','iva_debito'), 'H', coalesce(ci.iva,0), v_nc, 'IVA débito fiscal', null, 4);

  -- Percepciones: desglose por tipo si el detalle (0087) cuadra con la cabecera.
  select count(*) > 0,
         coalesce(sum(amount) filter (where tax_type::text like 'PERCEPCION_%'), 0),
         coalesce(sum(amount) filter (where tax_type in ('IMPUESTO_INTERNO','OTRO')), 0)
    into v_has_detail, v_det_percep, v_det_trib
  from public.customer_invoice_other_taxes
  where customer_invoice_id = p_invoice_id;

  if v_has_detail
     and abs(v_det_percep - coalesce(ci.percepciones,0)) <= 0.02
     and abs(v_det_trib   - coalesce(ci.tributos,0))     <= 0.02 then
    for rec in
      select tax_type, sum(amount) as amt
      from public.customer_invoice_other_taxes
      where customer_invoice_id = p_invoice_id
      group by tax_type
    loop
      v_acct := coalesce(
        public.acc_rule_account('customer_invoice', 'percepcion_' || rec.tax_type::text),
        case when rec.tax_type::text like 'PERCEPCION_%'
             then public.acc_rule_account('customer_invoice','percepciones_a_depositar')
             else public.acc_rule_account('customer_invoice','otros_tributos_a_depositar') end
      );
      v_ln := v_ln + 1;
      v_lines := v_lines || public.acc_mk_line(v_acct, 'H', rec.amt, v_nc, 'Percepción/tributo '||rec.tax_type::text, null, v_ln);
    end loop;
  else
    v_lines := v_lines
      || public.acc_mk_line(public.acc_rule_account('customer_invoice','percepciones_a_depositar'), 'H', coalesce(ci.percepciones,0), v_nc, 'Percepciones a depositar', null, 5)
      || public.acc_mk_line(public.acc_rule_account('customer_invoice','otros_tributos_a_depositar'), 'H', coalesce(ci.tributos,0), v_nc, 'Otros tributos', null, 6);
  end if;

  return public.acc_create_posted_entry('customer_invoice', p_invoice_id, ci.created_at::date,
    'Venta '||ci.tipo_comprobante||' '||coalesce(ci.punto_venta::text,'')||'-'||coalesce(ci.numero_comprobante::text,'')||' '||coalesce(ci.razon_social,''),
    v_lines, p_dry_run);
end; $$;
revoke all on function public.acc_post_sales_invoice(uuid, boolean) from public;
grant execute on function public.acc_post_sales_invoice(uuid, boolean) to authenticated;

-- =========================================================================
-- 2. Reportes por centro de costo (vistas security_invoker)
-- =========================================================================

-- 2a. Estado de resultados por centro de costo (detalle por cuenta).
create or replace view public.v_estado_resultados_cc
with (security_invoker = true) as
select
  to_char(je.entry_date, 'YYYY-MM')          as periodo,
  coalesce(cc.code, 'SIN_CC')                as centro_costo_code,
  coalesce(cc.name, 'Sin centro de costo')   as centro_costo_nombre,
  coa.type                                   as cuenta_tipo,
  coa.code                                   as cuenta_codigo,
  coa.name                                   as cuenta_nombre,
  sum(l.debit)                               as debe,
  sum(l.credit)                              as haber,
  sum(l.credit - l.debit)                    as neto
from public.journal_entry_lines l
join public.journal_entries je on je.id = l.journal_entry_id
join public.chart_of_accounts coa on coa.id = l.account_id
left join public.cost_centers cc on cc.id = l.cost_center_id
where je.status = 'posted' and coa.type in ('ingreso','gasto')
group by to_char(je.entry_date,'YYYY-MM'), coalesce(cc.code,'SIN_CC'),
         coalesce(cc.name,'Sin centro de costo'), coa.type, coa.code, coa.name;

comment on view public.v_estado_resultados_cc is
  'Estado de resultados por período, centro de costo y cuenta. Σ sobre todos los CC = v_estado_resultados (total general).';

-- 2b. Mayor por cuenta y centro de costo (sumas, no running).
create or replace view public.v_libro_mayor_cc
with (security_invoker = true) as
select
  coalesce(cc.code, 'SIN_CC')              as centro_costo_code,
  coalesce(cc.name, 'Sin centro de costo') as centro_costo_nombre,
  coa.code as cuenta_codigo,
  coa.name as cuenta_nombre,
  coa.type as cuenta_tipo,
  to_char(je.entry_date,'YYYY-MM') as periodo,
  sum(l.debit)  as debe,
  sum(l.credit) as haber,
  sum(l.debit - l.credit) as saldo
from public.journal_entry_lines l
join public.journal_entries je on je.id = l.journal_entry_id
join public.chart_of_accounts coa on coa.id = l.account_id
left join public.cost_centers cc on cc.id = l.cost_center_id
where je.status = 'posted'
group by coalesce(cc.code,'SIN_CC'), coalesce(cc.name,'Sin centro de costo'),
         coa.code, coa.name, coa.type, to_char(je.entry_date,'YYYY-MM');

comment on view public.v_libro_mayor_cc is
  'Mayor por cuenta y centro de costo (sumas por período). Σ sobre CC por cuenta = v_libro_mayor (total general).';

-- 2c. Rentabilidad por centro de costo / unidad de negocio.
create or replace view public.v_resultado_por_cc
with (security_invoker = true) as
with base as (
  select
    to_char(je.entry_date,'YYYY-MM') as periodo,
    coalesce(cc.code, 'SIN_CC') as code,
    coalesce(cc.name, 'Sin centro de costo') as nombre,
    cc.type as cc_type,
    coa.type as tipo,
    (l.credit - l.debit) as neto
  from public.journal_entry_lines l
  join public.journal_entries je on je.id = l.journal_entry_id
  join public.chart_of_accounts coa on coa.id = l.account_id
  left join public.cost_centers cc on cc.id = l.cost_center_id
  where je.status = 'posted' and coa.type in ('ingreso','gasto')
)
select
  periodo,
  code as centro_costo_code,
  nombre as centro_costo_nombre,
  cc_type as tipo,
  coalesce(sum(neto) filter (where tipo = 'ingreso'), 0)  as ingresos,
  coalesce(-sum(neto) filter (where tipo = 'gasto'), 0)   as gastos,
  coalesce(sum(neto), 0)                                  as resultado,
  case when coalesce(sum(neto) filter (where tipo='ingreso'),0) <> 0
       then round(sum(neto) / nullif(sum(neto) filter (where tipo='ingreso'),0) * 100, 2)
       end as margen_pct
from base
group by periodo, code, nombre, cc_type;

comment on view public.v_resultado_por_cc is
  'Rentabilidad por centro de costo/unidad de negocio y período: ingresos, gastos, resultado y margen %.';

grant select on public.v_estado_resultados_cc to authenticated;
grant select on public.v_libro_mayor_cc       to authenticated;
grant select on public.v_resultado_por_cc     to authenticated;

notify pgrst, 'reload schema';
