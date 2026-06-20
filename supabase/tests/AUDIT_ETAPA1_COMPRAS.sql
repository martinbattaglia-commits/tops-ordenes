-- =========================================================================
-- AUDIT_ETAPA1_COMPRAS.sql — Auditoría funcional · Etapa 1 (Compras)
--
-- NATURALEZA: 100% READ-ONLY. Solo SELECT / CTE. No contiene INSERT, UPDATE,
-- DELETE, TRUNCATE, DROP, ALTER, CREATE TABLE ni funciones que modifiquen datos.
-- Seguro de ejecutar entero en el Supabase SQL Editor (base arsksytgdnzukbmfgkju).
--
-- Controles: C1 IVA cabecera vs líneas · C2 total = neto+iva+percepciones ·
--            C3 duplicados de comprobante · C4 estados que impactan el libro ·
--            C5 percepciones sufridas.
--
-- Objetos reales (verificados):
--   supplier_invoices(neto,iva,percepciones,total,approval_status,vendor_id,
--                     tipo_comprobante,punto_venta,numero,fecha_emision)
--   supplier_invoice_vat_lines(supplier_invoice_id, base_neto, importe_iva)
--   libro_iva_compras  (vista; filtra approval_status <> 'anulada')
--   vendors(razon, cuit)
--   enum ap_approval_status_t = cargada|en_revision|aprobada|anulada
--
-- USO: ejecutar todo el archivo y copiar la tabla del bloque 8 (RESUMEN ETAPA 1).
--      Si un control da FALLA, correr su bloque de detalle (C1/C2/C3/C4) y copiarlo.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 2. PREFLIGHT — existencia de objetos base (read-only)
--    Si algún 'existe' = false, los controles asociados quedan NO_VERIFICABLE.
-- -------------------------------------------------------------------------
select 'PREFLIGHT' as bloque, obj as objeto, (to_regclass(obj) is not null) as existe
from (values
  ('public.supplier_invoices'),
  ('public.supplier_invoice_vat_lines'),
  ('public.libro_iva_compras'),
  ('public.vendors')
) t(obj)
order by obj;


-- -------------------------------------------------------------------------
-- 3. C1 — IVA cabecera vs Σ líneas IVA  (solo approval_status='aprobada')
--    Criterio: supplier_invoices.iva = Σ supplier_invoice_vat_lines.importe_iva
--    Diferencia esperada: 0.
-- -------------------------------------------------------------------------

-- 3.a C1 · RESUMEN
with c1 as (
  select si.id,
         si.iva                              as iva_cabecera,
         coalesce(sum(vl.importe_iva), 0)    as iva_lineas
  from public.supplier_invoices si
  left join public.supplier_invoice_vat_lines vl
         on vl.supplier_invoice_id = si.id
  where si.approval_status = 'aprobada'
  group by si.id, si.iva
)
select 'C1' as control,
       count(*)                                                              as total_auditados,
       count(*) filter (where round(abs(iva_cabecera - iva_lineas), 2) = 0)  as cantidad_ok,
       count(*) filter (where round(abs(iva_cabecera - iva_lineas), 2) > 0)  as cantidad_diferencia,
       coalesce(sum(round(abs(iva_cabecera - iva_lineas), 2))
                filter (where round(abs(iva_cabecera - iva_lineas), 2) > 0), 0) as monto_total_diferencia
from c1;

-- 3.b C1 · DETALLE (comprobantes con diferencia) — correr si C1 = FALLA
with c1 as (
  select si.id,
         si.public_id, si.vendor_id, si.tipo_comprobante, si.punto_venta,
         si.numero, si.fecha_emision, si.approval_status,
         si.iva                           as iva_cabecera,
         coalesce(sum(vl.importe_iva), 0) as iva_lineas
  from public.supplier_invoices si
  left join public.supplier_invoice_vat_lines vl
         on vl.supplier_invoice_id = si.id
  where si.approval_status = 'aprobada'
  group by si.id, si.public_id, si.vendor_id, si.tipo_comprobante,
           si.punto_venta, si.numero, si.fecha_emision, si.approval_status, si.iva
)
select c1.id, c1.public_id, v.razon as proveedor, v.cuit,
       c1.tipo_comprobante, c1.punto_venta, c1.numero, c1.fecha_emision,
       c1.iva_cabecera, c1.iva_lineas,
       round(c1.iva_cabecera - c1.iva_lineas, 2) as diferencia
