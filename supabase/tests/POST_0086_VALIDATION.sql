-- =========================================================================
-- POST_0086_VALIDATION.sql — Validación post-aplicación de 0085 + 0086 (SIN backfill)
--
-- NATURALEZA: 100% READ-ONLY. Solo SELECT / CTE. Sin INSERT/UPDATE/DELETE/
-- TRUNCATE/DROP/ALTER/CREATE ni llamadas a funciones que escriban.
-- NO ejecuta acc_backfill ni acc_post_*. Verifica el estado contable ANTES del
-- backfill: infraestructura instalada, libro vacío, balance sin movimiento, y
-- reglas de imputación (*) a revisar con contador.
--
-- Estado esperado ANTES del backfill:
--   · v_comprobantes_sin_asiento: TODOS los documentos elegibles (pendientes).
--   · v_asientos_descuadrados: VACÍO (0).
--   · v_balance_sumas_saldos: sin movimiento (debe/haber/saldos = 0).
--   · journal_entries = 0, journal_entry_lines = 0, v_libro_diario = 0.
--   · accounting_rules con (*): REVISAR con contador (no bloquea infraestructura,
--     bloquea el backfill real).
--
-- USO: ejecutar todo y copiar el bloque RESUMEN POST-0086. Los detalles A/B están
--      arriba del resumen.
-- =========================================================================


-- -------------------------------------------------------------------------
-- A1) v_comprobantes_sin_asiento — universo a contabilizar (agrupado + total)
-- -------------------------------------------------------------------------
select source_type,
       count(*)                  as comprobantes,
       round(sum(importe),2)     as importe_total
from public.v_comprobantes_sin_asiento
group by source_type
order by source_type;

select count(*)                  as total_sin_asiento,
       round(sum(importe),2)     as importe_total_general
from public.v_comprobantes_sin_asiento;


-- -------------------------------------------------------------------------
-- A2) v_asientos_descuadrados — control de integridad (esperado VACÍO)
-- -------------------------------------------------------------------------
select count(*) as asientos_descuadrados from public.v_asientos_descuadrados;


-- -------------------------------------------------------------------------
-- A3) v_balance_sumas_saldos — sin movimiento antes del backfill (esperado 0)
-- -------------------------------------------------------------------------
select count(*)                     as cuentas_imputables,
       round(sum(total_debe),2)     as suma_debe,
       round(sum(total_haber),2)    as suma_haber,
       round(sum(saldo_deudor),2)   as suma_saldo_deudor,
       round(sum(saldo_acreedor),2) as suma_saldo_acreedor
from public.v_balance_sumas_saldos;


-- -------------------------------------------------------------------------
-- A4) Conteos del libro contable (esperado todo 0 antes del backfill)
-- -------------------------------------------------------------------------
select (select count(*) from public.journal_entries)     as journal_entries,
       (select count(*) from public.journal_entry_lines) as journal_entry_lines,
       (select count(*) from public.v_libro_diario)      as v_libro_diario;


-- -------------------------------------------------------------------------
-- B) accounting_rules — reglas de imputación; (*) = default a validar con contador
-- -------------------------------------------------------------------------
select source_type, rule_key, account_code,
       (notes like '%(*)%') as default_a_validar,
       notes
from public.accounting_rules
order by (notes like '%(*)%') desc, source_type, rule_key;


-- -------------------------------------------------------------------------
-- RESUMEN POST-0086  ← copiar ESTA tabla y pegarla como evidencia
--    Estados: OK | FALLA | REVISAR | NO_VERIFICABLE
-- -------------------------------------------------------------------------
with
csa  as (select count(*) as pendientes, coalesce(round(sum(importe),2),0) as importe
         from public.v_comprobantes_sin_asiento),
des  as (select count(*) as n from public.v_asientos_descuadrados),
bal  as (select coalesce(round(sum(total_debe),2),0) as debe,
                coalesce(round(sum(total_haber),2),0) as haber
         from public.v_balance_sumas_saldos),
cnt  as (select (select count(*) from public.journal_entries)     as je,
                (select count(*) from public.journal_entry_lines) as jel,
                (select count(*) from public.v_libro_diario)      as ld),
rul  as (select count(*) filter (where notes like '%(*)%') as defaults,
                count(*) as total
         from public.accounting_rules)
select * from (
  select 1 as ord, 'POST86-1' as control,
         'Comprobantes pendientes detectados' as descripcion,
         case when (select pendientes from csa) > 0 then 'OK'
              when (select je from cnt) > 0 then 'OK'
              else 'REVISAR' end as estado,
         case when (select pendientes from csa) > 0 or (select je from cnt) > 0 then 0 else 1 end::bigint as cantidad_fallas,
         (select importe from csa)::numeric(15,2) as monto_diferencia,
         'pendientes='||(select pendientes from csa)::text
           ||' / asientos='||(select je from cnt)::text
           ||' (OK si hay pendientes y no hubo backfill)' as criterio_ok
  union all
  select 2, 'POST86-2',
         'Asientos descuadrados',
         case when (select n from des) = 0 then 'OK' else 'FALLA' end,
         (select n from des)::bigint,
         0::numeric(15,2),
         'esperado 0 (invariante partida doble)'
  union all
  select 3, 'POST86-3',
         'Balance sin movimiento (pre-backfill)',
         case when (select debe from bal) = 0 and (select haber from bal) = 0 then 'OK' else 'REVISAR' end,
         case when (select debe from bal) = 0 and (select haber from bal) = 0 then 0 else 1 end::bigint,
         round((select debe from bal) - (select haber from bal), 2)::numeric(15,2),
         'debe='||(select debe from bal)::text||' / haber='||(select haber from bal)::text
           ||' (OK si 0; REVISAR si hay movimiento -> hubo backfill)' as criterio_ok
  union all
  select 4, 'POST86-4',
         'Libro diario vacío (pre-backfill)',
         case when (select je from cnt) = 0 and (select jel from cnt) = 0 and (select ld from cnt) = 0
              then 'OK' else 'REVISAR' end,
         ((select je from cnt) + (select jel from cnt) + (select ld from cnt))::bigint,
         0::numeric(15,2),
         'journal_entries='||(select je from cnt)::text
           ||' / lineas='||(select jel from cnt)::text
           ||' / libro_diario='||(select ld from cnt)::text||' (OK si todos 0)' as criterio_ok
  union all
  select 5, 'POST86-5',
         'Reglas contables default/provisorias (*)',
         case when (select defaults from rul) > 0 then 'REVISAR' else 'OK' end,
         (select defaults from rul)::bigint,
         0::numeric(15,2),
         (select defaults from rul)::text||' de '||(select total from rul)::text
           ||' reglas con (*) -> validar con contador ANTES del backfill real' as criterio_ok
) s
order by ord;


-- -------------------------------------------------------------------------
-- INTERPRETACIÓN
--   · OK             → estado esperado pre-backfill (o post-backfill coherente).
--   · FALLA          → POST86-2 con asientos descuadrados (no debería ocurrir).
--   · REVISAR        → POST86-1 sin pendientes ni asientos (raro); POST86-3/4 con
--                      movimiento/asientos (esperable solo si ya se corrió backfill);
--                      POST86-5 con reglas (*) pendientes de validar con contador.
--   · NO_VERIFICABLE → (no aplica acá; todos los objetos existen tras 0086).
--   El backfill REAL no se corre hasta: cadena de posteo aplicada hasta 0094 +
--   reglas validadas con contador + dry-run final OK + conciliación fiscal vs
--   contable + aprobación explícita. El dry-run de acc_backfill es el próximo paso
--   (no escribe), NO el backfill real.
-- =========================================================================
