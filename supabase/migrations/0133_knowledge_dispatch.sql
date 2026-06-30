-- ENTREGADA — F0.5.2 Knowledge Layer · 0133 — E2.1: motor del worker (dispatcher) + telemetría.
-- 100% ADITIVA. No toca E1 ni E2.0 (knowledge_events, knowledge_emit_event, canonical intactos).
-- Estado terminal de éxito = 'processed' (G7). Procesador no-op (efecto de negocio = fases posteriores).
-- Lease sobre available_at para recuperar atascados (sin columna nueva). Hardening H-E1-1 en las 5 funciones.

-- 1) claim_batch: reclamar lote atómico due (pending/failed, available_at<=now()) -> processing, con lock + lease.
create or replace function public.knowledge_claim_batch(
  p_limit int default 50,
  p_lease interval default interval '5 minutes'
)
returns setof public.knowledge_events
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.knowledge_events ke
     set status = 'processing',
         available_at = now() + p_lease
   where ke.id in (
     select id from public.knowledge_events
      where status in ('pending','failed') and available_at <= now()
      order by available_at, seq
      limit greatest(p_limit, 0)
      for update skip locked
   )
   returning ke.*;
$$;

-- 2) mark_processed: processing -> processed (idempotente: solo si está en processing).
create or replace function public.knowledge_mark_processed(p_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.knowledge_events
     set status = 'processed', processed_at = now(), error = null
   where id = p_id and status = 'processing';
$$;

-- 3) mark_failed: incrementa retry_count; backoff exponencial (1->2->4 min); dead tras MAX_RETRIES (default 3).
create or replace function public.knowledge_mark_failed(p_id uuid, p_error text, p_max_retries int default 3)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_new int; v_status text;
begin
  update public.knowledge_events
     set retry_count = retry_count + 1
   where id = p_id and status = 'processing'
   returning retry_count into v_new;

  if v_new is null then
    return null;  -- no estaba en processing (idempotente / ya resuelto)
  end if;

  if v_new <= p_max_retries then
    update public.knowledge_events
       set status = 'failed',
           error = left(p_error, 2000),
           available_at = now() + (power(2, v_new - 1) * interval '1 minute'),
           processed_at = null
     where id = p_id
     returning status into v_status;
  else
    update public.knowledge_events
       set status = 'dead', error = left(p_error, 2000), processed_at = now()
     where id = p_id
     returning status into v_status;
  end if;

  return v_status;
end;
$$;

-- 4) recover_stuck: processing con lease vencido (available_at < now()) -> failed (reprograma). Sin columna nueva.
create or replace function public.knowledge_recover_stuck()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n int;
begin
  update public.knowledge_events
     set status = 'failed', available_at = now()
   where status = 'processing' and available_at < now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- 5) Telemetría de corridas del worker (G7: métricas internas para E2.3). Tabla nueva, aditiva.
create table if not exists public.knowledge_worker_runs (
  id             uuid primary key default gen_random_uuid(),
  started_at     timestamptz not null,
  finished_at    timestamptz not null default now(),
  duration_ms    int     not null default 0,
  dry            boolean not null default false,
  claimed        int     not null default 0,
  processed      int     not null default 0,
  failed_retried int     not null default 0,
  failed_dead    int     not null default 0,
  retries        int     not null default 0,
  batches        int     not null default 0,
  avg_event_ms   numeric,
  max_event_ms   numeric,
  correlation_id text
);
create index if not exists knowledge_worker_runs_started_idx
  on public.knowledge_worker_runs (started_at desc);

alter table public.knowledge_worker_runs enable row level security;
drop policy if exists knowledge_worker_runs_select on public.knowledge_worker_runs;
create policy knowledge_worker_runs_select on public.knowledge_worker_runs
  for select using (public.has_permission('knowledge.view'));
-- Sin policy de INSERT/UPDATE/DELETE: escritura solo por la RPC SECDEF (service_role).

-- 6) record_worker_run: el worker la llama al cerrar cada corrida.
create or replace function public.knowledge_record_worker_run(
  p_started_at timestamptz, p_duration_ms int, p_dry boolean,
  p_claimed int, p_processed int, p_failed_retried int, p_failed_dead int,
  p_retries int, p_batches int, p_avg_event_ms numeric, p_max_event_ms numeric,
  p_correlation_id text
)
returns uuid
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.knowledge_worker_runs (
    started_at, duration_ms, dry, claimed, processed, failed_retried, failed_dead,
    retries, batches, avg_event_ms, max_event_ms, correlation_id
  ) values (
    p_started_at, p_duration_ms, p_dry, p_claimed, p_processed, p_failed_retried, p_failed_dead,
    p_retries, p_batches, p_avg_event_ms, p_max_event_ms, p_correlation_id
  )
  returning id;
$$;

-- Hardening (H-E1-1): las 5 funciones SECDEF solo para service_role.
revoke all     on function public.knowledge_claim_batch(int, interval)                 from public;
revoke execute on function public.knowledge_claim_batch(int, interval)                 from anon, authenticated;
grant  execute on function public.knowledge_claim_batch(int, interval)                 to service_role;

revoke all     on function public.knowledge_mark_processed(uuid)                       from public;
revoke execute on function public.knowledge_mark_processed(uuid)                       from anon, authenticated;
grant  execute on function public.knowledge_mark_processed(uuid)                       to service_role;

revoke all     on function public.knowledge_mark_failed(uuid, text, int)               from public;
revoke execute on function public.knowledge_mark_failed(uuid, text, int)               from anon, authenticated;
grant  execute on function public.knowledge_mark_failed(uuid, text, int)               to service_role;

revoke all     on function public.knowledge_recover_stuck()                            from public;
revoke execute on function public.knowledge_recover_stuck()                            from anon, authenticated;
grant  execute on function public.knowledge_recover_stuck()                            to service_role;

revoke all     on function public.knowledge_record_worker_run(timestamptz, int, boolean, int, int, int, int, int, int, numeric, numeric, text) from public;
revoke execute on function public.knowledge_record_worker_run(timestamptz, int, boolean, int, int, int, int, int, int, numeric, numeric, text) from anon, authenticated;
grant  execute on function public.knowledge_record_worker_run(timestamptz, int, boolean, int, int, int, int, int, int, numeric, numeric, text) to service_role;

select pg_notify('pgrst', 'reload schema');
