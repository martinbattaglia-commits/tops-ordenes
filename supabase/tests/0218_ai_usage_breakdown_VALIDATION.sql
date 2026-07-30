-- 0218_ai_usage_breakdown_VALIDATION.sql — READ ONLY + un fixture con ROLLBACK.
-- NO es una migración: vive en supabase/tests/ y NO entra en la cadena de release.
-- Correr DESPUÉS de aplicar 0218. Cada check imprime PASS/FALLO.
--
-- POR QUÉ EXISTE, y por qué los tests de TypeScript no alcanzan.
-- Los tests que «cubren» 0218 son greps sobre el archivo: alcanza reescribir una
-- frase para eludirlos. Y el defecto que 0218 viene a cerrar —una conformidad que
-- el cliente se declara a sí mismo— vive DENTRO del SQL. La única prueba válida es
-- ejecutar la conducta contra el catálogo y contra los datos.
--
-- La lección que este kit hereda del de 0217: verificar la COLUMNA PERSISTIDA, no
-- el retorno del RPC. La primera versión de aquel kit leía el JSON devuelto y daba
-- PASS con el defecto presente.
-- ─────────────────────────────────────────────────────────────────────────────
\pset pager off

-- [1] Las tres columnas nuevas existen con el tipo y el default correctos.
select '[1] columnas nuevas (provider_usage jsonb, conforme bool NOT NULL default true, deviation text)' as check,
       case when count(*) = 3
             and bool_or(column_name='conforme' and is_nullable='NO' and column_default like '%true%')
            then 'PASS' else 'FALLO · ' || string_agg(column_name || ':' || data_type, ', ') end as result
from information_schema.columns
where table_schema='public' and table_name='ai_analysis_runs'
  and column_name in ('provider_usage','conforme','deviation');

-- [2] El desglose exige las CUATRO claves o ninguna.
select '[2] CHECK de forma del desglose: cuatro claves o NULL' as check,
       case when pg_get_constraintdef(oid) like '%promptTokens%'
             and pg_get_constraintdef(oid) like '%candidatesTokens%'
             and pg_get_constraintdef(oid) like '%thoughtsTokens%'
             and pg_get_constraintdef(oid) like '%totalTokens%'
            then 'PASS' else 'FALLO' end as result
from pg_constraint where conname='ai_analysis_runs_provider_usage_forma';

-- [3] Una no conformidad sin motivo no puede persistir.
select '[3] CHECK «no conforme ⇒ con motivo»' as check,
       case when count(*)=1 then 'PASS' else 'FALLO · ausente' end as result
from pg_constraint where conname='ai_analysis_runs_deviation_explicada';

-- [4] La firma VIEJA de 11 parámetros ya no existe: no hay vía sin conformidad.
select '[4] sólo queda la firma de 14 parámetros' as check,
       case when count(*)=1 and max(n)=14 then 'PASS'
            else 'FALLO · ' || count(*) || ' firmas, aridades=' || string_agg(n::text, '/') end as result
from (select pronargs as n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
      where ns.nspname='public' and p.proname='ai_finalize_analysis_run') x;

-- [5] La vista sigue respetando la RLS (`security_invoker` NO es el default).
select '[5] vista con security_invoker=true' as check,
       case when 'security_invoker=true' = any(c.reloptions) then 'PASS'
            else 'FALLO · reloptions=' || coalesce(c.reloptions::text,'{}') end as result
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='v_ai_spend_reconciliation';

-- [6] La vista conserva las 7 columnas de 0217 en el MISMO orden y agrega 4 al final.
select '[6] vista: 7 columnas de 0217 intactas + 4 nuevas al final' as check,
       case when cols[1:7] = array['periodo','corridas','corridas_auditadas','corridas_no_auditadas',
                                   'costo_declarado_por_corridas','costo_fuera_del_agregado',
                                   'corridas_sin_costo_verificable']
             and cols[8:11] = array['corridas_no_conformes','tokens_de_razonamiento',
                                    'tokens_de_salida_util','mayor_entrada_registrada']
            then 'PASS' else 'FALLO · ' || array_to_string(cols, ', ') end as result
from (select array_agg(column_name::text order by ordinal_position) as cols
      from information_schema.columns
      where table_schema='public' and table_name='v_ai_spend_reconciliation') x;

