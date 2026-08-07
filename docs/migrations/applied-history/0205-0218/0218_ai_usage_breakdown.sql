-- 0218_ai_usage_breakdown.sql — LINK-WA-002 · desglose de usage y conformidad.
-- Aplicada por Gate SQL autorizado. ADITIVA: cero eliminación de filas.
-- ⚠️ Desviación TEXTUAL declarada: se omiten los `begin;`/`commit;` del archivo —
-- `apply_migration` ya es atómico y un BEGIN anidado cerraría su transacción ANTES
-- de registrar la migración. Ninguna sentencia alterada.
-- Origen: commit 8e57e4daa8fb6f43856bbb4e7ab0d8559d1dfb7d
-- SHA-256 del archivo: 38edd5f96f59682174cdae8f59aaf0564a65f3059ba884de0f7b4fd687746911

-- ── 1 · Desglose y conformidad ──────────────────────────────────────────────
alter table public.ai_analysis_runs
  add column if not exists provider_usage jsonb,
  -- `conforme` arranca en true: las corridas históricas no se declaran en falta
  -- retroactivamente, porque nadie midió su conformidad.
  add column if not exists conforme  boolean not null default true,
  add column if not exists deviation text;

comment on column public.ai_analysis_runs.provider_usage is
  'Desglose de tokens informado por el proveedor: promptTokens, candidatesTokens, thoughtsTokens, totalTokens. Dato DIAGNOSTICO, no el registro economico: ese lo deriva la base de ai_messages.';
comment on column public.ai_analysis_runs.conforme is
  'false cuando un tope AUTORIZADO se excedio de verdad, comparado contra lo que el proveedor cobro (no contra la estimacion). Una corrida puede ser ok y NO conforme. La base lo deriva y solo puede endurecer lo que declara el cliente.';
comment on column public.ai_analysis_runs.deviation is
  'Que tope se excedio y por cuanto. Ej: context_limit_exceeded con los numeros reales.';

-- El desglose, si viene, tiene que estar completo: media verdad no sirve para
-- diagnosticar. Se permite NULL (mock, o proveedor que no informa usage).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_analysis_runs_provider_usage_forma') then
    alter table public.ai_analysis_runs
      add constraint ai_analysis_runs_provider_usage_forma
      check (
        provider_usage is null
        or (provider_usage ? 'promptTokens' and provider_usage ? 'candidatesTokens'
            and provider_usage ? 'thoughtsTokens' and provider_usage ? 'totalTokens')
      );
  end if;
  -- Si NO es conforme, hay que decir por qué. Una desviación sin motivo es ruido.
  if not exists (select 1 from pg_constraint where conname = 'ai_analysis_runs_deviation_explicada') then
    alter table public.ai_analysis_runs
      add constraint ai_analysis_runs_deviation_explicada
      check (conforme or deviation is not null);
  end if;
end $$;

-- Encontrar las no conformes sin recorrer la tabla.
create index if not exists ai_analysis_runs_no_conformes_idx
  on public.ai_analysis_runs (created_at desc) where not conforme;

