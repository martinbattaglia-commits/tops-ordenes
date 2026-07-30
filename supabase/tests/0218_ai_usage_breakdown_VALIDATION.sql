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
--
-- ══ v2 · CORRECCIONES DEL KIT (Gate SQL 0218, pre-aplicación) ═════════════════
-- C-1 · ENDURECIMIENTO. Los checks que consultaban `pg_constraint` / `pg_class` /
--   `pg_proc` por nombre devolvían CERO FILAS cuando el objeto no existía, en vez
--   de una fila con FALLO. En una salida larga, una fila ausente se lee como «no
--   aplica» y no como «falló» — un check que puede desaparecer no es un check.
--   Ahora van envueltos en `coalesce((select …), 'FALLO · ausente')`.
--   Igual [6]: con la vista ausente, `'FALLO · ' || array_to_string(NULL,…)` daba
--   NULL, no un FALLO visible.
-- C-2 · COBERTURA. Se agregan los puntos del postcheck de Dirección que la v1 no
--   ejercitaba: usage PARCIAL rechazado · `usage = NULL` como NO VERIFICABLE ·
--   total de tokens consistente · `thoughts = 0` distinguible de NULL · RLS de la
--   vista probada por CONDUCTA (no sólo por privilegio).
-- Ninguna aserción se relajó. Verificado pre-aplicación que todo el archivo parsea:
-- los checks que tocan objetos de 0218 fallan con 42703/42883, ninguno con 42601.
-- ─────────────────────────────────────────────────────────────────────────────
\pset pager off

-- [1] Las tres columnas nuevas existen con el tipo y el default correctos.
select '[1] columnas nuevas (provider_usage jsonb, conforme bool NOT NULL default true, deviation text)' as check,
       case when count(*) = 3
             and bool_or(column_name='conforme' and is_nullable='NO' and column_default like '%true%')
            then 'PASS' else 'FALLO · ' || coalesce(string_agg(column_name || ':' || data_type, ', '), 'ninguna') end as result
from information_schema.columns
where table_schema='public' and table_name='ai_analysis_runs'
  and column_name in ('provider_usage','conforme','deviation');

-- [2] El desglose exige las CUATRO claves o ninguna.
select '[2] CHECK de forma del desglose: cuatro claves o NULL' as check,
       coalesce((select case when pg_get_constraintdef(oid) like '%promptTokens%'
                              and pg_get_constraintdef(oid) like '%candidatesTokens%'
                              and pg_get_constraintdef(oid) like '%thoughtsTokens%'
                              and pg_get_constraintdef(oid) like '%totalTokens%'
                             then 'PASS' else 'FALLO · definición incompleta' end
                 from pg_constraint where conname='ai_analysis_runs_provider_usage_forma'),
                'FALLO · ausente') as result;

-- [3] Una no conformidad sin motivo no puede persistir.
select '[3] CHECK «no conforme ⇒ con motivo»' as check,
       case when count(*)=1 then 'PASS' else 'FALLO · ausente' end as result
from pg_constraint where conname='ai_analysis_runs_deviation_explicada';

-- [4] La firma VIEJA de 11 parámetros ya no existe: no hay vía sin conformidad.
select '[4] sólo queda la firma de 14 parámetros' as check,
       case when count(*)=1 and max(n)=14 then 'PASS'
            else 'FALLO · ' || count(*) || ' firmas, aridades=' || coalesce(string_agg(n::text, '/'),'ninguna') end as result
from (select pronargs as n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
      where ns.nspname='public' and p.proname='ai_finalize_analysis_run') x;

-- [5] La vista sigue respetando la RLS (`security_invoker` NO es el default).
select '[5] vista con security_invoker=true' as check,
       coalesce((select case when 'security_invoker=true' = any(c.reloptions) then 'PASS'
                             else 'FALLO · reloptions=' || coalesce(c.reloptions::text,'{}') end
                 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                 where n.nspname='public' and c.relname='v_ai_spend_reconciliation'),
                'FALLO · sin vista') as result;

