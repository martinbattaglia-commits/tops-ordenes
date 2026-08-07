-- SQL exacto del commit cdb5384eda25596e86c57596924b5c092b7c94ca
-- SHA-256 del archivo: 56d828f0613ca2f98cee76a592b76a221e35c4d4787d0ecdc93a23f00067d489
-- Se omiten únicamente el `begin;`/`commit;` explícitos: apply_migration ya ejecuta
-- de forma atómica y un BEGIN anidado cerraría su transacción antes de registrar la
-- migración. Ninguna sentencia se altera, agrega ni reordena.

-- ── 1 · Estados nuevos ──────────────────────────────────────────────────────
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
  add column if not exists audited       boolean not null default false,
  add column if not exists finish_reason text,
  add column if not exists error_code    text,
  add column if not exists started_at    timestamptz,
  add column if not exists expires_at    timestamptz;

comment on column public.ai_analysis_runs.audited is
  'true SOLO si el costo de esta corrida quedo registrado en ai_messages, que es la fuente de ai_monthly_spend() y del limite diario. false = corrida NO contabilizada.';
comment on column public.ai_analysis_runs.cost_usd is
  'Costo REAL informado por el proveedor. NULL = no verificable (el proveedor no devolvio usage). Nunca se estima.';

-- ── 3 · EL CANDADO ──────────────────────────────────────────────────────────
update public.ai_analysis_runs set started_at = created_at where started_at is null;
alter table public.ai_analysis_runs alter column started_at set default now();

create unique index if not exists ai_analysis_runs_una_activa_uq
  on public.ai_analysis_runs (conversation_id, analysis_kind)
  where outcome = 'en_curso';

comment on index public.ai_analysis_runs_una_activa_uq is
  'CANDADO de idempotencia: imposibilita dos corridas equivalentes simultaneas sobre el mismo hilo. No depende del navegador.';

create index if not exists ai_analysis_runs_no_auditadas_idx
  on public.ai_analysis_runs (created_at desc) where not audited;
create index if not exists ai_analysis_runs_activas_idx
  on public.ai_analysis_runs (expires_at) where outcome = 'en_curso';

-- ── 4 · Reclamar la corrida (fase 1) ────────────────────────────────────────
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

  -- (a) Vencer corridas abandonadas de ESTE hilo y tipo.
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
    return jsonb_build_object('ok', false, 'reason', 'ya_cerrada', 'outcome', v_row.outcome);
  end if;

  -- 🔑 La economía NO se acepta del cliente: se DERIVA de `ai_messages`.
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
    'audited', v_audited, 'cost_usd', v_cost,
    'tokens_in', v_tokens_in, 'tokens_out', v_tokens_out
  );
end $$;

revoke all on function public.ai_finalize_analysis_run(uuid, text, text, text, int, int, text, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.ai_finalize_analysis_run(uuid, text, text, text, int, int, text, text, text, timestamptz, timestamptz) to authenticated;

-- ── 6 · Gasto REAL, incluido lo no contabilizado ───────────────────────────
-- 🔴 `security_invoker = true` es OBLIGATORIO: el default de Postgres es FALSE y
-- una vista corre con los privilegios de su DUEÑO, salteando la RLS de la tabla.
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
