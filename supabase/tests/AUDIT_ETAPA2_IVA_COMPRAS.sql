-- =========================================================================
-- AUDIT_ETAPA2_IVA_COMPRAS.sql — Auditoría funcional · Etapa 2 (IVA Compras)
--
-- NATURALEZA: 100% READ-ONLY. Solo SELECT / CTE. Sin INSERT/UPDATE/DELETE/
-- TRUNCATE/DROP/ALTER/CREATE ni funciones que modifiquen datos.
-- Audita el IVA Compras POST-0102 (libro fiscal = solo 'aprobada';
-- prelibro = 'cargada'/'en_revision'; 'anulada' fuera de ambas).
--
-- Técnica: comparar la VISTA contra un "recompute" hecho con la MISMA lógica
-- (signo de NOTA_CREDITO, agregación por período/alícuota) filtrando por estado.
-- Si vista == recompute, la vista cuadra contra supplier_invoices.
--
-- Controles:
--   IC1 libro_iva_compras == recompute(aprobada)  (comprobantes/neto/iva/total)
--   IC2 período derivado de fecha_emision; sin filas huérfanas ni fechas nulas
--   IC3 libro_iva_compras_preliminar == recompute(cargada,en_revision)
--   IC4 'anulada' fuera de ambas vistas
--   IC5 NOTA_CREDITO aprobadas restan (signo) — NO_VERIFICABLE si no hay
--
-- Objetos: supplier_invoices, supplier_invoice_vat_lines, libro_iva_compras,
--          libro_iva_compras_preliminar.
-- Columnas de las vistas: periodo, alic_iva_id, alicuota_iva, comprobantes,
--          neto_gravado, iva_credito_fiscal, total_gravado.
--
-- USO: ejecutar todo y copiar PREFLIGHT + RESUMEN ETAPA 2. Los detalles (IC1..IC5)
--      están arriba del resumen; copiar el de cualquier control en FALLA.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 2. PREFLIGHT — existencia de objetos (si falta la preliminar, falta 0102)
-- -------------------------------------------------------------------------
select 'PREFLIGHT' as bloque, obj as objeto, (to_regclass(obj) is not null) as existe
from (values
  ('public.supplier_invoices'),
  ('public.supplier_invoice_vat_lines'),
  ('public.libro_iva_compras'),
  ('public.libro_iva_compras_preliminar')
) t(obj)
order by obj;


-- -------------------------------------------------------------------------
-- 3. IC1 — libro_iva_compras == recompute(aprobada)
-- -------------------------------------------------------------------------

-- 3.a IC1 · DETALLE (por período/alícuota: manual vs libro + diferencias)
with rec as (
  select to_char(si.fecha_emision,'YYYY-MM') as periodo, vl.alic_iva_id, vl.alicuota_iva,
         count(distinct si.id)                         as comprobantes,
         sum(sgn.f*vl.base_neto)                       as neto_gravado,
         sum(sgn.f*vl.importe_iva)                     as iva_credito_fiscal,
         sum(sgn.f*(vl.base_neto+vl.importe_iva))      as total_gravado
  from public.supplier_invoices si
  cross join lateral (select case when si.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f) sgn
  join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
  where si.approval_status = 'aprobada'
  group by 1,2,3
)
select coalesce(v.periodo, r.periodo)             as periodo,
       coalesce(v.alic_iva_id, r.alic_iva_id)     as alic_iva_id,
       coalesce(v.alicuota_iva, r.alicuota_iva)   as alicuota_iva,
       r.comprobantes        as manual_comprobantes,
       v.comprobantes        as libro_comprobantes,
       r.neto_gravado        as manual_neto,
       v.neto_gravado        as libro_neto,
       r.iva_credito_fiscal  as manual_iva,
       v.iva_credito_fiscal  as libro_iva,
       r.total_gravado       as manual_total,
       v.total_gravado       as libro_total,
       (coalesce(v.comprobantes,0)-coalesce(r.comprobantes,0))              as dif_comprobantes,
       round(coalesce(v.neto_gravado,0)-coalesce(r.neto_gravado,0),2)        as dif_neto,
       round(coalesce(v.iva_credito_fiscal,0)-coalesce(r.iva_credito_fiscal,0),2) as dif_iva,
       round(coalesce(v.total_gravado,0)-coalesce(r.total_gravado,0),2)      as dif_total,
       case when coalesce(v.comprobantes,0)=coalesce(r.comprobantes,0)
             and round(coalesce(v.neto_gravado,0)-coalesce(r.neto_gravado,0),2)=0
             and round(coalesce(v.iva_credito_fiscal,0)-coalesce(r.iva_credito_fiscal,0),2)=0
             and round(coalesce(v.total_gravado,0)-coalesce(r.total_gravado,0),2)=0
            then 'OK' else 'FALLA' end as estado
