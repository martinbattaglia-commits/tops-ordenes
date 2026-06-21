-- =========================================================================
-- AUDIT_ETAPA4_IVA_VENTAS.sql — Auditoría funcional · Etapa 4 (IVA Ventas)
--
-- NATURALEZA: 100% READ-ONLY. Solo SELECT / CTE. Sin INSERT/UPDATE/DELETE/
-- TRUNCATE/DROP/ALTER/CREATE ni funciones que modifiquen datos.
--
-- Verifica que libro_iva_ventas cuadre contra customer_invoices fiscalmente
-- válidas + sus líneas IVA, por período y alícuota, con ambiente vigente y
-- signo de notas de crédito.
--
-- Objetos reales (verificados):
--   customer_invoices(estado_arca, cae, anulada, ambiente, periodo, created_at,
--     tipo_comprobante, ...)
--   customer_invoice_vat_lines(invoice_id, alic_iva_id, alicuota_iva,
--     neto_gravado, iva_importe)
--   libro_iva_ventas (vista 0073): periodo=coalesce(ci.periodo,
--     to_char(created_at,'YYYY-MM')); filtra estado_arca='AUTORIZADO_ARCA'
--     AND anulada=false AND ambiente=public.fiscal_ambiente(); signo NC por
--     tipo_comprobante like 'NOTA_CREDITO%'. Columnas: periodo, alic_iva_id,
--     alicuota_iva, comprobantes, neto_gravado, iva_debito_fiscal, total_gravado.
--   fiscal_ambiente() -> arca_ambiente_t (fiscal_config.id=1).
--
-- "Recompute fiscal" = customer_invoices con:
--   estado_arca='AUTORIZADO_ARCA' AND cae no nulo AND anulada=false
--   AND ambiente=public.fiscal_ambiente(), con signo NC, agregado por
--   período/alícuota (idéntica lógica a la vista, + chequeo explícito de CAE).
--
-- Controles:
--   IV1 libro_iva_ventas == recompute fiscal (comprobantes/neto/iva/total)
--   IV2 débito fiscal por alícuota: líneas autorizadas == libro
--   IV3 facturas no autorizadas / sin CAE / anuladas fuera del libro
--   IV4 notas de crédito de venta restan (signo) — NO_VERIFICABLE si no hay
--   IV5 ambiente fiscal vigente — sin mezcla de ambientes
--
-- USO: ejecutar todo y copiar PREFLIGHT + RESUMEN ETAPA 4. Detalles arriba del resumen.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 2. PREFLIGHT — existencia de objetos (incluye la función de ambiente)
-- -------------------------------------------------------------------------
select 'PREFLIGHT' as bloque, obj as objeto, existe from (
  select 'public.customer_invoices'          as obj, (to_regclass('public.customer_invoices') is not null) as existe
  union all select 'public.customer_invoice_vat_lines', (to_regclass('public.customer_invoice_vat_lines') is not null)
  union all select 'public.libro_iva_ventas',           (to_regclass('public.libro_iva_ventas') is not null)
  union all select 'public.fiscal_ambiente()',          (to_regprocedure('public.fiscal_ambiente()') is not null)
) s
order by obj;


-- -------------------------------------------------------------------------
-- 3. IV1 — libro_iva_ventas == recompute fiscal  (por período/alícuota)
-- -------------------------------------------------------------------------