-- ── 2 · El cierre acepta el desglose y DERIVA la conformidad ────────────────
-- Se REEMPLAZA la función de 0217 con tres parámetros más. La economía sigue
-- derivándose de `ai_messages`, y ahora también el veredicto de conformidad.
create or replace function public.ai_finalize_analysis_run(
  p_run_id       uuid,
  p_outcome      text,
  p_provider     text,
  p_model        text,
  p_messages     int,
  p_emitted      int,
  p_finish_reason text,
  p_error_code   text,
  p_detail       text,
  p_window_from  timestamptz default null,
  p_window_to    timestamptz default null,
  p_provider_usage jsonb default null,
  p_conforme     boolean default true,
  p_deviation    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Tope de entrada AUTORIZADO por Dirección para el piloto LINK-WA-002.
  -- Debe coincidir con CONTEXT_LIMITS.maxInputTokens del código; hay un test que
  -- compara ambos números para que no puedan separarse en silencio.
  c_max_input_tokens constant int := 8000;
  v_uid uuid := auth.uid();
  v_row record;
  v_tokens_in  int;
  v_tokens_out int;
  v_cost       numeric;
  v_audited    boolean;
  v_conforme   boolean;
  v_deviation  text;
begin
  if v_uid is null then
    raise exception 'ai_finalize_analysis_run: sesión anónima';
  end if;
  if not public.is_admin() then
    raise exception 'ai_finalize_analysis_run: requiere rol administrador';
  end if;
  if p_outcome = 'en_curso' then
    raise exception 'ai_finalize_analysis_run: una corrida no vuelve a en_curso';
  end if;

  select id, requested_by, outcome into v_row
    from public.ai_analysis_runs where id = p_run_id;
  if v_row.id is null then
    raise exception 'ai_finalize_analysis_run: corrida inexistente';
  end if;
  if v_row.requested_by is distinct from v_uid then
    raise exception 'ai_finalize_analysis_run: corrida ajena';
  end if;
  if v_row.outcome <> 'en_curso' then
    return jsonb_build_object('ok', false, 'reason', 'ya_cerrada', 'outcome', v_row.outcome);
  end if;

  -- La economía la DERIVA la base (0217). No se acepta del cliente.
  select coalesce(sum(m.tokens_in), 0), coalesce(sum(m.tokens_out), 0),
         sum(m.cost_estimate), count(*) > 0
    into v_tokens_in, v_tokens_out, v_cost, v_audited
  from public.ai_messages m
  where m.session_id = p_run_id;

  -- La conformidad también. El cliente puede declararla FALSA (ve topes que la base
  -- no ve, como el de salida), pero no puede declararla verdadera contra la
  -- evidencia propia de la base. Sólo se endurece.
  v_conforme  := coalesce(p_conforme, true);
  v_deviation := p_deviation;

  if v_audited and v_tokens_in > c_max_input_tokens then
    v_conforme := false;
    if v_deviation is null then
      v_deviation := 'context_limit_exceeded: la base derivó ' || v_tokens_in
        || ' tokens de entrada de ai_messages contra un tope autorizado de '
        || c_max_input_tokens || '.';
    end if;
  end if;

  -- Una no conformidad SIN motivo se registra igual, con el motivo faltante dicho
  -- en voz alta: rechazar el cierre dejaría la corrida `en_curso` y perdería la
  -- economía de una corrida que YA se pagó. Registrar es más veraz que abortar.
  if not v_conforme and v_deviation is null then
    v_deviation := 'no conforme sin motivo declarado por el llamador';
  end if;

  update public.ai_analysis_runs
     set outcome       = p_outcome,
         provider      = coalesce(p_provider, provider),
         model         = p_model,
         messages_analyzed = coalesce(p_messages, messages_analyzed),
         suggestions_emitted = coalesce(p_emitted, 0),
         tokens_in     = case when v_audited then v_tokens_in else null end,
         tokens_out    = case when v_audited then v_tokens_out else null end,
         cost_usd      = v_cost,
         audited       = v_audited,
         finish_reason = p_finish_reason,
         error_code    = p_error_code,
         detail        = p_detail,
         window_from   = coalesce(p_window_from, window_from),
         window_to     = coalesce(p_window_to, window_to),
         provider_usage = p_provider_usage,
         conforme      = v_conforme,
         deviation     = v_deviation,
         expires_at    = null
   where id = p_run_id;

  return jsonb_build_object(
    'ok', true, 'run_id', p_run_id, 'outcome', p_outcome,
    'audited', v_audited, 'cost_usd', v_cost,
    'tokens_in', v_tokens_in, 'tokens_out', v_tokens_out,
    'conforme', v_conforme, 'deviation', v_deviation
  );
end $$;

-- La firma cambió, así que la anterior queda huérfana: se retira para que no exista
-- una vía vieja que ignore la conformidad.
drop function if exists public.ai_finalize_analysis_run(
  uuid, text, text, text, int, int, text, text, text, timestamptz, timestamptz);

revoke all on function public.ai_finalize_analysis_run(
  uuid, text, text, text, int, int, text, text, text, timestamptz, timestamptz, jsonb, boolean, text)
  from public, anon;
grant execute on function public.ai_finalize_analysis_run(
  uuid, text, text, text, int, int, text, text, text, timestamptz, timestamptz, jsonb, boolean, text)
  to authenticated;

-- ── 3 · La reconciliación también informa la conformidad ────────────────────
-- ⚠️ Las columnas nuevas van AL FINAL, en el mismo orden en que 0217 las dejó.
-- `create or replace view` NO admite insertar una columna en el medio ni renombrar:
-- aborta con «cannot change name of view column». Las siete primeras se copian
-- textualmente de 0217 a propósito.
create or replace view public.v_ai_spend_reconciliation
with (security_invoker = true) as
select
  date_trunc('month', r.created_at) as periodo,
  count(*)                                             as corridas,
  count(*) filter (where r.audited)                    as corridas_auditadas,
  count(*) filter (where not r.audited)                as corridas_no_auditadas,
  coalesce(sum(r.cost_usd), 0)                         as costo_declarado_por_corridas,
  coalesce(sum(r.cost_usd) filter (where not r.audited), 0) as costo_fuera_del_agregado,
  count(*) filter (where r.cost_usd is null and r.outcome <> 'en_curso') as corridas_sin_costo_verificable,
  -- ── nuevas en 0218, siempre al final ──
  count(*) filter (where not r.conforme)               as corridas_no_conformes,
  -- Desglose agregado: permite ver si el razonamiento pesa en la factura.
  coalesce(sum((r.provider_usage->>'thoughtsTokens')::int), 0)   as tokens_de_razonamiento,
  coalesce(sum((r.provider_usage->>'candidatesTokens')::int), 0) as tokens_de_salida_util,
  max((r.provider_usage->>'promptTokens')::int)                  as mayor_entrada_registrada
from public.ai_analysis_runs r
group by 1;

revoke all on public.v_ai_spend_reconciliation from public, anon, authenticated;
grant select on public.v_ai_spend_reconciliation to authenticated;
