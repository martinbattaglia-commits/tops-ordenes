-- =========================================================================
-- AUDIT_ETAPA5_POSICION_IVA.sql — Auditoría funcional · Etapa 5 (Posición IVA)
--
-- NATURALEZA: 100% READ-ONLY. Solo SELECT / CTE. Sin INSERT/UPDATE/DELETE/
-- TRUNCATE/DROP/ALTER/CREATE ni funciones que modifiquen datos.
--
-- Calcula la POSICIÓN IVA de forma MANUAL desde los libros ya validados
-- (libro_iva_ventas — Etapa 4 OK; libro_iva_compras post-0102 — Etapa 2 OK).
--
-- IMPORTANTE (estado real verificado en repo):
--   · v_posicion_iva pertenece a 0086 (NO confirmada aplicada) y además DEPENDE
--     de supplier_invoice_other_taxes (tabla de 0087, NO aplicada). Por eso el
--     kit NO referencia v_posicion_iva salvo por to_regclass (existencia).
--   · El desglose de percepciones/retenciones requiere 0087+ (no aplicadas) →
--     P4 queda NO_VERIFICABLE. El "saldo técnico" de P1 es débito − crédito
--     (SIN percepciones/retenciones).
--
-- Objetos (columnas reales):
--   libro_iva_ventas (periodo, alic_iva_id, alicuota_iva, comprobantes,
--     neto_gravado, iva_debito_fiscal, total_gravado)
--   libro_iva_compras (periodo, alic_iva_id, alicuota_iva, comprobantes,
--     neto_gravado, iva_credito_fiscal, total_gravado)
--
-- Controles:
--   P1 Posición IVA manual por período (débito − crédito = saldo técnico)
--   P2 Conciliación manual por período/alícuota (informativo)
--   P3 Comparación contra v_posicion_iva si existe (si no, NO_VERIFICABLE/NO_APLICADA)
--   P4 Percepciones/retenciones (NO_VERIFICABLE si 0087+ no aplicadas)
--   P5 Períodos con un solo lado (ventas sin compras / compras sin ventas) — observación
--
-- USO: ejecutar todo y copiar PREFLIGHT + RESUMEN ETAPA 5. El bloque opcional de
--      comparación con v_posicion_iva (P3) se corre APARTE solo si la vista existe.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 2. PREFLIGHT — existencia de objetos (read-only, nunca falla)
-- -------------------------------------------------------------------------
select 'PREFLIGHT' as bloque, obj as objeto, (to_regclass(obj) is not null) as existe
from (values
  ('public.libro_iva_ventas'),
  ('public.libro_iva_compras'),
  ('public.v_posicion_iva'),
  ('public.supplier_invoice_other_taxes'),   -- 0087
  ('public.customer_invoice_other_taxes'),   -- 0087
  ('public.supplier_payment_withholdings'),  -- 0088
  ('public.v_posicion_fiscal_mensual')       -- 0089
) t(obj)
order by obj;


-- -------------------------------------------------------------------------
-- 3. P1 — Posición IVA manual por período (saldo técnico = débito − crédito)
-- -------------------------------------------------------------------------

-- 3.a P1 · DETALLE
with ventas as (
  select periodo, sum(iva_debito_fiscal) as iva_debito from public.libro_iva_ventas group by periodo
),
compras as (
  select periodo, sum(iva_credito_fiscal) as iva_credito from public.libro_iva_compras group by periodo
),
pos as (
  select coalesce(v.periodo, c.periodo) as periodo,
         coalesce(v.iva_debito,0)  as debito_fiscal_ventas,
         coalesce(c.iva_credito,0) as credito_fiscal_compras,
         round(coalesce(v.iva_debito,0) - coalesce(c.iva_credito,0), 2) as saldo_tecnico
  from ventas v
  full outer join compras c using (periodo)
)
select periodo, debito_fiscal_ventas, credito_fiscal_compras, saldo_tecnico,
       case when saldo_tecnico > 0 then 'a_pagar'
            when saldo_tecnico < 0 then 'a_favor_tecnico'
            else 'neutro' end as signo
from pos
order by periodo;

-- 3.b P1 · RESUMEN (totales del período auditado)
with ventas as (
  select periodo, sum(iva_debito_fiscal) as iva_debito from public.libro_iva_ventas group by periodo
),
compras as (
  select periodo, sum(iva_credito_fiscal) as iva_credito from public.libro_iva_compras group by periodo
),
pos as (
  select coalesce(v.periodo, c.periodo) as periodo,
         coalesce(v.iva_debito,0) as deb, coalesce(c.iva_credito,0) as cred
  from ventas v full outer join compras c using (periodo)
)
select 'P1' as control,
       count(*)                                       as periodos,
       count(*) filter (where (deb - cred) > 0)       as periodos_a_pagar,
       count(*) filter (where (deb - cred) < 0)       as periodos_a_favor,
       count(*) filter (where (deb - cred) = 0)       as periodos_neutros,
       round(sum(deb),2)                              as total_debito,
       round(sum(cred),2)                             as total_credito,
       round(sum(deb) - sum(cred),2)                  as saldo_tecnico_acumulado