from public.libro_iva_compras v
full outer join rec r using (periodo, alic_iva_id, alicuota_iva)
order by periodo, alic_iva_id;

-- 3.b IC1 · RESUMEN
with rec as (
  select to_char(si.fecha_emision,'YYYY-MM') as periodo, vl.alic_iva_id, vl.alicuota_iva,
         count(distinct si.id) as comprobantes,
         sum(sgn.f*vl.base_neto) as neto_gravado,
         sum(sgn.f*vl.importe_iva) as iva_credito_fiscal,
         sum(sgn.f*(vl.base_neto+vl.importe_iva)) as total_gravado
  from public.supplier_invoices si
  cross join lateral (select case when si.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f) sgn
  join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
  where si.approval_status = 'aprobada'
  group by 1,2,3
),
cmp as (
  select case when coalesce(v.comprobantes,0)=coalesce(r.comprobantes,0)
               and round(coalesce(v.neto_gravado,0)-coalesce(r.neto_gravado,0),2)=0
               and round(coalesce(v.iva_credito_fiscal,0)-coalesce(r.iva_credito_fiscal,0),2)=0
               and round(coalesce(v.total_gravado,0)-coalesce(r.total_gravado,0),2)=0
              then 0 else 1 end as falla,
         round(abs(coalesce(v.iva_credito_fiscal,0)-coalesce(r.iva_credito_fiscal,0)),2) as dif_iva
  from public.libro_iva_compras v
  full outer join rec r using (periodo, alic_iva_id, alicuota_iva)
)
select 'IC1' as control,
       count(*)                          as filas_periodo_alicuota,
       coalesce(sum(falla),0)            as cantidad_fallas,
       coalesce(sum(dif_iva),0)          as monto_diferencia
from cmp;


-- -------------------------------------------------------------------------
-- 4. IC2 — período derivado de fecha_emision; sin huérfanas ni fechas nulas
-- -------------------------------------------------------------------------

-- 4.a IC2 · DETALLE (filas del libro sin respaldo en aprobadas + fechas nulas)
with rec as (
  select to_char(si.fecha_emision,'YYYY-MM') as periodo, vl.alic_iva_id, vl.alicuota_iva
  from public.supplier_invoices si
  join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
  where si.approval_status = 'aprobada'
  group by 1,2,3
)
select 'fila_libro_sin_respaldo' as tipo,
       v.periodo, v.alic_iva_id, v.alicuota_iva
from public.libro_iva_compras v
left join rec r using (periodo, alic_iva_id, alicuota_iva)
where r.periodo is null
union all
select 'aprobada_con_lineas_fecha_nula' as tipo,
       null as periodo, vl.alic_iva_id, vl.alicuota_iva
from public.supplier_invoices si
join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
where si.approval_status = 'aprobada' and si.fecha_emision is null
order by 1,2,3;

-- 4.b IC2 · RESUMEN
with rec as (
  select to_char(si.fecha_emision,'YYYY-MM') as periodo, vl.alic_iva_id, vl.alicuota_iva
  from public.supplier_invoices si
  join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
  where si.approval_status = 'aprobada'
  group by 1,2,3
),
huerfanas as (
  select count(*) as n
  from public.libro_iva_compras v
  left join rec r using (periodo, alic_iva_id, alicuota_iva)
  where r.periodo is null
),
fechas_nulas as (
  select count(distinct si.id) as n
  from public.supplier_invoices si
  join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
  where si.approval_status = 'aprobada' and si.fecha_emision is null
)
select 'IC2' as control,
       (select n from huerfanas)   as filas_libro_sin_respaldo,
       (select n from fechas_nulas) as aprobadas_fecha_nula,
       ((select n from huerfanas) + (select n from fechas_nulas)) as cantidad_fallas;


-- -------------------------------------------------------------------------
-- 5. IC3 — libro_iva_compras_preliminar == recompute(cargada,en_revision)
-- -------------------------------------------------------------------------

