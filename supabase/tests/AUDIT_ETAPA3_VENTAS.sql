-- =========================================================================
-- AUDIT_ETAPA3_VENTAS.sql — Auditoría funcional · Etapa 3 (Ventas / customer_invoices)
--
-- NATURALEZA: 100% READ-ONLY. Solo SELECT / CTE. Sin INSERT/UPDATE/DELETE/
-- TRUNCATE/DROP/ALTER/CREATE ni funciones que modifiquen datos.
--
-- Objetos reales (verificados):
--   customer_invoices(subtotal, importe_no_gravado, importe_exento, iva,
--     percepciones, tributos, total, estado_arca, anulada, cae, punto_venta,
--     numero_comprobante, cbte_tipo_arca, tipo_comprobante, condicion_iva,
--     client_id, periodo, ambiente, created_at)
--   customer_invoice_vat_lines(invoice_id, alic_iva_id, alicuota_iva,
--     neto_gravado, iva_importe)
--   libro_iva_ventas (vista 0073): filtra estado_arca='AUTORIZADO_ARCA'
--     AND anulada=false AND ambiente=public.fiscal_ambiente(); periodo =
--     coalesce(ci.periodo, to_char(created_at,'YYYY-MM')); signo NC por
--     tipo_comprobante like 'NOTA_CREDITO%'. Columnas: periodo, alic_iva_id,
--     alicuota_iva, comprobantes, neto_gravado, iva_debito_fiscal, total_gravado.
--   clients(id, ...)
--   enum invoice_arca_status_t: BORRADOR/PENDIENTE_ARCA/ENVIADO_ARCA/
--     AUTORIZADO_ARCA/RECHAZADO_ARCA/ERROR_ARCA/ANULADO
--   enum condicion_iva_t: RESPONSABLE_INSCRIPTO/MONOTRIBUTO/EXENTO/
--     CONSUMIDOR_FINAL/NO_RESPONSABLE/NO_CATEGORIZADO
--
-- Controles:
--   V1 IVA cabecera vs Σ líneas IVA (autorizadas, no anuladas)
--   V2 total = subtotal + importe_no_gravado + importe_exento + iva + percepciones + tributos
--   V3 solo AUTORIZADO_ARCA con CAE entra al libro (vista == recompute fiscal + cae no nulo)
--   V4 numeración correlativa por (punto_venta, cbte_tipo_arca) en autorizadas
--   V5 coherencia condicion_iva (receptor) vs tipo_comprobante (heurística emisor RI)
--
-- USO: ejecutar todo y copiar PREFLIGHT + RESUMEN ETAPA 3. Detalles arriba del resumen.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 2. PREFLIGHT — existencia de objetos
-- -------------------------------------------------------------------------
select 'PREFLIGHT' as bloque, obj as objeto, (to_regclass(obj) is not null) as existe
from (values
  ('public.customer_invoices'),
  ('public.customer_invoice_vat_lines'),
  ('public.libro_iva_ventas'),
  ('public.clients')
) t(obj)
order by obj;


-- -------------------------------------------------------------------------
-- 3. V1 — IVA cabecera vs Σ líneas IVA  (AUTORIZADO_ARCA, anulada=false)
--    Criterio: customer_invoices.iva = Σ customer_invoice_vat_lines.iva_importe
-- -------------------------------------------------------------------------

-- 3.a V1 · DETALLE (comprobantes con diferencia)
with c as (
  select ci.id, ci.numero_comprobante, ci.razon_social, ci.tipo_comprobante,
         ci.punto_venta, ci.periodo, ci.created_at,
         ci.iva                              as iva_cabecera,
         coalesce(sum(vl.iva_importe), 0)    as iva_lineas
  from public.customer_invoices ci
  left join public.customer_invoice_vat_lines vl on vl.invoice_id = ci.id
  where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
  group by ci.id, ci.numero_comprobante, ci.razon_social, ci.tipo_comprobante,
           ci.punto_venta, ci.periodo, ci.created_at, ci.iva
)
select id, numero_comprobante, razon_social, tipo_comprobante, punto_venta,
       coalesce(periodo, to_char(created_at,'YYYY-MM')) as periodo,
       iva_cabecera, iva_lineas,
       round(iva_cabecera - iva_lineas, 2) as diferencia
from c
where round(abs(iva_cabecera - iva_lineas), 2) > 0
order by abs(iva_cabecera - iva_lineas) desc;