from c1
left join public.vendors v on v.id = c1.vendor_id
where round(abs(c1.iva_cabecera - c1.iva_lineas), 2) > 0
order by abs(c1.iva_cabecera - c1.iva_lineas) desc;


-- -------------------------------------------------------------------------
-- 4. C2 — total = neto + iva + percepciones  (todas las facturas)
--    Diferencia esperada: 0.
-- -------------------------------------------------------------------------

-- 4.a C2 · RESUMEN
with c2 as (
  select id,
         round(total - (neto + iva + percepciones), 2) as diferencia
  from public.supplier_invoices
)
select 'C2' as control,
       count(*)                                              as total_auditados,
       count(*) filter (where diferencia = 0)                as cantidad_ok,
       count(*) filter (where diferencia <> 0)               as cantidad_diferencia,
       coalesce(sum(abs(diferencia)) filter (where diferencia <> 0), 0) as monto_total_diferencia
from c2;

-- 4.b C2 · DETALLE (comprobantes con diferencia) — correr si C2 = FALLA
select si.id, si.public_id, v.razon as proveedor, v.cuit,
       si.tipo_comprobante, si.punto_venta, si.numero, si.fecha_emision,
       si.approval_status,
       si.neto, si.iva, si.percepciones, si.total,
       round(si.total - (si.neto + si.iva + si.percepciones), 2) as diferencia
from public.supplier_invoices si
left join public.vendors v on v.id = si.vendor_id
where round(si.total - (si.neto + si.iva + si.percepciones), 2) <> 0
order by abs(si.total - (si.neto + si.iva + si.percepciones)) desc;


-- -------------------------------------------------------------------------
-- 5. C3 — Duplicados de comprobante de proveedor
--    Clave: (vendor_id, tipo_comprobante, punto_venta, numero)
--    Nota: existe UNIQUE en esa tupla (0014); se audita igual por completitud.
-- -------------------------------------------------------------------------

-- 5.a C3 · RESUMEN
with dup as (
  select vendor_id, tipo_comprobante, punto_venta, numero, count(*) as n
  from public.supplier_invoices
  group by vendor_id, tipo_comprobante, punto_venta, numero
  having count(*) > 1
)
select 'C3' as control,
       count(*)              as grupos_duplicados,
       coalesce(sum(n), 0)   as comprobantes_involucrados
from dup;

-- 5.b C3 · DETALLE (grupos e ids involucrados) — correr si C3 = FALLA
with dup as (
  select vendor_id, tipo_comprobante, punto_venta, numero
  from public.supplier_invoices
  group by vendor_id, tipo_comprobante, punto_venta, numero
  having count(*) > 1
)
select v.razon as proveedor, v.cuit,
       si.tipo_comprobante, si.punto_venta, si.numero,
       si.id, si.public_id, si.fecha_emision, si.approval_status,
       si.neto, si.iva, si.percepciones, si.total
from public.supplier_invoices si
join dup on dup.vendor_id = si.vendor_id
        and dup.tipo_comprobante = si.tipo_comprobante
        and dup.punto_venta = si.punto_venta
        and dup.numero = si.numero
left join public.vendors v on v.id = si.vendor_id
order by v.razon, si.tipo_comprobante, si.punto_venta, si.numero, si.fecha_emision;