-- 3.a IV1 · DETALLE (manual vs libro + diferencias)
with rec as (
  select coalesce(ci.periodo, to_char(ci.created_at,'YYYY-MM')) as periodo,
         vl.alic_iva_id, vl.alicuota_iva,
         count(distinct ci.id)                       as comprobantes,
         sum(sgn.f*vl.neto_gravado)                  as neto_gravado,
         sum(sgn.f*vl.iva_importe)                   as iva_debito_fiscal,
         sum(sgn.f*(vl.neto_gravado+vl.iva_importe)) as total_gravado
  from public.customer_invoices ci
  cross join lateral (select case when ci.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f) sgn
  join public.customer_invoice_vat_lines vl on vl.invoice_id = ci.id
  where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
    and ci.cae is not null and btrim(ci.cae) <> ''
    and ci.ambiente = public.fiscal_ambiente()
  group by 1,2,3
)
select coalesce(v.periodo, r.periodo)           as periodo,
       coalesce(v.alic_iva_id, r.alic_iva_id)   as alic_iva_id,
       coalesce(v.alicuota_iva, r.alicuota_iva) as alicuota_iva,
       r.comprobantes       as manual_comprobantes,
       v.comprobantes       as libro_comprobantes,
       r.neto_gravado       as manual_neto,
       v.neto_gravado       as libro_neto,
       r.iva_debito_fiscal  as manual_iva,
       v.iva_debito_fiscal  as libro_iva,
       r.total_gravado      as manual_total,
       v.total_gravado      as libro_total,
       (coalesce(v.comprobantes,0)-coalesce(r.comprobantes,0))               as dif_comprobantes,
       round(coalesce(v.neto_gravado,0)-coalesce(r.neto_gravado,0),2)         as dif_neto,
       round(coalesce(v.iva_debito_fiscal,0)-coalesce(r.iva_debito_fiscal,0),2) as dif_iva,
       round(coalesce(v.total_gravado,0)-coalesce(r.total_gravado,0),2)       as dif_total,
       case when coalesce(v.comprobantes,0)=coalesce(r.comprobantes,0)
             and round(coalesce(v.neto_gravado,0)-coalesce(r.neto_gravado,0),2)=0
             and round(coalesce(v.iva_debito_fiscal,0)-coalesce(r.iva_debito_fiscal,0),2)=0
             and round(coalesce(v.total_gravado,0)-coalesce(r.total_gravado,0),2)=0
            then 'OK' else 'FALLA' end as estado
from public.libro_iva_ventas v
full outer join rec r using (periodo, alic_iva_id, alicuota_iva)
order by periodo, alic_iva_id;

-- 3.b IV1 · RESUMEN
with rec as (
  select coalesce(ci.periodo, to_char(ci.created_at,'YYYY-MM')) as periodo,
         vl.alic_iva_id, vl.alicuota_iva,
         count(distinct ci.id) as comprobantes,
         sum(sgn.f*vl.neto_gravado) as neto_gravado,
         sum(sgn.f*vl.iva_importe) as iva_debito_fiscal,
         sum(sgn.f*(vl.neto_gravado+vl.iva_importe)) as total_gravado
  from public.customer_invoices ci
  cross join lateral (select case when ci.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f) sgn
  join public.customer_invoice_vat_lines vl on vl.invoice_id = ci.id
  where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
    and ci.cae is not null and btrim(ci.cae) <> ''
    and ci.ambiente = public.fiscal_ambiente()
  group by 1,2,3
),
cmp as (
  select case when coalesce(v.comprobantes,0)=coalesce(r.comprobantes,0)
               and round(coalesce(v.neto_gravado,0)-coalesce(r.neto_gravado,0),2)=0
               and round(coalesce(v.iva_debito_fiscal,0)-coalesce(r.iva_debito_fiscal,0),2)=0
               and round(coalesce(v.total_gravado,0)-coalesce(r.total_gravado,0),2)=0
              then 0 else 1 end as falla,
         round(abs(coalesce(v.iva_debito_fiscal,0)-coalesce(r.iva_debito_fiscal,0)),2) as dif_iva
  from public.libro_iva_ventas v
  full outer join rec r using (periodo, alic_iva_id, alicuota_iva)
)
select 'IV1' as control,
       count(*)               as filas_periodo_alicuota,
       coalesce(sum(falla),0) as cantidad_fallas,
       coalesce(sum(dif_iva),0) as monto_diferencia
from cmp;


-- -------------------------------------------------------------------------
-- 4. IV2 — Débito fiscal por alícuota: líneas autorizadas == libro
-- -------------------------------------------------------------------------

