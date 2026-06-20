-- =========================================================================
-- 0086_accounting_reports.sql — Capa Contable · Libros y reportes (vistas)
--
-- Vistas security_invoker (respetan RLS) y DERIVADAS (cero tablas nuevas).
-- Responden las preguntas del criterio de aceptación: libro diario, mayor por
-- cuenta, balance de sumas y saldos, estado de resultados, posición mensual de
-- IVA, comprobantes sin asiento, asientos descuadrados y diferencia IVA
-- fiscal↔contable.
--
-- NATURALEZA: ADITIVA y de solo lectura. Reutiliza libro_iva_ventas (0073) y
-- libro_iva_compras (0059) — NO los duplica. Requiere 0083-0085.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. v_libro_diario — todas las líneas de los asientos posteados
-- -------------------------------------------------------------------------
create or replace view public.v_libro_diario
with (security_invoker = true) as
select
  je.id                            as entry_id,
  je.entry_number,
  je.entry_date,
  to_char(je.entry_date, 'YYYY-MM') as periodo,
  je.source_type,
  je.source_id,
  je.description                   as asiento_descripcion,
  je.status,
  l.line_no,
  coa.code                         as cuenta_codigo,
  coa.name                         as cuenta_nombre,
  coa.type                         as cuenta_tipo,
  l.description                    as linea_descripcion,
  l.debit,
  l.credit,
  cc.code                          as centro_costo
from public.journal_entries je
join public.journal_entry_lines l on l.journal_entry_id = je.id
join public.chart_of_accounts coa on coa.id = l.account_id
left join public.cost_centers cc on cc.id = l.cost_center_id
where je.status = 'posted';

comment on view public.v_libro_diario is 'Libro Diario: líneas de asientos posteados, ordenables por entry_date/entry_number.';

-- -------------------------------------------------------------------------
-- 2. v_libro_mayor — movimientos por cuenta con saldo acumulado (running)
-- -------------------------------------------------------------------------
create or replace view public.v_libro_mayor
with (security_invoker = true) as
select
  coa.id                           as account_id,
  coa.code                         as cuenta_codigo,
  coa.name                         as cuenta_nombre,
  coa.type                         as cuenta_tipo,
  je.id                            as entry_id,
  je.entry_number,
  je.entry_date,
  to_char(je.entry_date, 'YYYY-MM') as periodo,
  l.description                    as linea_descripcion,
  l.debit,
  l.credit,
  sum(l.debit - l.credit) over (
    partition by l.account_id
    order by je.entry_date, je.entry_number, l.line_no
    rows between unbounded preceding and current row
  )                                as saldo_acumulado
from public.journal_entry_lines l
join public.journal_entries je on je.id = l.journal_entry_id
join public.chart_of_accounts coa on coa.id = l.account_id
where je.status = 'posted';

comment on view public.v_libro_mayor is 'Libro Mayor: movimientos por cuenta con saldo acumulado (deudor positivo / acreedor negativo).';

-- -------------------------------------------------------------------------
-- 3. v_balance_sumas_saldos — sumas (debe/haber) y saldos por cuenta imputable
-- -------------------------------------------------------------------------
create or replace view public.v_balance_sumas_saldos
with (security_invoker = true) as
select
  coa.id    as account_id,
  coa.code  as cuenta_codigo,
  coa.name  as cuenta_nombre,
  coa.type  as cuenta_tipo,
  coalesce(pl.total_debe, 0)  as total_debe,
  coalesce(pl.total_haber, 0) as total_haber,
  greatest(coalesce(pl.total_debe,0) - coalesce(pl.total_haber,0), 0) as saldo_deudor,
  greatest(coalesce(pl.total_haber,0) - coalesce(pl.total_debe,0), 0) as saldo_acreedor
from public.chart_of_accounts coa
left join (
  select l.account_id, sum(l.debit) as total_debe, sum(l.credit) as total_haber
  from public.journal_entry_lines l
  join public.journal_entries je on je.id = l.journal_entry_id
  where je.status = 'posted'
  group by l.account_id
) pl on pl.account_id = coa.id
where coa.is_postable;

comment on view public.v_balance_sumas_saldos is 'Balance de Sumas y Saldos: Σ debe = Σ haber y Σ saldo_deudor = Σ saldo_acreedor si la contabilidad cuadra.';

-- -------------------------------------------------------------------------
-- 4. v_estado_resultados — cuentas de resultado por período y cuenta
--    neto = haber - debe (ingresos +, gastos −). Resultado = Σ neto.
-- -------------------------------------------------------------------------
create or replace view public.v_estado_resultados
with (security_invoker = true) as
select
  to_char(je.entry_date, 'YYYY-MM') as periodo,
  coa.type   as cuenta_tipo,
  coa.code   as cuenta_codigo,
  coa.name   as cuenta_nombre,
  sum(l.debit)            as debe,
  sum(l.credit)           as haber,
  sum(l.credit - l.debit) as neto