-- -------------------------------------------------------------------------
-- 6. C4 — Solo 'aprobada' debería impactar el libro fiscal
--    Realidad: libro_iva_compras filtra approval_status <> 'anulada', por lo que
--    INCLUYE 'cargada' y 'en_revision'. Contra el criterio ("solo aprobada"),
--    se reportan como comprobantes no aprobados que impactan el libro.
--    (Hallazgo a confirmar con contador: crédito fiscal computable vs aprob. de pago.)
-- -------------------------------------------------------------------------

-- 6.a C4 · RESUMEN (no-aprobadas que aportan líneas al libro)
with impacta as (
  select distinct si.id, si.approval_status
  from public.supplier_invoices si
  join public.supplier_invoice_vat_lines vl
       on vl.supplier_invoice_id = si.id
  where si.approval_status <> 'anulada'        -- mismo recorte que la vista
    and si.approval_status <> 'aprobada'       -- pero no aprobadas
)
select 'C4' as control,
       count(*)                                                  as no_aprobados_en_libro,
       count(*) filter (where approval_status = 'cargada')       as cargada,
       count(*) filter (where approval_status = 'en_revision')   as en_revision
from impacta;

-- 6.b C4 · DETALLE — correr si C4 = FALLA
select si.id, si.public_id, v.razon as proveedor, v.cuit,
       si.tipo_comprobante, si.punto_venta, si.numero, si.fecha_emision,
       si.approval_status, si.neto, si.iva, si.percepciones, si.total,
       to_char(si.fecha_emision, 'YYYY-MM') as periodo
from public.supplier_invoices si
join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
left join public.vendors v on v.id = si.vendor_id
where si.approval_status <> 'anulada'
  and si.approval_status <> 'aprobada'
group by si.id, si.public_id, v.razon, v.cuit, si.tipo_comprobante,
         si.punto_venta, si.numero, si.fecha_emision, si.approval_status,
         si.neto, si.iva, si.percepciones, si.total
order by si.fecha_emision desc;


-- -------------------------------------------------------------------------
-- 7. C5 — Percepciones sufridas (aprobadas con percepciones > 0)
--    El modelo actual guarda el TOTAL de percepciones en supplier_invoices.percepciones.
--    El desglose por TIPO de percepción requiere la tabla supplier_invoice_other_taxes
--    (migración 0087, NO aplicada) → ese nivel queda NO_VERIFICABLE A NIVEL TIPO.
-- -------------------------------------------------------------------------

-- 7.a C5 · RESUMEN total por período
select 'C5' as control,
       count(*) filter (where percepciones > 0)                              as facturas_con_percepcion,
       coalesce(sum(percepciones) filter (where percepciones > 0), 0)        as total_percepciones,
       count(*) filter (where percepciones < 0)                              as facturas_percepcion_negativa
from public.supplier_invoices
where approval_status = 'aprobada';

-- 7.b C5 · DETALLE por período (aprobadas con percepción) — informativo
select to_char(si.fecha_emision, 'YYYY-MM')          as periodo,
       count(*) filter (where si.percepciones > 0)   as facturas_con_percepcion,
       coalesce(sum(si.percepciones) filter (where si.percepciones > 0), 0) as total_percepciones
from public.supplier_invoices si
where si.approval_status = 'aprobada'
group by to_char(si.fecha_emision, 'YYYY-MM')
having count(*) filter (where si.percepciones > 0) > 0
order by periodo desc;

-- 7.c C5 · ADVERTENCIA explícita de cobertura
select 'C5' as control,
       'NO_VERIFICABLE_A_NIVEL_TIPO' as nivel,
       (to_regclass('public.supplier_invoice_other_taxes') is not null) as existe_desglose_por_tipo,
       'El total de percepciones se verifica por factura; el desglose por tipo requiere la migración 0087 (supplier_invoice_other_taxes), no aplicada.' as advertencia;


