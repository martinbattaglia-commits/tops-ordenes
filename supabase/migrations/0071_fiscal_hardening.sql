-- =========================================================================
-- 0071_fiscal_hardening.sql — FISCAL-HARDENING · H2 + H3 (única migración)
--
-- Aprobación presidencial 2026-06-12 (FISCAL-HARDENING-REVIEW-SESSION.md).
-- Alcance exacto:
--   H2 — Separación SANDBOX vs producción: las vistas fiscales/tesorería de
--        VENTAS sólo computan comprobantes del ambiente vigente en
--        fiscal_config (corte único; los mock no se borran, salen del corte).
--   H3 — Signo de Notas de Crédito: una NC RESTA (crédito fiscal en compras,
--        deuda/acreencia en open items). Los importes almacenados siguen
--        positivos: el signo es semántica de las vistas (mismo criterio que
--        usará libro_iva_ventas en V2).
--
-- NATURALEZA: recreación de vistas derivadas + 1 función estable. CERO
-- cambios de datos, CERO cambios de tablas, CERO borrados. Columnas de las
-- vistas sin cambios de nombre/tipo (compatibilidad con consumidores).
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. fiscal_ambiente() — corte de validez fiscal (H2)
--    SECURITY DEFINER acotado: expone ÚNICAMENTE el escalar `ambiente` de
--    fiscal_config (dato no sensible), para que las vistas security_invoker
--    puedan filtrar sin requerir lectura RLS de fiscal_config (cuyo SELECT
--    está restringido a admin/operaciones/supervisor en 0011).
-- -------------------------------------------------------------------------
create or replace function public.fiscal_ambiente()
returns public.arca_ambiente_t
language sql
stable
security definer
set search_path = public
as $$
  select ambiente from public.fiscal_config where id = 1;
$$;

revoke all on function public.fiscal_ambiente() from public;
grant execute on function public.fiscal_ambiente() to authenticated;

-- -------------------------------------------------------------------------
-- 1. H2 + signo ventas — customer_open_items
--    Cambios vs 0054:
--      (a) + filtro de ambiente (corte de validez fiscal).
--      (b) total/saldo con signo: una NC de venta reduce la deuda del
--          cliente en cuenta corriente (entra como saldo negativo y queda
--          fuera de "pendientes" — saldo <= 0 → 'cobrada').
--    Columnas idénticas a 0054 (invoice_id, client_id, numero_comprobante,
--    total, fch_vto_pago, pagado, saldo, estado_cobro).
-- -------------------------------------------------------------------------
create or replace view public.customer_open_items
with (security_invoker = true) as
select ci.id as invoice_id, ci.client_id, ci.numero_comprobante,
       (case when ci.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end) * ci.total as total,
       ci.fch_vto_pago,
       coalesce(sum(ra.amount) filter (where cr.status='confirmado'), 0) as pagado,
       (case when ci.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end) * ci.total
         - coalesce(sum(ra.amount) filter (where cr.status='confirmado'), 0) as saldo,
       case
         when ((case when ci.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end) * ci.total
               - coalesce(sum(ra.amount) filter (where cr.status='confirmado'),0)) <= 0 then 'cobrada'
         when coalesce(sum(ra.amount) filter (where cr.status='confirmado'),0) > 0 then 'parcial'
         when ci.fch_vto_pago is not null and ci.fch_vto_pago < current_date then 'vencida'
         else 'pendiente'
       end as estado_cobro
from public.customer_invoices ci
left join public.receipt_allocations ra on ra.customer_invoice_id = ci.id
left join public.customer_receipts cr   on cr.id = ra.receipt_id
where ci.estado_arca = 'AUTORIZADO_ARCA'
  and ci.anulada = false
  and ci.ambiente = public.fiscal_ambiente()
group by ci.id;

-- (customer_current_account y treasury_cashflow_projection derivan de
--  customer_open_items — heredan el corte sin recrearse.)

-- -------------------------------------------------------------------------
-- 2. H3 — supplier_invoice_fiscal con signo de NC
--    Idéntica a 0059 salvo el factor de signo aplicado a todos los importes.
-- -------------------------------------------------------------------------
create or replace view public.supplier_invoice_fiscal
with (security_invoker = true) as
select
  si.id as invoice_id,
  si.public_id,
  si.vendor_id,
  si.tipo_comprobante,
  si.fecha_emision,
  to_char(si.fecha_emision, 'YYYY-MM') as periodo,
  si.approval_status,
  sgn.f * coalesce(vl.neto_gravado, 0)        as neto_gravado,
  sgn.f * si.importe_no_gravado               as importe_no_gravado,
  sgn.f * si.importe_exento                   as importe_exento,
  sgn.f * coalesce(vl.iva_credito_fiscal, 0)  as iva_pagado,
  sgn.f * coalesce(ot.percepciones, 0)        as percepciones,
  sgn.f * coalesce(ot.tributos, 0)            as tributos,
  sgn.f * ( coalesce(vl.neto_gravado,0) + si.importe_no_gravado + si.importe_exento
    + coalesce(vl.iva_credito_fiscal,0) + coalesce(ot.percepciones,0) + coalesce(ot.tributos,0)
  ) as total_derivado,
  sgn.f * si.total as total_cabecera
