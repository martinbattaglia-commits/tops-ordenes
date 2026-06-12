-- =========================================================================
-- 0073_libro_iva_ventas.sql — IVA VENTAS V2 · Libro IVA Ventas (Gate FASE 1)
--
-- Primer LECTOR oficial del dominio canónico customer_invoice_vat_lines
-- (0072). Espejo del lado compras (0059/0071), con las reglas de la
-- autorización presidencial 2026-06-12:
--   · FUENTE FISCAL = customer_invoice_vat_lines (no invoice_items, no la
--     cabecera como fuente primaria; la cabecera solo aporta dimensiones y
--     los componentes no-IVA: exento / no gravado / percepciones / tributos).
--   · Signo: NC restan (-1) · ND y facturas suman (+1).
--   · Corte de validez fiscal: AUTORIZADO_ARCA ∧ ¬anulada ∧ ambiente =
--     fiscal_ambiente() → cuando fiscal_config pase a PRODUCCION, los mocks
--     SANDBOX quedan excluidos AUTOMÁTICAMENTE (cero cambios necesarios).
--
-- NATURALEZA: ADITIVA y de solo lectura (2 vistas security_invoker + grants).
-- Cero tablas, cero datos, cero cambios a vistas existentes.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. customer_invoice_fiscal — el Libro IVA Ventas DETALLE (fila = comprobante)
--    Espejo de supplier_invoice_fiscal con dimensiones del lado ventas y
--    desglose de IVA por alícuota pivoteado (lo que pide la Contadora).
-- -------------------------------------------------------------------------
create or replace view public.customer_invoice_fiscal
with (security_invoker = true) as
select
  ci.id                                   as invoice_id,
  ci.created_at::date                     as fecha,
  coalesce(ci.periodo, to_char(ci.created_at, 'YYYY-MM')) as periodo,
  ci.tipo_comprobante,
  ci.punto_venta,
  ci.numero_comprobante,
  ci.razon_social                         as cliente,
  ci.cuit_cliente                         as cuit,
  ci.condicion_iva,
  -- Componentes IVA — fuente canónica con signo
  (sgn.f * coalesce(vl.neto_gravado, 0))::numeric(15,2)  as neto_gravado,
  (sgn.f * coalesce(vl.neto_21,  0))::numeric(15,2)      as neto_21,
  (sgn.f * coalesce(vl.iva_21,   0))::numeric(15,2)      as iva_21,
  (sgn.f * coalesce(vl.neto_105, 0))::numeric(15,2)      as neto_10_5,
  (sgn.f * coalesce(vl.iva_105,  0))::numeric(15,2)      as iva_10_5,
  (sgn.f * coalesce(vl.neto_27,  0))::numeric(15,2)      as neto_27,
  (sgn.f * coalesce(vl.iva_27,   0))::numeric(15,2)      as iva_27,
  (sgn.f * coalesce(vl.neto_otras, 0))::numeric(15,2)    as neto_otras_alicuotas,
  (sgn.f * coalesce(vl.iva_otras,  0))::numeric(15,2)    as iva_otras_alicuotas,
  (sgn.f * coalesce(vl.iva_total, 0))::numeric(15,2)     as iva_total,
  -- Componentes no-IVA de la cabecera (caché reconciliada), con signo
  (sgn.f * ci.importe_no_gravado)::numeric(15,2) as importe_no_gravado,
  (sgn.f * ci.importe_exento)::numeric(15,2)     as importe_exento,
  (sgn.f * ci.percepciones)::numeric(15,2)       as percepciones,
  (sgn.f * ci.tributos)::numeric(15,2)           as tributos,
  (sgn.f * ci.total)::numeric(15,2)              as total_comprobante,
  -- Estado y trazabilidad
  ci.estado_arca                          as estado_fiscal,
  ci.ambiente                             as ambiente_fiscal,
  ci.cae,
  case when asoc.id is not null
       then asoc.tipo_comprobante::text || ' ' || asoc.punto_venta || '-' || asoc.numero_comprobante
       end                                as comprobante_asociado
from public.customer_invoices ci
cross join lateral (
  select case when ci.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f
) sgn
join (
  select invoice_id,
         sum(neto_gravado) as neto_gravado,
         sum(iva_importe)  as iva_total,
         sum(neto_gravado) filter (where alic_iva_id = 5) as neto_21,
         sum(iva_importe)  filter (where alic_iva_id = 5) as iva_21,
         sum(neto_gravado) filter (where alic_iva_id = 4) as neto_105,
         sum(iva_importe)  filter (where alic_iva_id = 4) as iva_105,
         sum(neto_gravado) filter (where alic_iva_id = 6) as neto_27,
         sum(iva_importe)  filter (where alic_iva_id = 6) as iva_27,
         sum(neto_gravado) filter (where alic_iva_id in (3, 8, 9)) as neto_otras,
         sum(iva_importe)  filter (where alic_iva_id in (3, 8, 9)) as iva_otras
  from public.customer_invoice_vat_lines
  group by invoice_id
) vl on vl.invoice_id = ci.id
left join public.customer_invoices asoc on asoc.id = ci.comprobante_asociado_id
where ci.estado_arca = 'AUTORIZADO_ARCA'
  and ci.anulada = false
  and ci.ambiente = public.fiscal_ambiente();

comment on view public.customer_invoice_fiscal is
  'Libro IVA Ventas detalle (fila = comprobante fiscalmente válido). Fuente canónica: customer_invoice_vat_lines; NC con signo negativo; corte por fiscal_ambiente() — al pasar a PRODUCCION los mocks SANDBOX se excluyen automáticamente.';

-- -------------------------------------------------------------------------
-- 2. libro_iva_ventas — resumen por período y alícuota (DÉBITO FISCAL)
--    Espejo exacto de libro_iva_compras (0071), lado ventas.
-- -------------------------------------------------------------------------
create or replace view public.libro_iva_ventas
with (security_invoker = true) as
select
  coalesce(ci.periodo, to_char(ci.created_at, 'YYYY-MM')) as periodo,
  vl.alic_iva_id,
  vl.alicuota_iva,
  count(distinct ci.id)                 as comprobantes,
  sum(sgn.f * vl.neto_gravado)          as neto_gravado,
  sum(sgn.f * vl.iva_importe)           as iva_debito_fiscal,
  sum(sgn.f * (vl.neto_gravado + vl.iva_importe)) as total_gravado
from public.customer_invoices ci
cross join lateral (
  select case when ci.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f
) sgn
join public.customer_invoice_vat_lines vl on vl.invoice_id = ci.id
where ci.estado_arca = 'AUTORIZADO_ARCA'
  and ci.anulada = false
  and ci.ambiente = public.fiscal_ambiente()
group by coalesce(ci.periodo, to_char(ci.created_at, 'YYYY-MM')), vl.alic_iva_id, vl.alicuota_iva;

comment on view public.libro_iva_ventas is
  'Débito fiscal por período y alícuota. Fuente: customer_invoice_vat_lines con signo (NC restan). Solo comprobantes fiscalmente válidos del ambiente vigente.';

-- -------------------------------------------------------------------------
-- 3. GRANTS (security_invoker → respetan RLS de las tablas base:
--    customer_invoices/vat_lines son legibles solo por roles internos)
-- -------------------------------------------------------------------------
grant select on public.customer_invoice_fiscal to authenticated;
grant select on public.libro_iva_ventas        to authenticated;

notify pgrst, 'reload schema';