-- 3.b V1 · RESUMEN
with c as (
  select ci.id, ci.iva as iva_cabecera, coalesce(sum(vl.iva_importe),0) as iva_lineas
  from public.customer_invoices ci
  left join public.customer_invoice_vat_lines vl on vl.invoice_id = ci.id
  where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
  group by ci.id, ci.iva
)
select 'V1' as control,
       count(*)                                                            as total_auditados,
       count(*) filter (where round(abs(iva_cabecera-iva_lineas),2)=0)     as cantidad_ok,
       count(*) filter (where round(abs(iva_cabecera-iva_lineas),2)>0)     as cantidad_diferencia,
       coalesce(sum(round(abs(iva_cabecera-iva_lineas),2))
                filter (where round(abs(iva_cabecera-iva_lineas),2)>0),0)  as monto_total_diferencia
from c;


-- -------------------------------------------------------------------------
-- 4. V2 — total = subtotal + importe_no_gravado + importe_exento + iva
--                 + percepciones + tributos   (todas las facturas)
--    Nota: el modelo real incluye 'tributos' además de 'percepciones'; se suma.
-- -------------------------------------------------------------------------

-- 4.a V2 · DETALLE (comprobantes con diferencia)
select ci.id, ci.numero_comprobante, ci.razon_social, ci.tipo_comprobante,
       ci.estado_arca,
       ci.subtotal, ci.importe_no_gravado, ci.importe_exento, ci.iva,
       ci.percepciones, ci.tributos, ci.total,
       round(ci.total - (ci.subtotal + ci.importe_no_gravado + ci.importe_exento
                         + ci.iva + ci.percepciones + ci.tributos), 2) as diferencia
from public.customer_invoices ci
where round(ci.total - (ci.subtotal + ci.importe_no_gravado + ci.importe_exento
                       + ci.iva + ci.percepciones + ci.tributos), 2) <> 0
order by abs(ci.total - (ci.subtotal + ci.importe_no_gravado + ci.importe_exento
                        + ci.iva + ci.percepciones + ci.tributos)) desc;

-- 4.b V2 · RESUMEN
with c as (
  select round(total - (subtotal + importe_no_gravado + importe_exento
                        + iva + percepciones + tributos), 2) as diferencia
  from public.customer_invoices
)
select 'V2' as control,
       count(*)                                            as total_auditados,
       count(*) filter (where diferencia = 0)              as cantidad_ok,
       count(*) filter (where diferencia <> 0)             as cantidad_diferencia,
       coalesce(sum(abs(diferencia)) filter (where diferencia <> 0),0) as monto_total_diferencia
from c;


-- -------------------------------------------------------------------------
-- 5. V3 — Solo AUTORIZADO_ARCA con CAE entra al libro IVA Ventas
--    libro_iva_ventas == recompute(AUTORIZADO_ARCA, anulada=false,
--    ambiente vigente) + chequeo de autorizadas sin CAE.
-- -------------------------------------------------------------------------

-- 5.a V3 · DETALLE-1 (vista vs recompute por período/alícuota)
with rec as (
  select coalesce(ci.periodo, to_char(ci.created_at,'YYYY-MM')) as periodo,
         vl.alic_iva_id, vl.alicuota_iva,
         count(distinct ci.id)                          as comprobantes,
         sum(sgn.f*vl.neto_gravado)                     as neto_gravado,
         sum(sgn.f*vl.iva_importe)                      as iva_debito_fiscal,
         sum(sgn.f*(vl.neto_gravado+vl.iva_importe))    as total_gravado
  from public.customer_invoices ci
  cross join lateral (select case when ci.tipo_comprobante::text like 'NOTA_CREDITO%' then -1 else 1 end as f) sgn
  join public.customer_invoice_vat_lines vl on vl.invoice_id = ci.id
  where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
    and ci.ambiente = public.fiscal_ambiente()
  group by 1,2,3
)
select coalesce(v.periodo, r.periodo)           as periodo,
       coalesce(v.alic_iva_id, r.alic_iva_id)   as alic_iva_id,
       coalesce(v.alicuota_iva, r.alicuota_iva) as alicuota_iva,
       r.iva_debito_fiscal  as manual_iva,
       v.iva_debito_fiscal  as libro_iva,
       round(coalesce(v.iva_debito_fiscal,0)-coalesce(r.iva_debito_fiscal,0),2) as dif_iva,
       case when coalesce(v.comprobantes,0)=coalesce(r.comprobantes,0)
             and round(coalesce(v.neto_gravado,0)-coalesce(r.neto_gravado,0),2)=0
             and round(coalesce(v.iva_debito_fiscal,0)-coalesce(r.iva_debito_fiscal,0),2)=0
             and round(coalesce(v.total_gravado,0)-coalesce(r.total_gravado,0),2)=0
            then 'OK' else 'FALLA' end as estado
