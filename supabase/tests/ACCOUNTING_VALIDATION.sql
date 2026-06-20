-- =========================================================================
-- ACCOUNTING_VALIDATION.sql — Kit de validación READ-ONLY de la capa contable
-- (migraciones 0082-0086). Para que Martín lo corra en el SQL Editor DESPUÉS
-- de aplicar las migraciones. NO escribe nada (solo SELECT / asserts).
--
-- Responde el criterio de aceptación con evidencia:
--   débito/crédito del mes · posición IVA · comprobantes con/ sin asiento ·
--   diario · mayor · sumas y saldos · "¿listo para balance anual?".
-- =========================================================================

\echo '================ 1. ESTRUCTURA (tablas + RLS) ================'
select
  t.tablename,
  c.relrowsecurity as rls_on,
  case when c.relrowsecurity then 'OK' else 'FALLO' end as estado
from pg_tables t
join pg_class c on c.relname = t.tablename and c.relnamespace = 'public'::regnamespace
where t.schemaname = 'public'
  and t.tablename in ('chart_of_accounts','accounting_periods','journal_entries',
                      'journal_entry_lines','accounting_rules')
order by t.tablename;

\echo '================ 2. PLAN DE CUENTAS (seed) ================'
select
  count(*) as total_cuentas,
  count(*) filter (where is_postable) as imputables,
  count(*) filter (where not is_postable) as rubros,
  count(*) filter (where parent_id is null) as raices,
  case when count(*) >= 60 then 'OK' else 'FALLO (<60 cuentas)' end as estado
from public.chart_of_accounts;

-- Cuentas clave que el motor necesita resolver por código.
select code, name,
       case when id is not null then 'OK' else 'FALLO' end as estado
from (values
  ('1.1.01'),('1.1.02'),('1.1.03'),('1.1.05'),('1.1.06'),('1.1.08'),
  ('2.1.01'),('2.1.02'),('2.1.04'),('2.1.06'),
  ('4.1.05'),('4.1.07'),('6.1.10')
) v(code)
left join public.chart_of_accounts coa using (code)
order by 1;

\echo '================ 3. REGLAS DE IMPUTACIÓN (accounting_rules) ================'
select source_type, count(*) as reglas,
       case when count(*) > 0 then 'OK' else 'FALLO' end as estado
from public.accounting_rules
group by source_type order by source_type;

-- Toda regla debe resolver a una cuenta existente.
select count(*) as reglas_rotas,
       case when count(*) = 0 then 'OK' else 'FALLO (reglas sin cuenta)' end as estado
from public.accounting_rules r
left join public.chart_of_accounts coa on coa.code = r.account_code
where coa.id is null;

\echo '================ 4. RBAC contabilidad ================'
select count(*) as permisos_contabilidad,
       case when count(*) = 5 then 'OK' else 'FALLO (esperados 5)' end as estado
from public.permissions where module = 'contabilidad';

\echo '================ 5. FUNCIONES Y VISTAS ================'
select p.proname,
       case when p.proname is not null then 'OK' else 'FALLO' end as estado
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('acc_post_sales_invoice','acc_post_purchase_invoice',
                    'acc_post_customer_receipt','acc_post_supplier_payment',
                    'acc_post_document','acc_reverse_entry','acc_backfill',
                    'acc_create_posted_entry','acc_ensure_period')
order by 1;

select c.relname as vista,
       case when c.relname is not null then 'OK' else 'FALLO' end as estado
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  and c.relname in ('v_libro_diario','v_libro_mayor','v_balance_sumas_saldos',
                    'v_estado_resultados','v_posicion_iva','v_comprobantes_sin_asiento',
                    'v_asientos_descuadrados','v_iva_fiscal_vs_contable')
order by 1;

\echo '================ 6. INTEGRIDAD: asientos descuadrados (debe estar vacío) ================'
select count(*) as descuadrados,
       case when count(*) = 0 then 'OK' else 'FALLO (hay asientos sin balancear)' end as estado
from public.v_asientos_descuadrados;

\echo '================ 7. BALANCE DE SUMAS Y SALDOS cuadra ================'
select
  round(sum(total_debe),2)    as suma_debe,
  round(sum(total_haber),2)   as suma_haber,
  round(sum(saldo_deudor),2)  as suma_saldo_deudor,
  round(sum(saldo_acreedor),2) as suma_saldo_acreedor,
  case when round(sum(total_debe),2) = round(sum(total_haber),2)
        and round(sum(saldo_deudor),2) = round(sum(saldo_acreedor),2)
       then 'OK' else 'FALLO (no cuadra)' end as estado
from public.v_balance_sumas_saldos;

\echo '================ 8. POSICIÓN MENSUAL DE IVA ================'
select periodo, iva_debito_fiscal, iva_credito_fiscal, saldo_tecnico,
       percepciones_iva_sufridas, retenciones_sufridas, saldo_posicion, resultado,
       case when round(saldo_tecnico,2) = round(iva_debito_fiscal - iva_credito_fiscal,2)
            then 'OK' else 'FALLO' end as estado_saldo_tecnico
from public.v_posicion_iva
order by periodo desc
limit 24;

\echo '================ 9. IVA fiscal vs contable (diferencias) ================'
select periodo, iva_debito_fiscal, iva_debito_contable, dif_debito,
       iva_credito_fiscal, iva_credito_contable, dif_credito,
       case when abs(dif_debito) <= 0.02 and abs(dif_credito) <= 0.02
            then 'OK' else 'REVISAR (faltan asientos o difieren)' end as estado
from public.v_iva_fiscal_vs_contable
order by periodo desc
limit 24;

\echo '================ 10. COBERTURA DE CONTABILIZACIÓN (sin asiento) ================'
select source_type, count(*) as comprobantes_sin_asiento
from public.v_comprobantes_sin_asiento
group by source_type order by source_type;

\echo '================ 11. DRY-RUN de backfill (NO escribe) ================'
-- Requiere sesión con permiso contabilidad.create. Simula sin postear.
select public.acc_backfill('customer_invoice', true) as ventas_dry_run;
select public.acc_backfill('supplier_invoice', true) as compras_dry_run;
select public.acc_backfill('customer_receipt', true) as cobranzas_dry_run;
select public.acc_backfill('supplier_payment', true) as pagos_dry_run;

\echo '================ FIN — revisar columnas estado = OK ================'