-- 4.a IV2 · DETALLE (por alícuota, todos los períodos)
with rec as (
  select vl.alic_iva_id, vl.alicuota_iva,
         sum(sgn.f*vl.iva_importe) as iva_debito_manual
  from public.customer_invoices ci
  cross join lateral (select case when ci.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f) sgn
  join public.customer_invoice_vat_lines vl on vl.invoice_id = ci.id
  where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
    and ci.cae is not null and btrim(ci.cae) <> ''
    and ci.ambiente = public.fiscal_ambiente()
  group by 1,2
),
lib as (
  select alic_iva_id, alicuota_iva, sum(iva_debito_fiscal) as iva_debito_libro
  from public.libro_iva_ventas
  group by 1,2
)
select coalesce(l.alic_iva_id, r.alic_iva_id)   as alic_iva_id,
       coalesce(l.alicuota_iva, r.alicuota_iva) as alicuota_iva,
       r.iva_debito_manual, l.iva_debito_libro,
       round(coalesce(l.iva_debito_libro,0)-coalesce(r.iva_debito_manual,0),2) as diferencia,
       case when round(coalesce(l.iva_debito_libro,0)-coalesce(r.iva_debito_manual,0),2)=0
            then 'OK' else 'FALLA' end as estado
from lib l
full outer join rec r using (alic_iva_id, alicuota_iva)
order by alic_iva_id;

-- 4.b IV2 · RESUMEN
with rec as (
  select vl.alic_iva_id, vl.alicuota_iva, sum(sgn.f*vl.iva_importe) as iva_manual
  from public.customer_invoices ci
  cross join lateral (select case when ci.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f) sgn
  join public.customer_invoice_vat_lines vl on vl.invoice_id = ci.id
  where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
    and ci.cae is not null and btrim(ci.cae) <> ''
    and ci.ambiente = public.fiscal_ambiente()
  group by 1,2
),
lib as (
  select alic_iva_id, alicuota_iva, sum(iva_debito_fiscal) as iva_libro
  from public.libro_iva_ventas group by 1,2
),
cmp as (
  select round(abs(coalesce(l.iva_libro,0)-coalesce(r.iva_manual,0)),2) as dif
  from lib l full outer join rec r using (alic_iva_id, alicuota_iva)
)
select 'IV2' as control,
       count(*)                                as alicuotas,
       coalesce(sum(case when dif>0 then 1 else 0 end),0) as cantidad_fallas,
       coalesce(sum(dif),0)                    as monto_diferencia
from cmp;


-- -------------------------------------------------------------------------
-- 5. IV3 — Facturas no autorizadas / sin CAE / anuladas fuera del libro
--    El libro==recompute fiscal (IV1) garantiza la exclusión. Acá se listan e
--    informan las excluidas, y se confirma que no aportan al libro.
-- -------------------------------------------------------------------------

-- 5.a IV3 · DETALLE (comprobantes con líneas IVA que NO son fiscalmente válidos)
select ci.id, ci.numero_comprobante, ci.razon_social, ci.tipo_comprobante,
       ci.estado_arca, ci.cae, ci.anulada, ci.ambiente,
       coalesce(ci.periodo, to_char(ci.created_at,'YYYY-MM')) as periodo,
       case
         when ci.anulada then 'anulada=true'
         when ci.estado_arca <> 'AUTORIZADO_ARCA' then 'estado='||ci.estado_arca::text
         when ci.cae is null or btrim(ci.cae)='' then 'cae nulo'
         when ci.ambiente <> public.fiscal_ambiente() then 'otro ambiente'
         else 'revisar'
       end as motivo_exclusion
from public.customer_invoices ci
join public.customer_invoice_vat_lines vl on vl.invoice_id = ci.id
where not (ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
           and ci.cae is not null and btrim(ci.cae) <> ''
           and ci.ambiente = public.fiscal_ambiente())
