-- 0179 — KIT DE VALIDACIÓN (SOLO LECTURA). F5.1-b.0.1.2 · ai_docs_browse FTS.
-- Correr en el SQL Editor DESPUÉS de aplicar 0179, en la ventana autorizada.
-- NINGUNA sentencia escribe. Cada bloque imprime PASS/FAIL o un conteo esperado.
-- Valores esperados verificados read-only en vivo 2026-07-03 (pueden variar si cambió la fuente).
-- ─────────────────────────────────────────────────────────────────────────────

-- V1. SECURITY INVOKER preservado (NO SECURITY DEFINER → hereda RLS de searchable_items).
select 'V1 invoker' as check,
       case when not prosecdef then 'PASS' else 'FAIL (no debe ser SECURITY DEFINER)' end as veredicto
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'ai_docs_browse';

-- V2. Contrato de salida = 7 columnas (entity_type, entity_id, public_id, title, excerpt, status, entity_date).
select 'V2 contrato' as check,
       case when count(*) = 7 then 'PASS' else 'FAIL (≠7 columnas)' end as veredicto
from information_schema.columns
where table_schema = 'public' and table_name = 'ai_docs_browse';

-- V3. MULTI-PALABRA que el ILIKE viejo NO encontraba, ahora SÍ (FTS tokenizado + acentos).
--     (Corre como el caller: superuser en SQL Editor = RLS bypass → valida LÓGICA de retrieval.)
select 'V3 multi-palabra' as check, q as query, n as hits,
       case when n > 0 then 'PASS' else 'FAIL (0 resultados)' end as veredicto
from (
  select 'residuos nacion'          as q, (select count(*) from public.ai_docs_browse('compliance','residuos nacion',20)) as n
  union all select 'impacto ambiental lujan',     (select count(*) from public.ai_docs_browse('compliance','impacto ambiental lujan',20))
  union all select 'plancheta habilitacion lujan', (select count(*) from public.ai_docs_browse('compliance','plancheta habilitacion lujan',20))
  union all select 'certificado ambiental',       (select count(*) from public.ai_docs_browse('compliance','certificado ambiental',20))
  union all select 'CAA Magaldi',                 (select count(*) from public.ai_docs_browse('compliance','CAA Magaldi',20))
) t order by q;

-- V4. Palabra suelta sigue funcionando (no-regresión vs ILIKE).
select 'V4 palabra suelta' as check, q as query, n as hits,
       case when n > 0 then 'PASS' else 'FAIL' end as veredicto
from (
  select 'residuos' as q, (select count(*) from public.ai_docs_browse('compliance','residuos',50)) as n
  union all select 'ambiental', (select count(*) from public.ai_docs_browse('compliance','ambiental',50))
  union all select 'plancheta', (select count(*) from public.ai_docs_browse('compliance','plancheta',50))
) t order by q;

-- V5. LISTADO sin query (p_query null) → devuelve fichas por tipo (path de "cuáles son los archivos").
select 'V5 listado' as check,
       (select count(*) from public.ai_docs_browse('compliance', null, 50)) as compliance_listado,
       (select count(*) from public.ai_docs_browse('contrato',  null, 50)) as contrato_listado,
       case when (select count(*) from public.ai_docs_browse('compliance', null, 50)) > 0
             and (select count(*) from public.ai_docs_browse('contrato', null, 50)) > 0
            then 'PASS' else 'FAIL (listado vacío)' end as veredicto;

-- V6. PII en el OUTPUT = 0 (título/excerpt vienen del body YA redactado; sin CUIT/corridas ≥7 díg).
select 'V6 PII output' as check,
       count(*) filter (where title ~ '[0-9]{7,}' or excerpt ~ '[0-9]{7,}'
                          or title ~ '[0-9]{1,3}([.[:space:]-][0-9]{3}){2,}') as pii_hits,
       case when count(*) filter (where title ~ '[0-9]{7,}' or excerpt ~ '[0-9]{7,}'
                          or title ~ '[0-9]{1,3}([.[:space:]-][0-9]{3}){2,}') = 0
            then 'PASS' else 'FAIL (PII en output)' end as veredicto
from public.ai_docs_browse('compliance','ambiental',50);

-- V7. Solo entity_types documentales (nunca otras entidades del spine).
select 'V7 scope entity_type' as check,
       case when bool_and(entity_type in ('compliance_documento','contrato')) then 'PASS'
            else 'FAIL (fuga de otro entity_type)' end as veredicto
from public.ai_docs_browse(null,'lujan',50);

-- V8. Cap defensivo: nunca > 50 filas aunque se pida más.
select 'V8 cap' as check,
       (select count(*) from public.ai_docs_browse('compliance','lujan',999)) as rows_returned,
       case when (select count(*) from public.ai_docs_browse('compliance','lujan',999)) <= 50
            then 'PASS' else 'FAIL (superó el cap 50)' end as veredicto;

-- V9. RLS por piloto (correr con sesión de un PILOTO real, NO postgres): debe ver fichas;
--     un NO-piloto (sin knowledge.view) debe ver 0. Verificar en el smoke con usuario piloto.
--     (No automatizable acá porque el SQL Editor corre como superuser/owner.)