-- [7] `anon` sin acceso a la vista.
select '[7] anon sin SELECT sobre la vista' as check,
       case when not has_table_privilege('anon','public.v_ai_spend_reconciliation','SELECT')
            then 'PASS' else 'FALLO' end as result;

-- [8] El tope autorizado está en el cuerpo del RPC, no implícito.
select '[8] tope de entrada autorizado presente en el RPC (8000)' as check,
       case when pg_get_functiondef(p.oid) like '%c_max_input_tokens constant int := 8000%'
            then 'PASS' else 'FALLO' end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='ai_finalize_analysis_run';

-- [9] DATOS HISTÓRICOS: nada se declaró en falta retroactivamente.
select '[9] corridas historicas: conforme=true, deviation NULL, provider_usage NULL' as check,
       coalesce((select case when count(*)=0 then 'PASS · ' || (select count(*) from public.ai_analysis_runs) || ' corridas intactas'
                             else 'FALLO · ' || count(*) || ' filas alteradas' end
                 from public.ai_analysis_runs
                 where not conforme or deviation is not null or provider_usage is not null),
                'N/A') as result;

-- ═══ [10-13] CONDUCTA REAL, con ROLLBACK forzado: cero residuo ════════════════
do $$
declare
  v_uid uuid;
  v_conv uuid;
  v_run uuid := gen_random_uuid();
  v_run2 uuid := gen_random_uuid();
  r jsonb;
  v_conforme_col boolean;
  v_dev_col text;
  v_usage_col jsonb;
  res text := '';
