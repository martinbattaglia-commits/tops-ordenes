-- =========================================================================
-- 0102_libro_iva_compras_fiscal_filter.sql — Fix C4 · Libro IVA Compras fiscal
--
-- Auditoría funcional Etapa 1 (Compras), control C4: la vista libro_iva_compras
-- filtraba `approval_status <> 'anulada'`, por lo que INCLUÍA comprobantes
-- 'cargada' y 'en_revision' (no validados) sumando crédito fiscal. Decisión
-- funcional aprobada (opción A): el LIBRO FISCAL REAL computa solo 'aprobada'.
--
-- Cambios:
--   1. libro_iva_compras → mismo cuerpo que 0071 (signo de NOTA_CREDITO,
--      security_invoker, misma agregación y columnas); solo cambia el WHERE a
--      approval_status = 'aprobada'.
--   2. libro_iva_compras_preliminar → NUEVA vista, misma estructura de salida,
--      para 'cargada'/'en_revision' (control operativo, NO fiscal).
--   'anulada' nunca computa en ninguna de las dos.
--
-- NATURALEZA: ADITIVA/CORRECTIVA, IDEMPOTENTE (create or replace view). No toca
-- tablas ni datos. Independiente de la cadena 0085-0101 (solo lee
-- supplier_invoices + supplier_invoice_vat_lines, ya presentes).
-- Ref: docs/auditoria/c4-libro-iva-compras-propuesta.md
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. libro_iva_compras — LIBRO FISCAL REAL (solo 'aprobada')
--    Idéntica a 0071 salvo el filtro de approval_status.
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
where si.approval_status = 'aprobada'
group by to_char(si.fecha_emision, 'YYYY-MM'), vl.alic_iva_id, vl.alicuota_iva;

-- -------------------------------------------------------------------------
-- 2. libro_iva_compras_preliminar — PRELIBRO OPERATIVO (cargada/en_revision)
--    Misma estructura de salida que el libro fiscal; NO fiscal.
-- -------------------------------------------------------------------------
create or replace view public.libro_iva_compras_preliminar
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
where si.approval_status in ('cargada', 'en_revision')
group by to_char(si.fecha_emision, 'YYYY-MM'), vl.alic_iva_id, vl.alicuota_iva;

-- -------------------------------------------------------------------------
-- 3. Comentarios de documentación
-- -------------------------------------------------------------------------
comment on view public.libro_iva_compras is
  'Libro IVA Compras FISCAL REAL: computa solo comprobantes approval_status=''aprobada'' '
  '(NOTA_CREDITO aprobadas restan por signo). cargada/en_revision NO computan; anulada nunca. '
  'Fix C4 (0102).';

comment on view public.libro_iva_compras_preliminar is
  'Prelibro IVA Compras OPERATIVO / NO FISCAL: comprobantes approval_status in '
  '(''cargada'',''en_revision'') para control de gestión previo a la aprobación. '
  'No usar para liquidación fiscal. Fix C4 (0102).';

notify pgrst, 'reload schema';