from public.supplier_invoices si
cross join lateral (
  select case when si.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f
) sgn
left join (
  select supplier_invoice_id,
         sum(base_neto)   as neto_gravado,
         sum(importe_iva) as iva_credito_fiscal
  from public.supplier_invoice_vat_lines
  group by supplier_invoice_id
) vl on vl.supplier_invoice_id = si.id
left join (
  select supplier_invoice_id,
         sum(importe) filter (where tax_kind::text like 'PERCEPCION_%')          as percepciones,
         sum(importe) filter (where tax_kind in ('IMPUESTO_INTERNO','OTRO')) as tributos
  from public.supplier_invoice_other_taxes
  group by supplier_invoice_id
) ot on ot.supplier_invoice_id = si.id
where si.approval_status <> 'anulada';

-- -------------------------------------------------------------------------
-- 3. H3 — libro_iva_compras con signo de NC
--    Una NC ahora RESTA neto y crédito fiscal del período (caso de control:
--    factura $121.000/IVA $21.000 + NC $12.100/IVA $2.100 → crédito $18.900).
-- -------------------------------------------------------------------------
create or replace view public.libro_iva_compras
with (security_invoker = true) as
select
  to_char(si.fecha_emision, 'YYYY-MM') as periodo,
  vl.alic_iva_id,
  vl.alicuota_iva,
  count(distinct si.id)   as comprobantes,
  sum(sgn.f * vl.base_neto)       as neto_gravado,
  sum(sgn.f * vl.importe_iva)     as iva_credito_fiscal,
  sum(sgn.f * (vl.base_neto + vl.importe_iva)) as total_gravado
from public.supplier_invoices si
cross join lateral (
  select case when si.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f
) sgn
join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
where si.approval_status <> 'anulada'
group by to_char(si.fecha_emision, 'YYYY-MM'), vl.alic_iva_id, vl.alicuota_iva;

-- -------------------------------------------------------------------------
-- 4. H3 — supplier_open_items con signo de NC
--    Una NC de proveedor reduce el saldo a pagar (entra con total/saldo
--    negativos a la cuenta corriente; queda fuera de "pendientes").
--    Columnas y filtros idénticos a 0054 salvo el signo.
-- -------------------------------------------------------------------------
create or replace view public.supplier_open_items
with (security_invoker = true) as
select si.id as invoice_id, si.vendor_id, si.public_id,
       (case when si.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end) * si.total as total,
       si.fecha_vencimiento,
       coalesce(sum(pa.amount) filter (where sp.status='confirmado'), 0) as pagado,
       (case when si.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end) * si.total
         - coalesce(sum(pa.amount) filter (where sp.status='confirmado'), 0) as saldo,
       case
         when ((case when si.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end) * si.total
               - coalesce(sum(pa.amount) filter (where sp.status='confirmado'),0)) <= 0 then 'pagada'
         when coalesce(sum(pa.amount) filter (where sp.status='confirmado'),0) > 0 then 'parcial'
         when si.fecha_vencimiento is not null and si.fecha_vencimiento < current_date then 'vencida'
         else 'pendiente'
       end as estado_pago
from public.supplier_invoices si
left join public.payment_allocations pa on pa.supplier_invoice_id = si.id
left join public.supplier_payments sp   on sp.id = pa.payment_id
where si.status <> 'anulada'
group by si.id;

-- (supplier_current_account, supplier_ap_status y treasury_cashflow_projection
--  derivan de supplier_open_items — heredan el signo sin recrearse.)

-- -------------------------------------------------------------------------
-- 5. GRANTS (sin cambios de política: mismas concesiones que 0054/0059)
-- -------------------------------------------------------------------------
grant select on public.customer_open_items     to authenticated;
grant select on public.supplier_open_items     to authenticated;
grant select on public.supplier_invoice_fiscal to authenticated;
grant select on public.libro_iva_compras       to authenticated;

notify pgrst, 'reload schema';