from pos;


-- -------------------------------------------------------------------------
-- 4. P2 — Conciliación manual por período/alícuota (informativo)
-- -------------------------------------------------------------------------
with ventas as (
  select periodo, alic_iva_id, alicuota_iva, sum(iva_debito_fiscal) as iva_debito
  from public.libro_iva_ventas group by 1,2,3
),
compras as (
  select periodo, alic_iva_id, alicuota_iva, sum(iva_credito_fiscal) as iva_credito
  from public.libro_iva_compras group by 1,2,3
)
select coalesce(v.periodo, c.periodo)         as periodo,
       coalesce(v.alic_iva_id, c.alic_iva_id) as alic_iva_id,
       coalesce(v.alicuota_iva, c.alicuota_iva) as alicuota_iva,
       coalesce(v.iva_debito,0)               as iva_debito_ventas,
       coalesce(c.iva_credito,0)              as iva_credito_compras,
       round(coalesce(v.iva_debito,0) - coalesce(c.iva_credito,0),2) as saldo_alicuota
from ventas v
full outer join compras c using (periodo, alic_iva_id, alicuota_iva)
order by periodo, alic_iva_id;


-- -------------------------------------------------------------------------
-- 5. P3 — Comparación contra v_posicion_iva (SOLO si la vista existe)
--    OJO: NO descomentar/correr este bloque si PREFLIGHT muestra
--    v_posicion_iva = false (la vista no existe → referenciarla daría error).
--    Si existe, descomentar y correr para comparar manual vs vista.
-- -------------------------------------------------------------------------
-- with manual as (
--   select coalesce(v.periodo, c.periodo) as periodo,
--          coalesce(v.iva_debito,0) - coalesce(c.iva_credito,0) as saldo_tecnico_manual
--   from (select periodo, sum(iva_debito_fiscal) iva_debito from public.libro_iva_ventas group by periodo) v
--   full outer join (select periodo, sum(iva_credito_fiscal) iva_credito from public.libro_iva_compras group by periodo) c
--   using (periodo)
-- )
-- select coalesce(m.periodo, p.periodo) as periodo,
--        m.saldo_tecnico_manual,
--        p.saldo_tecnico               as saldo_tecnico_vista,
--        round(coalesce(m.saldo_tecnico_manual,0) - coalesce(p.saldo_tecnico,0),2) as diferencia
-- from manual m
-- full outer join public.v_posicion_iva p using (periodo)
-- order by periodo;


-- -------------------------------------------------------------------------
-- 6. P4 — Percepciones / retenciones (estado de cobertura)
--    Existencia de las estructuras de desglose (0087+). Si no están aplicadas,
--    la posición NO puede incorporar percepciones/retenciones por tipo.
-- -------------------------------------------------------------------------

-- 6.a P4 · DETALLE (existencia de estructuras + total agregado SIN desglose)
select
  (to_regclass('public.supplier_invoice_other_taxes') is not null) as t0087_compras_other_taxes,
  (to_regclass('public.customer_invoice_other_taxes') is not null) as t0087_ventas_other_taxes,
  (to_regclass('public.supplier_payment_withholdings') is not null) as t0088_retenciones_practicadas,
  (to_regclass('public.v_posicion_fiscal_mensual') is not null)     as v0089_posicion_fiscal_mensual,
  -- Agregado existente (columna aplicada) SIN desglose por tipo — NO computar en posición IVA:
  (select coalesce(round(sum(percepciones),2),0)
     from public.supplier_invoices where approval_status = 'aprobada') as percepciones_compras_agregado_no_desglosado;


-- -------------------------------------------------------------------------
-- 7. P5 — Períodos con un solo lado (ventas sin compras / compras sin ventas)
-- -------------------------------------------------------------------------

-- 7.a P5 · DETALLE
with ventas as (select distinct periodo from public.libro_iva_ventas),
compras as (select distinct periodo from public.libro_iva_compras)
select coalesce(v.periodo, c.periodo) as periodo,
       (v.periodo is not null) as tiene_ventas,
       (c.periodo is not null) as tiene_compras,
       case when v.periodo is not null and c.periodo is null then 'ventas_sin_compras'
            when v.periodo is null and c.periodo is not null then 'compras_sin_ventas'
            else 'ambos' end as situacion
from ventas v
full outer join compras c using (periodo)
where v.periodo is null or c.periodo is null
order by periodo;

