-- 0180_ai_budget_overrides_VALIDATION.sql — read-only (+ 1 fixture con rollback
-- por sentinel, 0 footprint). NO es una migración: vive en supabase/tests/ y NO
-- se aplica en la cadena de release. Correr MANUALMENTE en el SQL Editor de prod
-- DESPUÉS de aplicar 0180 (los checks [6]/[7] asumen que también se corrió el
-- seed manual supabase/seed/MANUAL_ai_budget_overrides_superadmin.sql).
-- NO escribe nada persistente. Cada check imprime PASS/FALLO.
-- ─────────────────────────────────────────────────────────────────────────

-- [1] Tabla existe con RLS habilitada.
select '[1] RLS habilitada' as check,
       case when relrowsecurity then 'PASS' else 'FALLO' end as result
from pg_class where oid = 'public.ai_budget_overrides'::regclass;

-- [2] Policies: SOLO admin (todas las qual/withcheck referencian is_admin()).
select '[2] policies admin-only' as check,
       case when count(*) >= 1
             and bool_and(coalesce(pg_get_expr(polqual, polrelid),'') ilike '%is_admin()%')
             and bool_and(polwithcheck is null
                          or pg_get_expr(polwithcheck, polrelid) ilike '%is_admin()%')
            then 'PASS' else 'FALLO' end as result
from pg_policy where polrelid = 'public.ai_budget_overrides'::regclass;

-- [3] CHECK de dominio de daily_limit (rango [1, 100000]) presente.
select '[3] check daily_limit rango' as check,
       case when exists (
         select 1 from pg_constraint
         where conrelid = 'public.ai_budget_overrides'::regclass
           and conname = 'ai_budget_overrides_daily_limit_ck'
       ) then 'PASS' else 'FALLO' end as result;

-- [4] ai_daily_limit_for = SECURITY DEFINER + search_path seguro (public, pg_temp).
select '[4] fn DEFINER + search_path' as check,
       case when p.prosecdef
             and array_to_string(p.proconfig, ',') ilike '%search_path=%pg_temp%'
            then 'PASS' else 'FALLO' end as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'ai_daily_limit_for';

-- [5] anon SIN acceso (ni ejecutar la función ni leer la tabla).
select '[5] anon sin acceso' as check,
       case when not has_function_privilege('anon','public.ai_daily_limit_for(integer)','execute')
             and not has_table_privilege('anon','public.ai_budget_overrides','select')
            then 'PASS' else 'FALLO' end as result;

-- [6] (post-seed) Ambas cuentas de Martín tienen override 300 vigente.
select '[6] seed superadmin 300' as check,
       case when count(*) = 2
             and bool_and(o.daily_limit = 300
                          and (o.expires_at is null or o.expires_at > now()))
            then 'PASS'
            else format('PENDIENTE/FALLO (%s filas)', count(*)) end as result
from public.ai_budget_overrides o
join auth.users u on u.id = o.user_id
where lower(u.email) in ('martin@logisticatops.com','martin.battaglia@logisticatops.com');

-- [7] Pilotos comunes SIN override → siguen en el default (40).
select '[7] pilotos comunes sin override' as check,
       case when not exists (
         select 1 from public.ai_budget_overrides o
         join auth.users u on u.id = o.user_id
         where lower(u.email) not in ('martin@logisticatops.com','martin.battaglia@logisticatops.com')
       ) then 'PASS' else 'REVISAR (hay overrides adicionales — verificar que sean intencionales)' end as result;

-- [8] Tope mensual global intacto: ai_monthly_spend() sigue existiendo.
select '[8] ai_monthly_spend presente' as check,
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'ai_monthly_spend'
       ) then 'PASS' else 'FALLO' end as result;

-- [9] Auditoría intacta: ai_messages y ai_log_interaction sin cambios de 0180.
select '[9] auditoria intacta (ai_messages + ai_log_interaction)' as check,
       case when to_regclass('public.ai_messages') is not null
             and exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                         where n.nspname='public' and p.proname='ai_log_interaction')
            then 'PASS' else 'FALLO' end as result;

-- [10] ai_pilot_users NO fue tocada por 0180 (estructura intacta: 3 columnas).
select '[10] ai_pilot_users intacta' as check,
       case when (select count(*) from information_schema.columns
                  where table_schema='public' and table_name='ai_pilot_users') = 3
            then 'PASS' else 'FALLO' end as result;

-- [11] COMPORTAMIENTO ai_daily_limit_for (vigente vs vencido vs sin override).
-- Fixture 0-footprint: inserta filas de prueba, evalúa como el usuario de prueba
-- (auth.uid() desde request.jwt.claims) y hace ROLLBACK por sentinel. Nada persiste.
do $$
declare
  v_test    uuid    := '00000000-0000-4000-8000-0000000000aa';
  v_none    integer;
  v_active  integer;
  v_expired integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_test::text)::text, true);
  perform set_config('request.jwt.claim.sub', v_test::text, true);

  v_none := public.ai_daily_limit_for(40);                       -- sin override → 40

  insert into public.ai_budget_overrides (user_id, daily_limit) values (v_test, 300);
  v_active := public.ai_daily_limit_for(40);                     -- vigente → 300

  update public.ai_budget_overrides set expires_at = now() - interval '1 day'
   where user_id = v_test;
  v_expired := public.ai_daily_limit_for(40);                    -- vencido → 40

  raise notice '[11] sin=% (esp 40) | vigente=% (esp 300) | vencido=% (esp 40) => %',
    v_none, v_active, v_expired,
    case when v_none = 40 and v_active = 300 and v_expired = 40 then 'PASS' else 'FALLO' end;

  raise exception '__qa_rollback__';   -- revierte el fixture (0 footprint)
exception when others then
  if sqlerrm <> '__qa_rollback__' then raise; end if;
end $$;
