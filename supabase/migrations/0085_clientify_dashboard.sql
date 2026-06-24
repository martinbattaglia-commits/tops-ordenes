-- =========================================================================
-- 0085_clientify_dashboard — CRM Comercial › Tablero (espejo Clientify)
-- =========================================================================
-- Caché diaria de deals de Clientify + overlay manual (probabilidad/horizonte/
-- observaciones) compartido y auditado + snapshots históricos por pipeline para
-- tendencias. Un job (21:00 ART = 00:00 UTC) hace replace atómico de la caché y
-- agrega 1 snapshot por día por pipeline. Nexus NUNCA escribe en Clientify.
--
-- 100% ADITIVA. Convenciones (0082): id uuid default gen_random_uuid();
-- created_at/updated_at default now(); trigger public.tg_touch_updated_at()
-- (0005); RLS con public.current_role(); RPC security definer + search_path fijo;
-- revoke from public/anon/authenticated + grant a service_role.
-- =========================================================================

-- ---- Enum status de deal (espejo de mappers.ts) -------------------------
do $$ begin
  create type public.clientify_deal_status_t as enum ('open','expired','won','lost','other');
exception when duplicate_object then null; end $$;

-- ---- (A) Caché de deals (replace diario) --------------------------------
create table if not exists public.clientify_deals_cache (
  deal_id        bigint primary key,                    -- id de Clientify (estable)
  title          text not null default '',
  contact_name   text,
  company_name   text,
  amount         numeric(16,2) not null default 0,
  currency       text not null default 'ARS',
  stage          text,
  stage_id       bigint,
  pipeline       text,
  pipeline_id    bigint,
  probability    int not null default 0,                -- prob. de Clientify (no la editable)
  status         public.clientify_deal_status_t not null default 'other',
  status_label   text,
  owner_name     text,
  expected_close date,
  actual_close   date,
  created_src    timestamptz,                           -- created en Clientify
  modified_src   timestamptz,                           -- modified en Clientify
  href           text,
  sync_run_id    uuid,
  synced_at      timestamptz not null default now()
);
create index if not exists clientify_cache_pipeline_idx on public.clientify_deals_cache (pipeline_id, status);
create index if not exists clientify_cache_modified_idx on public.clientify_deals_cache (modified_src desc);

