-- =========================================================================
-- 0089_phase10_posting_and_reports.sql — Fase 10.C/E · Integración contable de
--   percepciones de venta y retenciones practicadas + reportes fiscales
--
-- 1) acc_post_sales_invoice (create or replace, MISMA firma): si la factura
--    tiene detalle de percepciones (0087) y Σ detalle == cabecera (±0,02),
--    desglosa la imputación por tipo; si no, mantiene el comportamiento lump de
--    0085 (retrocompatible con comprobantes legacy). Balance preservado.
-- 2) acc_post_supplier_payment (create or replace, MISMA firma): si el pago
--    tiene retenciones (0088), arma DEBE Proveedores (neto+retenciones) / HABER
--    Banco (neto) + Retenciones a depositar (por tipo). Sin retenciones → igual
--    que 0085. Balance preservado.
-- 3) Vistas de reporte fiscal: percepciones de venta, retenciones practicadas,
--    posición fiscal mensual consolidada, fiscal-vs-contable y comprobantes con
--    diferencias fiscales.
--
-- COMPATIBILIDAD: solo create-or-replace (mismas firmas) + vistas nuevas. NO
--   modifica tablas ni las vistas de 0086. ADITIVA e idempotente.
-- =========================================================================

-- =========================================================================
-- 1. acc_post_sales_invoice — con desglose de percepciones por tipo
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
  v_total := coalesce(ci.subtotal,0) + coalesce(ci.importe_no_gravado,0) + coalesce(ci.importe_exento,0)
           + coalesce(ci.iva,0) + coalesce(ci.percepciones,0) + coalesce(ci.tributos,0);

  -- Líneas base (deudor + ventas + IVA) — idénticas a 0085.
  v_lines := v_lines
    || public.acc_mk_line(public.acc_rule_account('customer_invoice','receivable'), 'D', v_total, v_nc, 'Deudores por ventas', null, 1)
    || public.acc_mk_line(public.acc_rule_account('customer_invoice','revenue'), 'H', coalesce(ci.subtotal,0), v_nc, 'Ventas (neto gravado)', null, 2)
    || public.acc_mk_line(public.acc_rule_account('customer_invoice','revenue_exento'), 'H', coalesce(ci.importe_no_gravado,0)+coalesce(ci.importe_exento,0), v_nc, 'Ventas no gravadas/exentas', null, 3)
    || public.acc_mk_line(public.acc_rule_account('customer_invoice','iva_debito'), 'H', coalesce(ci.iva,0), v_nc, 'IVA débito fiscal', null, 4);

  -- ¿Hay detalle de percepciones y cuadra con la cabecera?
  select count(*) > 0,
         coalesce(sum(amount) filter (where tax_type::text like 'PERCEPCION_%'), 0),
         coalesce(sum(amount) filter (where tax_type in ('IMPUESTO_INTERNO','OTRO')), 0)
    into v_has_detail, v_det_percep, v_det_trib
  from public.customer_invoice_other_taxes
  where customer_invoice_id = p_invoice_id;

  if v_has_detail
     and abs(v_det_percep - coalesce(ci.percepciones,0)) <= 0.02
     and abs(v_det_trib   - coalesce(ci.tributos,0))     <= 0.02 then
    -- Desglose por tipo (suma == cabecera → balance preservado).
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
    -- Sin detalle (o no cuadra): lump como en 0085.
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
-- 2. acc_post_supplier_payment — con retenciones practicadas
-- =========================================================================
create or replace function public.acc_post_supplier_payment(p_payment_id uuid, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  sp public.supplier_payments;
  v_is_caja boolean; v_bank_acc uuid; v_lines jsonb := '[]'::jsonb;
  v_w numeric; rec record; v_acct uuid; v_ln int := 10;
begin
  perform public.acc_require_post_permission();
  select * into sp from public.supplier_payments where id = p_payment_id;
  if sp.id is null then
    raise exception 'ACC_DOC_NOT_FOUND: pago % inexistente', p_payment_id using errcode='no_data_found';
  end if;
  if sp.status <> 'confirmado' then
    return jsonb_build_object('ok', false, 'skipped', true, 'source_type','supplier_payment',
      'source_id', p_payment_id, 'message', 'no_contabilizable (status='||sp.status||')');
  end if;
  select is_system into v_is_caja from public.bank_accounts where id = sp.bank_account_id;
  v_bank_acc := public.acc_rule_account('supplier_payment', case when coalesce(v_is_caja,false) then 'caja' else 'bank' end);

  -- Σ retenciones practicadas en este pago.
  select coalesce(sum(amount), 0) into v_w
  from public.supplier_payment_withholdings where supplier_payment_id = p_payment_id;

  -- DEBE Proveedores (neto + retenciones) / HABER Banco (neto) + Retenciones (por tipo).
  v_lines := v_lines
    || public.acc_mk_line(public.acc_rule_account('supplier_payment','payable'), 'D', coalesce(sp.amount,0) + v_w, false, 'Cancela proveedores', null, 1)
    || public.acc_mk_line(v_bank_acc, 'H', coalesce(sp.amount,0), false, 'Egreso de fondos', null, 2);

  for rec in
    select withholding_type, sum(amount) as amt
    from public.supplier_payment_withholdings
    where supplier_payment_id = p_payment_id
    group by withholding_type
  loop
    v_acct := coalesce(
      public.acc_rule_account('supplier_payment', 'withholding_' || rec.withholding_type::text),
      public.acc_rule_account('supplier_payment', 'retencion_practicada')
    );
    v_ln := v_ln + 1;
    v_lines := v_lines || public.acc_mk_line(v_acct, 'H', rec.amt, false, 'Retención '||rec.withholding_type::text||' a depositar', null, v_ln);
  end loop;

  return public.acc_create_posted_entry('supplier_payment', p_payment_id, sp.payment_date,
    'Pago '||sp.public_id, v_lines, p_dry_run);
end; $$;
revoke all on function public.acc_post_supplier_payment(uuid, boolean) from public;
grant execute on function public.acc_post_supplier_payment(uuid, boolean) to authenticated;

-- =========================================================================
-- 3. Reportes fiscales (vistas security_invoker, read-only)
-- =========================================================================

-- 3a. Percepciones de venta por período / tipo / jurisdicción (NC con signo,
--     solo comprobantes fiscalmente válidos del ambiente vigente).
create or replace view public.v_percepciones_ventas
with (security_invoker = true) as
select
  coalesce(ci.periodo, to_char(ci.created_at,'YYYY-MM')) as periodo,
  ot.tax_type,
  ot.jurisdiction,
  count(distinct ci.id) as comprobantes,
  sum(sgn.f * ot.tax_base) as base_imponible,
  sum(sgn.f * ot.amount)   as importe
from public.customer_invoice_other_taxes ot
join public.customer_invoices ci on ci.id = ot.customer_invoice_id
cross join lateral (
  select case when ci.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f
) sgn
where ci.estado_arca = 'AUTORIZADO_ARCA'
  and ci.anulada = false
  and ci.ambiente = public.fiscal_ambiente()
group by coalesce(ci.periodo, to_char(ci.created_at,'YYYY-MM')), ot.tax_type, ot.jurisdiction;

comment on view public.v_percepciones_ventas is
  'Percepciones/otros tributos de venta practicados por período, tipo y jurisdicción (NC restan). Insumo de DDJJ de percepciones.';

-- 3b. Retenciones practicadas por período / tipo / jurisdicción.
create or replace view public.v_retenciones_practicadas
with (security_invoker = true) as
select
  to_char(w.withheld_at, 'YYYY-MM') as periodo,
  w.withholding_type,
  w.jurisdiction,
  count(distinct sp.id) as pagos,
  count(*) as retenciones,
  sum(w.tax_base) as base_imponible,
  sum(w.amount)   as importe
from public.supplier_payment_withholdings w
join public.supplier_payments sp on sp.id = w.supplier_payment_id
where sp.status = 'confirmado'
group by to_char(w.withheld_at, 'YYYY-MM'), w.withholding_type, w.jurisdiction;

comment on view public.v_retenciones_practicadas is
  'Retenciones practicadas a proveedores por período, tipo y jurisdicción. Solo pagos confirmados. Deuda fiscal a depositar.';

-- 3c. Pago bruto / retención / neto por proveedor (criterio de aceptación #3).
create or replace view public.v_pagos_proveedor_retenciones
with (security_invoker = true) as
select
  sp.id as payment_id,
  sp.public_id,
  sp.vendor_id,
  v.razon as proveedor,
  sp.payment_date,
  to_char(sp.payment_date,'YYYY-MM') as periodo,
  coalesce(w.total_ret, 0)              as retenciones,
  sp.amount                             as pago_neto,
  sp.amount + coalesce(w.total_ret, 0)  as pago_bruto
from public.supplier_payments sp
left join public.vendors v on v.id = sp.vendor_id
left join (
  select supplier_payment_id, sum(amount) as total_ret
  from public.supplier_payment_withholdings group by supplier_payment_id
) w on w.supplier_payment_id = sp.id
where sp.status = 'confirmado';

comment on view public.v_pagos_proveedor_retenciones is
  'Por pago confirmado: bruto (obligación saldada) = neto pagado + retenciones practicadas.';

-- 3d. Posición fiscal mensual consolidada (IVA + percep/retenc practicadas y
--     sufridas). NO altera v_posicion_iva; la referencia.
create or replace view public.v_posicion_fiscal_mensual
with (security_invoker = true) as
with periodos as (
  select periodo from public.v_posicion_iva
  union select periodo from public.v_percepciones_ventas
  union select periodo from public.v_retenciones_practicadas
),
pp as (select periodo, sum(importe) as percep_practicadas from public.v_percepciones_ventas group by periodo),
rp as (select periodo, sum(importe) as retenc_practicadas from public.v_retenciones_practicadas group by periodo)
select
  p.periodo,
  coalesce(iva.iva_debito_fiscal, 0)         as iva_debito_fiscal,
  coalesce(iva.iva_credito_fiscal, 0)        as iva_credito_fiscal,
  coalesce(iva.saldo_posicion, 0)            as iva_saldo_posicion,
  coalesce(iva.resultado, 'neutro')          as iva_resultado,
  coalesce(pp.percep_practicadas, 0)         as percepciones_ventas_a_depositar,
  coalesce(rp.retenc_practicadas, 0)         as retenciones_practicadas_a_depositar,
  coalesce(iva.percepciones_iva_sufridas, 0) as percepciones_iva_sufridas,
  coalesce(iva.retenciones_sufridas, 0)      as retenciones_sufridas
from periodos p
left join public.v_posicion_iva iva on iva.periodo = p.periodo
left join pp on pp.periodo = p.periodo
left join rp on rp.periodo = p.periodo;

comment on view public.v_posicion_fiscal_mensual is
  'Panorama fiscal del mes: posición IVA + percepciones/retenciones practicadas (a depositar) + percepciones/retenciones sufridas. No mezcla las percepciones/retenciones con el saldo de IVA.';

-- 3e. Percepciones/retenciones: fiscal vs contable (a depositar).
create or replace view public.v_percep_retenc_fiscal_vs_contable
with (security_invoker = true) as
with fiscal as (
  select periodo, 'percepciones_ventas'::text as concepto, sum(importe) as fiscal
  from public.v_percepciones_ventas group by periodo
  union all
  select periodo, 'retenciones_practicadas', sum(importe)
  from public.v_retenciones_practicadas group by periodo
),
contable as (
  select to_char(je.entry_date,'YYYY-MM') as periodo,
    case
      when coa.code in ('2.1.04','2.1.05','2.1.10','2.1.16') then 'percepciones_ventas'
      when coa.code in ('2.1.06','2.1.12','2.1.13','2.1.14','2.1.15') then 'retenciones_practicadas'
    end as concepto,
    sum(l.credit - l.debit) as contable
  from public.journal_entries je
  join public.journal_entry_lines l on l.journal_entry_id = je.id
  join public.chart_of_accounts coa on coa.id = l.account_id
  where je.status = 'posted'
    and coa.code in ('2.1.04','2.1.05','2.1.10','2.1.16','2.1.06','2.1.12','2.1.13','2.1.14','2.1.15')
  group by 1, 2
)
select
  coalesce(f.periodo, c.periodo) as periodo,
  coalesce(f.concepto, c.concepto) as concepto,
  coalesce(f.fiscal, 0) as fiscal,
  coalesce(c.contable, 0) as contable,
  round(coalesce(f.fiscal,0) - coalesce(c.contable,0), 2) as diferencia
from fiscal f
full outer join contable c on c.periodo = f.periodo and c.concepto = f.concepto;

comment on view public.v_percep_retenc_fiscal_vs_contable is
  'Conciliación: percepciones de venta y retenciones practicadas (fiscal) vs. saldos contables de las cuentas a depositar.';

-- 3f. Comprobantes de venta con diferencia fiscal cabecera↔detalle.
create or replace view public.v_comprobantes_diferencias_fiscales
with (security_invoker = true) as
select
  ci.id as invoice_id,
  ci.tipo_comprobante,
  ci.punto_venta,
  ci.numero_comprobante,
  coalesce(ci.periodo, to_char(ci.created_at,'YYYY-MM')) as periodo,
  (coalesce(ci.percepciones,0) + coalesce(ci.tributos,0)) as cabecera_otros_tributos,
  d.total_detalle,
  round(d.total_detalle - (coalesce(ci.percepciones,0) + coalesce(ci.tributos,0)), 2) as diferencia
from public.customer_invoices ci
join (
  select customer_invoice_id, sum(amount) as total_detalle
  from public.customer_invoice_other_taxes group by customer_invoice_id
) d on d.customer_invoice_id = ci.id
where abs(d.total_detalle - (coalesce(ci.percepciones,0) + coalesce(ci.tributos,0))) > 0.02;

comment on view public.v_comprobantes_diferencias_fiscales is
  'Comprobantes de venta cuyo detalle de percepciones/tributos no cuadra con la cabecera (±0,02). Debe estar vacío para imputación contable desglosada.';

-- =========================================================================
-- 4. GRANTS
-- =========================================================================
grant select on public.v_percepciones_ventas               to authenticated;
grant select on public.v_retenciones_practicadas           to authenticated;
grant select on public.v_pagos_proveedor_retenciones       to authenticated;
grant select on public.v_posicion_fiscal_mensual           to authenticated;
grant select on public.v_percep_retenc_fiscal_vs_contable  to authenticated;
grant select on public.v_comprobantes_diferencias_fiscales to authenticated;

notify pgrst, 'reload schema';