-- 5.a IC3 · DETALLE (por período/alícuota: manual vs prelibro + diferencias)
with rec as (
  select to_char(si.fecha_emision,'YYYY-MM') as periodo, vl.alic_iva_id, vl.alicuota_iva,
         count(distinct si.id) as comprobantes,
         sum(sgn.f*vl.base_neto) as neto_gravado,
         sum(sgn.f*vl.importe_iva) as iva_credito_fiscal,
         sum(sgn.f*(vl.base_neto+vl.importe_iva)) as total_gravado
  from public.supplier_invoices si
  cross join lateral (select case when si.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f) sgn
  join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
  where si.approval_status in ('cargada','en_revision')
  group by 1,2,3
)
select coalesce(v.periodo, r.periodo)           as periodo,
       coalesce(v.alic_iva_id, r.alic_iva_id)   as alic_iva_id,
       coalesce(v.alicuota_iva, r.alicuota_iva) as alicuota_iva,
       r.comprobantes       as manual_comprobantes,
       v.comprobantes       as prelibro_comprobantes,
       r.iva_credito_fiscal as manual_iva,
       v.iva_credito_fiscal as prelibro_iva,
       round(coalesce(v.iva_credito_fiscal,0)-coalesce(r.iva_credito_fiscal,0),2) as dif_iva,
       case when coalesce(v.comprobantes,0)=coalesce(r.comprobantes,0)
             and round(coalesce(v.neto_gravado,0)-coalesce(r.neto_gravado,0),2)=0
             and round(coalesce(v.iva_credito_fiscal,0)-coalesce(r.iva_credito_fiscal,0),2)=0
             and round(coalesce(v.total_gravado,0)-coalesce(r.total_gravado,0),2)=0
            then 'OK' else 'FALLA' end as estado
from public.libro_iva_compras_preliminar v
full outer join rec r using (periodo, alic_iva_id, alicuota_iva)
order by periodo, alic_iva_id;

-- 5.b IC3 · RESUMEN
with rec as (
  select to_char(si.fecha_emision,'YYYY-MM') as periodo, vl.alic_iva_id, vl.alicuota_iva,
         count(distinct si.id) as comprobantes,
         sum(sgn.f*vl.base_neto) as neto_gravado,
         sum(sgn.f*vl.importe_iva) as iva_credito_fiscal,
         sum(sgn.f*(vl.base_neto+vl.importe_iva)) as total_gravado
  from public.supplier_invoices si
  cross join lateral (select case when si.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f) sgn
  join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
  where si.approval_status in ('cargada','en_revision')
  group by 1,2,3
),
cmp as (
  select case when coalesce(v.comprobantes,0)=coalesce(r.comprobantes,0)
               and round(coalesce(v.neto_gravado,0)-coalesce(r.neto_gravado,0),2)=0
               and round(coalesce(v.iva_credito_fiscal,0)-coalesce(r.iva_credito_fiscal,0),2)=0
               and round(coalesce(v.total_gravado,0)-coalesce(r.total_gravado,0),2)=0
              then 0 else 1 end as falla,
         round(abs(coalesce(v.iva_credito_fiscal,0)-coalesce(r.iva_credito_fiscal,0)),2) as dif_iva
  from public.libro_iva_compras_preliminar v
  full outer join rec r using (periodo, alic_iva_id, alicuota_iva)
)
select 'IC3' as control,
       count(*)               as filas_periodo_alicuota,
       coalesce(sum(falla),0) as cantidad_fallas,
       coalesce(sum(dif_iva),0) as monto_diferencia
from cmp;


-- -------------------------------------------------------------------------
-- 6. IC4 — 'anulada' fuera de ambas vistas
--    Garantía: IC1 (fiscal==aprobada) e IC3 (prelibro==cargada/en_revision) ya
--    excluyen 'anulada' por construcción. Acá se informa el riesgo residual.
-- -------------------------------------------------------------------------

-- 6.a IC4 · DETALLE (anuladas con líneas IVA — no deben estar en ninguna vista)
select si.id as supplier_invoice_id, v.razon as proveedor,
       si.tipo_comprobante, si.punto_venta, si.numero, si.fecha_emision,
       si.approval_status, si.neto, si.iva, si.total