from public.libro_iva_ventas v
full outer join rec r using (periodo, alic_iva_id, alicuota_iva)
order by periodo, alic_iva_id;

-- 5.b V3 · DETALLE-2 (autorizadas del ambiente vigente SIN CAE — no deberían existir)
select ci.id, ci.numero_comprobante, ci.razon_social, ci.tipo_comprobante,
       ci.punto_venta, ci.estado_arca, ci.cae, ci.ambiente,
       coalesce(ci.periodo, to_char(ci.created_at,'YYYY-MM')) as periodo
from public.customer_invoices ci
where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
  and ci.ambiente = public.fiscal_ambiente()
  and (ci.cae is null or btrim(ci.cae) = '')
order by ci.created_at desc;

-- 5.c V3 · RESUMEN
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
    and ci.ambiente = public.fiscal_ambiente()
  group by 1,2,3
),
mismatch as (
  select coalesce(sum(case when coalesce(v.comprobantes,0)=coalesce(r.comprobantes,0)
                            and round(coalesce(v.neto_gravado,0)-coalesce(r.neto_gravado,0),2)=0
                            and round(coalesce(v.iva_debito_fiscal,0)-coalesce(r.iva_debito_fiscal,0),2)=0
                            and round(coalesce(v.total_gravado,0)-coalesce(r.total_gravado,0),2)=0
                           then 0 else 1 end),0) as fallas
  from public.libro_iva_ventas v
  full outer join rec r using (periodo, alic_iva_id, alicuota_iva)
),
sin_cae as (
  select count(*) as n
  from public.customer_invoices ci
  where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
    and ci.ambiente = public.fiscal_ambiente()
    and (ci.cae is null or btrim(ci.cae) = '')
)
select 'V3' as control,
       (select fallas from mismatch) as filas_vista_vs_recompute,
       (select n from sin_cae)       as autorizadas_sin_cae,
       ((select fallas from mismatch) + (select n from sin_cae)) as cantidad_fallas;


-- -------------------------------------------------------------------------
-- 6. V4 — Numeración correlativa por (punto_venta, cbte_tipo_arca) en autorizadas
-- -------------------------------------------------------------------------

-- 6.a V4 · DETALLE (por punto_venta/tipo: rango, cantidad, duplicados, nulos, gaps)
with autoriz as (
  select ci.punto_venta, ci.cbte_tipo_arca, ci.tipo_comprobante, ci.numero_comprobante
  from public.customer_invoices ci
  where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
),
nulos as (
  select punto_venta, cbte_tipo_arca, count(*) as nros_nulos
  from autoriz where numero_comprobante is null
  group by punto_venta, cbte_tipo_arca
),
base as (
  select punto_venta, cbte_tipo_arca,
         min(tipo_comprobante::text) as tipo_comprobante,
         count(*)                          as cantidad,
         count(numero_comprobante)         as con_numero,
         count(distinct numero_comprobante) as numeros_distintos,
         min(numero_comprobante)           as nro_min,
         max(numero_comprobante)           as nro_max
  from autoriz
  group by punto_venta, cbte_tipo_arca
)
select b.punto_venta, b.cbte_tipo_arca, b.tipo_comprobante,
       b.cantidad, b.con_numero, b.numeros_distintos,
       b.nro_min, b.nro_max,
       (b.con_numero - b.numeros_distintos)                                   as duplicados,
       coalesce(n.nros_nulos,0)                                               as nros_nulos,
       case when b.nro_min is null then 0
            else greatest((b.nro_max - b.nro_min + 1) - b.numeros_distintos, 0) end as gaps
from base b
left join nulos n on n.punto_venta = b.punto_venta and n.cbte_tipo_arca = b.cbte_tipo_arca
order by b.punto_venta, b.cbte_tipo_arca;

-- 6.b V4 · RESUMEN (fallas duras = duplicados + nulos; gaps informados aparte)
with autoriz as (
  select ci.punto_venta, ci.cbte_tipo_arca, ci.numero_comprobante
  from public.customer_invoices ci
  where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
),
base as (
  select punto_venta, cbte_tipo_arca,
         count(numero_comprobante)          as con_numero,
         count(distinct numero_comprobante) as numeros_distintos,
         min(numero_comprobante)            as nro_min,
         max(numero_comprobante)            as nro_max,
         count(*) filter (where numero_comprobante is null) as nulos
  from autoriz
  group by punto_venta, cbte_tipo_arca
)
select 'V4' as control,
       coalesce(sum(con_numero - numeros_distintos),0) as duplicados,
       coalesce(sum(nulos),0)                          as nros_nulos,
       coalesce(sum(case when nro_min is null then 0
                         else greatest((nro_max-nro_min+1)-numeros_distintos,0) end),0) as gaps
