-- =========================================================================
-- PHASE12_VALIDATION.sql — Kit READ-ONLY de la Fase 12 (centros de costo,
-- logística facturable, base de cierre; migraciones 0092-0095).
-- Para correr en el SQL Editor DESPUÉS de aplicar. NO escribe nada.
--
-- Nota: las RPC (acc_simulate_closing, etc.) están gateadas por permisos y se
-- prueban desde la app. Este kit valida estructura + consistencia sobre las
-- vistas (security_invoker) y demuestra que la simulación es read-only.
-- =========================================================================

\echo '================ 1. ESTRUCTURA (columnas + tablas nuevas) ================'
select 'cost_centers.type' as objeto,
       case when exists(select 1 from information_schema.columns where table_name='cost_centers' and column_name='type') then 'OK' else 'FALLO' end as estado
union all select 'cost_centers.updated_at',
       case when exists(select 1 from information_schema.columns where table_name='cost_centers' and column_name='updated_at') then 'OK' else 'FALLO' end
union all select 'customer_invoices.cost_center_id',
       case when exists(select 1 from information_schema.columns where table_name='customer_invoices' and column_name='cost_center_id') then 'OK' else 'FALLO' end
union all select 'treasury_movements.cost_center_id',
       case when exists(select 1 from information_schema.columns where table_name='treasury_movements' and column_name='cost_center_id') then 'OK' else 'FALLO' end
union all select 'logistics_order_billing_links',
       case when to_regclass('public.logistics_order_billing_links') is not null then 'OK' else 'FALLO' end
union all select 'accounting_closing_runs',
       case when to_regclass('public.accounting_closing_runs') is not null then 'OK' else 'FALLO' end;

\echo '================ 2. SEED unidades de negocio / sedes ================'
select type, count(*) as centros
from public.cost_centers
where type is not null
group by type order by type;

\echo '================ 3. NO HAY FACTURACIÓN DUPLICADA de órdenes ================'
-- UNIQUE(logistics_order_id) lo garantiza; verificación defensiva.
select count(*) as ordenes_con_doble_vinculo,
       case when count(*) = 0 then 'OK' else 'FALLO' end as estado
from (
  select logistics_order_id from public.logistics_order_billing_links
  group by logistics_order_id having count(*) > 1
) x;

\echo '================ 4. ÓRDENES FACTURADAS con vínculo correcto ================'
select count(*) as facturadas_sin_invoice,
       case when count(*) = 0 then 'OK' else 'FALLO' end as estado
from public.logistics_order_billing_links
where billing_status = 'invoiced' and customer_invoice_id is null;

\echo '================ 5. ÓRDENES NO FACTURABLES no aparecen como facturables ================'
select count(*) as fugas,
       case when count(*) = 0 then 'OK' else 'FALLO' end as estado
from public.v_logistics_orders_facturables f
join public.logistics_order_billing_links l on l.logistics_order_id = f.order_id
where l.billing_status in ('not_billable','invoiced','cancelled');

\echo '================ 6. FACTURAS GENERADAS DESDE ÓRDENES (flujo de ventas) ================'
select invoice_id, tipo_comprobante, total, ordenes_vinculadas
from public.v_facturas_desde_ordenes
order by fecha desc
limit 25;

\echo '================ 7. CENTROS DE COSTO imputados en resultado ================'
select count(*) as lineas_resultado,
       count(*) filter (where cost_center_id is not null) as con_cc,
       count(*) filter (where cost_center_id is null) as sin_cc
from public.journal_entry_lines l
join public.journal_entries je on je.id = l.journal_entry_id
join public.chart_of_accounts coa on coa.id = l.account_id
where je.status = 'posted' and coa.type in ('ingreso','gasto');

\echo '================ 8. EERR por CC cuadra con el total general ================'
with cc as (select periodo, round(sum(neto),2) as total from public.v_estado_resultados_cc group by periodo),
     gen as (select periodo, round(sum(neto),2) as total from public.v_estado_resultados group by periodo)
select coalesce(cc.periodo, gen.periodo) as periodo,
       coalesce(cc.total,0) as por_cc, coalesce(gen.total,0) as general,
       case when round(coalesce(cc.total,0) - coalesce(gen.total,0),2) = 0 then 'OK' else 'FALLO' end as estado
from cc full outer join gen using (periodo)
order by periodo desc;

\echo '================ 9. MAYOR por CC cuadra con el mayor general (sumas) ================'
select round(sum(debe),2) as cc_debe, round(sum(haber),2) as cc_haber,
       (select round(sum(total_debe),2) from public.v_balance_sumas_saldos)  as bal_debe,
       (select round(sum(total_haber),2) from public.v_balance_sumas_saldos) as bal_haber,
       case when round(sum(debe),2) = (select round(sum(total_debe),2) from public.v_balance_sumas_saldos)
             and round(sum(haber),2) = (select round(sum(total_haber),2) from public.v_balance_sumas_saldos)
            then 'OK' else 'FALLO' end as estado
from public.v_libro_mayor_cc;

\echo '================ 10. RENTABILIDAD por centro de costo ================'
select periodo, centro_costo_code, centro_costo_nombre, ingresos, gastos, resultado, margen_pct
from public.v_resultado_por_cc
order by periodo desc, resultado desc
limit 30;

\echo '================ 11. INTEGRIDAD CONTABLE general ================'
select round(sum(total_debe),2) as suma_debe, round(sum(total_haber),2) as suma_haber,
       case when round(sum(total_debe),2) = round(sum(total_haber),2) then 'OK' else 'FALLO' end as estado
from public.v_balance_sumas_saldos;
select count(*) as descuadrados, case when count(*) = 0 then 'OK' else 'FALLO' end as estado
from public.v_asientos_descuadrados;

\echo '================ 12. PERÍODOS listos / bloqueados para cierre ================'
select year, month, status, descuadrados, comprobantes_sin_asiento, iva_diffs, listo
from public.v_periodos_para_cierre
order by year desc, month desc
limit 24;

\echo '================ 13. SIMULACIÓN DE REFUNDICIÓN (read-only, vista) ================'
select periodo, ingresos, gastos, resultado_estimado
from public.v_refundicion_simulacion
order by periodo desc
limit 24;

\echo '================ 14. PRUEBA: la simulación de cierre es READ-ONLY (no escribe) ================'
-- provolatile = s (STABLE) ⇒ la función no puede ejecutar escrituras.
select proname,
       case when provolatile in ('s','i') then 'OK (read-only)' else 'FALLO (volátil/escribe)' end as estado
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('acc_simulate_closing','acc_closing_blockers','acc_closing_proposed_lines')
order by 1;

\echo '================ FIN — revisar columnas estado = OK ================'
