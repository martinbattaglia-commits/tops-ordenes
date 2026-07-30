-- 0217_ai_run_lifecycle.sql — LINK-WA-002 · ciclo de vida y economía de la corrida.
-- ⚠️ PROPUESTA — requiere Gate SQL autorizado. ADITIVA: cero eliminación de filas.
--
-- POR QUÉ EXISTE
-- El smoke con Gemini falló y el diagnóstico reveló dos defectos peores que el fallo:
--
--   1. La auditoría económica del análisis estructurado NUNCA persistía: el engine
--      pasaba `"structured:wa_analysis"` a un RPC que espera `uuid`. Como `audit.ts`
--      es fail-open, el error se iba por consola. Consecuencia real: el gasto del
--      analizador no entraba en `ai_monthly_spend()` NI en el contador diario —que
--      cuenta filas de `ai_messages`—, así que el analizador corría **sin tope
--      efectivo, ni diario ni mensual**.
--   2. No había idempotencia de servidor: el único freno era un `disabled` de React.
--      Dos pestañas o un doble clic ⇒ dos llamadas al proveedor, dos cargos reales y,
--      si ambas salían bien, dos juegos de sugerencias sobre el mismo hilo.
--
-- QUÉ APORTA ESTA MIGRACIÓN
--   · Economía en la propia corrida: tokens, costo y `audited` como COLUMNAS, no como
--     texto libre dentro de `detail`. Así «corridas no contabilizadas» se detecta con
--     una consulta, no leyendo prosa.
--   · Ciclo de vida en dos fases —`en_curso` → terminal— con un índice único parcial
--     que hace **imposible** una segunda corrida equivalente concurrente.
--   · Dos RPC `security definer` que ejecutan las transiciones. Son necesarias porque
--     `0216` revocó UPDATE a `authenticated` —y con razón: la auditoría no se edita—.
--     El definer permite la transición gobernada sin devolver ese privilegio.
--
-- IDEMPOTENTE: todo guardado por catálogo.

begin;

-- ── 1 · Estados nuevos ──────────────────────────────────────────────────────
-- `en_curso`      corrida reclamada, todavía sin resultado (es el candado).
-- `audit_failure` el proveedor respondió pero la auditoría económica NO pudo
--                 registrarse. Decisión de Dirección: eso NO es una corrida
--                 completada, y no puede emitir sugerencias.
do $$
begin
  alter table public.ai_analysis_runs drop constraint if exists ai_analysis_runs_outcome_check;
  alter table public.ai_analysis_runs
    add constraint ai_analysis_runs_outcome_check
    check (outcome in ('en_curso','ok','killed','denied','budget',
                       'invalid_output','audit_failure','error'));
end $$;

-- ── 2 · Economía y trazas como COLUMNAS ─────────────────────────────────────
alter table public.ai_analysis_runs
  add column if not exists analysis_kind text not null default 'wa_analysis',
  add column if not exists tokens_in     int,
  add column if not exists tokens_out    int,
  add column if not exists cost_usd      numeric(12,6),
  -- `audited` es la afirmación económica: true SÓLO si el costo quedó registrado
  -- en `ai_messages`, que es de donde lo leen el tope mensual y el diario.
  add column if not exists audited       boolean not null default false,
  add column if not exists finish_reason text,
  add column if not exists error_code    text,
  add column if not exists started_at    timestamptz,
  -- Vencimiento del candado: una corrida abandonada no puede bloquear para siempre.
  add column if not exists expires_at    timestamptz;

comment on column public.ai_analysis_runs.audited is
  'true SOLO si el costo de esta corrida quedo registrado en ai_messages, que es la fuente de ai_monthly_spend() y del limite diario. false = corrida NO contabilizada.';
comment on column public.ai_analysis_runs.cost_usd is
  'Costo REAL informado por el proveedor. NULL = no verificable (el proveedor no devolvio usage). Nunca se estima.';

-- ── 3 · EL CANDADO ──────────────────────────────────────────────────────────
-- Una sola corrida activa por conversación y tipo de análisis. Índice único
-- PARCIAL: sólo restringe las `en_curso`, así que el historial no estorba.
-- Las filas preexistentes no empezaron «ahora»: se rellena con su propia fecha
-- de creación para que el dato no mienta. Recién después se pone el default.
update public.ai_analysis_runs set started_at = created_at where started_at is null;
alter table public.ai_analysis_runs alter column started_at set default now();

create unique index if not exists ai_analysis_runs_una_activa_uq
  on public.ai_analysis_runs (conversation_id, analysis_kind)
  where outcome = 'en_curso';