from base;


-- -------------------------------------------------------------------------
-- 7. V5 — Coherencia condicion_iva (receptor) vs tipo_comprobante
--    HEURÍSTICA emisor RI: receptor RESPONSABLE_INSCRIPTO -> comprobante A;
--    receptor (MONOTRIBUTO/EXENTO/CONSUMIDOR_FINAL/NO_RESPONSABLE/NO_CATEGORIZADO) -> B.
--    Solo AUTORIZADO_ARCA. Tipos C/E quedan FUERA de la evaluación (casos especiales).
--    Es una guía, no una regla rígida: las inconsistencias son HALLAZGO para contador.
-- -------------------------------------------------------------------------

-- 7.a V5 · DETALLE (combinaciones inconsistentes + no evaluados C/E)
with f as (
  select ci.id, ci.numero_comprobante, ci.razon_social, ci.condicion_iva,
         ci.tipo_comprobante, right(ci.tipo_comprobante::text,1) as letra
  from public.customer_invoices ci
  where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
)
select id, numero_comprobante, razon_social, condicion_iva, tipo_comprobante,
       case
         when letra in ('C','E') then 'NO_EVALUADO (tipo C/E)'
         when condicion_iva = 'RESPONSABLE_INSCRIPTO' and letra = 'B' then 'INCONSISTENTE (RI con B)'
         when condicion_iva <> 'RESPONSABLE_INSCRIPTO' and letra = 'A' then 'INCONSISTENTE (no-RI con A)'
         else 'OK'
       end as evaluacion
from f
where letra in ('C','E')
   or (condicion_iva = 'RESPONSABLE_INSCRIPTO' and letra = 'B')
   or (condicion_iva <> 'RESPONSABLE_INSCRIPTO' and letra = 'A')
order by evaluacion, razon_social;

-- 7.b V5 · RESUMEN
with f as (
  select ci.condicion_iva, right(ci.tipo_comprobante::text,1) as letra
  from public.customer_invoices ci
  where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
)
select 'V5' as control,
       count(*)                                                          as autorizadas_total,
       count(*) filter (where letra in ('A','B'))                        as evaluables_ab,
       count(*) filter (where letra in ('C','E'))                        as no_evaluados_ce,
       count(*) filter (where (condicion_iva='RESPONSABLE_INSCRIPTO' and letra='B')
                            or (condicion_iva<>'RESPONSABLE_INSCRIPTO' and letra='A')) as inconsistencias
from f;