-- 7.b P5 · RESUMEN
with ventas as (select distinct periodo from public.libro_iva_ventas),
compras as (select distinct periodo from public.libro_iva_compras)
select 'P5' as control,
       count(*) filter (where v.periodo is not null and c.periodo is null) as ventas_sin_compras,
       count(*) filter (where v.periodo is null and c.periodo is not null) as compras_sin_ventas
from ventas v full outer join compras c using (periodo);


-- -------------------------------------------------------------------------
-- 8. RESUMEN ETAPA 5  ← copiar ESTA tabla y pegarla como evidencia
--    Estados: OK | FALLA | NO_VERIFICABLE
-- -------------------------------------------------------------------------
with
ventas as (select periodo, sum(iva_debito_fiscal) as deb from public.libro_iva_ventas group by periodo),
compras as (select periodo, sum(iva_credito_fiscal) as cred from public.libro_iva_compras group by periodo),
pos as (
  select coalesce(v.periodo,c.periodo) as periodo,
         coalesce(v.deb,0) as deb, coalesce(c.cred,0) as cred
  from ventas v full outer join compras c using (periodo)
),
p1 as (
  select count(*) as periodos, round(sum(deb)-sum(cred),2) as saldo
  from pos
),
p5 as (
  select count(*) filter (where deb_only) as v_sin_c, count(*) filter (where cred_only) as c_sin_v
  from (
    select (v.periodo is not null and c.periodo is null) as deb_only,
           (v.periodo is null and c.periodo is not null) as cred_only
    from (select distinct periodo from public.libro_iva_ventas) v
    full outer join (select distinct periodo from public.libro_iva_compras) c using (periodo)
  ) q
),
flags as (
  select (to_regclass('public.v_posicion_iva') is not null) as v_pos_existe,
         (to_regclass('public.supplier_invoice_other_taxes') is not null
          or to_regclass('public.customer_invoice_other_taxes') is not null
          or to_regclass('public.supplier_payment_withholdings') is not null) as percep_aplicadas
)
select * from (
  select 1 as ord, 'P1' as control,
         'Posicion IVA manual por periodo (debito - credito)' as descripcion,
         'OK' as estado,
         0::bigint as cantidad_fallas,
         (select saldo from p1)::numeric(15,2) as monto_diferencia,
         'saldo tecnico acumulado (sin percep/retenc); '||(select periodos from p1)::text||' periodos' as criterio_ok
  union all
  select 2, 'P2',
         'Conciliacion manual por periodo/alicuota',
         'OK',
         0::bigint,
         0::numeric(15,2),
         'informativo (saldo por alicuota no necesariamente 0)'
  union all
  select 3, 'P3',
         'Comparacion contra v_posicion_iva',
         case when (select v_pos_existe from flags) then 'OK' else 'NO_VERIFICABLE' end,
         0::bigint,
         0::numeric(15,2),
         case when (select v_pos_existe from flags)
              then 'vista existe: correr bloque 5 (comparacion)'
              else 'v_posicion_iva NO APLICADA (0086 + depende de 0087) -> NO_VERIFICABLE' end
  union all
  select 4, 'P4',
         'Percepciones / retenciones desglosadas',
         case when (select percep_aplicadas from flags) then 'OK' else 'NO_VERIFICABLE' end,
         0::bigint,
         0::numeric(15,2),
         case when (select percep_aplicadas from flags)
              then 'estructuras 0087+ presentes: incorporar a la posicion'
              else 'estructuras 0087+ NO aplicadas -> NO_VERIFICABLE (no inventar importes)' end
  union all
  select 5, 'P5',
         'Periodos con un solo lado (observacion)',
         'OK',
         0::bigint,
         0::numeric(15,2),
         'ventas_sin_compras='||(select v_sin_c from p5)::text
         ||' / compras_sin_ventas='||(select c_sin_v from p5)::text||' (observacion, ver 7.a)'
) s
order by ord;


-- -------------------------------------------------------------------------
-- 9. INSTRUCCIONES PARA INTERPRETAR RESULTADOS
--    · OK             → cálculo/observación producidos sin inconsistencias.
--    · FALLA          → dato imposible/nulo indebido (no esperado en P1/P2/P5).
--    · NO_VERIFICABLE → P3 si v_posicion_iva no existe (0086 no aplicada; además
--                       depende de 0087). P4 si las estructuras 0087+ no están.
--    La posición manual (P1) es el SALDO TÉCNICO = débito − crédito, SIN
--    percepciones/retenciones (esas requieren 0087+; ver P4). No se inventan importes.
--    P5: períodos con un solo lado son OBSERVACIÓN, no falla.
--    No avanzar a Etapa 6 (Asientos → Balance) hasta cerrar Etapa 5 con evidencia real.
-- =========================================================================