-- -------------------------------------------------------------------------
-- 8. RESUMEN ETAPA 1  ← copiar ESTA tabla y pegarla como evidencia
--    Estados: OK | FALLA | NO_VERIFICABLE
-- -------------------------------------------------------------------------
with
c1 as (
  select si.id, si.iva as iva_cab, coalesce(sum(vl.importe_iva),0) as iva_lin
  from public.supplier_invoices si
  left join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
  where si.approval_status = 'aprobada'
  group by si.id, si.iva
),
c1agg as (
  select count(*) filter (where round(abs(iva_cab-iva_lin),2) > 0) as fallas,
         coalesce(sum(round(abs(iva_cab-iva_lin),2)) filter (where round(abs(iva_cab-iva_lin),2) > 0),0) as monto
  from c1
),
c2 as (
  select round(total-(neto+iva+percepciones),2) as diff from public.supplier_invoices
),
c2agg as (
  select count(*) filter (where diff <> 0) as fallas,
         coalesce(sum(abs(diff)) filter (where diff <> 0),0) as monto
  from c2
),
c3 as (
  select count(*) as n
  from public.supplier_invoices
  group by vendor_id, tipo_comprobante, punto_venta, numero
  having count(*) > 1
),
c3agg as ( select count(*) as grupos from c3 ),
c4 as (
  select distinct si.id
  from public.supplier_invoices si
  join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
  where si.approval_status <> 'anulada' and si.approval_status <> 'aprobada'
),
c4agg as ( select count(*) as fallas from c4 ),
c5agg as (
  select count(*) filter (where percepciones > 0) as facturas,
         coalesce(sum(percepciones) filter (where percepciones > 0),0) as monto
  from public.supplier_invoices where approval_status = 'aprobada'
)
select * from (
  select 1 as ord, 'C1' as control,
         'IVA cabecera = Σ líneas IVA (aprobadas)' as descripcion,
         case when (select fallas from c1agg) = 0 then 'OK' else 'FALLA' end as estado,
         (select fallas from c1agg)::bigint as cantidad_fallas,
         (select monto  from c1agg)::numeric(14,2) as monto_diferencia,
         'diferencia = 0' as criterio_ok
  union all
  select 2, 'C2',
         'total = neto + iva + percepciones',
         case when (select fallas from c2agg) = 0 then 'OK' else 'FALLA' end,
         (select fallas from c2agg)::bigint,
         (select monto  from c2agg)::numeric(14,2),
         'diferencia = 0'
  union all
  select 3, 'C3',
         'Sin duplicados (vendor,tipo,pto_vta,numero)',
         case when (select grupos from c3agg) = 0 then 'OK' else 'FALLA' end,
         (select grupos from c3agg)::bigint,
         0::numeric(14,2),
         '0 grupos duplicados'
  union all
  select 4, 'C4',
         'Solo aprobada impacta libro_iva_compras',
         case when (select fallas from c4agg) = 0 then 'OK' else 'FALLA' end,
         (select fallas from c4agg)::bigint,
         0::numeric(14,2),
         'libro real filtra <> anulada (incluye cargada/en_revision) → ver hallazgo'
  union all
  select 5, 'C5',
         'Percepciones sufridas (total por factura)',
         'NO_VERIFICABLE' ,
         (select facturas from c5agg)::bigint,
         (select monto    from c5agg)::numeric(14,2),
         'total OK por factura; desglose por tipo requiere 0087 (no aplicada)'
) s
order by ord;


-- -------------------------------------------------------------------------
-- 9. INSTRUCCIONES PARA INTERPRETAR RESULTADOS
--    · OK             → control cumplido (diferencia 0 / sin filas inesperadas). Se registra OK REAL.
--    · FALLA          → diferencia detectada. Correr el bloque DETALLE del control, aislar el
--                       comprobante, buscar causa raíz. NO ajustar manualmente.
--    · NO_VERIFICABLE → el modelo actual no permite el chequeo a ese nivel (C5: desglose por tipo
--                       sin la migración 0087). Se documenta como tal.
--    Nota C4: se espera FALLA "por diseño" si hay comprobantes 'cargada'/'en_revision' con líneas
--    IVA, porque la vista los incluye. Es un hallazgo semántico a confirmar con el contador,
--    no un error de cálculo.
-- =========================================================================
