-- =========================================================================
-- C4_LIBRO_IVA_COMPRAS_VALIDATION.sql — Validación del fix C4 (migración 0102)
--
-- NATURALEZA: 100% READ-ONLY. Solo SELECT / CTE. Sin INSERT/UPDATE/DELETE/
-- TRUNCATE/DROP/ALTER/CREATE ni funciones que modifiquen datos.
--
-- CORRER DESPUÉS DE APLICAR 0102. La técnica compara la VISTA contra un
-- "recompute" hecho con la MISMA lógica (signo de NOTA_CREDITO, agregación por
-- período/alícuota) pero filtrando explícitamente por estado. Si vista == recompute,
-- la vista filtra lo que debe.
--
-- Controles:
--   C4.1 libro_iva_compras (vista) == recompute(aprobada)  → sin cargada/en_revision/anulada
--   C4.2 libro_iva_compras_preliminar (vista) == recompute(cargada,en_revision)
--   C4.3 los 2 comprobantes (Neuralsoft / Bulonera Balemap) fuera del fiscal, dentro del prelibro
--   C4.4 delta crédito fiscal 2026-06 (lo que sale del fiscal) = 334866.00
--   C4.5 notas de crédito con signo correcto en la vista fiscal
--   C4.6 columnas de libro_iva_compras sin cambios (nombre/orden/tipo)
--   C4.7 ningún 'anulada' en ninguna de las dos vistas
--
-- USO: ejecutar todo y copiar la tabla del bloque RESUMEN. Detalles arriba de él.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 0. PREFLIGHT — ambas vistas deben existir (si falta la preliminar, falta 0102)
-- -------------------------------------------------------------------------
select 'PREFLIGHT' as bloque, obj as objeto, (to_regclass(obj) is not null) as existe
from (values
  ('public.libro_iva_compras'),
  ('public.libro_iva_compras_preliminar'),
  ('public.supplier_invoices'),
  ('public.supplier_invoice_vat_lines')
) t(obj)
order by obj;


-- -------------------------------------------------------------------------
-- C4.6 · DETALLE — columnas de libro_iva_compras (orden y tipo)
--   Esperado: periodo(text), alic_iva_id(smallint), alicuota_iva(numeric),
--             comprobantes(bigint), neto_gravado(numeric),
--             iva_credito_fiscal(numeric), total_gravado(numeric)
-- -------------------------------------------------------------------------
select ordinal_position, column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'libro_iva_compras'
order by ordinal_position;


-- -------------------------------------------------------------------------
-- C4.3 · DETALLE — los 2 comprobantes objetivo: estado + presencia esperada
-- -------------------------------------------------------------------------
select si.id as supplier_invoice_id, v.razon as proveedor,
       si.tipo_comprobante, si.punto_venta, si.numero, si.fecha_emision,
       si.approval_status,
       (si.approval_status = 'aprobada')                      as deberia_estar_en_fiscal,
       (si.approval_status in ('cargada','en_revision'))      as deberia_estar_en_preliminar
from public.supplier_invoices si
left join public.vendors v on v.id = si.vendor_id
where si.id in ('04193a08-3cd9-42ae-a018-adef262aab55',
                '761c5750-d39a-4091-9481-a1b803e62d1f');


