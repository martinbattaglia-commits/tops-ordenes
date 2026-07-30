-- 0218_ai_usage_breakdown.sql — LINK-WA-002 · desglose de usage y conformidad.
-- ⚠️ PROPUESTA — requiere Gate SQL autorizado. ADITIVA: cero eliminación de filas.
--
-- POR QUÉ EXISTE
-- La segunda corrida real falló y, gracias a `0217`, esta vez el fallo quedó MEDIDO:
--   entrada real 10.835 tokens contra un tope autorizado de 8.000 → 135,4 %
--   salida cortada en 1.990 de 2.000 · finishReason = MAX_TOKENS
--
-- Dos cosas quedaron al descubierto:
--
--   1. `outputTokens` sumaba candidates + thoughts en un solo número, así que era
--      IMPOSIBLE afirmar si el razonamiento estaba apagado: 1.990 tokens podían ser
--      JSON puro o JSON más razonamiento. Cuando el tope de salida ES la causa del
--      fallo, esa ambigüedad impide diagnosticar.
--   2. El tope de ENTRADA se excedió y nada lo detectó, porque la guarda de contexto
--      trabaja con una ESTIMACIÓN y el proveedor cobra por tokens reales. La
--      estimación subestimó 2,35 veces.
--
-- QUÉ APORTA
--   · `provider_usage` — el desglose tal como lo informó el proveedor.
--   · `conforme` / `deviation` — si algún tope AUTORIZADO se excedió de verdad,
--     comparado contra lo COBRADO. Una corrida puede terminar `ok` y NO ser
--     conforme: son dos preguntas distintas y hasta ahora sólo se hacía una.
--
-- FRONTERA IMPORTANTE: `provider_usage` es dato DIAGNÓSTICO informado por el
-- proveedor, NO el registro económico. El registro económico —`tokens_in`,
-- `tokens_out`, `cost_usd`, `audited`— lo sigue DERIVANDO la base de `ai_messages`,
-- como fijó `0217`. Se mantiene esa separación a propósito: lo que decide el
-- presupuesto no puede venir del cliente.
--
-- Y LA CONFORMIDAD TAMBIÉN SE DERIVA. El cliente puede DECLARAR que una corrida no
-- fue conforme —ve cosas que la base no ve, como el tope de salida—, pero NO puede
-- declararla conforme si los tokens que la propia base derivó de `ai_messages`
-- exceden el tope autorizado. La base sólo endurece, nunca afloja. Es la misma
-- lección que dejó la auditoría fail-open: un permiso que el cliente se otorga a sí
-- mismo no es un control.

begin;

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

commit;

-- Cero eliminación de filas. Las corridas históricas quedan `conforme = true` por
-- default: no se las declara en falta retroactivamente porque nadie midió su
-- conformidad. La corrida del 2º smoke —que SÍ excedió el tope— se marcará recién
-- si Dirección ordena un data-op explícito; este archivo no lo hace.
--
-- ROLLBACK (por pasos independientes):
--   begin;
--   -- 1) restituir la firma de 0217 (sin desglose ni conformidad):
--   --    re-ejecutar el bloque de `ai_finalize_analysis_run` de 0217 tal cual,
--   --    y luego borrar la variante de 14 parámetros:
--   drop function if exists public.ai_finalize_analysis_run(
--     uuid, text, text, text, int, int, text, text, text, timestamptz, timestamptz, jsonb, boolean, text);
--   commit;
--   begin;
--   -- 2) restituir la vista de 0217. ⚠️ Volver a 7 columnas EXIGE `drop view` antes
--   --    del `create`: `create or replace` no puede QUITAR columnas.
--   drop view if exists public.v_ai_spend_reconciliation;
--   --    (y luego re-ejecutar el bloque de la vista de 0217 + sus grants)
--   -- 3) índices y constraints:
--   drop index if exists public.ai_analysis_runs_no_conformes_idx;
--   alter table public.ai_analysis_runs drop constraint if exists ai_analysis_runs_provider_usage_forma;
--   alter table public.ai_analysis_runs drop constraint if exists ai_analysis_runs_deviation_explicada;
--   commit;
--   -- 4) columnas: NO se recomienda quitarlas (aditivas, y `provider_usage` es la
--   --    única evidencia del desglose de las corridas ya ejecutadas).
