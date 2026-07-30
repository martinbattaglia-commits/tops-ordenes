-- 0217_ai_run_lifecycle_VALIDATION.sql — READ ONLY + un fixture con ROLLBACK.
-- NO es una migración: vive en supabase/tests/ y NO entra en la cadena de release.
-- Correr DESPUÉS de aplicar 0217. Cada check imprime PASS/FALLO.
--
-- POR QUÉ EXISTE, y por qué no alcanzaba con los tests de TypeScript.
-- La revalidación adversarial rompió el código de producción de cinco maneras y la
-- suite sólo detectó cuatro. La quinta —el RPC escribiendo `cost_usd = 0` en lugar
-- de NULL— **ninguna suite de TypeScript puede detectarla**: es semántica dentro
-- del SQL, y los tests que "cubrían" 0217 eran greps de texto sobre el archivo.
-- Un grep no protege nada: alcanza cambiar la conducta dejando el string en su lugar.
-- Este kit ejecuta la conducta real contra el catálogo y contra los datos.
-- ─────────────────────────────────────────────────────────────────────────────
\pset pager off

-- [1] Estados nuevos admitidos por el CHECK.
select '[1] outcome admite en_curso y audit_failure' as check,
       case when pg_get_constraintdef(oid) like '%en_curso%'
             and pg_get_constraintdef(oid) like '%audit_failure%'
            then 'PASS' else 'FALLO' end as result
from pg_constraint where conname = 'ai_analysis_runs_outcome_check';

-- [2] EL CANDADO: índice único parcial sobre las corridas activas.
select '[2] candado: unico parcial (conversation_id, analysis_kind) where en_curso' as check,
       case when count(*) = 1 then 'PASS' else 'FALLO' end as result
from pg_indexes
where schemaname='public' and indexname='ai_analysis_runs_una_activa_uq'
  and indexdef like '%WHERE (outcome = ''en_curso''::text)%';

-- [3] La firma del cierre NO acepta economía del cliente.
select '[3] ai_finalize_analysis_run sin p_tokens/p_cost/p_audited' as check,
       case when args not like '%p_tokens%'
             and args not like '%p_cost%'
             and args not like '%p_audited%'
            then 'PASS' else 'FALLO · ' || args end as result
from (select pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='ai_finalize_analysis_run') x;

-- [4] La vista respeta la RLS. `security_invoker` NO es el default: si falta, la
--     vista corre como su dueño y saltea la RLS de la tabla.
select '[4] vista con security_invoker=true' as check,
       case when 'security_invoker=true' = any(c.reloptions) then 'PASS'
            else 'FALLO · reloptions=' || coalesce(c.reloptions::text,'{}') end as result
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='v_ai_spend_reconciliation';

-- [5] Privilegios: `anon` sin nada; `authenticated` sólo SELECT sobre la vista.
select '[5] anon sin acceso a la vista' as check,
       case when not has_table_privilege('anon','public.v_ai_spend_reconciliation','SELECT')
            then 'PASS' else 'FALLO' end as result;

-- [6] Ambos RPC exigen administrador (no sólo sesión).
select '[6] los dos RPC exigen is_admin()' as check,
       case when count(*) = 2 then 'PASS' else 'FALLO · ' || count(*) end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('ai_claim_analysis_run','ai_finalize_analysis_run')
  and pg_get_functiondef(p.oid) like '%requiere rol administrador%';

-- [7] TTL con TECHO, no sólo piso (un TTL absurdo bloqueaba el hilo por décadas).
select '[7] TTL acotado por arriba' as check,
       case when pg_get_functiondef(p.oid) like '%least(greatest(coalesce(p_ttl_seconds%'
            then 'PASS' else 'FALLO' end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='ai_claim_analysis_run';

-- [8] Conteos: 0217 no crea ni borra nada.
select '[8] conteos (comparar contra la foto previa)' as check,
       'corridas=' || (select count(*) from public.ai_analysis_runs)
    || ' sugerencias=' || (select count(*) from public.ai_suggestions)
    || ' alertas=' || (select count(*) from public.ai_budget_alerts) as result;

-- [9] La corrida histórica fallida se conserva SIN maquillar.
select '[9] corrida historica: audited=false y cost_usd NULL' as check,
       coalesce((select case when audited = false and cost_usd is null
                             then 'PASS · outcome=' || outcome
                             else 'FALLO · audited=' || audited || ' cost=' || coalesce(cost_usd::text,'null') end
                 from public.ai_analysis_runs
                 where outcome <> 'en_curso' order by created_at limit 1),
                'N/A · no hay corridas') as result;

-- [10] `started_at` de las filas preexistentes no miente.
select '[10] started_at = created_at en filas previas a 0217' as check,
       case when count(*) = 0 then 'PASS'
            else 'FALLO · ' || count(*) || ' filas con started_at posterior' end as result
from public.ai_analysis_runs
where started_at is not null and created_at < started_at - interval '1 second';

