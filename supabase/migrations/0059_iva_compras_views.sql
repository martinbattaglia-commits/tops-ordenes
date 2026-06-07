-- =========================================================================
-- 0059_iva_compras_views.sql — ERP-B1 · Vistas derivadas IVA Compras (Gate 4)
--
-- Vistas security_invoker (respetan RLS) y DERIVADAS (D5: nunca tablas).
-- Toda la triple obligatoria (Neto Gravado / IVA Pagado / Total) sale del
-- MISMO detalle canónico (supplier_invoice_vat_lines + other_taxes), sin
-- cálculos ambiguos. Habilita Libro IVA Compras y export contador (fases B4/B5).
--
-- NATURALEZA: ADITIVA y de solo lectura. Lee supplier_open_items (ERP-A) sin
-- modificarla.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. supplier_invoice_fiscal — triple derivada por factura (sin ambigüedad)
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
  coalesce(vl.neto_gravado, 0)        as neto_gravado,
  si.importe_no_gravado,
  si.importe_exento,
  coalesce(vl.iva_credito_fiscal, 0)  as iva_pagado,
  coalesce(ot.percepciones, 0)        as percepciones,
  coalesce(ot.tributos, 0)            as tributos,
  ( coalesce(vl.neto_gravado,0) + si.importe_no_gravado + si.importe_exento
    + coalesce(vl.iva_credito_fiscal,0) + coalesce(ot.percepciones,0) + coalesce(ot.tributos,0)
  ) as total_derivado,
  si.total as total_cabecera
from public.supplier_invoices si
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
-- 2. libro_iva_compras — agrupado por período y alícuota (crédito fiscal)
-- -------------------------------------------------------------------------
create or replace view public.libro_iva_compras
with (security_invoker = true) as
select
  to_char(si.fecha_emision, 'YYYY-MM') as periodo,
  vl.alic_iva_id,
  vl.alicuota_iva,
  count(distinct si.id)   as comprobantes,
  sum(vl.base_neto)       as neto_gravado,
  sum(vl.importe_iva)     as iva_credito_fiscal,
  sum(vl.base_neto + vl.importe_iva) as total_gravado
from public.supplier_invoices si
join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
where si.approval_status <> 'anulada'
group by to_char(si.fecha_emision, 'YYYY-MM'), vl.alic_iva_id, vl.alicuota_iva;

-- -------------------------------------------------------------------------
-- 3. supplier_ap_status — estado operativo = aprobación × pago (DERIVADO)
--    Resuelve el double-truth: una sola vista combina ambas dimensiones.
-- -------------------------------------------------------------------------
create or replace view public.supplier_ap_status
with (security_invoker = true) as
select
  si.id as invoice_id,
  si.public_id,
  si.vendor_id,
  si.total,
  si.neto        as neto_gravado,
  si.iva         as iva_pagado,
  si.fecha_vencimiento,
  si.approval_status,
  coalesce(soi.estado_pago, 'pendiente') as estado_pago,
  coalesce(soi.pagado, 0)                as pagado,
  coalesce(soi.saldo, si.total)          as saldo,
  case
    when si.approval_status = 'anulada' then 'anulada'
    when coalesce(soi.estado_pago,'pendiente') = 'pagada' then 'pagada'
    when si.approval_status = 'aprobada'
         and coalesce(soi.estado_pago,'pendiente') in ('pendiente','parcial','vencida') then 'pendiente_pago'
    when si.approval_status = 'aprobada'   then 'aprobada'
    when si.approval_status = 'en_revision' then 'revision'
    else 'cargada'
  end as estado_operativo
from public.supplier_invoices si
left join public.supplier_open_items soi on soi.invoice_id = si.id;

-- -------------------------------------------------------------------------
-- 4. GRANTS (security_invoker → respetan RLS de las tablas base)
-- -------------------------------------------------------------------------
grant select on public.supplier_invoice_fiscal to authenticated;
grant select on public.libro_iva_compras       to authenticated;
grant select on public.supplier_ap_status      to authenticated;

notify pgrst, 'reload schema';