begin
  select id into v_uid from auth.users limit 1;
  if v_uid is null then raise notice '[10-13] sin usuarios: N/A'; return; end if;
  perform set_config('request.jwt.claim.sub', v_uid::text, true);

  -- Se REUTILIZA una conversación existente: el kit no inventa datos de negocio y
  -- así corre igual en producción y en cualquier base de verificación. Todo se
  -- revierte con el RAISE final.
  select id into v_conv from public.connect_conversations
   where not exists (select 1 from public.ai_analysis_runs r2
                     where r2.conversation_id = public.connect_conversations.id
                       and r2.outcome = 'en_curso')
   limit 1;
  if v_conv is null then raise notice '[10-13] sin conversaciones disponibles: N/A'; return; end if;

  -- ── [10] 🔑 EL DEFECTO QUE 0218 CIERRA ────────────────────────────────────
  -- Se registra una auditoría que EXCEDE el tope (10.835 tokens, el número real
  -- de la 2ª corrida) y se cierra la corrida declarando `p_conforme => true`.
  -- La base tiene que CONTRADECIR al cliente.
  r := public.ai_claim_analysis_run(v_run, v_conv, 'wa_analysis', repeat('a',64), 120);
  if not ((r->>'ok')::boolean) then raise notice '[10] no se pudo reclamar: %', r; end if;

  insert into public.ai_sessions (id, user_id, channel) values (v_run, v_uid, 'panel');
  insert into public.ai_messages (session_id, user_id, seq, role, content_hash,
                                  provider, model, tokens_in, tokens_out, cost_estimate, outcome)
  values (v_run, v_uid, 1, 'user', repeat('f',64),
          'gemini', 'gemini-2.5-flash', 10835, 1990, 0.008226, 'error');

  r := public.ai_finalize_analysis_run(
         v_run, 'ok', 'gemini', 'gemini-2.5-flash', 120, 3,
         'STOP', null, 'prueba de validación',
         null, null,
         '{"promptTokens":10835,"candidatesTokens":1990,"thoughtsTokens":0,"totalTokens":12825}'::jsonb,
         true,   -- ⚠️ el cliente MIENTE: dice conforme
         null);

  select conforme, deviation, provider_usage into v_conforme_col, v_dev_col, v_usage_col
    from public.ai_analysis_runs where id = v_run;

  res := res || '[10] cliente declara conforme con 10835 tokens ⇒ la base lo niega (COLUMNA): '
             || case when v_conforme_col = false then 'PASS' else 'FALLO · conforme=' || v_conforme_col::text end || E'\n';
  res := res || '     y explica por qué, sin que el cliente lo pida: '
             || case when v_dev_col like '%context_limit_exceeded%' and v_dev_col like '%10835%'
                     then 'PASS' else 'FALLO · deviation=' || coalesce(v_dev_col,'null') end || E'\n';
  res := res || '     el desglose del proveedor queda persistido: '
             || case when (v_usage_col->>'thoughtsTokens') = '0'
                      and (v_usage_col->>'promptTokens') = '10835'
                     then 'PASS' else 'FALLO · ' || coalesce(v_usage_col::text,'null') end || E'\n';
  -- La economía sigue viniendo de ai_messages, no del cliente.
  res := res || '     economía DERIVADA de ai_messages (no del cliente): '
             || coalesce((select case when tokens_in = 10835 and audited
                                      then 'PASS' else 'FALLO · tokens_in='
                                           || coalesce(tokens_in::text,'null') end
                          from public.ai_analysis_runs where id = v_run), 'FALLO') || E'\n';

  -- ── [11] Dentro del tope, el veredicto del cliente se respeta ─────────────
  r := public.ai_claim_analysis_run(v_run2, v_conv, 'wa_analysis_b', repeat('b',64), 120);
  insert into public.ai_sessions (id, user_id, channel) values (v_run2, v_uid, 'panel');
  insert into public.ai_messages (session_id, user_id, seq, role, content_hash,
                                  provider, model, tokens_in, tokens_out, cost_estimate, outcome)
  values (v_run2, v_uid, 1, 'user', repeat('e',64),
          'gemini', 'gemini-2.5-flash', 7300, 2100, 0.003, 'answered');
  r := public.ai_finalize_analysis_run(
         v_run2, 'ok', 'gemini', 'gemini-2.5-flash', 81, 2, 'STOP', null, 'dentro del tope',
         null, null,
         '{"promptTokens":7300,"candidatesTokens":2100,"thoughtsTokens":0,"totalTokens":9400}'::jsonb,
         true, null);
  select conforme, deviation into v_conforme_col, v_dev_col
    from public.ai_analysis_runs where id = v_run2;
  res := res || '[11] 7300 tokens (dentro del tope) ⇒ conforme=true sin desviación: '
             || case when v_conforme_col and v_dev_col is null then 'PASS'
                     else 'FALLO · conforme=' || v_conforme_col::text || ' dev=' || coalesce(v_dev_col,'null') end || E'\n';

  -- ── [12] El cliente SÍ puede declarar no conforme por lo que la base no ve ─
  -- (p. ej. el tope de SALIDA). La base endurece, no ablanda.
  begin
    update public.ai_analysis_runs set outcome='en_curso', conforme=true, deviation=null
     where id = v_run2;
    r := public.ai_finalize_analysis_run(
           v_run2, 'ok', 'gemini', 'gemini-2.5-flash', 81, 2, 'MAX_TOKENS', null, 'salida cortada',
           null, null, null, false, 'output_limit_exceeded: la salida se cortó en el tope');
    select conforme, deviation into v_conforme_col, v_dev_col
      from public.ai_analysis_runs where id = v_run2;
    res := res || '[12] cliente declara NO conforme por el tope de salida ⇒ se respeta: '
               || case when v_conforme_col = false and v_dev_col like '%output_limit_exceeded%'
                       then 'PASS' else 'FALLO · conforme=' || v_conforme_col::text end || E'\n';
  exception when others then
    res := res || '[12] no evaluable: ' || SQLERRM || E'\n';
  end;

  -- ── [13] El CHECK no deja pasar una no conformidad muda ───────────────────
  begin
    update public.ai_analysis_runs set conforme = false, deviation = null where id = v_run;
    res := res || '[13] no conforme SIN motivo ⇒ el CHECK debía rechazarlo: FALLO (lo aceptó)' || E'\n';
  exception when check_violation then
    res := res || '[13] no conforme SIN motivo ⇒ RECHAZADO por el CHECK: PASS' || E'\n';
  end;

  raise exception E'\n== 0218 · CONDUCTA REAL ==\n%(TODO REVERTIDO)', res;
end $$;

-- [14] Reconciliación: las no conformes y el peso del razonamiento, visibles.
select '[14] reconciliacion' as check,
       coalesce((select 'corridas=' || corridas
                      || ' auditadas=' || corridas_auditadas
                      || ' NO conformes=' || corridas_no_conformes
                      || ' tokens de razonamiento=' || tokens_de_razonamiento
                      || ' mayor entrada=' || coalesce(mayor_entrada_registrada::text,'n/d')
                 from public.v_ai_spend_reconciliation
                 order by periodo desc limit 1),
                'sin corridas') as result;