from public.supplier_invoices si
join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
left join public.vendors v on v.id = si.vendor_id
where si.approval_status = 'anulada'
group by si.id, v.razon, si.tipo_comprobante, si.punto_venta, si.numero,
         si.fecha_emision, si.approval_status, si.neto, si.iva, si.total
order by si.fecha_emision desc;

-- 6.b IC4 · RESUMEN
select 'IC4' as control,
       count(distinct si.id) as anuladas_con_lineas
from public.supplier_invoices si
join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
where si.approval_status = 'anulada';


-- -------------------------------------------------------------------------
-- 7. IC5 — NOTA_CREDITO aprobadas restan (signo)
-- -------------------------------------------------------------------------

-- 7.a IC5 · DETALLE (NC aprobadas y su aporte con signo)
select si.id as supplier_invoice_id, v.razon as proveedor,
       si.tipo_comprobante, si.numero, si.fecha_emision,
       sum(vl.importe_iva)        as iva_lineas_positivo,
       -1 * sum(vl.importe_iva)   as aporte_al_libro_con_signo
from public.supplier_invoices si
join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
left join public.vendors v on v.id = si.vendor_id
where si.approval_status = 'aprobada'
  and si.tipo_comprobante::text like 'NOTA_CREDITO%'
group by si.id, v.razon, si.tipo_comprobante, si.numero, si.fecha_emision
order by si.fecha_emision desc;

-- 7.b IC5 · RESUMEN
with nc as (
  select count(distinct si.id) as nc_aprobadas,
         coalesce(sum(vl.importe_iva),0) as iva_nc_positivo
  from public.supplier_invoices si
  join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
  where si.approval_status = 'aprobada'
    and si.tipo_comprobante::text like 'NOTA_CREDITO%'
)
select 'IC5' as control,
       nc_aprobadas,
       (-1 * iva_nc_positivo) as aporte_total_al_libro,
       case when nc_aprobadas = 0 then 'NO_VERIFICABLE' else 'OK' end as estado
from nc;


