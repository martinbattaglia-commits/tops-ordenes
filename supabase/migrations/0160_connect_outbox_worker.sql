-- 0160_connect_outbox_worker.sql — Nexus Link F4.1A (Fundación colaborativa).
-- ENTREGADA, NO APLICADA (G3). Aplicar a mano en el SQL Editor de prod (arsksytgdnzukbmfgkju).
-- ─────────────────────────────────────────────────────────────────────────
-- Worker/consumidor de connect_outbox (entregable F1.4 del spec §A4/NOTIF-1, nunca construido):
-- RPCs de despacho espejo del patrón PROBADO de Knowledge (0133): claim atómico con
-- FOR UPDATE SKIP LOCKED + lease sobre available_at, backoff exponencial 1→2→4 min,
-- dead-letter tras 3 reintentos, telemetría por corrida y retención (D-F41-7).
--   · connect_outbox usa PK `seq bigint` (no uuid) y columna `last_error` (no `error`).
--   · D-F41-3: el backlog histórico se drena SIN efectos (el worker F4.1 es de gobierno:
--     los efectos de notificación son SÍNCRONOS vía triggers de 0161, modelo híbrido spec:777).
--     `connect_worker_runs.skipped` registra los eventos drenados sin efecto.
--   · P-1: funciones SQL puras sin guards de rol (service_role only vía grants H-E1-1).
-- 100% ADITIVA · IDEMPOTENTE. NO toca connect_outbox (DDL) ni el trigger de 0144.
-- DEPENDE de 0143 (connect_outbox), 0146 (permiso connect.view para leer telemetría).
-- ─────────────────────────────────────────────────────────────────────────

-- 1) claim_batch: reclamar lote atómico due (pending/failed, available_at<=now()) -> processing, lock + lease.
create or replace function public.connect_claim_batch(
  p_limit int default 50,
  p_lease interval default interval '5 minutes'
)
returns setof public.connect_outbox
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.connect_outbox o
     set status = 'processing',
         available_at = now() + p_lease
   where o.seq in (
     select seq from public.connect_outbox
      where status in ('pending','failed') and available_at <= now()
      order by available_at, seq
      limit greatest(p_limit, 0)
      for update skip locked
   )
   returning o.*;
$$;

-- 2) mark_processed: processing -> processed (idempotente: solo si está en processing).
create or replace function public.connect_mark_processed(p_seq bigint)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.connect_outbox
     set status = 'processed', processed_at = now(), last_error = null
   where seq = p_seq and status = 'processing';
$$;

-- 3) mark_failed: incrementa retry_count; backoff exponencial (1->2->4 min); dead tras MAX_RETRIES (default 3).
create or replace function public.connect_mark_failed(p_seq bigint, p_error text, p_max_retries int default 3)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_new int; v_status text;
begin
  update public.connect_outbox
     set retry_count = retry_count + 1
   where seq = p_seq and status = 'processing'
   returning retry_count into v_new;

  if v_new is null then
    return null;  -- no estaba en processing (idempotente / ya resuelto)
  end if;

  if v_new <= p_max_retries then
    update public.connect_outbox
       set status = 'failed',
           last_error = left(p_error, 2000),
           available_at = now() + (power(2, v_new - 1) * interval '1 minute'),
           processed_at = null
     where seq = p_seq
     returning status into v_status;
  else
    update public.connect_outbox
       set status = 'dead', last_error = left(p_error, 2000), processed_at = now()
     where seq = p_seq
     returning status into v_status;
  end if;

  return v_status;
end;
$$;

-- 4) recover_stuck: processing con lease vencido (available_at < now()) -> failed (reprograma).
create or replace function public.connect_recover_stuck()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n int;
begin
  update public.connect_outbox
     set status = 'failed', available_at = now()
   where status = 'processing' and available_at < now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- 5) prune (retención, D-F41-7): borra SOLO 'processed' viejos. 'dead' se conserva (forense).
create or replace function public.connect_prune_outbox(p_keep interval default interval '30 days')
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_n int;
begin
  delete from public.connect_outbox
   where status = 'processed' and processed_at < now() - p_keep;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- 6) Telemetría de corridas del worker (EOL). Tabla nueva, aditiva.