group by ci.id, ci.numero_comprobante, ci.razon_social, ci.tipo_comprobante,
         ci.estado_arca, ci.cae, ci.anulada, ci.ambiente, ci.periodo, ci.created_at
order by motivo_exclusion, ci.created_at desc;

-- 5.b IV3 · RESUMEN (fallas = filas del libro que exceden el recompute fiscal = leak)
with rec as (
  select coalesce(ci.periodo, to_char(ci.created_at,'YYYY-MM')) as periodo,
         vl.alic_iva_id, vl.alicuota_iva,
         sum(sgn.f*vl.iva_importe) as iva_debito_fiscal
  from public.customer_invoices ci
  cross join lateral (select case when ci.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f) sgn
  join public.customer_invoice_vat_lines vl on vl.invoice_id = ci.id
  where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
    and ci.cae is not null and btrim(ci.cae) <> ''
    and ci.ambiente = public.fiscal_ambiente()
  group by 1,2,3
),
leak as (
  select coalesce(sum(case when round(coalesce(v.iva_debito_fiscal,0)-coalesce(r.iva_debito_fiscal,0),2)<>0
                           then 1 else 0 end),0) as fallas
  from public.libro_iva_ventas v
  full outer join rec r using (periodo, alic_iva_id, alicuota_iva)
),
excluidas as (
  select count(distinct ci.id) as n
  from public.customer_invoices ci
  join public.customer_invoice_vat_lines vl on vl.invoice_id = ci.id
  where not (ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
             and ci.cae is not null and btrim(ci.cae) <> ''
             and ci.ambiente = public.fiscal_ambiente())
)
select 'IV3' as control,
       (select n from excluidas)  as comprobantes_no_fiscales_con_lineas,
       (select fallas from leak)  as cantidad_fallas;


-- -------------------------------------------------------------------------
-- 6. IV4 — Notas de crédito de venta con signo correcto
-- -------------------------------------------------------------------------

-- 6.a IV4 · DETALLE (NC autorizadas y su aporte con signo)
select ci.id, ci.numero_comprobante, ci.razon_social, ci.tipo_comprobante,
       coalesce(ci.periodo, to_char(ci.created_at,'YYYY-MM')) as periodo,
       sum(vl.neto_gravado)      as neto_lineas_positivo,
       sum(vl.iva_importe)       as iva_lineas_positivo,
       -1 * sum(vl.neto_gravado) as aporte_neto_al_libro,
       -1 * sum(vl.iva_importe)  as aporte_iva_al_libro
from public.customer_invoices ci
join public.customer_invoice_vat_lines vl on vl.invoice_id = ci.id
where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
  and ci.cae is not null and btrim(ci.cae) <> ''
  and ci.ambiente = public.fiscal_ambiente()
  and ci.tipo_comprobante::text like 'NOTA_CREDITO%'
group by ci.id, ci.numero_comprobante, ci.razon_social, ci.tipo_comprobante, ci.periodo, ci.created_at
order by periodo desc;

-- 6.b IV4 · RESUMEN
with nc as (
  select count(distinct ci.id) as nc_autorizadas,
         coalesce(sum(vl.iva_importe),0)  as iva_nc_positivo,
         coalesce(sum(vl.neto_gravado),0) as neto_nc_positivo
  from public.customer_invoices ci
  join public.customer_invoice_vat_lines vl on vl.invoice_id = ci.id
  where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
    and ci.cae is not null and btrim(ci.cae) <> ''
    and ci.ambiente = public.fiscal_ambiente()
    and ci.tipo_comprobante::text like 'NOTA_CREDITO%'
)
select 'IV4' as control,
       nc_autorizadas,
       (-1 * neto_nc_positivo) as aporte_neto_al_libro,
       (-1 * iva_nc_positivo)  as aporte_iva_al_libro,
       case when nc_autorizadas = 0 then 'NO_VERIFICABLE' else 'OK' end as estado
from nc;