comment on index public.ai_analysis_runs_una_activa_uq is
  'CANDADO de idempotencia: imposibilita dos corridas equivalentes simultaneas sobre el mismo hilo. No depende del navegador.';

-- Índices de reconciliación: encontrar lo no contabilizado y lo abandonado.
create index if not exists ai_analysis_runs_no_auditadas_idx
  on public.ai_analysis_runs (created_at desc) where not audited;
create index if not exists ai_analysis_runs_activas_idx
  on public.ai_analysis_runs (expires_at) where outcome = 'en_curso';

-- ── 4 · Reclamar la corrida (fase 1) ────────────────────────────────────────
-- Atómica: vence las abandonadas y luego inserta. Si otra está activa, el índice
-- único la rechaza y devolvemos `conflicto` en vez de propagar el error crudo.
--
-- SECURITY DEFINER porque necesita cerrar corridas ajenas vencidas (UPDATE), que
-- `authenticated` no tiene por 0216. La autoría la sigue derivando el trigger
-- `ai_set_run_actor` desde auth.uid(): acá no se acepta un actor del cliente.
create or replace function public.ai_claim_analysis_run(
  p_run_id          uuid,
  p_conversation_id uuid,
  p_analysis_kind   text,
  p_input_sha256    text,
  p_messages        int,
  p_ttl_seconds     int default 300
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_activa record;
begin
  if v_uid is null then
    raise exception 'ai_claim_analysis_run: sesión anónima';
  end if;
  if not public.is_admin() then
    raise exception 'ai_claim_analysis_run: requiere rol administrador';
  end if;

  -- (a) Vencer corridas abandonadas de ESTE hilo y tipo. Quedan como terminales
  --     `error` con motivo explícito: una corrida que nadie cerró no se borra.
  update public.ai_analysis_runs
     set outcome = 'error',
         detail = coalesce(detail,'') || ' · corrida vencida sin cierre (candado liberado)',
         error_code = 'lock_expired',
         expires_at = null
   where outcome = 'en_curso'
     and conversation_id = p_conversation_id
     and analysis_kind = p_analysis_kind
     and expires_at is not null
     and expires_at < now();

  -- (b) ¿Sigue habiendo una activa? Entonces es concurrencia real.
  select id, requested_by, started_at into v_activa
    from public.ai_analysis_runs
   where outcome = 'en_curso'
     and conversation_id = p_conversation_id
     and analysis_kind = p_analysis_kind
   limit 1;

  if v_activa.id is not null then
    return jsonb_build_object(
      'ok', false, 'reason', 'conflicto',
      'run_id', v_activa.id,
      'mismo_usuario', v_activa.requested_by = v_uid,
      'started_at', v_activa.started_at
    );
  end if;

  -- (c) Reclamar. El índice único es la garantía última ante una carrera exacta.
  begin
    insert into public.ai_analysis_runs (
      id, conversation_id, analysis_kind, provider, model,
      messages_analyzed, outcome, input_sha256, started_at, expires_at, audited
    ) values (
      p_run_id, p_conversation_id, p_analysis_kind, 'pendiente', null,
      coalesce(p_messages, 0), 'en_curso', p_input_sha256, now(),
      -- Piso Y TECHO: sin techo, un TTL absurdo (o un bug del cliente) dejaba el
      -- hilo bloqueado durante décadas. 15 minutos es holgado para un análisis.
      now() + make_interval(secs => least(greatest(coalesce(p_ttl_seconds, 300), 30), 900)), false
    );
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'conflicto', 'run_id', null);
  end;

  return jsonb_build_object('ok', true, 'run_id', p_run_id);
end $$;

revoke all on function public.ai_claim_analysis_run(uuid, uuid, text, text, int, int) from public, anon;
grant execute on function public.ai_claim_analysis_run(uuid, uuid, text, text, int, int) to authenticated;

