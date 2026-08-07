-- 0216_ai_grants_hardening_VALIDATION.sql — READ ONLY, cero footprint.
-- NO es una migración: vive en supabase/tests/ y NO entra en la cadena de release.
-- Correr DESPUÉS de aplicar 0215 (retención) y 0216 (grants). Cada check imprime PASS/FALLO.
--
-- POR QUÉ ES OBLIGATORIO (hallazgo H-4 de la revisión adversarial):
-- `REVOKE` **no falla** si no hay nada que revocar, y sólo retira los privilegios
-- concedidos por el grantor que lo ejecuta. Si los default privileges de Supabase
-- fueron sentados por otro grantor, la migración termina «con éxito» y el agujero
-- queda abierto. Un no-op es indistinguible de un éxito ⇒ la única prueba válida es
-- interrogar el catálogo con `has_table_privilege`, no confiar en que el apply salió bien.
-- ─────────────────────────────────────────────────────────────────────────────

-- [1] Los cuatro privilegios PROHIBIDOS están cerrados para `authenticated`.
--     TRUNCATE es el crítico: la RLS no lo filtra, sólo el privilegio lo contiene.
select '[1] authenticated sin UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES' as check,
       case when bool_and(not has_table_privilege('authenticated', t, p))
            then 'PASS' else 'FALLO · ' || string_agg(t || ':' || p, ', ')
                                            filter (where has_table_privilege('authenticated', t, p))
       end as result
from unnest(array['public.ai_suggestions','public.ai_analysis_runs','public.ai_budget_alerts']) t
cross join unnest(array['UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES']) p;

-- [2] La matriz MÍNIMA concedida es exactamente la aprobada, sin faltantes ni sobrantes.
with esperado(t, p, debe) as (
  values
    ('public.ai_suggestions','SELECT',true),   ('public.ai_suggestions','INSERT',true),
    ('public.ai_suggestions','UPDATE',false),
    ('public.ai_analysis_runs','SELECT',true), ('public.ai_analysis_runs','INSERT',true),
    ('public.ai_analysis_runs','UPDATE',false),
    ('public.ai_budget_alerts','SELECT',true), ('public.ai_budget_alerts','INSERT',true),
    ('public.ai_budget_alerts','UPDATE',false)
)
select '[2] matriz exacta de authenticated' as check,
       case when bool_and(has_table_privilege('authenticated', t, p) = debe)
            then 'PASS' else 'FALLO · ' || string_agg(t || ':' || p || ' esperado=' || debe, ', ')
                                            filter (where has_table_privilege('authenticated', t, p) <> debe)
       end as result
from esperado;

-- [3] `anon` sin NINGÚN privilegio sobre las tres tablas.
select '[3] anon sin privilegios' as check,
       case when bool_and(not has_table_privilege('anon', t, p))
            then 'PASS' else 'FALLO · ' || string_agg(t || ':' || p, ', ')
                                            filter (where has_table_privilege('anon', t, p))
       end as result
from unnest(array['public.ai_suggestions','public.ai_analysis_runs','public.ai_budget_alerts']) t
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES']) p;

-- [4] ACL de tabla (relacl) — vista cruda, para leer qué quedó y de quién.
select '[4] relacl' as check, c.relname::text as tabla, c.relacl::text as result
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('ai_suggestions','ai_analysis_runs','ai_budget_alerts')
order by c.relname;

-- [5] Privilegios a nivel COLUMNA (hallazgo H-5): `REVOKE ALL ON TABLE` no limpia
--     `pg_attribute.attacl`. Este repo usa column grants de verdad (0143 sobre
--     connect_participants), así que la ausencia hay que probarla, no suponerla.
select '[5] sin column grants residuales' as check,
       case when count(*) = 0 then 'PASS'
            else 'FALLO · ' || string_agg(c.relname || '.' || a.attname, ', ') end as result
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('ai_suggestions','ai_analysis_runs','ai_budget_alerts')
  and a.attnum > 0 and not a.attisdropped
  and a.attacl is not null;

-- [6] La RLS sigue habilitada: 0215 no debía tocarla.
select '[6] RLS intacta' as check,
       case when bool_and(relrowsecurity) then 'PASS' else 'FALLO' end as result
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relname in ('ai_suggestions','ai_analysis_runs','ai_budget_alerts');

-- [7] Las policies de 0213/0214 siguen presentes y sin aflojarse.
select '[7] policies intactas (5 de 0213 + 2 de 0214)' as check,
       case when count(*) = 7 then 'PASS' else 'FALLO · hay ' || count(*) end as result
from pg_policies
where schemaname='public' and tablename in ('ai_suggestions','ai_analysis_runs','ai_budget_alerts');

-- [8] Cero mutación de datos por parte de la migración de GRANTS.
--     ⚠️ No se exige «tablas vacías»: en cuanto haya un análisis real eso sería un
--     FALLO por diseño (hallazgo A-10). Lo que se verifica es que 0216 no pudo
--     tocar datos: se informan los conteos para comparar contra la foto previa.
select '[8] conteos (comparar contra la foto previa al Gate)' as check,
       'sugerencias=' || (select count(*) from public.ai_suggestions)
    || ' corridas='   || (select count(*) from public.ai_analysis_runs)
    || ' alertas='    || (select count(*) from public.ai_budget_alerts) as result;

-- [9] H-1 CERRADO por 0215: las FK deben ser SET NULL, nunca CASCADE.
select '[9] FK sin CASCADE (H-1 cerrado por 0215)' as check,
       case when bool_and(confdeltype = 'n') then 'PASS · ' else 'FALLO · ' end ||
       string_agg(conrelid::regclass::text || '=' ||
                  case confdeltype when 'c' then 'CASCADE' when 'n' then 'SET NULL'
                                   when 'r' then 'RESTRICT' else confdeltype::text end,
                  ' · ' order by conrelid::regclass::text) as result
from pg_constraint
where contype='f' and confrelid='public.connect_conversations'::regclass
  and conrelid::regclass::text in ('ai_suggestions','ai_analysis_runs');

-- [10] `conversation_ref` obligatoria y con las claves mínimas (0215).
select '[10] conversation_ref exigida por CHECK' as check,
       case when count(*) = 2 then 'PASS' else 'FALLO · hay ' || count(*) end as result
from pg_constraint
where conname in ('ai_suggestions_conversation_ref_required',
                  'ai_analysis_runs_conversation_ref_required');

-- [11] Triggers de poblado e inmutabilidad presentes (0215).
--      Nota (A-10): 0213 dejó viva la policy "ai_suggestions admin update" mientras
--      0216 revoca UPDATE ⇒ es una policy MUERTA. No se elimina porque 0213 está
--      aplicada y sellada, pero queda advertido: si alguien concediera UPDATE en el
--      futuro, esa policy se reactivaría con TODAS las columnas abiertas.
select '[11] triggers set_ref + freeze_ref' as check,
       case when count(*) = 4 then 'PASS' else 'FALLO · hay ' || count(*) end as result
from pg_trigger t join pg_class c on c.oid = t.tgrelid
where not t.tgisinternal
  and c.relname in ('ai_suggestions','ai_analysis_runs')
  and t.tgname in ('ai_suggestions_set_ref','ai_analysis_runs_set_ref',
                   'ai_suggestions_freeze_ref','ai_analysis_runs_freeze_ref');
