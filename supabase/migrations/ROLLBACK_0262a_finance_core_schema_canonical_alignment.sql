-- =========================================================================
-- ROLLBACK_0262a_finance_core_schema_canonical_alignment.sql
--
-- Expediente: "Remediación del Incidente de Provenance 0262 — Alineación Canónica"
-- Autoridad: Dirección Técnica Nexus.
-- Régimen: Rollback condicional simétrico, fail-closed, preservación de datos y semillas.
--
-- Propósito:
--   Revertir de forma simétrica, segura y sin CASCADE el esquema financiero
--   al estado divergente previo si se requiriera en un entorno efímero/aislado.
-- =========================================================================

do $$
declare
  v_count integer;
  v_dep_count integer;
  v_cat_cols text[];
  v_cc_cols text[];
  v_cat_type_udt text;
  v_cc_bl_nullable text;
begin
  -- =======================================================================
  -- 1. PRESONDAS FAIL-CLOSED: INTEGRIDAD DE TABLAS Y SEMILLAS
  -- =======================================================================

  -- 1.1 Verificar que las 7 tablas vacías sigan teniendo 0 filas
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

  -- 1.2 Preservar y validar versión semilla
  select count(*) into v_count from public.finance_versions;
  if v_count <> 1 then raise exception 'STOP — ROLLBACK 0262a ABORTADO: finance_versions alterada'; end if;
  if not exists (select 1 from public.finance_versions where code = 'BUDGET-2026-V1') then
    raise exception 'STOP — ROLLBACK 0262a ABORTADO: Versión semilla BUDGET-2026-V1 ausente';
  end if;

  -- 1.3 Preservar y validar categorías semilla
  select count(*) into v_count from public.finance_categories;
  if v_count <> 13 then raise exception 'STOP — ROLLBACK 0262a ABORTADO: finance_categories alterada'; end if;

  -- 1.4 Preservar y validar centros de costo
  select count(*) into v_count from public.finance_cost_centers;
  if v_count <> 5 then raise exception 'STOP — ROLLBACK 0262a ABORTADO: finance_cost_centers alterada'; end if;

  -- =======================================================================
  -- 2. PRESONDAS EXHAUSTIVAS DE DEPENDENCIAS (Anti-CASCADE)
  -- =======================================================================

  -- 2.1 Foreign Keys entrantes externas
  select count(*) into v_dep_count
  from pg_constraint c
  join pg_class r_from on r_from.oid = c.conrelid
  join pg_class r_to on r_to.oid = c.confrelid
  join pg_namespace ns_from on ns_from.oid = r_from.relnamespace
  join pg_namespace ns_to on ns_to.oid = r_to.relnamespace
  where c.contype = 'f'
    and ns_to.nspname = 'public'
    and r_to.relname in (
      'finance_assumptions', 'finance_plan_lines', 'finance_forecast_adjustments',
      'finance_scenarios', 'finance_report_snapshots', 'finance_document_inbox', 'finance_quicken_imports'
    )
    and not (
      ns_from.nspname = 'public' and r_from.relname in (
        'finance_assumptions', 'finance_plan_lines', 'finance_forecast_adjustments',
        'finance_scenarios', 'finance_report_snapshots', 'finance_document_inbox', 'finance_quicken_imports'
      )
    );
  if v_dep_count > 0 then
    raise exception 'STOP — ROLLBACK 0262a ABORTADO: Existen foreign keys externas entrantes';
  end if;

  -- 2.2 Vistas dependientes
  select count(distinct v.oid) into v_dep_count
  from pg_depend d
  join pg_rewrite rw on rw.oid = d.objid
  join pg_class v on v.oid = rw.ev_class
  join pg_namespace ns_v on ns_v.oid = v.relnamespace
  join pg_class t on t.oid = d.refobjid
  join pg_namespace ns_t on ns_t.oid = t.relnamespace
  where ns_t.nspname = 'public'
    and t.relname in (
      'finance_assumptions', 'finance_plan_lines', 'finance_forecast_adjustments',
      'finance_scenarios', 'finance_report_snapshots', 'finance_document_inbox', 'finance_quicken_imports'
    )
    and v.relkind in ('v', 'm')
    and v.oid <> t.oid;
  if v_dep_count > 0 then
    raise exception 'STOP — ROLLBACK 0262a ABORTADO: Existen vistas o vistas materializadas dependientes';
  end if;

  -- =======================================================================
  -- 3. REVERSIÓN SIMÉTRICA (Cero CASCADE)
  -- =======================================================================

  -- 3.1 Drops restrictivos de las 7 tablas canónicas
  drop table public.finance_quicken_imports restrict;
  drop table public.finance_document_inbox restrict;
  drop table public.finance_report_snapshots restrict;
  drop table public.finance_scenarios restrict;
  drop table public.finance_forecast_adjustments restrict;
  drop table public.finance_plan_lines restrict;
  drop table public.finance_assumptions restrict;

  -- 3.2 Preservar semillas y reconstruir finance_categories en estado divergente exacto
  create temp table tmp_finance_categories on commit drop as
  select id, code, name, parent_id, category_type::text as category_type_str, display_order, is_active, created_at
  from public.finance_categories;

  drop table public.finance_categories restrict;

  create table public.finance_categories (
    id uuid primary key default gen_random_uuid(),
    code text unique not null,
    name text not null,
    parent_id uuid references public.finance_categories(id) on delete set null,
    category_type public.finance_direction_t not null,
    pnl_section text,
    cash_flow_section text,
    display_order integer not null default 0,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  insert into public.finance_categories (id, code, name, parent_id, category_type, display_order, is_active, created_at)
  select id, code, name, parent_id, category_type_str::public.finance_direction_t, display_order, is_active, created_at
  from tmp_finance_categories;

  create index if not exists finance_categories_type_idx on public.finance_categories(category_type);

  alter table public.finance_categories enable row level security;

  create policy "finance_categories read" on public.finance_categories for select
    using (coalesce(public.has_permission('finanzas.view'), false));

  create policy "finance_categories write" on public.finance_categories for all
    using (coalesce(public.has_permission('finanzas.admin'), false));

  grant select, insert, update, delete on public.finance_categories to authenticated;

  -- 3.3 Preservar semillas y reconstruir finance_cost_centers en estado divergente exacto
  create temp table tmp_finance_cost_centers on commit drop as
  select id, code, name, business_line, is_active, created_at
  from public.finance_cost_centers;

  drop table public.finance_cost_centers restrict;

  create table public.finance_cost_centers (
    id uuid primary key default gen_random_uuid(),
    code text unique not null,
    name text not null,
    business_line text,
    manager_id uuid,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  insert into public.finance_cost_centers (id, code, name, business_line, is_active, created_at)
  select id, code, name, business_line, is_active, created_at
  from tmp_finance_cost_centers;

  alter table public.finance_cost_centers enable row level security;

  create policy "finance_cost_centers read" on public.finance_cost_centers for select
    using (coalesce(public.has_permission('finanzas.view'), false));

  create policy "finance_cost_centers write" on public.finance_cost_centers for all
    using (coalesce(public.has_permission('finanzas.admin'), false));

  grant select, insert, update, delete on public.finance_cost_centers to authenticated;

  -- 3.4 Recreación de las 7 tablas en el estado divergente exacto
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

  -- 3.5 Índices Divergentes
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

  -- 3.6 RLS y Políticas Divergentes
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

  -- =======================================================================
  -- 4. POSTSONDAS FAIL-CLOSED: CERTIFICACIÓN INTEGRAL DE ESTADO DIVERGENTE
  -- =======================================================================

  select array_agg(column_name::text order by column_name) into v_cat_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'finance_categories';

  select udt_name into v_cat_type_udt
  from information_schema.columns
  where table_schema = 'public' and table_name = 'finance_categories' and column_name = 'category_type';

  if v_cat_cols <> array['cash_flow_section', 'category_type', 'code', 'created_at', 'display_order', 'id', 'is_active', 'name', 'parent_id', 'pnl_section', 'updated_at']
     or v_cat_type_udt <> 'finance_direction_t'
  then
    raise exception 'STOP — ROLLBACK 0262a POSTSONDA FALLÓ: finance_categories no restaurada al estado divergente exacto';
  end if;

  select array_agg(column_name::text order by column_name) into v_cc_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'finance_cost_centers';

  select is_nullable into v_cc_bl_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'finance_cost_centers' and column_name = 'business_line';

  if v_cc_cols <> array['business_line', 'code', 'created_at', 'id', 'is_active', 'manager_id', 'name', 'updated_at']
     or v_cc_bl_nullable <> 'YES'
  then
    raise exception 'STOP — ROLLBACK 0262a POSTSONDA FALLÓ: finance_cost_centers no restaurada al estado divergente exacto';
  end if;

  raise notice 'ROLLBACK 0262a completado simétricamente con éxito.';
end $$;

notify pgrst, 'reload schema';
