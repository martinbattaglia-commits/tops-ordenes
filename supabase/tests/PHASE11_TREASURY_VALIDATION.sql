-- =========================================================================
-- PHASE11_TREASURY_VALIDATION.sql — Kit READ-ONLY de la Fase 11
-- (tesorería con retenciones nativas; migraciones 0090-0091).
-- Para correr en el SQL Editor DESPUÉS de aplicar. NO escribe nada.
--
-- Nota: la RPC tesoreria_register_supplier_payment_neto está gateada por
-- has_permission('tesoreria.create'), por lo que el alta real se prueba desde
-- la app (sesión autenticada) o vía JWT-claims. Este kit valida ESTRUCTURA y
-- CONSISTENCIA sobre los datos existentes (criterio de aceptación 1-10).
-- =========================================================================

\echo '================ 1. ESTRUCTURA (columnas nuevas en supplier_payments) ================'
select column_name,
       case when column_name is not null then 'OK' else 'FALLO' end as estado
from information_schema.columns
where table_schema='public' and table_name='supplier_payments'
  and column_name in ('gross_amount','withheld_amount')
order by column_name;

\echo '================ 2. RPC nativa + diagnóstico + vistas ================'
select proname, case when proname is not null then 'OK' else 'FALLO' end as estado
from pg_proc
where pronamespace='public'::regnamespace
  and proname in ('tesoreria_register_supplier_payment_neto','tesoreria_diagnose_payment_withholdings')
order by 1;

select c.relname as vista, case when c.relname is not null then 'OK' else 'FALLO' end as estado
from pg_class c
where c.relnamespace='public'::regnamespace and c.relkind='v'
  and c.relname in ('v_supplier_payment_detalle','v_pagos_retencion_residual','v_pagos_tesoreria_vs_contable')
order by 1;

\echo '================ 3. La RPC vieja sigue intacta (pagos sin retención) ================'
select case when exists(
  select 1 from pg_proc where pronamespace='public'::regnamespace
    and proname='tesoreria_register_payment'
) then 'OK (intacta)' else 'FALLO' end as estado;

\echo '================ 4. DETALLE bruto/retención/neto por pago ================'
select periodo, public_id, proveedor, bruto, retenciones, neto,
       case when balanceado then 'OK' else 'RESIDUAL' end as estado
from public.v_supplier_payment_detalle
order by payment_date desc
limit 50;

\echo '================ 5. ¿Todos los pagos balancean (bruto = neto + retención)? ================'
select count(*) as pagos_confirmados,
       count(*) filter (where not balanceado) as desbalanceados,
       case when count(*) filter (where not balanceado) = 0 then 'OK' else 'REVISAR (ver v_pagos_retencion_residual)' end as estado
from public.v_supplier_payment_detalle;

\echo '================ 6. RESIDUALES por retención (deben corregirse con RPC nativa) ================'
select payment_id, public_id, proveedor, bruto_esperado, bruto_imputado, residual
from public.v_pagos_retencion_residual
order by residual desc
limit 50;

select public.tesoreria_diagnose_payment_withholdings(true) as diagnostico_dry_run;

\echo '================ 7. NO queda residual abierto en CxP por retención ================'
-- Para pagos con retención registrados con la RPC nativa, la factura cancela por
-- el bruto. Saldo negativo (sobre-imputación) nunca debe ocurrir.
select count(*) as facturas_saldo_negativo,
       case when count(*) = 0 then 'OK' else 'FALLO' end as estado
from public.supplier_open_items
where saldo < -0.02;

\echo '================ 8. DEUDA FISCAL por retenciones (a depositar) ================'
select periodo, withholding_type, jurisdiction, importe
from public.v_retenciones_practicadas
order by periodo desc, withholding_type
limit 50;

\echo '================ 9. CONCILIACIÓN tesorería vs contabilidad (pagos) ================'
select periodo, neto_tesoreria, neto_contable, dif_neto, bruto_contable_proveedores,
       case when abs(dif_neto) <= 0.02 then 'OK' else 'REVISAR (contabilizar pagos pendientes)' end as estado
from public.v_pagos_tesoreria_vs_contable
order by periodo desc
limit 24;

\echo '================ 10. INTEGRIDAD CONTABLE: sigue cuadrando ================'
select round(sum(total_debe),2) as suma_debe, round(sum(total_haber),2) as suma_haber,
       case when round(sum(total_debe),2) = round(sum(total_haber),2) then 'OK' else 'FALLO' end as estado
from public.v_balance_sumas_saldos;

select count(*) as asientos_descuadrados,
       case when count(*) = 0 then 'OK' else 'FALLO' end as estado
from public.v_asientos_descuadrados;

\echo '================ 11. POSICIÓN FISCAL MENSUAL sigue correcta ================'
select periodo, iva_saldo_posicion, percepciones_ventas_a_depositar, retenciones_practicadas_a_depositar
from public.v_posicion_fiscal_mensual
order by periodo desc
limit 12;

\echo '================ FIN — revisar columnas estado = OK ================'