-- ═══ [11-14] CONDUCTA REAL, con ROLLBACK forzado: cero residuo ═══════════════
-- Es lo que ninguna suite de TypeScript puede probar. El RAISE final aborta todo.
do $$
declare
  v_uid uuid;
  v_conv uuid;
  v_run uuid := gen_random_uuid();
  v_run2 uuid := gen_random_uuid();
  r jsonb;
  v_audited_col boolean;
  v_cost_col numeric;
  res text := '';
begin
  select id into v_uid from auth.users limit 1;
  if v_uid is null then raise notice '[11-14] sin usuarios: N/A'; return; end if;
  perform set_config('request.jwt.claim.sub', v_uid::text, true);

  -- Se REUTILIZA una conversación existente en vez de crear una: el kit no
  -- necesita inventar datos y así corre igual en producción y en cualquier base de
  -- verificación, sin depender de los valores del enum de `kind`. Todo lo que
  -- sigue se revierte con el RAISE final, así que el hilo real no se altera.
  select id into v_conv from public.connect_conversations
   where not exists (select 1 from public.ai_analysis_runs r
                     where r.conversation_id = public.connect_conversations.id
                       and r.outcome = 'en_curso')
   limit 1;
  if v_conv is null then raise notice '[11-14] sin conversaciones disponibles: N/A'; return; end if;

  -- [11] Reclamar y volver a reclamar ⇒ conflicto (el candado funciona).
  r := public.ai_claim_analysis_run(v_run, v_conv, 'wa_analysis', repeat('a',64), 120);
  res := res || '[11] primer claim: '
             || case when ((r->>'ok')::boolean) then 'PASS' else 'FALLO' end || E'\n';
  r := public.ai_claim_analysis_run(v_run2, v_conv, 'wa_analysis', repeat('a',64), 120);
  res := res || '     segundo claim: '
             || case when (r->>'reason') = 'conflicto' then 'RECHAZADO·PASS' else 'FALLO' end || E'\n';

  -- [12] 🔑 Cerrar SIN asiento en ai_messages ⇒ audited=false y cost_usd NULL.
  --      Esta es la rotura que la suite de TypeScript no puede detectar: si el RPC
  --      escribiera `coalesce(v_cost, 0)`, una corrida sin costo verificable
  --      quedaría registrada como «cero», y sería invisible en la reconciliación.
  r := public.ai_finalize_analysis_run(
         v_run, 'error', 'gemini', 'gemini-2.5-flash', 120, 0,
         'MAX_TOKENS', 'max_tokens', 'prueba de validación');
  -- 🔑 Se verifica la COLUMNA PERSISTIDA, no el retorno del RPC. La primera versión
  -- de este kit leía el JSON devuelto, y la mutación de prueba —escribir
  -- `coalesce(v_cost,0)` en la columna— seguía devolviendo NULL en ese JSON: el
  -- check daba PASS con el defecto presente. Validar el reporte en lugar del
  -- registro es la misma clase de error que un test que hace grep de texto.
  select audited, cost_usd into v_audited_col, v_cost_col
    from public.ai_analysis_runs where id = v_run;
  res := res || '[12] sin asiento ⇒ audited=false (columna): '
             || case when v_audited_col = false then 'PASS' else 'FALLO' end || E'\n';
  res := res || '     sin asiento ⇒ cost_usd NULL en la COLUMNA (NO cero): '
             || case when v_cost_col is null then 'PASS'
                     else 'FALLO · cost_usd=' || v_cost_col::text end || E'\n';

  -- [13] Doble cierre ⇒ ya_cerrada, sin reescribir.
  r := public.ai_finalize_analysis_run(
         v_run, 'ok', 'gemini', 'x', 1, 5, null, null, 'segundo intento');
  res := res || '[13] doble cierre: '
             || case when (r->>'reason') = 'ya_cerrada' then 'RECHAZADO·PASS' else 'FALLO' end || E'\n';

  -- [14] Tras un cierre terminal, se puede reintentar.
  r := public.ai_claim_analysis_run(gen_random_uuid(), v_conv, 'wa_analysis', repeat('b',64), 10);
  res := res || '[14] reintento tras terminal: '
             || case when ((r->>'ok')::boolean) then 'PERMITIDO·PASS' else 'FALLO' end || E'\n';

  raise exception E'\n== 0217 · CONDUCTA REAL ==\n%(TODO REVERTIDO)', res;
end $$;

-- [15] Reconciliación: qué quedó fuera del agregado mensual.
--      `ai_monthly_spend()` sólo ve `ai_messages`; esta vista muestra el gasto que
--      NO entró, para que «no contabilizado» sea visible en vez de invisible.
select '[15] reconciliacion' as check,
       coalesce((select 'corridas=' || corridas
                      || ' auditadas=' || corridas_auditadas
                      || ' NO auditadas=' || corridas_no_auditadas
                      || ' costo fuera del agregado=' || costo_fuera_del_agregado
                      || ' sin costo verificable=' || corridas_sin_costo_verificable
                 from public.v_ai_spend_reconciliation
                 order by periodo desc limit 1),
                'sin corridas') as result;
