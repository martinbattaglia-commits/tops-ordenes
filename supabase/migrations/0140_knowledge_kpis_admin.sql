-- ENTREGADA — F0.5.2 Knowledge Layer · 0140 — E2.3: KPIs del Panel Administrativo (read-only).
-- 100% ADITIVA y SOLO LECTURA. No toca E1/E2.0/E2.1/E2.2: ni knowledge_events (datos), ni el
-- emisor, ni el worker/dispatcher/telemetría, ni los adaptadores, ni el Timeline (D-3 congelados).
-- 5 RPC SECURITY DEFINER de agregación: cruzan la RLS por visibility_key para dar el panorama TOTAL
-- al admin, con gate INTERNO fail-closed has_permission('knowledge.admin') (D-2).
-- Gate defensivo: has_permission es SECURITY INVOKER y puede devolver NULL sin contexto de auth
-- (auth.uid() NULL) → coalesce(...,false) cierra el acceso. Hardening H-E1-1: search_path fijo,
-- revoke all from public, revoke execute from anon, grant execute to authenticated (el gate interno
-- es la frontera; NO service_role, porque las invoca el usuario staff logueado vía el cliente anon).

-- 1) HEALTH — signals crudos para el "Estado general del sistema" (D-7). El scoring vive en TS (puro, testeable).
create or replace function public.knowledge_kpi_health()
returns table (
  total_events               bigint,
  dead_count                 bigint,
  stuck_count                bigint,
  processing_count           bigint,
  due_now                    bigint,
  oldest_pending_age_seconds int,
  last_run_at                timestamptz,
  last_nondry_run_at         timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.has_permission('knowledge.admin'), false) then return; end if;
  return query
  select
    (select count(*) from public.knowledge_events),
    (select count(*) from public.knowledge_events where status = 'dead'),
    (select count(*) from public.knowledge_events where status = 'processing' and available_at < now()),
    (select count(*) from public.knowledge_events where status = 'processing'),
    (select count(*) from public.knowledge_events where status in ('pending','failed') and available_at <= now()),
    (select extract(epoch from (now() - min(available_at)))::int from public.knowledge_events where status = 'pending'),
    (select max(started_at)     from public.knowledge_worker_runs),
    (select max(started_at)     from public.knowledge_worker_runs where dry = false);
end;
$$;

-- 2) QUEUE — estado de la cola y del procesamiento (una fila resumen).
create or replace function public.knowledge_kpi_queue()
returns table (
  pending            bigint,
  processing         bigint,
  failed             bigint,
  dead               bigint,
  processed          bigint,
  total              bigint,
  due_now            bigint,
  stuck              bigint,
  oldest_pending_age_seconds int
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.has_permission('knowledge.admin'), false) then return; end if;
  return query
  select
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'processing'),
    count(*) filter (where status = 'failed'),
    count(*) filter (where status = 'dead'),
    count(*) filter (where status = 'processed'),
    count(*),
    count(*) filter (where status in ('pending','failed') and available_at <= now()),
    count(*) filter (where status = 'processing' and available_at < now()),
    (select extract(epoch from (now() - min(available_at)))::int from public.knowledge_events where status = 'pending')
  from public.knowledge_events;
end;
$$;

-- 3) SOURCES — estado de las fuentes (registry + conteo real por source_table).
create or replace function public.knowledge_kpi_sources()
returns table (
  source_table     text,
  enabled          boolean,
  last_backfill_at timestamptz,
  events           bigint,
  notes            text
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.has_permission('knowledge.admin'), false) then return; end if;
  return query
  select s.source_table, s.enabled, s.last_backfill_at,
         coalesce(c.n, 0) as events, s.notes
  from public.knowledge_sources s
  left join (
    select ke.source_table as st, count(*) as n
    from public.knowledge_events ke
    group by ke.source_table
  ) c on c.st = s.source_table
  order by s.enabled desc, s.source_table;
end;
$$;

-- 4) WORKER — telemetría agregada en una ventana (default 24h) + liveness del cron.
create or replace function public.knowledge_kpi_worker(p_window interval default interval '24 hours')
returns table (
  runs               bigint,
  processed          bigint,
  failed_retried     bigint,
  failed_dead        bigint,
  avg_duration_ms    numeric,
  max_duration_ms    int,
  last_run_at        timestamptz,
  last_nondry_run_at timestamptz,
  last_dry           boolean
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.has_permission('knowledge.admin'), false) then return; end if;
  return query
  with win as (
    select * from public.knowledge_worker_runs
    where started_at >= now() - p_window
  )
  select
    (select count(*)                                from win),
    (select coalesce(sum(win.processed),0)          from win),     -- win.* qualifica: evita choque con la columna OUT homónima
    (select coalesce(sum(win.failed_retried),0)     from win),
    (select coalesce(sum(win.failed_dead),0)        from win),
    (select round(avg(win.duration_ms)::numeric, 1) from win),
    (select max(win.duration_ms)                    from win),
    (select max(started_at)     from public.knowledge_worker_runs),
    (select max(started_at)     from public.knowledge_worker_runs where dry = false),
    (select dry from public.knowledge_worker_runs order by started_at desc limit 1);
end;
$$;

-- 5) DEAD LETTER — eventos muertos/fallidos recientes (lista acotada, error truncado).
create or replace function public.knowledge_kpi_dead_letter(p_limit int default 50)
returns table (
  seq          bigint,
  id           uuid,
  event_type   text,
  source_table text,
  status       text,
  retry_count  int,
  error        text,
  available_at timestamptz,
  occurred_at  timestamptz
)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.has_permission('knowledge.admin'), false) then return; end if;
  return query
  select ke.seq, ke.id, ke.event_type, ke.source_table, ke.status,
         ke.retry_count, left(ke.error, 500), ke.available_at, ke.occurred_at
  from public.knowledge_events ke
  where ke.status in ('dead','failed')
  order by (ke.status = 'dead') desc, ke.seq desc
  limit greatest(coalesce(p_limit, 50), 0);
end;
$$;

-- Hardening H-E1-1 (RPC de lectura para staff logueado: authenticated + gate interno; anon NO).
revoke all     on function public.knowledge_kpi_health()                 from public;
revoke execute on function public.knowledge_kpi_health()                 from anon;
grant  execute on function public.knowledge_kpi_health()                 to authenticated;

revoke all     on function public.knowledge_kpi_queue()                  from public;
revoke execute on function public.knowledge_kpi_queue()                  from anon;
grant  execute on function public.knowledge_kpi_queue()                  to authenticated;

revoke all     on function public.knowledge_kpi_sources()                from public;
revoke execute on function public.knowledge_kpi_sources()                from anon;
grant  execute on function public.knowledge_kpi_sources()                to authenticated;

revoke all     on function public.knowledge_kpi_worker(interval)         from public;
revoke execute on function public.knowledge_kpi_worker(interval)         from anon;
grant  execute on function public.knowledge_kpi_worker(interval)         to authenticated;

revoke all     on function public.knowledge_kpi_dead_letter(int)         from public;
revoke execute on function public.knowledge_kpi_dead_letter(int)         from anon;
grant  execute on function public.knowledge_kpi_dead_letter(int)         to authenticated;

select pg_notify('pgrst', 'reload schema');
