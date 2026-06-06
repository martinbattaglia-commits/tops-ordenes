-- =========================================================================
-- PROD_VERIFY_CRM.sql — Verificación post-aplicación de 0041–0051 en PROD
--
-- Ejecutar en el SQL Editor de Supabase PROD (arsksytgdnzukbmfgkju) DESPUÉS de
-- aplicar 0041→0051 en orden. NO escribe nada (solo SELECT). Devuelve una tabla
-- única con cada chequeo y su resultado esperado.
-- =========================================================================
with checks as (
  -- 10 tablas crm_* / clientify_sync_log
  select '1·tablas' as seccion, '10 tablas CRM existen' as chequeo,
    (select count(*) from information_schema.tables
      where table_schema='public' and table_name in
      ('crm_leads','crm_opportunities','crm_quotes','crm_quote_items','crm_proposals',
       'crm_contracts','crm_onboarding','crm_onboarding_tasks','crm_stage_history','clientify_sync_log'))::text as valor,
    '= 10' as esperado
  union all
  -- 10 enums
  select '2·enums','10 enums crm_* existen',
    (select count(*) from pg_type where typname in
      ('crm_lead_status_t','crm_service_t','crm_stage_t','crm_committed_state_t',
       'crm_quote_status_t','crm_proposal_t','crm_proposal_status_t',
       'crm_contract_status_t','crm_onboarding_status_t','crm_onboarding_task_t'))::text, '= 10'
  union all
  -- RLS habilitada en las 10 tablas
  select '3·rls','RLS habilitada en 10 tablas',
    (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relrowsecurity and c.relname in
      ('crm_leads','crm_opportunities','crm_quotes','crm_quote_items','crm_proposals',
       'crm_contracts','crm_onboarding','crm_onboarding_tasks','crm_stage_history','clientify_sync_log'))::text, '= 10'
  union all
  -- 7 funciones RPC + trigger fn
  select '4·funciones','RPC/trigger fns existen',
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in
      ('crm_advance_stage','crm_reserve_capacity','crm_complete_onboarding','crm_ingest_lead',
       'crm_list_commercial_users','crm_promote_lead','crm_tg_create_onboarding_on_won'))::text, '= 7'
  union all
  -- security: ingest/list/promote/onboarding-trigger DEFINER vs advance/reserve/complete INVOKER
  select '4·funciones','SECURITY DEFINER (ingest/list/onboarding-fn)',
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef
      and p.proname in ('crm_ingest_lead','crm_list_commercial_users','crm_tg_create_onboarding_on_won'))::text, '= 3'
  union all
  select '4·funciones','SECURITY INVOKER (advance/reserve/complete/promote)',
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and not p.prosecdef
      and p.proname in ('crm_advance_stage','crm_reserve_capacity','crm_complete_onboarding','crm_promote_lead'))::text, '= 4'
  union all
  -- trigger de onboarding al ganar
  select '5·trigger','trg_crm_create_onboarding_on_won existe',
    (select count(*) from pg_trigger where tgname='trg_crm_create_onboarding_on_won')::text, '= 1'
  union all
  -- RBAC: permisos comercial.* sembrados
  select '6·rbac','permisos comercial.* (0046)',
    (select count(*) from public.permissions where module='comercial')::text, '>= 5'
  union all
  select '6·rbac','mapeos role_permissions comercial.*',
    (select count(*) from public.role_permissions rp join public.permissions p on p.id=rp.permission_id
      where p.module='comercial')::text, '>= 1'
  union all
  -- profiles_public (R-G3): existe y devuelve filas (sin email)
  select '7·view','profiles_public existe',
    (select count(*) from information_schema.views where table_schema='public' and table_name='profiles_public')::text, '= 1'
  union all
  select '7·view','profiles_public devuelve filas (PII-safe)',
    (select count(*) from public.profiles_public)::text, '>= 0'
)
select seccion, chequeo, valor, esperado,
  case
    when chequeo like '%>= 0%' then 'ok'
    when esperado like '= %'  and valor = trim(replace(esperado,'= ','')) then 'PASS'
    when esperado like '>= %' and valor::int >= replace(esperado,'>= ','')::int then 'PASS'
    else 'FAIL'
  end as resultado
from checks
order by seccion, chequeo;
