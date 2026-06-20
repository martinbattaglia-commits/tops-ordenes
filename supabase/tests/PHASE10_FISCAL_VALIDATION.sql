-- =========================================================================
-- PHASE10_FISCAL_VALIDATION.sql — Kit READ-ONLY de la Fase 10
-- (percepciones de venta desglosadas + retenciones practicadas a proveedores;
-- migraciones 0087-0089). Para correr en el SQL Editor DESPUÉS de aplicar.
-- NO escribe nada (solo SELECT / asserts).
--
-- Responde el criterio de aceptación:
--  · ¿qué percepciones se aplicaron en ventas? ¿qué retenciones practiqué?
--  · ¿bruto/retención/neto por proveedor? ¿deuda fiscal generada?
--  · ¿integración contable correcta? ¿posición fiscal mensual? ¿sigue cuadrando
--    el balance? ¿hay diferencias fiscal vs contable?
-- =========================================================================

\echo '================ 1. ESTRUCTURA (tablas + RLS) ================'
select t.tablename, c.relrowsecurity as rls_on,
       case when c.relrowsecurity then 'OK' else 'FALLO' end as estado
from pg_tables t
join pg_class c on c.relname = t.tablename and c.relnamespace = 'public'::regnamespace
where t.schemaname = 'public'
  and t.tablename in ('customer_invoice_other_taxes','supplier_payment_withholdings')
order by t.tablename;

\echo '================ 2. ENUMS nuevos ================'
select typname, case when typname is not null then 'OK' else 'FALLO' end as estado
from pg_type
where typname in ('sales_other_tax_t','supplier_withholding_t')
order by typname;

\echo '================ 3. PLAN DE CUENTAS nuevo (a depositar) ================'
select code, name, case when id is not null then 'OK' else 'FALLO' end as estado
from (values ('2.1.12'),('2.1.13'),('2.1.14'),('2.1.15'),('2.1.16')) v(code)
left join public.chart_of_accounts coa using (code)
order by 1;

\echo '================ 4. accounting_rules nuevas resuelven a cuenta ================'
select count(*) as reglas_fase10,
       count(*) filter (where coa.id is null) as reglas_rotas,
       case when count(*) filter (where coa.id is null) = 0 then 'OK' else 'FALLO' end as estado
from public.accounting_rules r
left join public.chart_of_accounts coa on coa.code = r.account_code
where (r.source_type = 'customer_invoice' and r.rule_key like 'percepcion_%')
   or (r.source_type = 'supplier_payment' and r.rule_key like 'withholding_%');

\echo '================ 5. RPCs y VISTAS de la fase ================'
select proname, case when proname is not null then 'OK' else 'FALLO' end as estado
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('ventas_persist_other_taxes','ap_register_payment_withholdings')
order by 1;

select c.relname as vista, case when c.relname is not null then 'OK' else 'FALLO' end as estado
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  and c.relname in ('v_percepciones_ventas','v_retenciones_practicadas',
                    'v_pagos_proveedor_retenciones','v_posicion_fiscal_mensual',
                    'v_percep_retenc_fiscal_vs_contable','v_comprobantes_diferencias_fiscales')
order by 1;

\echo '================ 6. PERCEPCIONES DE VENTA (por período/tipo) ================'
select periodo, tax_type, jurisdiction, comprobantes, base_imponible, importe
from public.v_percepciones_ventas
order by periodo desc, tax_type
limit 50;

\echo '================ 7. RETENCIONES PRACTICADAS (por período/tipo) ================'
select periodo, withholding_type, jurisdiction, pagos, retenciones, base_imponible, importe
from public.v_retenciones_practicadas
order by periodo desc, withholding_type
limit 50;

\echo '================ 8. PAGO BRUTO / RETENCIÓN / NETO por proveedor ================'
select periodo, proveedor, public_id, pago_bruto, retenciones, pago_neto,
       case when round(pago_bruto - retenciones - pago_neto, 2) = 0 then 'OK' else 'FALLO' end as estado_identidad
from public.v_pagos_proveedor_retenciones
where retenciones > 0
order by periodo desc
limit 50;

\echo '================ 9. POSICIÓN FISCAL MENSUAL CONSOLIDADA ================'
select periodo, iva_saldo_posicion, iva_resultado,
       percepciones_ventas_a_depositar, retenciones_practicadas_a_depositar,
       percepciones_iva_sufridas, retenciones_sufridas
from public.v_posicion_fiscal_mensual
order by periodo desc
limit 24;

\echo '================ 10. DIFERENCIAS FISCAL vs CONTABLE (percep/retenc) ================'
select periodo, concepto, fiscal, contable, diferencia,
       case when abs(diferencia) <= 0.02 then 'OK' else 'REVISAR' end as estado
from public.v_percep_retenc_fiscal_vs_contable
order by periodo desc, concepto
limit 50;

\echo '================ 11. COMPROBANTES CON DIFERENCIA FISCAL (cabecera<>detalle) ================'
select count(*) as comprobantes_con_diferencia,
       case when count(*) = 0 then 'OK' else 'REVISAR (detalle no cuadra con cabecera)' end as estado
from public.v_comprobantes_diferencias_fiscales;

\echo '================ 12. INTEGRIDAD CONTABLE: sigue cuadrando ================'
select round(sum(total_debe),2) as suma_debe, round(sum(total_haber),2) as suma_haber,
       case when round(sum(total_debe),2) = round(sum(total_haber),2) then 'OK' else 'FALLO' end as estado
from public.v_balance_sumas_saldos;

select count(*) as asientos_descuadrados,
       case when count(*) = 0 then 'OK' else 'FALLO' end as estado
from public.v_asientos_descuadrados;

\echo '================ 13. DRY-RUN de recontabilización (NO escribe) ================'
-- Re-postear es idempotente (skip si ya existe). Útil para verificar balance de
-- pagos con retención sin alterar nada.
select public.acc_backfill('supplier_payment', true) as pagos_dry_run;
select public.acc_backfill('customer_invoice', true) as ventas_dry_run;

\echo '================ FIN — revisar columnas estado = OK ================'
