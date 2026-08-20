-- =========================================================================
-- ROLLBACK_0262a_finance_core_schema_canonical_alignment.sql
--
-- Expediente: "Remediación del Incidente de Provenance 0262 — Alineación Canónica"
-- Autoridad: Dirección.
-- Régimen: Rollback condicionado, fail-closed, preservación de datos y semillas.
-- =========================================================================

do $$
declare
  v_count integer;
begin
  -- 1. Presondas de seguridad: verificar que las 7 tablas vacías sigan teniendo 0 filas
  select count(*) into v_count from public.finance_assumptions;
  if v_count > 0 then raise exception 'STOP — ROLLBACK 0262a ABORTADO: finance_assumptions contiene datos (% filas)', v_count; end if;

  select count(*) into v_count from public.finance_plan_lines;
  if v_count > 0 then raise exception 'STOP — ROLLBACK 0262a ABORTADO: finance_plan_lines contiene datos (% filas)', v_count; end if;

  select count(*) into v_count from public.finance_forecast_adjustments;
  if v_count > 0 then raise exception 'STOP — ROLLBACK 0262a ABORTADO: finance_forecast_adjustments contiene datos (% filas)', v_count; end if;

  select count(*) into v_count from public.finance_scenarios;
  if v_count > 0 then raise exception 'STOP — ROLLBACK 0262a ABORTADO: finance_scenarios contiene datos (% filas)', v_count; end if;

  select count(*) into v_count from public.finance_report_snapshots;
  if v_count > 0 then raise exception 'STOP — ROLLBACK 0262a ABORTADO: finance_report_snapshots contiene datos (% filas)', v_count; end if;

  select count(*) into v_count from public.finance_document_inbox;
  if v_count > 0 then raise exception 'STOP — ROLLBACK 0262a ABORTADO: finance_document_inbox contiene datos (% filas)', v_count; end if;

  select count(*) into v_count from public.finance_quicken_imports;
  if v_count > 0 then raise exception 'STOP — ROLLBACK 0262a ABORTADO: finance_quicken_imports contiene datos (% filas)', v_count; end if;

  -- 2. Preservar seeds en finance_versions, finance_categories, finance_cost_centers
  select count(*) into v_count from public.finance_versions;
  if v_count <> 1 then raise exception 'STOP — ROLLBACK 0262a ABORTADO: finance_versions alterada'; end if;

  select count(*) into v_count from public.finance_categories;
  if v_count <> 13 then raise exception 'STOP — ROLLBACK 0262a ABORTADO: finance_categories alterada'; end if;

  select count(*) into v_count from public.finance_cost_centers;
  if v_count <> 5 then raise exception 'STOP — ROLLBACK 0262a ABORTADO: finance_cost_centers alterada'; end if;

  -- 3. Restaurar columnas auxiliares previas en categories y cost_centers
  alter table public.finance_categories
    add column if not exists pnl_section text,
    add column if not exists cash_flow_section text,
    add column if not exists updated_at timestamptz not null default now();

  alter table public.finance_cost_centers
    add column if not exists manager_id uuid,
    add column if not exists updated_at timestamptz not null default now();

  -- 4. Recrear tablas en el estado previo si se requiriera
  drop table if exists public.finance_quicken_imports cascade;
  drop table if exists public.finance_document_inbox cascade;
  drop table if exists public.finance_report_snapshots cascade;
  drop table if exists public.finance_scenarios cascade;
  drop table if exists public.finance_forecast_adjustments cascade;
  drop table if exists public.finance_plan_lines cascade;
  drop table if exists public.finance_assumptions cascade;

  create table public.finance_assumptions (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references public.finance_versions(id) on delete cascade,
    key text not null,
    name text not null,
    category text not null default 'general',
    value_numeric numeric(18, 6),
    value_text text,
    value_json jsonb,
    unit text,
    valid_from date,
    valid_to date,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (version_id, key)
  );

  create table public.finance_plan_lines (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references public.finance_versions(id) on delete cascade,
    category_id uuid not null references public.finance_categories(id) on delete restrict,
    cost_center_id uuid references public.finance_cost_centers(id) on delete set null,
    period_date date not null,
    currency public.finance_currency_t not null default 'ARS',
    amount_planned numeric(18, 4) not null default 0,
    amount_forecast numeric(18, 4) not null default 0,
    amount_actual numeric(18, 4) not null default 0,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (version_id, category_id, cost_center_id, period_date, currency)
  );

  create table public.finance_forecast_adjustments (
    id uuid primary key default gen_random_uuid(),
    forecast_date date not null,
    direction public.finance_direction_t not null,
    account_group public.finance_account_group_t not null default 'bancos',
    bank_account_id uuid references public.bank_accounts(id) on delete set null,
    category_id uuid references public.finance_categories(id) on delete set null,
    cost_center_id uuid references public.finance_cost_centers(id) on delete set null,
    currency public.finance_currency_t not null default 'ARS',
    amount numeric(18, 4) not null check (amount > 0),
    certainty_level public.finance_certainty_level_t not null default 'media',
    status public.finance_forecast_status_t not null default 'proyectado',
    concept text not null,
    entity_type text,
    entity_id uuid,
    treasury_movement_id uuid references public.treasury_movements(id) on delete set null,
    notes text,
    created_by uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table public.finance_scenarios (
    id uuid primary key default gen_random_uuid(),
    version_id uuid not null references public.finance_versions(id) on delete cascade,
    code text not null,
    name text not null,
    description text,
    is_base_case boolean not null default false,
    inflation_rate numeric(8, 4) default 0,
    fx_rate_usd numeric(12, 4),
    volume_variation_pct numeric(8, 4) default 0,
    parameters_override jsonb default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (version_id, code)
  );

  create table public.finance_report_snapshots (
    id uuid primary key default gen_random_uuid(),
    snapshot_date date not null,
    report_type text not null,
    version_id uuid references public.finance_versions(id) on delete set null,
    payload jsonb not null default '{}'::jsonb,
    hash_sha256 text,
    created_by uuid,
    created_at timestamptz not null default now()
  );

  create table public.finance_document_inbox (
    id uuid primary key default gen_random_uuid(),
    file_name text not null,
    file_size integer not null,
    mime_type text not null,
    storage_path text not null,
    status text not null default 'pending' check (status in ('pending', 'processing', 'parsed', 'linked', 'error')),
    extracted_data jsonb default '{}'::jsonb,
    matched_entity_type text,
    matched_entity_id uuid,
    error_message text,
    uploaded_by uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table public.finance_quicken_imports (
    id uuid primary key default gen_random_uuid(),
    file_name text not null,
    storage_path text not null,
    imported_at timestamptz not null default now(),
    total_records integer not null default 0,
    reconciled_records integer not null default 0,
    status text not null default 'completed' check (status in ('completed', 'with_errors', 'rolled_back')),
    summary jsonb default '{}'::jsonb,
    imported_by uuid
  );

  -- Indices
  create index if not exists finance_plan_lines_version_period_idx
    on public.finance_plan_lines (version_id, period_date);
  create index if not exists finance_forecast_date_idx
    on public.finance_forecast_adjustments (forecast_date);
  create index if not exists finance_forecast_status_idx
    on public.finance_forecast_adjustments (status);
  create index if not exists finance_forecast_acc_group_idx
    on public.finance_forecast_adjustments (account_group);
  create index if not exists finance_document_inbox_status_idx
    on public.finance_document_inbox (status);
  create index if not exists finance_categories_type_idx
    on public.finance_categories (category_type);

  -- RLS
  alter table public.finance_assumptions enable row level security;
  alter table public.finance_plan_lines enable row level security;
  alter table public.finance_forecast_adjustments enable row level security;
  alter table public.finance_scenarios enable row level security;
  alter table public.finance_report_snapshots enable row level security;
  alter table public.finance_document_inbox enable row level security;
  alter table public.finance_quicken_imports enable row level security;

  create policy "finance_assumptions read" on public.finance_assumptions for select
    using (coalesce(public.has_permission('finanzas.view'), false));
  create policy "finance_plan_lines read" on public.finance_plan_lines for select
    using (coalesce(public.has_permission('finanzas.view'), false));
  create policy "finance_forecast_adjustments read" on public.finance_forecast_adjustments for select
    using (coalesce(public.has_permission('finanzas.view'), false));
  create policy "finance_scenarios read" on public.finance_scenarios for select
    using (coalesce(public.has_permission('finanzas.view'), false));
  create policy "finance_report_snapshots read" on public.finance_report_snapshots for select
    using (coalesce(public.has_permission('finanzas.view'), false));
  create policy "finance_document_inbox read" on public.finance_document_inbox for select
    using (coalesce(public.has_permission('finanzas.view'), false));
  create policy "finance_quicken_imports read" on public.finance_quicken_imports for select
    using (coalesce(public.has_permission('finanzas.view'), false));

  create policy "finance_assumptions write" on public.finance_assumptions for all
    using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));
  create policy "finance_plan_lines write" on public.finance_plan_lines for all
    using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));
  create policy "finance_forecast_adjustments write" on public.finance_forecast_adjustments for all
    using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));
  create policy "finance_scenarios write" on public.finance_scenarios for all
    using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));
  create policy "finance_report_snapshots write" on public.finance_report_snapshots for all
    using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));
  create policy "finance_document_inbox write" on public.finance_document_inbox for all
    using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));
  create policy "finance_quicken_imports write" on public.finance_quicken_imports for all
    using (coalesce(public.has_permission('finanzas.admin'), false));

  grant select, insert, update, delete on
    public.finance_assumptions,
    public.finance_plan_lines,
    public.finance_forecast_adjustments,
    public.finance_scenarios,
    public.finance_report_snapshots,
    public.finance_document_inbox,
    public.finance_quicken_imports
  to authenticated;

  raise notice 'ROLLBACK 0262a completado.';
end $$;

notify pgrst, 'reload schema';
