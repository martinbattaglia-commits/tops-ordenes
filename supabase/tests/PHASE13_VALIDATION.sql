-- =========================================================================
-- PHASE13_VALIDATION.sql — Kit READ-ONLY de la Fase 13 (tarifas, facturación
-- recurrente, pricing logístico, borradores, refundición anual; 0096-0101).
-- Para correr en el SQL Editor DESPUÉS de aplicar. NO escribe nada.
--
-- Las RPC (billing_*, acc_simulate_annual_closing, ...) están gateadas por
-- permisos y se prueban desde la app. Este kit valida estructura + consistencia
-- sobre vistas y catálogos, y demuestra que las simulaciones son read-only.
-- =========================================================================

\echo '================ 1. ESTRUCTURA (tablas + EXCLUDE de tarifas) ================'
select objeto, case when ok then 'OK' else 'FALLO' end as estado from (
  select 'billable_services' objeto, to_regclass('public.billable_services') is not null ok
  union all select 'customer_service_rates', to_regclass('public.customer_service_rates') is not null
  union all select 'billing_runs', to_regclass('public.billing_runs') is not null
  union all select 'billing_run_items', to_regclass('public.billing_run_items') is not null
  union all select 'invoice_items.billing_run_item_id',
    exists(select 1 from information_schema.columns where table_name='invoice_items' and column_name='billing_run_item_id')
  union all select 'accounting_closing_runs (0095)', to_regclass('public.accounting_closing_runs') is not null
) q;

select 'csr_no_overlap (EXCLUDE)' as constraint,
       case when exists(select 1 from pg_constraint where conname='csr_no_overlap') then 'OK' else 'FALLO' end as estado;

\echo '================ 2. CATÁLOGO de servicios facturables ================'
select service_type, count(*) as servicios, count(*) filter (where is_active) as activos
from public.billable_services group by service_type order by service_type;

\echo '================ 3. TARIFAS solapadas activas (debe ser 0; lo garantiza el EXCLUDE) ================'
-- Verificación defensiva por pares (ventana).
select count(*) as solapamientos,
       case when count(*) = 0 then 'OK' else 'FALLO' end as estado
from (
  select a.id
  from public.customer_service_rates a
  join public.customer_service_rates b
    on a.customer_id = b.customer_id and a.service_id = b.service_id and a.id < b.id
   and a.is_active and b.is_active
   and daterange(a.valid_from, coalesce(a.valid_to,'infinity'::date), '[]')
       && daterange(b.valid_from, coalesce(b.valid_to,'infinity'::date), '[]')
) x;

\echo '================ 4. BILLING RUN ITEMS duplicados (debe ser 0) ================'
select count(*) as duplicados,
       case when count(*) = 0 then 'OK' else 'FALLO' end as estado
from (
  select billing_run_id, customer_id, service_id, coalesce(source_type,''), coalesce(source_id,'00000000-0000-0000-0000-000000000000'::uuid)
  from public.billing_run_items
  group by 1,2,3,4,5 having count(*) > 1
) d;

\echo '================ 5. NO se emiten facturas automáticamente (billing → BORRADOR) ================'
select ci.estado_arca, count(distinct ci.id) as facturas_desde_billing
from public.customer_invoices ci
join public.invoice_items ii on ii.invoice_id = ci.id and ii.source_type = 'billing_run'
group by ci.estado_arca;

\echo '================ 6. NO se contabilizan borradores (BORRADOR no entra en sin-asiento) ================'
select count(*) as borradores_en_pendientes_contab,
       case when count(*) = 0 then 'OK' else 'FALLO' end as estado
from public.v_comprobantes_sin_asiento c
join public.customer_invoices ci on ci.id = c.source_id
where c.source_type = 'customer_invoice' and ci.estado_arca = 'BORRADOR';

\echo '================ 7. TRAZABILIDAD billing ↔ factura (diferencia debe ser 0) ================'
select invoice_id, billing_gross, factura_gross, diferencia,
       case when abs(diferencia) <= 0.02 then 'OK' else 'REVISAR' end as estado
from public.v_billing_vs_factura_diff
order by abs(diferencia) desc
limit 50;

\echo '================ 8. ÓRDENES LOGÍSTICAS no priceables con motivo ================'
select order_id, public_id, client_name, client_matches, priceable, motivo_no_priceable
from public.v_logistics_orders_pricing
order by fecha desc
limit 30;

\echo '================ 9. SIMULACIONES son READ-ONLY (no escriben) ================'
select proname,
       case when provolatile in ('s','i') then 'OK (read-only)' else 'FALLO (volátil)' end as estado
from pg_proc
where pronamespace='public'::regnamespace
  and proname in ('billing_price_logistics_order','acc_simulate_annual_closing','acc_annual_blockers',
                  'customer_service_rate_for')
order by 1;

\echo '================ 10. RESULTADO ANUAL simulado coincide con EERR ================'
with anual as (select ejercicio, round(resultado_ejercicio,2) as r from public.v_resultado_anual),
     eerr as (select left(periodo,4)::int as ejercicio, round(sum(neto),2) as r from public.v_estado_resultados group by left(periodo,4))
select coalesce(a.ejercicio, e.ejercicio) as ejercicio,
       coalesce(a.r,0) as anual, coalesce(e.r,0) as eerr,
       case when round(coalesce(a.r,0)-coalesce(e.r,0),2)=0 then 'OK' else 'FALLO' end as estado
from anual a full outer join eerr e using (ejercicio)
order by ejercicio desc;

\echo '================ 11. REFUNDICIÓN anual: ejercicios ya refundidos (no duplicar) ================'
select p.year as ejercicio, r.closing_type, r.status, r.completed_at
from public.accounting_closing_runs r
join public.accounting_periods p on p.id = r.period_id
where r.closing_type in ('annual_closing','retained_earnings_transfer')
order by p.year desc;

\echo '================ 12. PERÍODOS abiertos (bloquean refundición anual) ================'
select year, month, status, listo from public.v_periodos_para_cierre
where status = 'open' order by year desc, month desc limit 24;

\echo '================ 13. INTEGRIDAD CONTABLE general (no se rompió nada) ================'
select round(sum(total_debe),2) as debe, round(sum(total_haber),2) as haber,
       case when round(sum(total_debe),2)=round(sum(total_haber),2) then 'OK' else 'FALLO' end as estado
from public.v_balance_sumas_saldos;
select count(*) as descuadrados, case when count(*)=0 then 'OK' else 'FALLO' end as estado
from public.v_asientos_descuadrados;

\echo '================ 14. VISTAS de la fase responden ================'
select 'v_tarifas_vigentes' v, count(*) n from public.v_tarifas_vigentes
union all select 'v_billing_runs', count(*) from public.v_billing_runs
union all select 'v_servicios_recurrentes_pendientes', count(*) from public.v_servicios_recurrentes_pendientes
union all select 'v_resultado_anual', count(*) from public.v_resultado_anual;

\echo '================ FIN — revisar columnas estado = OK ================'