from public.journal_entry_lines l
join public.journal_entries je on je.id = l.journal_entry_id
join public.chart_of_accounts coa on coa.id = l.account_id
where je.status = 'posted'
  and coa.type in ('ingreso','gasto')
group by to_char(je.entry_date, 'YYYY-MM'), coa.type, coa.code, coa.name;

comment on view public.v_estado_resultados is 'Estado de Resultados por período y cuenta. Resultado del período = Σ neto (ingresos − gastos).';

-- -------------------------------------------------------------------------
-- 5. v_posicion_iva — posición mensual de IVA consolidada (FISCAL, no contable)
--    Une libro_iva_ventas (débito) + libro_iva_compras (crédito) + percepciones
--    IVA sufridas + retenciones sufridas. Independiente de la contabilidad.
-- -------------------------------------------------------------------------
create or replace view public.v_posicion_iva
with (security_invoker = true) as
with periodos as (
  select periodo from public.libro_iva_ventas
  union
  select periodo from public.libro_iva_compras
  union
  select to_char(si.fecha_emision,'YYYY-MM')
  from public.supplier_invoices si where si.approval_status <> 'anulada'
  union
  select to_char(cr.payment_date,'YYYY-MM')
  from public.customer_receipts cr where cr.status = 'confirmado'
),
ventas as (
  select periodo, sum(iva_debito_fiscal) as iva_debito
  from public.libro_iva_ventas group by periodo
),
compras as (
  select periodo, sum(iva_credito_fiscal) as iva_credito
  from public.libro_iva_compras group by periodo
),
percep as (
  select to_char(si.fecha_emision,'YYYY-MM') as periodo,
         sum(ot.importe) as percep_iva
  from public.supplier_invoices si
  join public.supplier_invoice_other_taxes ot on ot.supplier_invoice_id = si.id
  where si.approval_status <> 'anulada' and ot.tax_kind = 'PERCEPCION_IVA'
  group by 1
),
retenc as (
  select to_char(cr.payment_date,'YYYY-MM') as periodo,
         sum(cr.retention_amount) as retenc_sufrida
  from public.customer_receipts cr
  where cr.status = 'confirmado'
  group by 1
)
select
  p.periodo,
  coalesce(v.iva_debito, 0)                                   as iva_debito_fiscal,
  coalesce(c.iva_credito, 0)                                  as iva_credito_fiscal,
  coalesce(v.iva_debito, 0) - coalesce(c.iva_credito, 0)      as saldo_tecnico,
  coalesce(pe.percep_iva, 0)                                  as percepciones_iva_sufridas,
  coalesce(re.retenc_sufrida, 0)                              as retenciones_sufridas,
  (coalesce(v.iva_debito,0) - coalesce(c.iva_credito,0)
     - coalesce(pe.percep_iva,0) - coalesce(re.retenc_sufrida,0)) as saldo_posicion,
  case
    when (coalesce(v.iva_debito,0) - coalesce(c.iva_credito,0)
          - coalesce(pe.percep_iva,0) - coalesce(re.retenc_sufrida,0)) > 0 then 'a_pagar'
    when (coalesce(v.iva_debito,0) - coalesce(c.iva_credito,0)
          - coalesce(pe.percep_iva,0) - coalesce(re.retenc_sufrida,0)) < 0 then 'a_favor'
    else 'neutro'
  end as resultado
from periodos p
left join ventas  v  on v.periodo  = p.periodo
left join compras c  on c.periodo  = p.periodo
left join percep  pe on pe.periodo = p.periodo
left join retenc  re on re.periodo = p.periodo;

comment on view public.v_posicion_iva is 'Posición mensual de IVA: débito − crédito − percepciones IVA sufridas − retenciones sufridas = saldo a pagar/favor.';

-- -------------------------------------------------------------------------
-- 6. v_comprobantes_sin_asiento — documentos contabilizables sin asiento activo
-- -------------------------------------------------------------------------
create or replace view public.v_comprobantes_sin_asiento
with (security_invoker = true) as
select * from (
  select 'customer_invoice'::text as source_type, ci.id as source_id,
         ci.created_at::date as fecha,
         ci.tipo_comprobante::text || ' ' || coalesce(ci.punto_venta::text,'') || '-' || coalesce(ci.numero_comprobante::text,'') as referencia,
         ci.razon_social as entidad, ci.total as importe
  from public.customer_invoices ci
  where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
    and not exists (select 1 from public.journal_entries je
      where je.source_type='customer_invoice' and je.source_id=ci.id
        and je.status in ('draft','posted') and je.reversed_entry_id is null)
  union all
  select 'supplier_invoice', si.id, si.fecha_emision, si.public_id,
         v.razon, si.total
  from public.supplier_invoices si
  left join public.vendors v on v.id = si.vendor_id
  where si.approval_status = 'aprobada'
    and not exists (select 1 from public.journal_entries je
      where je.source_type='supplier_invoice' and je.source_id=si.id
        and je.status in ('draft','posted') and je.reversed_entry_id is null)
  union all
  select 'customer_receipt', cr.id, cr.payment_date, cr.public_id,
         cl.razon, cr.gross_amount
  from public.customer_receipts cr
  left join public.clients cl on cl.id = cr.client_id
  where cr.status = 'confirmado'
    and not exists (select 1 from public.journal_entries je
      where je.source_type='customer_receipt' and je.source_id=cr.id
        and je.status in ('draft','posted') and je.reversed_entry_id is null)
  union all
  select 'supplier_payment', sp.id, sp.payment_date, sp.public_id,
         v.razon, sp.amount
  from public.supplier_payments sp
  left join public.vendors v on v.id = sp.vendor_id
  where sp.status = 'confirmado'
    and not exists (select 1 from public.journal_entries je
      where je.source_type='supplier_payment' and je.source_id=sp.id
        and je.status in ('draft','posted') and je.reversed_entry_id is null)
) x;