-- ── 5 · Cerrar la corrida (fase 2) ─────────────────────────────────────────
-- Única vía para pasar de `en_curso` a un estado terminal. Sólo el dueño, sólo
-- una vez, y jamás vuelve a `en_curso`.
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
  p_window_to    timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
  v_tokens_in  int;
  v_tokens_out int;
  v_cost       numeric;
  v_audited    boolean;
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
    -- Ya cerrada: idempotente, no se reescribe la historia.
    return jsonb_build_object('ok', false, 'reason', 'ya_cerrada', 'outcome', v_row.outcome);
  end if;

  -- 🔑 La economía NO se acepta del cliente: se DERIVA de `ai_messages`, que es
  -- la misma fuente que leen `ai_monthly_spend()` y el contador diario. Antes
  -- estos valores llegaban por parámetro, así que un admin podía cerrar una
  -- corrida declarando `audited=true, cost_usd=0` desde el navegador —las RPC
  -- están expuestas por PostgREST— y corromper la auditoría. Ahora `audited` es
  -- una CONSTATACIÓN: true sólo si existe el asiento.
  select coalesce(sum(m.tokens_in), 0), coalesce(sum(m.tokens_out), 0),
         sum(m.cost_estimate), count(*) > 0
    into v_tokens_in, v_tokens_out, v_cost, v_audited
  from public.ai_messages m
  where m.session_id = p_run_id;

  update public.ai_analysis_runs
     set outcome       = p_outcome,
         provider      = coalesce(p_provider, provider),
         model         = p_model,
         messages_analyzed = coalesce(p_messages, messages_analyzed),
         suggestions_emitted = coalesce(p_emitted, 0),
         tokens_in     = case when v_audited then v_tokens_in else null end,
         tokens_out    = case when v_audited then v_tokens_out else null end,
         -- NULL = no verificable. Nunca se estima ni se asume cero.
         cost_usd      = v_cost,
         audited       = v_audited,
         finish_reason = p_finish_reason,
         error_code    = p_error_code,
         detail        = p_detail,
         window_from   = coalesce(p_window_from, window_from),
         window_to     = coalesce(p_window_to, window_to),
         expires_at    = null
   where id = p_run_id;

  return jsonb_build_object(
    'ok', true, 'run_id', p_run_id, 'outcome', p_outcome,
    -- Se devuelve lo CONSTATADO, para que el llamador sepa si su corrida quedó
    -- realmente contabilizada en lugar de suponerlo.
    'audited', v_audited, 'cost_usd', v_cost,
    'tokens_in', v_tokens_in, 'tokens_out', v_tokens_out
  );
end $$;

revoke all on function public.ai_finalize_analysis_run(uuid, text, text, text, int, int, text, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.ai_finalize_analysis_run(uuid, text, text, text, int, int, text, text, text, timestamptz, timestamptz) to authenticated;

-- ── 6 · Gasto REAL, incluido lo no contabilizado ───────────────────────────
-- `ai_monthly_spend()` (0174) suma `ai_messages.cost_estimate`: mide gasto
-- AUDITADO. Esta vista expone además el gasto que quedó fuera del agregado, para
-- que «no contabilizado» sea visible en vez de invisible.
-- 🔴 `security_invoker = true` es OBLIGATORIO. El default de Postgres es FALSE:
-- una vista corre con los privilegios de su DUEÑO y **saltea la RLS de la tabla**.
-- Sin esto, cualquier usuario autenticado no-admin leía el gasto de IA de la
-- empresa. Verificado empíricamente: la tabla devolvía 0 filas y la vista las
-- devolvía todas.
create or replace view public.v_ai_spend_reconciliation
with (security_invoker = true) as
select
  date_trunc('month', r.created_at) as periodo,
  count(*)                                             as corridas,
  count(*) filter (where r.audited)                    as corridas_auditadas,
  count(*) filter (where not r.audited)                as corridas_no_auditadas,
  coalesce(sum(r.cost_usd), 0)                         as costo_declarado_por_corridas,
  coalesce(sum(r.cost_usd) filter (where not r.audited), 0) as costo_fuera_del_agregado,
  count(*) filter (where r.cost_usd is null and r.outcome <> 'en_curso') as corridas_sin_costo_verificable
from public.ai_analysis_runs r
group by 1;

revoke all on public.v_ai_spend_reconciliation from public, anon, authenticated;
grant select on public.v_ai_spend_reconciliation to authenticated;

commit;

-- La vista respeta la RLS de `ai_analysis_runs` porque se declara
-- `security_invoker = true` de forma EXPLÍCITA: no es el default.
--
-- ROLLBACK (por pasos independientes):
--   begin;
--   drop view if exists public.v_ai_spend_reconciliation;
--   drop function if exists public.ai_finalize_analysis_run(uuid,text,text,text,int,int,text,text,text,timestamptz,timestamptz);
--   drop function if exists public.ai_claim_analysis_run(uuid,uuid,text,text,int,int);
--   drop index if exists public.ai_analysis_runs_una_activa_uq;
--   drop index if exists public.ai_analysis_runs_no_auditadas_idx;
--   drop index if exists public.ai_analysis_runs_activas_idx;
--   commit;
--   -- Las columnas se pueden dejar (aditivas, sin costo). Si se quitaran, primero
--   -- hay que cerrar toda corrida `en_curso`, porque el CHECK volvería a rechazar
--   -- ese estado:
--   -- update public.ai_analysis_runs set outcome='error' where outcome='en_curso';