-- -------------------------------------------------------------------------
-- 7. IV5 — Ambiente fiscal vigente (sin mezcla de ambientes)
-- -------------------------------------------------------------------------

-- 7.a IV5 · DETALLE (ambiente vigente + autorizadas en OTROS ambientes, excluidas)
select public.fiscal_ambiente()::text as ambiente_vigente,
       ci.ambiente::text              as ambiente_factura,
       count(distinct ci.id)          as comprobantes_autorizados_excluidos
from public.customer_invoices ci
join public.customer_invoice_vat_lines vl on vl.invoice_id = ci.id
where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
  and ci.ambiente <> public.fiscal_ambiente()
group by ci.ambiente
order by ci.ambiente;

-- 7.b IV5 · RESUMEN
with otros as (
  select count(distinct ci.id) as n
  from public.customer_invoices ci
  join public.customer_invoice_vat_lines vl on vl.invoice_id = ci.id
  where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
    and ci.ambiente <> public.fiscal_ambiente()
)
select 'IV5' as control,
       public.fiscal_ambiente()::text as ambiente_vigente,
       (select n from otros)          as autorizadas_otros_ambientes_excluidas,
       case when public.fiscal_ambiente() is null then 'NO_VERIFICABLE' else 'OK' end as estado;


-- -------------------------------------------------------------------------
-- 8. RESUMEN ETAPA 4  ← copiar ESTA tabla y pegarla como evidencia
--    Estados: OK | FALLA | NO_VERIFICABLE
-- -------------------------------------------------------------------------
with
rec as (
  select coalesce(ci.periodo, to_char(ci.created_at,'YYYY-MM')) as periodo,
         vl.alic_iva_id, vl.alicuota_iva,
         count(distinct ci.id) as comprobantes,
         sum(sgn.f*vl.neto_gravado) as neto_gravado,
         sum(sgn.f*vl.iva_importe) as iva_debito_fiscal,
         sum(sgn.f*(vl.neto_gravado+vl.iva_importe)) as total_gravado
  from public.customer_invoices ci
  cross join lateral (select case when ci.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f) sgn
  join public.customer_invoice_vat_lines vl on vl.invoice_id = ci.id
  where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
    and ci.cae is not null and btrim(ci.cae) <> ''
    and ci.ambiente = public.fiscal_ambiente()
  group by 1,2,3
),
iv1 as (
  select coalesce(sum(case when coalesce(v.comprobantes,0)=coalesce(r.comprobantes,0)
                            and round(coalesce(v.neto_gravado,0)-coalesce(r.neto_gravado,0),2)=0
                            and round(coalesce(v.iva_debito_fiscal,0)-coalesce(r.iva_debito_fiscal,0),2)=0
                            and round(coalesce(v.total_gravado,0)-coalesce(r.total_gravado,0),2)=0
                           then 0 else 1 end),0) as fallas,
         coalesce(sum(round(abs(coalesce(v.iva_debito_fiscal,0)-coalesce(r.iva_debito_fiscal,0)),2)),0) as monto
  from public.libro_iva_ventas v
  full outer join rec r using (periodo, alic_iva_id, alicuota_iva)
),
iv2 as (
  select coalesce(sum(case when dif>0 then 1 else 0 end),0) as fallas,
         coalesce(sum(dif),0) as monto
  from (
    select round(abs(coalesce(l.iva_libro,0)-coalesce(rr.iva_manual,0)),2) as dif
    from (select alic_iva_id, alicuota_iva, sum(iva_debito_fiscal) as iva_libro
          from public.libro_iva_ventas group by 1,2) l
    full outer join (
      select vl.alic_iva_id, vl.alicuota_iva, sum(sgn.f*vl.iva_importe) as iva_manual
      from public.customer_invoices ci
      cross join lateral (select case when ci.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f) sgn
      join public.customer_invoice_vat_lines vl on vl.invoice_id = ci.id
      where ci.estado_arca='AUTORIZADO_ARCA' and ci.anulada=false
        and ci.cae is not null and btrim(ci.cae)<>'' and ci.ambiente=public.fiscal_ambiente()
      group by 1,2) rr using (alic_iva_id, alicuota_iva)
  ) q
),
iv3 as (
  select coalesce(sum(case when round(coalesce(v.iva_debito_fiscal,0)-coalesce(r.iva_debito_fiscal,0),2)<>0
                           then 1 else 0 end),0) as fallas
  from public.libro_iva_ventas v
  full outer join rec r using (periodo, alic_iva_id, alicuota_iva)
),
iv4 as (
  select count(distinct ci.id) as nc_autorizadas,
         coalesce(sum(vl.iva_importe),0) as iva_nc
  from public.customer_invoices ci
  join public.customer_invoice_vat_lines vl on vl.invoice_id = ci.id
  where ci.estado_arca='AUTORIZADO_ARCA' and ci.anulada=false
    and ci.cae is not null and btrim(ci.cae)<>'' and ci.ambiente=public.fiscal_ambiente()
    and ci.tipo_comprobante::text like 'NOTA_CREDITO%'
)
select * from (
  select 1 as ord, 'IV1' as control,
         'libro_iva_ventas = recompute fiscal' as descripcion,
         case when (select fallas from iv1)=0 then 'OK' else 'FALLA' end as estado,
         (select fallas from iv1)::bigint as cantidad_fallas,
         (select monto  from iv1)::numeric(15,2) as monto_diferencia,
         'por periodo/alicuota: comprobantes/neto/iva/total (diff=0)' as criterio_ok
  union all
  select 2, 'IV2',
         'Debito fiscal por alicuota: lineas == libro',
         case when (select fallas from iv2)=0 then 'OK' else 'FALLA' end,
         (select fallas from iv2)::bigint,
         (select monto  from iv2)::numeric(15,2),
         'por alicuota: iva_debito coincide (diff=0)'
  union all
  select 3, 'IV3',
         'No autorizadas / sin CAE / anuladas fuera del libro',
         case when (select fallas from iv3)=0 then 'OK' else 'FALLA' end,
         (select fallas from iv3)::bigint,
         0::numeric(15,2),
         'libro==recompute fiscal => sin leak de no-autorizadas'
  union all
  select 4, 'IV4',
         'Notas de credito de venta restan (signo)',
         case when (select nc_autorizadas from iv4)=0 then 'NO_VERIFICABLE' else 'OK' end,
         0::bigint,
         (-1 * (select iva_nc from iv4))::numeric(15,2),
         'si hay NC autorizadas, restan (validado por IV1); si no, NO_VERIFICABLE'
  union all
  select 5, 'IV5',
         'Ambiente fiscal vigente (sin mezcla)',
         case when public.fiscal_ambiente() is null then 'NO_VERIFICABLE' else 'OK' end,
         0::bigint,
         0::numeric(15,2),
         'libro filtra ambiente=fiscal_ambiente(); ver detalle 7.a'
) s
order by ord;


-- -------------------------------------------------------------------------
-- 9. INSTRUCCIONES PARA INTERPRETAR RESULTADOS
--    · OK             → control cumplido (vista == recompute / sin leak).
--    · FALLA          → diferencia. Correr el DETALLE del control y aislar el
--                       período/alícuota/comprobante. NO ajustar manualmente.
--    · NO_VERIFICABLE → IV4 sin NC de venta autorizadas; IV5 sin ambiente vigente.
--    IV3: 'comprobantes_no_fiscales_con_lineas' es informativo (lo que se excluye
--         correctamente); la FALLA real sería un leak (libro > recompute fiscal).
--    IV5: el detalle 7.a lista comprobantes autorizados de OTROS ambientes que el
--         libro excluye (no deben mezclarse). 0 filas = no hay otros ambientes.
--    No avanzar a Etapa 5 (Posición IVA) hasta cerrar Etapa 4 con evidencia real.
-- =========================================================================