-- ---- (B) Overlay manual (compartido + auditado) -------------------------
-- Reemplaza el localStorage per-device del artefacto. 1 fila por deal.
create table if not exists public.crm_deal_overlay (
  clientify_deal_id bigint primary key,                 -- = clientify_deals_cache.deal_id
  -- La PROBABILIDAD de concreción NO vive acá: se toma siempre de Clientify (foto
  -- del último corte). En Nexus solo se anotan horizonte y observaciones.
  horizonte         text,                               -- 'Esta semana' | '15 días' | ... | 'A definir'
  observaciones     text,
  updated_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---- (C) Snapshot histórico — 1 por día por pipeline --------------------
create table if not exists public.clientify_dashboard_snapshots (
  id                uuid primary key default gen_random_uuid(),
  snapshot_date     date not null default current_date,
  pipeline_id       bigint not null,
  pipeline_name     text not null,
  sync_run_id       uuid,
  deals_total       int not null default 0,             -- todos los deals del pipeline
  deals_active      int not null default 0,             -- status not in (won,lost)
  total_amount      numeric(16,2) not null default 0,   -- Σ amount (todos)
  active_amount     numeric(16,2) not null default 0,   -- Σ amount (status in open,other) → "pipeline vivo"
  forecast_weighted numeric(16,2) not null default 0,   -- Σ amount*prob/100 (solo activos no expired)
  won_count         int not null default 0,
  won_amount        numeric(16,2) not null default 0,
  lost_count        int not null default 0,
  expired_count     int not null default 0,
  avg_probability   numeric(6,2) not null default 0,
  created_at        timestamptz not null default now(),
  unique (snapshot_date, pipeline_id)                   -- upsert: última corrida del día gana
);
create index if not exists clientify_snap_idx on public.clientify_dashboard_snapshots (pipeline_id, snapshot_date desc);

-- ---- (D) Bitácora de sync ----------------------------------------------
create table if not exists public.clientify_sync_log (
  id            bigserial primary key,
  run_id        uuid not null unique default gen_random_uuid(),
  trigger       text not null check (trigger in ('cron','manual','api')),
  status        text not null check (status in ('running','completed','partial','error','skipped')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  duration_ms   int,
  pipelines     int default 0,
  deals_synced  int default 0,
  errors        int default 0,
  message       text,
  report        jsonb,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists clientify_sync_started_idx on public.clientify_sync_log (started_at desc);

-- ---- Triggers updated_at (usa public.tg_touch_updated_at() de 0005) ------
drop trigger if exists trg_crm_deal_overlay_touch on public.crm_deal_overlay;
create trigger trg_crm_deal_overlay_touch
  before update on public.crm_deal_overlay
  for each row execute function public.tg_touch_updated_at();

-- ---- (E) Replace ATÓMICO de la caché (DELETE+INSERT) --------------------
-- security definer + search_path fijo; EXECUTE solo service_role (lo llama el job).
create or replace function public.clientify_replace_deals_cache(p_rows jsonb, p_run_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count int;
begin
  delete from public.clientify_deals_cache;
  insert into public.clientify_deals_cache
    (deal_id, title, contact_name, company_name, amount, currency, stage, stage_id,
     pipeline, pipeline_id, probability, status, status_label, owner_name,
     expected_close, actual_close, created_src, modified_src, href, sync_run_id)
  select (r->>'deal_id')::bigint,
         coalesce(r->>'title',''),
         nullif(r->>'contact_name',''),
         nullif(r->>'company_name',''),
         coalesce((r->>'amount')::numeric, 0),
         coalesce(nullif(r->>'currency',''), 'ARS'),
         nullif(r->>'stage',''),
         nullif(r->>'stage_id','')::bigint,
         nullif(r->>'pipeline',''),
         nullif(r->>'pipeline_id','')::bigint,
         coalesce((r->>'probability')::int, 0),
         coalesce(nullif(r->>'status','')::public.clientify_deal_status_t, 'other'),
         nullif(r->>'status_label',''),
         nullif(r->>'owner_name',''),
         nullif(r->>'expected_close','')::date,
         nullif(r->>'actual_close','')::date,
         nullif(r->>'created_src','')::timestamptz,
         nullif(r->>'modified_src','')::timestamptz,
         nullif(r->>'href',''),
         p_run_id
  from jsonb_array_elements(p_rows) as r;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.clientify_replace_deals_cache(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.clientify_replace_deals_cache(jsonb, uuid) to service_role;

-- ---- (F) Vista de lectura: caché + overlay ------------------------------
create or replace view public.v_clientify_deals_enriched
  with (security_invoker = true) as
  select c.*,
         o.horizonte     as overlay_horizonte,
         o.observaciones as overlay_observaciones,
         o.updated_at    as overlay_updated_at,
         c.probability   as effective_probability   -- prob. SIEMPRE de Clientify (foto de hoy); el overlay no la pisa
  from public.clientify_deals_cache c
  left join public.crm_deal_overlay o on o.clientify_deal_id = c.deal_id;

-- ---- RLS ----------------------------------------------------------------
-- Lectura: cualquier autenticado (datos comerciales internos, patrón compliance/caja-chica).
-- Escritura overlay: roles comerciales. Caché/snapshots/log: solo service-role (sin policy write).
alter table public.clientify_deals_cache         enable row level security;
alter table public.crm_deal_overlay              enable row level security;
alter table public.clientify_dashboard_snapshots enable row level security;
alter table public.clientify_sync_log            enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'clientify_deals_cache','crm_deal_overlay','clientify_dashboard_snapshots','clientify_sync_log'
  ] loop
    execute format('drop policy if exists "%1$s read" on public.%1$s', t);
    execute format($f$
      create policy "%1$s read" on public.%1$s
        for select to authenticated using (true);
    $f$, t);
  end loop;
end $$;

-- Escritura del overlay: roles del equipo comercial. user_role_t (0001) = admin|
-- operaciones|supervisor|cliente → el equipo comercial opera como 'operaciones'
-- (misma convención que crm_opportunities/0042 y caja-chica/0082). Los demás writes
-- (caché/snapshots/log) van por service-role.
drop policy if exists "crm_deal_overlay write" on public.crm_deal_overlay;
create policy "crm_deal_overlay write" on public.crm_deal_overlay
  for all to authenticated
  using (public.current_role() in ('admin','supervisor','operaciones'))
  with check (public.current_role() in ('admin','supervisor','operaciones'));

notify pgrst, 'reload schema';