-- -------------------------------------------------------------------------
-- 8. RESUMEN ETAPA 3  ← copiar ESTA tabla y pegarla como evidencia
--    Estados: OK | FALLA | NO_VERIFICABLE
-- -------------------------------------------------------------------------
with
v1 as (
  select coalesce(sum(case when round(abs(ci.iva - s.iva_lin),2) > 0 then 1 else 0 end),0) as fallas,
         coalesce(sum(round(abs(ci.iva - s.iva_lin),2)) filter (where round(abs(ci.iva - s.iva_lin),2) > 0),0) as monto
  from public.customer_invoices ci
  join lateral (
    select coalesce(sum(vl.iva_importe),0) as iva_lin
    from public.customer_invoice_vat_lines vl where vl.invoice_id = ci.id
  ) s on true
  where ci.estado_arca = 'AUTORIZADO_ARCA' and ci.anulada = false
),
v2 as (
  select coalesce(sum(case when d <> 0 then 1 else 0 end),0) as fallas,
         coalesce(sum(abs(d)) filter (where d <> 0),0) as monto
  from (select round(total-(subtotal+importe_no_gravado+importe_exento+iva+percepciones+tributos),2) as d
        from public.customer_invoices) q
),
rec3 as (
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
    and ci.ambiente = public.fiscal_ambiente()
  group by 1,2,3
),
v3 as (
  select (
    coalesce((select sum(case when coalesce(v.comprobantes,0)=coalesce(r.comprobantes,0)
                               and round(coalesce(v.neto_gravado,0)-coalesce(r.neto_gravado,0),2)=0
                               and round(coalesce(v.iva_debito_fiscal,0)-coalesce(r.iva_debito_fiscal,0),2)=0
                               and round(coalesce(v.total_gravado,0)-coalesce(r.total_gravado,0),2)=0
                              then 0 else 1 end)
              from public.libro_iva_ventas v full outer join rec3 r using (periodo, alic_iva_id, alicuota_iva)),0)
    +
    (select count(*) from public.customer_invoices ci
       where ci.estado_arca='AUTORIZADO_ARCA' and ci.anulada=false
         and ci.ambiente = public.fiscal_ambiente()
         and (ci.cae is null or btrim(ci.cae)=''))
  ) as fallas
),
v4 as (
  select coalesce(sum(con_numero - numeros_distintos),0)
         + coalesce(sum(nulos),0) as fallas,
         coalesce(sum(case when nro_min is null then 0
                           else greatest((nro_max-nro_min+1)-numeros_distintos,0) end),0) as gaps
  from (
    select count(numero_comprobante) as con_numero,
           count(distinct numero_comprobante) as numeros_distintos,
           min(numero_comprobante) as nro_min, max(numero_comprobante) as nro_max,
           count(*) filter (where numero_comprobante is null) as nulos
    from public.customer_invoices
    where estado_arca='AUTORIZADO_ARCA' and anulada=false
    group by punto_venta, cbte_tipo_arca
  ) b
),
v5 as (
  select count(*) filter (where letra in ('A','B')) as evaluables,
         count(*) filter (where (condicion_iva='RESPONSABLE_INSCRIPTO' and letra='B')
                              or (condicion_iva<>'RESPONSABLE_INSCRIPTO' and letra='A')) as inconsistencias
  from (select condicion_iva, right(tipo_comprobante::text,1) as letra
        from public.customer_invoices
        where estado_arca='AUTORIZADO_ARCA' and anulada=false) q
)
select * from (
  select 1 as ord, 'V1' as control,
         'IVA cabecera = Σ líneas IVA (autorizadas)' as descripcion,
         case when (select fallas from v1)=0 then 'OK' else 'FALLA' end as estado,
         (select fallas from v1)::bigint as cantidad_fallas,
         (select monto  from v1)::numeric(15,2) as monto_diferencia,
         'diferencia = 0' as criterio_ok
  union all
  select 2, 'V2',
         'total = subtotal+no_grav+exento+iva+percep+tributos',
         case when (select fallas from v2)=0 then 'OK' else 'FALLA' end,
         (select fallas from v2)::bigint,
         (select monto  from v2)::numeric(15,2),
         'diferencia = 0 (incluye tributos del modelo real)'
  union all
  select 3, 'V3',
         'Solo AUTORIZADO_ARCA con CAE entra al libro',
         case when (select fallas from v3)=0 then 'OK' else 'FALLA' end,
         (select fallas from v3)::bigint,
         0::numeric(15,2),
         'vista==recompute fiscal + 0 autorizadas sin CAE'
  union all
  select 4, 'V4',
         'Numeracion correlativa por pto_venta/tipo (autorizadas)',
         case when (select fallas from v4)=0 then 'OK' else 'FALLA' end,
         (select fallas from v4)::bigint,
         0::numeric(15,2),
         'duplicados + nulos = 0; gaps='||(select gaps from v4)::text||' (ver detalle, revisar)'
  union all
  select 5, 'V5',
         'Coherencia condicion_iva vs tipo_comprobante (heuristica RI)',
         case when (select evaluables from v5)=0 then 'NO_VERIFICABLE'
              when (select inconsistencias from v5)=0 then 'OK'
              else 'FALLA' end,
         (select inconsistencias from v5)::bigint,
         0::numeric(15,2),
         'heuristica emisor RI; inconsistencias = HALLAZGO para contador (C/E no evaluados)'
) s
order by ord;


-- -------------------------------------------------------------------------
-- 9. INSTRUCCIONES PARA INTERPRETAR RESULTADOS
--    · OK             → control cumplido (diferencia 0 / sin inconsistencias).
--    · FALLA          → diferencia/anomalía. Correr el DETALLE del control, aislar el
--                       comprobante, causa raíz. NO ajustar manualmente.
--    · NO_VERIFICABLE → no hay datos suficientes para evaluar (V5 sin comprobantes A/B).
--    V4: 'gaps' se informa pero NO dispara FALLA por sí solo (pueden deberse a numeración
--        compartida o intentos rechazados); revisar el detalle con criterio fiscal/contador.
--    V5: es HEURÍSTICA (regla emisor RI). Las inconsistencias son hallazgo para el contador,
--        no necesariamente un error del sistema. Tipos C y E quedan fuera de la evaluación.
--    No avanzar a Etapa 4 (IVA Ventas) hasta cerrar Etapa 3 con evidencia real.
-- =========================================================================