--    `skipped` (D-F41-3): eventos drenados sin efecto (backlog / topics de gobierno).
--    `pruned`: filas de retención eliminadas en la corrida.
create table if not exists public.connect_worker_runs (
  id             uuid primary key default gen_random_uuid(),
  started_at     timestamptz not null,
  finished_at    timestamptz not null default now(),
  duration_ms    int     not null default 0,
  dry            boolean not null default false,
  claimed        int     not null default 0,
  processed      int     not null default 0,
  skipped        int     not null default 0,
  failed_retried int     not null default 0,
  failed_dead    int     not null default 0,
  retries        int     not null default 0,
  batches        int     not null default 0,
  pruned         int     not null default 0,
  avg_event_ms   numeric,
  max_event_ms   numeric,
  correlation_id text
);
create index if not exists connect_worker_runs_started_idx
  on public.connect_worker_runs (started_at desc);

alter table public.connect_worker_runs enable row level security;
drop policy if exists connect_worker_runs_select on public.connect_worker_runs;
create policy connect_worker_runs_select on public.connect_worker_runs
  for select using (public.has_permission('connect.view'));
-- Sin policy de INSERT/UPDATE/DELETE: escritura solo por la RPC SECDEF (service_role).

-- 7) record_worker_run: el worker la llama al cerrar cada corrida.
create or replace function public.connect_record_worker_run(
  p_started_at timestamptz, p_duration_ms int, p_dry boolean,
  p_claimed int, p_processed int, p_skipped int, p_failed_retried int, p_failed_dead int,
  p_retries int, p_batches int, p_pruned int, p_avg_event_ms numeric, p_max_event_ms numeric,
  p_correlation_id text
)
returns uuid
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.connect_worker_runs (
    started_at, duration_ms, dry, claimed, processed, skipped, failed_retried, failed_dead,
    retries, batches, pruned, avg_event_ms, max_event_ms, correlation_id
  ) values (
    p_started_at, p_duration_ms, p_dry, p_claimed, p_processed, p_skipped, p_failed_retried, p_failed_dead,
    p_retries, p_batches, p_pruned, p_avg_event_ms, p_max_event_ms, p_correlation_id
  )
  returning id;
$$;

-- Hardening (H-E1-1): las 6 funciones SECDEF solo para service_role.
revoke all     on function public.connect_claim_batch(int, interval)   from public;
revoke execute on function public.connect_claim_batch(int, interval)   from anon, authenticated;
grant  execute on function public.connect_claim_batch(int, interval)   to service_role;

revoke all     on function public.connect_mark_processed(bigint)       from public;
revoke execute on function public.connect_mark_processed(bigint)       from anon, authenticated;
grant  execute on function public.connect_mark_processed(bigint)       to service_role;

revoke all     on function public.connect_mark_failed(bigint, text, int) from public;
revoke execute on function public.connect_mark_failed(bigint, text, int) from anon, authenticated;
grant  execute on function public.connect_mark_failed(bigint, text, int) to service_role;

revoke all     on function public.connect_recover_stuck()              from public;
revoke execute on function public.connect_recover_stuck()              from anon, authenticated;
grant  execute on function public.connect_recover_stuck()              to service_role;

revoke all     on function public.connect_prune_outbox(interval)       from public;
revoke execute on function public.connect_prune_outbox(interval)       from anon, authenticated;
grant  execute on function public.connect_prune_outbox(interval)       to service_role;

revoke all     on function public.connect_record_worker_run(timestamptz, int, boolean, int, int, int, int, int, int, int, int, numeric, numeric, text) from public;
revoke execute on function public.connect_record_worker_run(timestamptz, int, boolean, int, int, int, int, int, int, int, int, numeric, numeric, text) from anon, authenticated;
grant  execute on function public.connect_record_worker_run(timestamptz, int, boolean, int, int, int, int, int, int, int, int, numeric, numeric, text) to service_role;

select pg_notify('pgrst', 'reload schema');
