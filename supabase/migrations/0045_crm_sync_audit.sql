-- =========================================================================
-- 0045_crm_sync_audit.sql — CRM Comercial F2.1-2 · auditoría de etapas + sync
--
-- ADDITIVE ONLY. ⚠️ Requiere 0041-0042 (enums, crm_opportunities), helpers RLS (0005).
-- - crm_stage_history: ledger append-only de transiciones de etapa (bigserial).
-- - clientify_sync_log: cache + auditoría del sync (cierra el "F2.7" del código:
--   sync-deals/route.ts:13 prometía esta tabla; webhook persistirá acá).
-- NO aplicar a Supabase PROD. Rama de feature, sin deploy.
-- =========================================================================

-- ---- Tabla: crm_stage_history (append-only) -----------------------------
create table if not exists public.crm_stage_history (
  id              bigserial primary key,             -- ledger → bigserial (estilo audit_log 0001)
  opportunity_id  uuid not null references public.crm_opportunities(id) on delete cascade,
  from_stage      public.crm_stage_t,
  to_stage        public.crm_stage_t not null,
  changed_by      uuid references auth.users(id) on delete set null,
  changed_at      timestamptz not null default now(),
  note            text
);
create index if not exists crm_stage_history_opp_idx on public.crm_stage_history (opportunity_id);

-- ---- Tabla: clientify_sync_log ------------------------------------------
create table if not exists public.clientify_sync_log (
  id            bigserial primary key,
  direction     text not null,                       -- 'inbound' | 'outbound'
  entity        text not null,                       -- 'lead' | 'deal' | 'contact' | 'company'
  clientify_id  text,
  nexus_id      uuid,
  event         text,                                -- evento del webhook o 'pull'
  status        text not null,                       -- 'ok' | 'error' | 'skipped'
  error         text,
  payload       jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists clientify_sync_log_entity_idx  on public.clientify_sync_log (entity);
create index if not exists clientify_sync_log_created_idx on public.clientify_sync_log (created_at);

-- =========================================================================
-- RLS — append-only: lectura staff/comercial; insert staff/comercial; sin update/
-- delete salvo admin (ledger inmutable).
-- =========================================================================
alter table public.crm_stage_history  enable row level security;
alter table public.clientify_sync_log enable row level security;

do $$
declare t text;
begin
  foreach t in array array['crm_stage_history','clientify_sync_log'] loop
    execute format('drop policy if exists "%s read" on public.%I', t, t);
    execute format('create policy "%s read" on public.%I for select using (public.is_staff() or public.current_role() = ''comercial'')', t, t);
    execute format('drop policy if exists "%s insert" on public.%I', t, t);
    execute format('create policy "%s insert" on public.%I for insert with check (public.current_role() in (''admin'',''operaciones'',''supervisor'',''comercial''))', t, t);
    execute format('drop policy if exists "%s delete" on public.%I', t, t);
    execute format('create policy "%s delete" on public.%I for delete using (public.is_admin())', t, t);
  end loop;
end $$;

notify pgrst, 'reload schema';
