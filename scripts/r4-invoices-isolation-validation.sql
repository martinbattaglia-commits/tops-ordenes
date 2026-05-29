-- =========================================================================
-- FASE E1 · R4 — Script de validación multi-tenant del bucket `invoices`
-- Ejecutar SOLO en STAGING (aislado), tras aplicar 0013.
--   psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f scripts/r4-invoices-isolation-validation.sql
--
-- Replica el patrón de prueba de storage usado en GATE 2 para `documents`:
-- simula un cliente (auth.uid + role) y verifica que SOLO ve su prefijo.
-- 100% read-only sobre datos (usa rollback); NO emite comprobantes.
-- =========================================================================

\echo '== R0: predicado de la policy de lectura (debe usar split_part por client_id) =='
select policyname, cmd, qual
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'invoices%'
order by policyname;

\echo '== R1: RLS habilitado en storage.objects =='
select relrowsecurity from pg_class where relname = 'objects' and relnamespace = 'storage'::regnamespace;

-- -------------------------------------------------------------------------
-- Simulación de aislamiento. NOTA (verificado en staging 2026-05-29):
--   public.profiles.id ⇒ FK a auth.users(id). Por eso NO se inventan perfiles:
--   se usan TRES fixtures `cliente` reales con client_id distinto + un admin.
--   Ajustar los UUID a los del entorno destino. Solo se siembran objetos en
--   storage.objects (sin FK), TODO dentro de una transacción que se revierte.
--
--   auth.uid()           = current_setting('request.jwt.claim.sub')::uuid
--   public.current_role()= select role from profiles where id = auth.uid()
--   ⇒ set_config('request.jwt.claim.sub', <uid>, true) simula al usuario.
-- -------------------------------------------------------------------------
\set userA 'aaaaaaaa-0000-0000-0000-000000000001'
\set cliA  '11111111-0000-0000-0000-0000000000a1'
\set userB 'bbbbbbbb-0000-0000-0000-000000000002'
\set cliB  '22222222-0000-0000-0000-0000000000b2'
\set admin 'eeeeeeee-0000-0000-0000-000000000005'

begin;

-- Objetos fiscales simulados, prefijados por client_id (canon buildInvoicePdfPath).
insert into storage.objects (bucket_id, name, owner, metadata) values
  ('invoices', :'cliA' || '/2026/05/11-00002-00000001-deadbeef.pdf', null, '{}'::jsonb),
  ('invoices', :'cliB' || '/2026/05/11-00002-00000001-cafebabe.pdf', null, '{}'::jsonb)
on conflict do nothing;

\echo '== Q1: Cliente A — total_visible=1, ve_propio=1, ve_de_B=0 (DENEGADO) =='
set local role authenticated;
select set_config('request.jwt.claim.sub', :'userA', true);
select count(*) as a_total_visible,
       count(*) filter (where split_part(name,'/',1)=:'cliA') as a_ve_propio,
       count(*) filter (where split_part(name,'/',1)=:'cliB') as a_ve_de_B_debe_0
from storage.objects where bucket_id='invoices';
reset role;

\echo '== Q2: Cliente B — total_visible=1, ve_propio=1, ve_de_A=0 (DENEGADO) =='
set local role authenticated;
select set_config('request.jwt.claim.sub', :'userB', true);
select count(*) as b_total_visible,
       count(*) filter (where split_part(name,'/',1)=:'cliB') as b_ve_propio,
       count(*) filter (where split_part(name,'/',1)=:'cliA') as b_ve_de_A_debe_0
from storage.objects where bucket_id='invoices';
reset role;

\echo '== Q3: Staff admin ve TODOS (espera 2) =='
set local role authenticated;
select set_config('request.jwt.claim.sub', :'admin', true);
select count(*) as admin_total_visible from storage.objects where bucket_id='invoices';
reset role;

\echo '== VEREDICTO R4 (PASS solo si A no ve B y B no ve A) =='
set local role authenticated;
select set_config('request.jwt.claim.sub', :'userA', true);
create temp table _a as
  select count(*) filter (where split_part(name,'/',1)=:'cliB') c
  from storage.objects where bucket_id='invoices';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'userB', true);
create temp table _b as
  select count(*) filter (where split_part(name,'/',1)=:'cliA') c
  from storage.objects where bucket_id='invoices';
reset role;
select case when (select c from _a)=0 and (select c from _b)=0
            then 'PASS — aislamiento cross-tenant ENFORCED'
            else 'FAIL — FUGA cross-tenant detectada' end as veredicto_r4;

rollback;

\echo '== R4 VALIDATION COMPLETE (transacción revertida; sin cambios persistidos) =='