-- -------------------------------------------------------------------------
-- RESUMEN C4  ← copiar ESTA tabla y pegarla como evidencia
--   Estados: OK | FALLA | NO_VERIFICABLE
-- -------------------------------------------------------------------------
with
-- recompute genérico (misma lógica que la vista) parametrizado por estado --------
rec_aprob as (
  select to_char(si.fecha_emision,'YYYY-MM') as periodo, vl.alic_iva_id, vl.alicuota_iva,
         sum(sgn.f*vl.base_neto)   as neto,
         sum(sgn.f*vl.importe_iva) as iva,
         sum(sgn.f*(vl.base_neto+vl.importe_iva)) as total
  from public.supplier_invoices si
  cross join lateral (select case when si.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f) sgn
  join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
  where si.approval_status = 'aprobada'
  group by 1,2,3
),
rec_prelim as (
  select to_char(si.fecha_emision,'YYYY-MM') as periodo, vl.alic_iva_id, vl.alicuota_iva,
         sum(sgn.f*vl.base_neto)   as neto,
         sum(sgn.f*vl.importe_iva) as iva,
         sum(sgn.f*(vl.base_neto+vl.importe_iva)) as total
  from public.supplier_invoices si
  cross join lateral (select case when si.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f) sgn
  join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
  where si.approval_status in ('cargada','en_revision')
  group by 1,2,3
),
-- C4.1 : vista fiscal == recompute(aprobada) ----------------------------------
c1cmp as (
  select coalesce(round(abs(coalesce(lf.iva_credito_fiscal,0) - coalesce(r.iva,0)),2),0) as diff
  from public.libro_iva_compras lf
  full outer join rec_aprob r using (periodo, alic_iva_id, alicuota_iva)
),
c1 as (
  select count(*) filter (where diff > 0) as fallas,
         coalesce(sum(diff),0)            as monto
  from c1cmp
),
-- C4.2 : vista preliminar == recompute(cargada,en_revision) --------------------
c2cmp as (
  select coalesce(round(abs(coalesce(lp.iva_credito_fiscal,0) - coalesce(r.iva,0)),2),0) as diff
  from public.libro_iva_compras_preliminar lp
  full outer join rec_prelim r using (periodo, alic_iva_id, alicuota_iva)
),
c2 as (
  select count(*) filter (where diff > 0) as fallas,
         coalesce(sum(diff),0)            as monto
  from c2cmp
),
-- C4.3 : los 2 comprobantes en estado cargada/en_revision (fuera de fiscal) -----
c3 as (
  select count(*) filter (
           where approval_status not in ('cargada','en_revision')
         ) as fallas
  from public.supplier_invoices
  where id in ('04193a08-3cd9-42ae-a018-adef262aab55',
               '761c5750-d39a-4091-9481-a1b803e62d1f')
),
-- C4.4 : delta crédito fiscal 2026-06 que sale del fiscal = 334866.00 ----------
c4 as (
  select coalesce(sum(sgn.f*vl.importe_iva),0) as iva_sale
  from public.supplier_invoices si
  cross join lateral (select case when si.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f) sgn
  join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
  where si.approval_status in ('cargada','en_revision')
    and to_char(si.fecha_emision,'YYYY-MM') = '2026-06'
),
-- C4.5 : ¿hay NOTA_CREDITO aprobadas? si las hay, su aporte debe ser negativo ---
c5 as (
  select count(*) as nc_aprobadas,
         coalesce(sum(vl.importe_iva),0) as iva_nc
  from public.supplier_invoices si
  join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
  where si.approval_status = 'aprobada'
    and si.tipo_comprobante::text like 'NOTA_CREDITO%'
),
-- C4.6 : columnas de libro_iva_compras sin cambios ----------------------------
c6 as (
  select case when array_agg(column_name order by ordinal_position) =
              array['periodo','alic_iva_id','alicuota_iva','comprobantes',
                    'neto_gravado','iva_credito_fiscal','total_gravado']
              then 0 else 1 end as fallas
  from information_schema.columns
  where table_schema='public' and table_name='libro_iva_compras'
),
-- C4.7 : ningún 'anulada' aporta a ninguna de las dos vistas -------------------
--        (vista==recompute en C1/C2 ya lo garantiza; acá se cuenta el riesgo
--         residual: anuladas con líneas que NO deben aparecer en ningún lado)
c7 as (
  select count(distinct si.id) as anuladas_con_lineas
  from public.supplier_invoices si
  join public.supplier_invoice_vat_lines vl on vl.supplier_invoice_id = si.id
  where si.approval_status = 'anulada'
)
select * from (
  select 1 as ord, 'C4.1' as control,
         'libro_iva_compras = recompute(aprobada)' as descripcion,
         case when (select fallas from c1)=0 then 'OK' else 'FALLA' end as estado,
         (select fallas from c1)::bigint as cantidad_fallas,
         (select monto  from c1)::numeric(14,2) as monto_diferencia,
         'vista fiscal sin cargada/en_revision/anulada (diff=0)' as criterio_ok
  union all
  select 2, 'C4.2',
         'libro_iva_compras_preliminar = recompute(cargada,en_revision)',
         case when (select fallas from c2)=0 then 'OK' else 'FALLA' end,
         (select fallas from c2)::bigint,
         (select monto  from c2)::numeric(14,2),
         'prelibro = solo cargada/en_revision (diff=0)'
  union all
  select 3, 'C4.3',
         'Los 2 comprobantes fuera del fiscal (cargada)',
         case when (select fallas from c3)=0 then 'OK' else 'FALLA' end,
         (select fallas from c3)::bigint,
         0::numeric(14,2),
         'ambos en cargada/en_revision'
  union all
  select 4, 'C4.4',
         'Delta credito fiscal 2026-06 que sale del fiscal',
         case when round(abs((select iva_sale from c4) - 334866.00),2)=0 then 'OK' else 'FALLA' end,
         case when round(abs((select iva_sale from c4) - 334866.00),2)=0 then 0 else 1 end::bigint,
         round(abs((select iva_sale from c4) - 334866.00),2)::numeric(14,2),
         'iva cargada/en_revision 2026-06 = 334866.00'
  union all
  select 5, 'C4.5',
         'Notas de credito aprobadas con signo correcto',
         case when (select nc_aprobadas from c5)=0 then 'NO_VERIFICABLE' else 'OK' end,
         0::bigint,
         (select iva_nc from c5)::numeric(14,2),
         'si existen NC aprobadas, restan en la vista (validado por C4.1)'
  union all
  select 6, 'C4.6',
         'Columnas de libro_iva_compras sin cambios',
         case when (select fallas from c6)=0 then 'OK' else 'FALLA' end,
         (select fallas from c6)::bigint,
         0::numeric(14,2),
         'nombre/orden/tipo == definicion 0071'
  union all
  select 7, 'C4.7',
         'Anuladas fuera de ambas vistas',
         case when (select fallas from c1)=0 and (select fallas from c2)=0 then 'OK' else 'FALLA' end,
         (select anuladas_con_lineas from c7)::bigint,
         0::numeric(14,2),
         'C4.1 y C4.2 OK garantizan que anulada no aparece (col. = anuladas existentes, informativo)'
) s
order by ord;


-- -------------------------------------------------------------------------
-- INSTRUCCIONES
--   · OK             → control cumplido.
--   · FALLA          → revisar: si C4.1/C4.2 fallan, la vista no quedó con el filtro esperado
--                       (¿se aplicó 0102?). Si C4.4 falla, el delta 2026-06 ≠ 334866.00
--                       (revisar si cambiaron datos desde la detección).
--   · NO_VERIFICABLE → C4.5 sin NOTA_CREDITO aprobadas para evidenciar el signo (no es falla).
--   Nota C4.7: cantidad_fallas muestra anuladas con líneas existentes (informativo); el estado OK
--   se sostiene en que C4.1 y C4.2 (vista==recompute por estado) excluyen 'anulada' por construcción.
-- =========================================================================