comment on view public.v_comprobantes_sin_asiento is 'Comprobantes contabilizables que aún no tienen asiento activo (insumo del backfill).';

-- -------------------------------------------------------------------------
-- 7. v_asientos_descuadrados — control: asientos posteados que no balancean
--    (debería estar SIEMPRE vacío gracias al invariante de 0083)
-- -------------------------------------------------------------------------
create or replace view public.v_asientos_descuadrados
with (security_invoker = true) as
select
  je.id as entry_id, je.entry_number, je.entry_date,
  sum(l.debit) as total_debe, sum(l.credit) as total_haber,
  round(sum(l.debit) - sum(l.credit), 2) as diferencia
from public.journal_entries je
join public.journal_entry_lines l on l.journal_entry_id = je.id
where je.status = 'posted'
group by je.id, je.entry_number, je.entry_date
having round(sum(l.debit) - sum(l.credit), 2) <> 0;

comment on view public.v_asientos_descuadrados is 'Control de integridad: asientos posteados descuadrados (debe estar vacío).';

-- -------------------------------------------------------------------------
-- 8. v_iva_fiscal_vs_contable — diferencia entre IVA fiscal y contable por mes
-- -------------------------------------------------------------------------
create or replace view public.v_iva_fiscal_vs_contable
with (security_invoker = true) as
with fiscal as (
  select periodo,
         sum(case when fuente='ventas'  then iva else 0 end) as iva_debito_fiscal,
         sum(case when fuente='compras' then iva else 0 end) as iva_credito_fiscal
  from (
    select periodo, 'ventas'::text as fuente, sum(iva_debito_fiscal) as iva
    from public.libro_iva_ventas group by periodo
    union all
    select periodo, 'compras', sum(iva_credito_fiscal)
    from public.libro_iva_compras group by periodo
  ) f group by periodo
),
contable as (
  select to_char(je.entry_date,'YYYY-MM') as periodo,
         sum(case when coa.code='2.1.02' then l.credit - l.debit else 0 end) as iva_debito_contable,
         sum(case when coa.code='1.1.05' then l.debit - l.credit else 0 end) as iva_credito_contable
  from public.journal_entries je
  join public.journal_entry_lines l on l.journal_entry_id = je.id
  join public.chart_of_accounts coa on coa.id = l.account_id
  where je.status = 'posted' and coa.code in ('2.1.02','1.1.05')
  group by 1
)
select
  coalesce(f.periodo, c.periodo) as periodo,
  coalesce(f.iva_debito_fiscal,0)    as iva_debito_fiscal,
  coalesce(c.iva_debito_contable,0)  as iva_debito_contable,
  round(coalesce(f.iva_debito_fiscal,0) - coalesce(c.iva_debito_contable,0), 2) as dif_debito,
  coalesce(f.iva_credito_fiscal,0)   as iva_credito_fiscal,
  coalesce(c.iva_credito_contable,0) as iva_credito_contable,
  round(coalesce(f.iva_credito_fiscal,0) - coalesce(c.iva_credito_contable,0), 2) as dif_credito
from fiscal f
full outer join contable c on c.periodo = f.periodo;

comment on view public.v_iva_fiscal_vs_contable is 'Conciliación: IVA de los libros fiscales vs. IVA registrado en la contabilidad (2.1.02 débito / 1.1.05 crédito).';

-- -------------------------------------------------------------------------
-- 9. GRANTS
-- -------------------------------------------------------------------------
grant select on public.v_libro_diario            to authenticated;
grant select on public.v_libro_mayor             to authenticated;
grant select on public.v_balance_sumas_saldos    to authenticated;
grant select on public.v_estado_resultados       to authenticated;
grant select on public.v_posicion_iva            to authenticated;
grant select on public.v_comprobantes_sin_asiento to authenticated;
grant select on public.v_asientos_descuadrados   to authenticated;
grant select on public.v_iva_fiscal_vs_contable  to authenticated;

notify pgrst, 'reload schema';