-- [6] La vista conserva las 7 columnas de 0217 en el MISMO orden y agrega 4 al final.
select '[6] vista: 7 columnas de 0217 intactas + 4 nuevas al final' as check,
       coalesce(
         case when cols[1:7] = array['periodo','corridas','corridas_auditadas','corridas_no_auditadas',
                                     'costo_declarado_por_corridas','costo_fuera_del_agregado',
                                     'corridas_sin_costo_verificable']
               and cols[8:11] = array['corridas_no_conformes','tokens_de_razonamiento',
                                      'tokens_de_salida_util','mayor_entrada_registrada']
              then 'PASS' else 'FALLO · ' || array_to_string(cols, ', ') end,
         'FALLO · vista ausente o sin columnas') as result
from (select array_agg(column_name::text order by ordinal_position) as cols
      from information_schema.columns
      where table_schema='public' and table_name='v_ai_spend_reconciliation') x;

-- [7] `anon` sin acceso a la vista.
select '[7] anon sin SELECT sobre la vista' as check,
       case when not has_table_privilege('anon','public.v_ai_spend_reconciliation','SELECT')
            then 'PASS' else 'FALLO' end as result;

-- [8] El tope autorizado está en el cuerpo del RPC, no implícito.
select '[8] tope de entrada autorizado presente en el RPC (8000)' as check,
       coalesce((select case when pg_get_functiondef(p.oid) like '%c_max_input_tokens constant int := 8000%'
                             then 'PASS' else 'FALLO · tope ausente o distinto' end
                 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='public' and p.proname='ai_finalize_analysis_run'),
                'FALLO · sin función') as result;

-- [9] DATOS HISTÓRICOS: nada se declaró en falta retroactivamente.
select '[9] corridas historicas: conforme=true, deviation NULL, provider_usage NULL' as check,
       coalesce((select case when count(*)=0 then 'PASS · ' || (select count(*) from public.ai_analysis_runs) || ' corridas intactas'
                             else 'FALLO · ' || count(*) || ' filas alteradas' end
                 from public.ai_analysis_runs
                 where not conforme or deviation is not null or provider_usage is not null),
                'N/A') as result;

-- ═══ [10-17] CONDUCTA REAL, con ROLLBACK forzado: cero residuo ════════════════
do $$
declare
  v_uid uuid;
  v_conv uuid;
  v_run uuid := gen_random_uuid();
  v_run2 uuid := gen_random_uuid();
  v_run3 uuid := gen_random_uuid();
  v_run4 uuid := gen_random_uuid();
  r jsonb;
  v_conforme_col boolean;
  v_dev_col text;
  v_usage_col jsonb;
  v_tokens_col int;
  v_cost_col numeric;
  v_audited_col boolean;
  v_vista_admin bigint;
  v_vista_ajeno bigint;
  res text := '';
begin
  -- C-4 · ANTI-RELAJACIÓN. Al comparar v1 contra v2 apareció una aserción PERDIDA: el
