-- =========================================================================
-- RLS_0040_SMOKE_TEST.sql — Smoke test READ-ONLY post-aplicación de 0040.
-- Para el SQL Editor de Supabase. NO muta datos. Correr DESPUÉS de aplicar 0040.
--
-- Dos partes:
--   A. CHECKS DE CATÁLOGO  → 100% deterministas, corren como postgres. Esperado: todo 'OK'.
--   B. CHECK DE COMPORTAMIENTO (OPCIONAL) → impersonación bajo BEGIN/ROLLBACK (read-only).
--      La verificación autoritativa de "non-admin ve solo su fila" es por app/API (ver runbook §4.2),
--      porque el SQL Editor corre como postgres (BYPASSRLS).
-- =========================================================================

-- =========================================================================
-- A. CHECKS DE CATÁLOGO — esperado: columna resultado = 'OK' en todas las filas.
-- =========================================================================
with checks as (
  select 1 as ord,
    'RLS habilitada en public.profiles' as chk,
    case when (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass)
         then 'OK' else 'FALLO' end as resultado,
    coalesce((select relrowsecurity::text from pg_class where oid = 'public.profiles'::regclass), '?') as detalle
  union all
  select 2,
    'Policy nueva "profiles read own or admin" (SELECT) existe',
    case when exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='profiles'
        and policyname='profiles read own or admin' and cmd='SELECT'
    ) then 'OK' else 'FALLO' end,
    ''
  union all
  select 3,
    'Policy vieja "profiles read own or staff" eliminada',
    case when not exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='profiles'
        and policyname='profiles read own or staff'
    ) then 'OK' else 'FALLO' end,
    ''
  union all
  select 4,
    'qual de la policy usa is_admin y NO is_staff',
    case when exists (
      select 1 from pg_policies
      where schemaname='public' and tablename='profiles'
        and policyname='profiles read own or admin'
        and qual ilike '%is_admin%' and qual not ilike '%is_staff%'
    ) then 'OK' else 'FALLO' end,
    coalesce((select qual from pg_policies
              where schemaname='public' and tablename='profiles'
                and policyname='profiles read own or admin'), '')
  union all
  select 5,
    'Exactamente 1 policy SELECT en profiles (sin permisivas extra que anulen por OR)',
    case when (select count(*) from pg_policies
               where schemaname='public' and tablename='profiles' and cmd='SELECT') = 1
         then 'OK' else 'FALLO' end,
    (select count(*)::text from pg_policies
     where schemaname='public' and tablename='profiles' and cmd='SELECT')
  union all
  select 6,
    'Funciones is_admin / is_staff / current_role presentes',
    case when (select count(distinct proname) from pg_proc
               where pronamespace='public'::regnamespace
                 and proname in ('is_admin','is_staff','current_role')) >= 3
         then 'OK' else 'FALLO' end,
    coalesce((select string_agg(distinct proname, ',' order by proname) from pg_proc
              where pronamespace='public'::regnamespace
                and proname in ('is_admin','is_staff','current_role')), '')
  union all
  select 7,
    'Policies INSERT/UPDATE/DELETE de profiles intactas (own-or-admin / admin)',
    case when (select count(*) from pg_policies
               where schemaname='public' and tablename='profiles' and cmd in ('INSERT','UPDATE','DELETE')) >= 3
         then 'OK' else 'FALLO' end,
    (select count(*)::text from pg_policies
     where schemaname='public' and tablename='profiles' and cmd in ('INSERT','UPDATE','DELETE'))
)
select ord, chk, resultado, detalle
from checks
order by (resultado = 'OK'), ord;  -- FALLO primero si los hubiera

-- =========================================================================
-- B. CHECK DE COMPORTAMIENTO — OPCIONAL, read-only (BEGIN/ROLLBACK, sin mutación de datos).
--    Impersona usuarios reales para verificar visibilidad de filas bajo la RLS nueva.
--    Si tu entorno no permite `set local role`, omití esta parte y usá la app/API (runbook §4.2).
-- =========================================================================
begin;
  -- Capturar UUIDs y total como rol actual (postgres bypassa RLS). GUCs transaction-local.
  select set_config('qa.admin_id',    (select id::text from public.profiles where role='admin'  order by created_at limit 1), true);
  select set_config('qa.nonadmin_id', (select id::text from public.profiles where role<>'admin' order by created_at limit 1), true);
  select set_config('qa.total',       (select count(*)::text from public.profiles), true);

  -- Pasar a rol no-privilegiado para que la RLS aplique.
  set local role authenticated;

  -- ADMIN impersonado → debe ver TODAS las filas.
  select set_config('request.jwt.claims',
         json_build_object('sub', current_setting('qa.admin_id'), 'role', 'authenticated')::text, true);
  select 'B1 · admin ve todas las filas' as chk,
         (select count(*) from public.profiles) as visibles,
         current_setting('qa.total') as esperado,
         case when (select count(*) from public.profiles)::text = current_setting('qa.total')
              then 'OK' else 'FALLO' end as resultado;

  -- NO-ADMIN impersonado → debe ver SOLO su fila (1).
  select set_config('request.jwt.claims',
         json_build_object('sub', current_setting('qa.nonadmin_id'), 'role', 'authenticated')::text, true);
  select 'B2 · non-admin ve solo su fila' as chk,
         (select count(*) from public.profiles) as visibles,
         '1' as esperado,
         case when (select count(*) from public.profiles) = 1 then 'OK' else 'FALLO' end as resultado;

  -- NO-ADMIN no puede leer el email de otro usuario (esperado: 0 filas del admin).
  select 'B3 · non-admin NO ve email de otros' as chk,
         (select count(*) from public.profiles where id = current_setting('qa.admin_id')::uuid) as filas_admin_visibles,
         '0' as esperado,
         case when (select count(*) from public.profiles where id = current_setting('qa.admin_id')::uuid) = 0
              then 'OK' else 'FALLO' end as resultado;
rollback;  -- sin persistir nada

-- Resultado esperado global: A = todas 'OK'; B1/B2/B3 = 'OK'.