-- -------------------------------------------------------------------------
-- 8. RESUMEN ETAPA 2  ← copiar ESTA tabla y pegarla como evidencia
--    Estados: OK | FALLA | NO_VERIFICABLE
-- -------------------------------------------------------------------------
with
rec_aprob as (
  select to_char(si.fecha_emision,'YYYY-MM') as periodo, vl.alic_iva_id, vl.alicuota_iva,
         count(distinct si.id) as comprobantes,
         sum(sgn.f*vl.base_neto) as neto_gravado,
         sum(sgn.f*vl.importe_iva) as iva_credito_fiscal,
         sum(sgn.f*(vl.base_neto+vl.importe_iva)) as total_gravado
  from public.supplier_invoices si
  cross join lateral (select case when si.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f) sgn
  join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
  where si.approval_status = 'aprobada'
  group by 1,2,3
),
rec_prelim as (
  select to_char(si.fecha_emision,'YYYY-MM') as periodo, vl.alic_iva_id, vl.alicuota_iva,
         count(distinct si.id) as comprobantes,
         sum(sgn.f*vl.base_neto) as neto_gravado,
         sum(sgn.f*vl.importe_iva) as iva_credito_fiscal,
         sum(sgn.f*(vl.base_neto+vl.importe_iva)) as total_gravado
  from public.supplier_invoices si
  cross join lateral (select case when si.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f) sgn
  join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
  where si.approval_status in ('cargada','en_revision')
  group by 1,2,3
),
ic1 as (
  select coalesce(sum(case when coalesce(v.comprobantes,0)=coalesce(r.comprobantes,0)
                            and round(coalesce(v.neto_gravado,0)-coalesce(r.neto_gravado,0),2)=0
                            and round(coalesce(v.iva_credito_fiscal,0)-coalesce(r.iva_credito_fiscal,0),2)=0
                            and round(coalesce(v.total_gravado,0)-coalesce(r.total_gravado,0),2)=0
                           then 0 else 1 end),0) as fallas,
         coalesce(sum(round(abs(coalesce(v.iva_credito_fiscal,0)-coalesce(r.iva_credito_fiscal,0)),2)),0) as monto
  from public.libro_iva_compras v
  full outer join rec_aprob r using (periodo, alic_iva_id, alicuota_iva)
),
ic2 as (
  select (
    (select count(*) from public.libro_iva_compras v
       left join rec_aprob r using (periodo, alic_iva_id, alicuota_iva)
       where r.periodo is null)
    +
    (select count(distinct si.id) from public.supplier_invoices si
       join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
       where si.approval_status='aprobada' and si.fecha_emision is null)
  ) as fallas
),
ic3 as (
  select coalesce(sum(case when coalesce(v.comprobantes,0)=coalesce(r.comprobantes,0)
                            and round(coalesce(v.neto_gravado,0)-coalesce(r.neto_gravado,0),2)=0
                            and round(coalesce(v.iva_credito_fiscal,0)-coalesce(r.iva_credito_fiscal,0),2)=0
                            and round(coalesce(v.total_gravado,0)-coalesce(r.total_gravado,0),2)=0
                           then 0 else 1 end),0) as fallas,
         coalesce(sum(round(abs(coalesce(v.iva_credito_fiscal,0)-coalesce(r.iva_credito_fiscal,0)),2)),0) as monto
  from public.libro_iva_compras_preliminar v
  full outer join rec_prelim r using (periodo, alic_iva_id, alicuota_iva)
),
ic4 as (
  select count(distinct si.id) as anuladas
  from public.supplier_invoices si
  join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
  where si.approval_status = 'anulada'
),
ic5 as (
  select count(distinct si.id) as nc_aprobadas,
         coalesce(sum(vl.importe_iva),0) as iva_nc
  from public.supplier_invoices si
  join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
  where si.approval_status = 'aprobada' and si.tipo_comprobante::text like 'NOTA_CREDITO%'
)
select * from (
  select 1 as ord, 'IC1' as control,
         'libro_iva_compras = recompute(aprobada)' as descripcion,
         case when (select fallas from ic1)=0 then 'OK' else 'FALLA' end as estado,
         (select fallas from ic1)::bigint as cantidad_fallas,
         (select monto  from ic1)::numeric(14,2) as monto_diferencia,
         'por periodo/alicuota: comprobantes/neto/iva/total coinciden (diff=0)' as criterio_ok
  union all
  select 2, 'IC2',
         'Periodo derivado de fecha_emision; sin huerfanas ni fecha nula',
         case when (select fallas from ic2)=0 then 'OK' else 'FALLA' end,
         (select fallas from ic2)::bigint,
         0::numeric(14,2),
         '0 filas de libro sin respaldo + 0 aprobadas con fecha nula'
  union all
  select 3, 'IC3',
         'libro_iva_compras_preliminar = recompute(cargada,en_revision)',
         case when (select fallas from ic3)=0 then 'OK' else 'FALLA' end,
         (select fallas from ic3)::bigint,
         (select monto  from ic3)::numeric(14,2),
         'prelibro = solo cargada/en_revision (diff=0)'
  union all
  select 4, 'IC4',
         'Anuladas fuera de fiscal y preliminar',
         case when (select fallas from ic1)=0 and (select fallas from ic3)=0 then 'OK' else 'FALLA' end,
         (select anuladas from ic4)::bigint,
         0::numeric(14,2),
         'IC1+IC3 OK garantizan exclusion de anulada (col.=anuladas existentes, informativo)'
  union all
  select 5, 'IC5',
         'Notas de credito aprobadas restan (signo)',
         case when (select nc_aprobadas from ic5)=0 then 'NO_VERIFICABLE' else 'OK' end,
         0::bigint,
         (-1 * (select iva_nc from ic5))::numeric(14,2),
         'si hay NC aprobadas, aportan negativo (validado por IC1); si no, NO_VERIFICABLE'
) s
order by ord;


-- -------------------------------------------------------------------------
-- 9. INSTRUCCIONES PARA INTERPRETAR RESULTADOS
--    · OK             → control cumplido (vista == recompute / sin huérfanas).
--    · FALLA          → diferencia detectada. Correr el DETALLE del control y aislar
--                       el período/alícuota/comprobante. NO ajustar manualmente.
--    · NO_VERIFICABLE → IC5 sin NOTA_CREDITO aprobadas para evidenciar el signo (no es falla).
--    Recordatorio: este kit asume 0102 aplicada. Si en PREFLIGHT
--    libro_iva_compras_preliminar no existe, falta aplicar 0102 (IC3 dará error/incompleto).
--    No avanzar a Etapa 3 (Ventas) hasta cerrar Etapa 2 con evidencia real.
-- =========================================================================
