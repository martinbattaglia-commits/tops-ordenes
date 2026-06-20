-- =========================================================================
-- 0091_phase11_reports_backfill.sql — Fase 11.D/F · Reportes de conciliación de
--   pagos con retención + diagnóstico de residuales (read-only / dry-run)
--
-- Reportes nuevos (vistas security_invoker) y un diagnóstico read-only que
-- detecta pagos con retenciones cuyo bruto imputado no cubre neto+retención
-- (caso "Fase 10 manual": pago con RPC vieja + retenciones agregadas aparte).
-- Los pagos nativos (RPC 0090) imputan bruto → quedan balanceados (no aparecen).
--
-- NO modifica vistas de 0054/0086/0089. ADITIVA e idempotente.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. v_supplier_payment_detalle — bruto / retención / neto por pago + balance
-- -------------------------------------------------------------------------
create or replace view public.v_supplier_payment_detalle
with (security_invoker = true) as
select
  sp.id as payment_id,
  sp.public_id,
  sp.vendor_id,
  v.razon as proveedor,
  sp.payment_date,
  to_char(sp.payment_date, 'YYYY-MM') as periodo,
  coalesce(sp.gross_amount, alloc.total_alloc, sp.amount) as bruto,
  coalesce(sp.withheld_amount, wh.total_wh, 0)            as retenciones,
  sp.amount                                               as neto,
  (round(coalesce(sp.gross_amount, alloc.total_alloc, sp.amount)
         - sp.amount - coalesce(sp.withheld_amount, wh.total_wh, 0), 2) = 0) as balanceado
from public.supplier_payments sp
left join public.vendors v on v.id = sp.vendor_id
left join (
  select payment_id, sum(amount) as total_alloc
  from public.payment_allocations group by payment_id
) alloc on alloc.payment_id = sp.id
left join (
  select supplier_payment_id, sum(amount) as total_wh
  from public.supplier_payment_withholdings group by supplier_payment_id
) wh on wh.supplier_payment_id = sp.id
where sp.status = 'confirmado';

comment on view public.v_supplier_payment_detalle is
  'Por pago confirmado: bruto (= Σ allocations) / retenciones (= Σ withholdings) / neto (= amount). balanceado = bruto == neto + retenciones.';

-- -------------------------------------------------------------------------
-- 2. v_pagos_retencion_residual — pagos con residual (bruto < neto+retención)
-- -------------------------------------------------------------------------
create or replace view public.v_pagos_retencion_residual
with (security_invoker = true) as
select
  payment_id, public_id, proveedor, periodo,
  neto, retenciones,
  (neto + retenciones) as bruto_esperado,
  bruto                as bruto_imputado,
  round((neto + retenciones) - bruto, 2) as residual
from public.v_supplier_payment_detalle
where not balanceado
  and retenciones > 0;

comment on view public.v_pagos_retencion_residual is
  'Pagos con retención cuyo bruto imputado (allocations) no cubre neto+retención → residual abierto en CxP. Los pagos nativos (RPC 0090) NO aparecen.';

-- -------------------------------------------------------------------------
-- 3. v_pagos_tesoreria_vs_contable — consistencia tesorería ↔ contabilidad
--    (sobre asientos de origen 'supplier_payment' posteados)
-- -------------------------------------------------------------------------
create or replace view public.v_pagos_tesoreria_vs_contable
with (security_invoker = true) as
with teso as (
  select to_char(m.date,'YYYY-MM') as periodo,
         sum(m.amount) as neto_tesoreria
  from public.treasury_movements m
  where m.type = 'pago_proveedor' and m.status = 'confirmado'
  group by 1
),
cont_bank as (
  select to_char(je.entry_date,'YYYY-MM') as periodo,
         sum(l.credit - l.debit) as neto_contable
  from public.journal_entries je
  join public.journal_entry_lines l on l.journal_entry_id = je.id
  join public.chart_of_accounts coa on coa.id = l.account_id
  where je.status = 'posted' and je.source_type = 'supplier_payment'
    and coa.code in ('1.1.01','1.1.02')
  group by 1
),
cont_prov as (
  select to_char(je.entry_date,'YYYY-MM') as periodo,
         sum(l.debit - l.credit) as bruto_contable
  from public.journal_entries je
  join public.journal_entry_lines l on l.journal_entry_id = je.id
  join public.chart_of_accounts coa on coa.id = l.account_id
  where je.status = 'posted' and je.source_type = 'supplier_payment'
    and coa.code = '2.1.01'
  group by 1
)
select
  coalesce(t.periodo, b.periodo, p.periodo) as periodo,
  coalesce(t.neto_tesoreria, 0)  as neto_tesoreria,
  coalesce(b.neto_contable, 0)   as neto_contable,
  round(coalesce(t.neto_tesoreria,0) - coalesce(b.neto_contable,0), 2) as dif_neto,
  coalesce(p.bruto_contable, 0)  as bruto_contable_proveedores
from teso t
full outer join cont_bank b on b.periodo = t.periodo
full outer join cont_prov p on p.periodo = coalesce(t.periodo, b.periodo);

comment on view public.v_pagos_tesoreria_vs_contable is
  'Conciliación de pagos: egreso neto en tesorería vs. HABER de Caja/Bancos en los asientos de pago; y bruto debitado a Proveedores. dif_neto debe ser ≈ 0.';

-- -------------------------------------------------------------------------
-- 4. Diagnóstico read-only (dry-run) de residuales — NUNCA escribe.
-- -------------------------------------------------------------------------
create or replace function public.tesoreria_diagnose_payment_withholdings(p_dry_run boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_res jsonb;
begin
  if not (public.has_permission('tesoreria.view') or public.current_role() = 'admin') then
    raise exception 'FORBIDDEN: requiere permiso tesoreria.view' using errcode='42501';
  end if;
  select jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'residual_count', count(*),
    'total_residual', coalesce(round(sum(residual),2), 0),
    'nota', 'Diagnóstico READ-ONLY. La corrección NO se ejecuta automáticamente (payment_allocations es inmutable). Para corregir: registrar el pago con tesoreria_register_supplier_payment_neto (0090) o un ajuste contable documentado.',
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'payment_id', payment_id, 'public_id', public_id, 'proveedor', proveedor,
      'neto', neto, 'retenciones', retenciones, 'bruto_esperado', bruto_esperado,
      'bruto_imputado', bruto_imputado, 'residual', residual
    ) order by residual desc), '[]'::jsonb)
  ) into v_res
  from public.v_pagos_retencion_residual;
  return v_res;
end; $$;

revoke all on function public.tesoreria_diagnose_payment_withholdings(boolean) from public;
grant execute on function public.tesoreria_diagnose_payment_withholdings(boolean) to authenticated;

-- -------------------------------------------------------------------------
-- 5. GRANTS de vistas
-- -------------------------------------------------------------------------
grant select on public.v_supplier_payment_detalle      to authenticated;
grant select on public.v_pagos_retencion_residual      to authenticated;
grant select on public.v_pagos_tesoreria_vs_contable   to authenticated;

notify pgrst, 'reload schema';