--   caso «corrida AUDITADA y dentro del tope + cliente declara conforme ⇒ la base la
--   deja en true con deviation NULL». La v2 había reusado esa corrida para el escenario
--   de endurecimiento. Es el único control de FALSO POSITIVO de la derivación: sin él,
--   una mutación a `if v_audited then v_conforme := false` habría pasado el postcheck
--   completo. Restituido en [15], con una corrida separada ([15b]) para el
--   endurecimiento. Ninguna condición de v1 queda sin equivalente igual o más estricto.
-- C-3 · Los RPC exigen `is_admin()`. Tomar `auth.users limit 1` era una SUPOSICIÓN:
  -- en producción esa fila no es administradora y el kit abortaba con «requiere rol
  -- administrador» — un fallo del KIT que, leído rápido, se habría atribuido a 0218.
  -- Se BUSCA un admin real en vez de suponerlo, sin asumir el esquema de roles.
  for v_uid in select id from auth.users order by created_at loop
    perform set_config('request.jwt.claim.sub', v_uid::text, true);
    exit when public.is_admin();
    v_uid := null;
  end loop;
  if v_uid is null then raise notice '[10-17] sin usuario administrador: N/A'; return; end if;
  perform set_config('request.jwt.claim.sub', v_uid::text, true);

  -- Se REUTILIZA una conversación existente: el kit no inventa datos de negocio y
  -- así corre igual en producción y en cualquier base de verificación. Todo se
  -- revierte con el RAISE final.
  select id into v_conv from public.connect_conversations
   where not exists (select 1 from public.ai_analysis_runs r2
                     where r2.conversation_id = public.connect_conversations.id
                       and r2.outcome = 'en_curso')
   limit 1;
  if v_conv is null then raise notice '[10-17] sin conversaciones disponibles: N/A'; return; end if;

  -- ── [10] 🔑 EL DEFECTO QUE 0218 CIERRA ────────────────────────────────────
  -- Se registra una auditoría que EXCEDE el tope (10.835 tokens, el número real
  -- de la 2ª corrida) y se cierra la corrida declarando `p_conforme => true`.
  -- La base tiene que CONTRADECIR al cliente.
  r := public.ai_claim_analysis_run(v_run, v_conv, 'kit0218_a', repeat('a',64), 120);
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

  select conforme, deviation, provider_usage, tokens_in, cost_usd, audited
    into v_conforme_col, v_dev_col, v_usage_col, v_tokens_col, v_cost_col, v_audited_col
    from public.ai_analysis_runs where id = v_run;

  res := res || '[10] cliente declara conforme con 10835 tokens ⇒ la base lo NIEGA (COLUMNA): '
             || case when v_conforme_col = false then 'PASS' else 'FALLO · conforme=' || v_conforme_col::text end || E'\n';
  res := res || '     y explica por qué sin que el cliente lo pida (context_limit_exceeded): '
             || case when v_dev_col like '%context_limit_exceeded%' and v_dev_col like '%10835%'
                     then 'PASS' else 'FALLO · deviation=' || coalesce(v_dev_col,'null') end || E'\n';
  res := res || '[11] economía DERIVADA de ai_messages, no declarada por el cliente: '
             || case when v_tokens_col = 10835 and v_audited_col and v_cost_col = 0.008226
                     then 'PASS' else 'FALLO · tokens_in=' || coalesce(v_tokens_col::text,'null')
                          || ' audited=' || v_audited_col::text
                          || ' cost=' || coalesce(v_cost_col::text,'null') end || E'\n';
  res := res || '[12] usage COMPLETO válido y persistido: '
             || case when (v_usage_col->>'promptTokens')='10835' and (v_usage_col->>'candidatesTokens')='1990'
                      and (v_usage_col->>'thoughtsTokens')='0' and (v_usage_col->>'totalTokens')='12825'
                     then 'PASS' else 'FALLO · ' || coalesce(v_usage_col::text,'null') end || E'\n';
  res := res || '     total CONSISTENTE con la suma del desglose: '
             || case when (v_usage_col->>'totalTokens')::int
                        = (v_usage_col->>'promptTokens')::int + (v_usage_col->>'candidatesTokens')::int
                        + (v_usage_col->>'thoughtsTokens')::int
                     then 'PASS' else 'FALLO' end || E'\n';
  res := res || '     thoughts=0 DISTINGUIBLE de ausencia de dato: '
             || case when (v_usage_col->>'thoughtsTokens') is not null
                      and (v_usage_col->>'thoughtsTokens')::int = 0
                     then 'PASS · «0» es una medición, no un hueco' else 'FALLO' end || E'\n';

  -- ── [13] usage PARCIAL rechazado: media verdad no diagnostica ─────────────
  begin
    update public.ai_analysis_runs
       set provider_usage = '{"promptTokens":10835,"candidatesTokens":1990}'::jsonb
     where id = v_run;
    res := res || '[13] usage PARCIAL (2 de 4 claves) ⇒ debía rechazarse: FALLO (lo aceptó)' || E'\n';
  exception when check_violation then
    res := res || '[13] usage PARCIAL (2 de 4 claves) ⇒ RECHAZADO por el CHECK: PASS' || E'\n';
  end;

  -- ── [14] `usage = NULL` permanece NO VERIFICABLE (no se convierte en cero) ─
  -- Corrida sin asiento en ai_messages y sin desglose: es la semántica de los
  -- tres valores —número = real · 0 = cero verificable · NULL = no verificable—.
  r := public.ai_claim_analysis_run(v_run3, v_conv, 'kit0218_c', repeat('c',64), 5);
  r := public.ai_finalize_analysis_run(
         v_run3, 'error', 'gemini', 'gemini-2.5-flash', 5, 0,
         null, 'provider_error', 'sin usage informado',
         null, null, null::jsonb, true, null);
  select conforme, provider_usage, tokens_in, cost_usd, audited
    into v_conforme_col, v_usage_col, v_tokens_col, v_cost_col, v_audited_col
    from public.ai_analysis_runs where id = v_run3;
  res := res || '[14] usage=NULL ⇒ NO VERIFICABLE (cost NULL, tokens NULL, audited=false, provider_usage NULL): '
             || case when v_usage_col is null and v_cost_col is null and v_tokens_col is null
                      and v_audited_col = false
                     then 'PASS' else 'FALLO · usage=' || coalesce(v_usage_col::text,'null')
                          || ' cost=' || coalesce(v_cost_col::text,'null')
                          || ' tokens=' || coalesce(v_tokens_col::text,'null')
                          || ' audited=' || v_audited_col::text end || E'\n';
  res := res || '     y sin evidencia en contra NO se declara incumplimiento: '
             || case when v_conforme_col then 'PASS · conforme=true por ausencia de evidencia'
                     else 'FALLO · se declaró no conforme sin medición' end || E'\n';

  -- ── [15] 🔑 CONTROL DE FALSO POSITIVO: la derivación no se dispara de más ──
  -- Corrida AUDITADA y DENTRO del tope, con el cliente declarando conforme: la base
  -- NO debe voltearla, y `deviation` debe quedar NULL.
  --
  -- C-4 · Este caso existía en la v1 del kit y la v2 lo PERDIÓ al reusar la misma
  -- corrida para el escenario de endurecimiento. Es la única prueba de que la
  -- comparación `v_tokens_in > c_max_input_tokens` se evalúa de verdad: sin ella, una
  -- mutación a `if v_audited then v_conforme := false` —marcando TODA corrida
  -- auditada como no conforme— habría pasado el postcheck completo. Restituido con
  -- corridas separadas para cada escenario.
  r := public.ai_claim_analysis_run(v_run2, v_conv, 'kit0218_b', repeat('b',64), 81);
  insert into public.ai_sessions (id, user_id, channel) values (v_run2, v_uid, 'panel');
  insert into public.ai_messages (session_id, user_id, seq, role, content_hash,
                                  provider, model, tokens_in, tokens_out, cost_estimate, outcome)
  values (v_run2, v_uid, 1, 'user', repeat('e',64),
          'gemini', 'gemini-2.5-flash', 7300, 2100, 0.003, 'answered');
  r := public.ai_finalize_analysis_run(
         v_run2, 'ok', 'gemini', 'gemini-2.5-flash', 81, 2,
         'STOP', null, 'dentro del tope',
         null, null,
         '{"promptTokens":7300,"candidatesTokens":2100,"thoughtsTokens":0,"totalTokens":9400}'::jsonb,
         true, null);
  select conforme, deviation, tokens_in into v_conforme_col, v_dev_col, v_tokens_col
    from public.ai_analysis_runs where id = v_run2;
  res := res || '[15] AUDITADA con 7300 tokens (dentro del tope) ⇒ conforme=true y deviation NULL: '
             || case when v_conforme_col is true and v_dev_col is null and v_tokens_col = 7300
                     then 'PASS · la derivación no se dispara de más'
                     else 'FALLO · conforme=' || v_conforme_col::text
                          || ' dev=' || coalesce(v_dev_col,'null')
                          || ' tokens_in=' || coalesce(v_tokens_col::text,'null') end || E'\n';

  -- ── [15b] El cliente SÍ puede ENDURECER a no conforme ────────────────────
  -- (p. ej. por el tope de SALIDA, que la base no ve). Endurece, no ablanda.
  r := public.ai_claim_analysis_run(v_run4, v_conv, 'kit0218_d', repeat('d',64), 81);
  insert into public.ai_sessions (id, user_id, channel) values (v_run4, v_uid, 'panel');
  insert into public.ai_messages (session_id, user_id, seq, role, content_hash,
                                  provider, model, tokens_in, tokens_out, cost_estimate, outcome)
  values (v_run4, v_uid, 1, 'user', repeat('d',64),
          'gemini', 'gemini-2.5-flash', 7300, 6000, 0.004, 'answered');
  r := public.ai_finalize_analysis_run(
         v_run4, 'ok', 'gemini', 'gemini-2.5-flash', 81, 2,
         'MAX_TOKENS', null, 'salida cortada',
         null, null,
         '{"promptTokens":7300,"candidatesTokens":6000,"thoughtsTokens":0,"totalTokens":13300}'::jsonb,
         false, 'output_limit_exceeded: la salida se cortó en el tope autorizado');
  select conforme, deviation into v_conforme_col, v_dev_col
    from public.ai_analysis_runs where id = v_run4;
  res := res || '[15b] dentro del tope de ENTRADA + cliente declara NO conforme ⇒ se respeta: '
             || case when v_conforme_col = false and v_dev_col like '%output_limit_exceeded%'
                     then 'PASS · la base endurece, nunca ablanda'
                     else 'FALLO · conforme=' || v_conforme_col::text
                          || ' dev=' || coalesce(v_dev_col,'null') end || E'\n';

  -- ── [16] El CHECK no deja pasar una no conformidad MUDA ───────────────────
  begin
    update public.ai_analysis_runs set conforme = false, deviation = null where id = v_run;
    res := res || '[16] no conforme SIN motivo ⇒ debía rechazarse: FALLO (lo aceptó)' || E'\n';
  exception when check_violation then
    res := res || '[16] no conforme SIN motivo ⇒ RECHAZADO por el CHECK: PASS' || E'\n';
  end;

  -- ── [17] La vista respeta la RLS por CONDUCTA, no sólo por privilegio ─────
  select count(*) into v_vista_admin from public.v_ai_spend_reconciliation;
  begin
    set local role authenticated;
    -- uuid inexistente ⇒ `is_admin()` falso ⇒ la RLS de la tabla base filtra todo.
    perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
    select count(*) into v_vista_ajeno from public.v_ai_spend_reconciliation;
    reset role;
    perform set_config('request.jwt.claim.sub', v_uid::text, true);
    res := res || '[17] vista bajo RLS: admin ve ' || v_vista_admin
               || ' período(s), no-admin ve ' || v_vista_ajeno || ': '
               || case when v_vista_admin > 0 and v_vista_ajeno = 0 then 'PASS'
                       else 'FALLO · security_invoker no está filtrando' end || E'\n';
  exception when others then
    reset role;
    res := res || '[17] no evaluable: ' || SQLSTATE || ' ' || SQLERRM || E'\n';
  end;

  raise exception E'\n== 0218 · CONDUCTA REAL ==\n%(TODO REVERTIDO)', res;
end $$;

-- [18] Reconciliación: las no conformes y el peso del razonamiento, visibles.
select '[18] reconciliacion' as check,
       coalesce((select 'corridas=' || corridas
                      || ' auditadas=' || corridas_auditadas
                      || ' NO conformes=' || corridas_no_conformes
                      || ' tokens de razonamiento=' || tokens_de_razonamiento
                      || ' tokens de salida util=' || tokens_de_salida_util
                      || ' mayor entrada=' || coalesce(mayor_entrada_registrada::text,'n/d')
                 from public.v_ai_spend_reconciliation
                 order by periodo desc limit 1),
                'sin corridas') as result;
