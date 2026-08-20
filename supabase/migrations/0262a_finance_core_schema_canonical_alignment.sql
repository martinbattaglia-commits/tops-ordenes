-- =========================================================================
-- 0262a_finance_core_schema_canonical_alignment.sql
--
-- Expediente: "Remediación del Incidente de Provenance 0262 — Alineación Canónica"
-- Autoridad: Dirección (Master de Continuación Full Push Autónomo).
-- Régimen: Aditivo forward-only, dual-state determinístico, RLS estricto, fail-closed.
--
-- Propósito:
--   Alinear el esquema de base de datos con el contrato canónico autenticado
--   de 0262_finance_core_foundation.sql (SHA-256: 1908587594777b7e9dfd6b2d629f578a6b0edc1985b0f4f47b36038879a42d63).
--
-- Soporte Dual-State:
--   - Estado A (Replay Canónico): No-op estructural verificado.
--   - Estado B (Remoto Divergente): Corrección in-place de categories y cost_centers,
--     y recreación atómica de las 7 tablas vacías.
-- =========================================================================

do $$
declare
  v_count integer;
  v_is_canonical boolean := false;
  v_is_divergent boolean := false;
  v_has_pnl_section boolean;
  v_has_manager_id boolean;
  v_has_period_date boolean;
  v_has_period boolean;
begin
  -- =======================================================================
  -- 1. PRESONDAS FAIL-CLOSED (Comunes a Estado A y B)
  -- =======================================================================

  -- 1.1 Verificar existencia de las 10 tablas finance_%
  select count(*) into v_count
  from information_schema.tables
  where table_schema = 'public'
    and table_name in (
      'finance_versions',
      'finance_categories',
      'finance_cost_centers',
      'finance_assumptions',
      'finance_plan_lines',
      'finance_forecast_adjustments',
      'finance_scenarios',
      'finance_report_snapshots',
      'finance_document_inbox',
      'finance_quicken_imports'
    );

  if v_count <> 10 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Se esperaban 10 tablas finance_*, encontradas: %', v_count;
  end if;

  -- 1.2 Verificar que las 7 tablas transaccionales estén estrictamente vacías
  select count(*) into v_count from public.finance_assumptions;
  if v_count > 0 then raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_assumptions contiene % filas', v_count; end if;

  select count(*) into v_count from public.finance_plan_lines;
  if v_count > 0 then raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_plan_lines contiene % filas', v_count; end if;

  select count(*) into v_count from public.finance_forecast_adjustments;
  if v_count > 0 then raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_forecast_adjustments contiene % filas', v_count; end if;

  select count(*) into v_count from public.finance_scenarios;
  if v_count > 0 then raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_scenarios contiene % filas', v_count; end if;

  select count(*) into v_count from public.finance_report_snapshots;
  if v_count > 0 then raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_report_snapshots contiene % filas', v_count; end if;

  select count(*) into v_count from public.finance_document_inbox;
  if v_count > 0 then raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_document_inbox contiene % filas', v_count; end if;

  select count(*) into v_count from public.finance_quicken_imports;
  if v_count > 0 then raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_quicken_imports contiene % filas', v_count; end if;

  -- 1.3 Verificar integridad y conteo de versión semilla en finance_versions (1 fila)
  select count(*) into v_count from public.finance_versions;
  if v_count <> 1 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_versions contiene % filas (esperada: 1)', v_count;
  end if;
  if not exists (select 1 from public.finance_versions where code = 'BUDGET-2026-V1') then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Versión semilla BUDGET-2026-V1 ausente';
  end if;

  -- 1.4 Verificar integridad y conteo de categorías semilla en finance_categories (13 filas)
  select count(*) into v_count from public.finance_categories;
  if v_count <> 13 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_categories contiene % filas (esperadas: 13)', v_count;
  end if;

  -- 1.5 Verificar integridad y conteo de centros de costo en finance_cost_centers (5 filas)
  select count(*) into v_count from public.finance_cost_centers;
  if v_count <> 5 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_cost_centers contiene % filas (esperadas: 5)', v_count;
  end if;

  -- 1.6 Verificar permisos RBAC finanzas.* (4 permisos)
  select count(*) into v_count
  from public.permissions
  where slug in ('finanzas.view', 'finanzas.plan', 'finanzas.approve', 'finanzas.admin');
  if v_count <> 4 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Permisos finanzas.* incompletos (encontrados: %)', v_count;
  end if;

  -- 1.7 Verificar ausencia de dependencias externas entrantes (views o fkeys ajenas a finance_*)
  select count(*) into v_count
  from information_schema.view_table_usage
  where view_schema = 'public'
    and table_schema = 'public'
    and table_name in (
      'finance_assumptions', 'finance_plan_lines', 'finance_forecast_adjustments',
      'finance_scenarios', 'finance_report_snapshots', 'finance_document_inbox', 'finance_quicken_imports'
    );
  if v_count > 0 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Existen vistas dependientes de tablas financieras';
  end if;

  -- =======================================================================
  -- 2. DISCRIMINACIÓN DETERMINÍSTICA DE ESTADO (Estado A vs Estado B)
  -- =======================================================================

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'finance_categories' and column_name = 'pnl_section'
  ) into v_has_pnl_section;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'finance_cost_centers' and column_name = 'manager_id'
  ) into v_has_manager_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'finance_plan_lines' and column_name = 'period_date'
  ) into v_has_period_date;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'finance_plan_lines' and column_name = 'period'
  ) into v_has_period;

  -- Estado A: Canónico (sin pnl_section, sin manager_id, con period, sin period_date)
  if not v_has_pnl_section and not v_has_manager_id and v_has_period and not v_has_period_date then
    v_is_canonical := true;
  end if;

  -- Estado B: Divergente Exacto (con pnl_section, con manager_id, con period_date, sin period)
  if v_has_pnl_section and v_has_manager_id and v_has_period_date and not v_has_period then
    v_is_divergent := true;
  end if;

  if not v_is_canonical and not v_is_divergent then
    raise exception 'STOP — 0262a ESTADO HÍBRIDO O NO IDENTIFICABLE: abortando sin modificaciones.';
  end if;

  -- =======================================================================
  -- 3. EJECUCIÓN CONDICIONAL
  -- =======================================================================

  if v_is_canonical then
    -- ESTADO A: No-op estructural
    raise notice '0262a: Esquema ya se encuentra en estado canónico. No-op estructural ejecutado.';
  else
    -- ESTADO B: Aplicación de la alineación canónica exacta
    raise notice '0262a: Detectado estado remoto divergente. Iniciando alineación canónica...';

    -- 3.1 Corrección in-place de finance_categories
    alter table public.finance_categories
      drop column if exists pnl_section,
      drop column if exists cash_flow_section,
      drop column if exists updated_at;

    alter table public.finance_categories
      alter column category_type type text using category_type::text;

    alter table public.finance_categories
      drop constraint if exists finance_categories_category_type_check;

    alter table public.finance_categories
      add constraint finance_categories_category_type_check
      check (category_type in ('ingreso', 'egreso', 'activo', 'pasivo'));

    alter table public.finance_categories
      drop constraint if exists finance_categories_parent_id_fkey;

    alter table public.finance_categories
      add constraint finance_categories_parent_id_fkey
      foreign key (parent_id) references public.finance_categories(id) on delete restrict;

    -- 3.2 Corrección in-place de finance_cost_centers
    alter table public.finance_cost_centers
      drop column if exists manager_id,
      drop column if exists updated_at;

    alter table public.finance_cost_centers
      alter column business_line set not null;

    alter table public.finance_cost_centers
      drop constraint if exists finance_cost_centers_business_line_check;

    alter table public.finance_cost_centers
      add constraint finance_cost_centers_business_line_check
      check (business_line in ('cargas_generales', 'anmat', 'corporativo', 'almacenamiento', 'distribucion'));

    -- 3.3 Recreación de las 7 tablas vacías divergentes
    drop table if exists public.finance_quicken_imports cascade;
    drop table if exists public.finance_document_inbox cascade;
    drop table if exists public.finance_report_snapshots cascade;
    drop table if exists public.finance_scenarios cascade;
    drop table if exists public.finance_forecast_adjustments cascade;
    drop table if exists public.finance_plan_lines cascade;
    drop table if exists public.finance_assumptions cascade;

    -- Table: finance_assumptions
    create table public.finance_assumptions (
      id uuid primary key default gen_random_uuid(),
      version_id uuid not null references public.finance_versions(id) on delete cascade,
      driver_key text not null,
      name text not null,
      category text not null default 'general',
      unit text not null default 'ARS',
      source text,
      value numeric not null default 0,
      period text,
      notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (version_id, driver_key, period)
    );

    -- Table: finance_plan_lines
    create table public.finance_plan_lines (
      id uuid primary key default gen_random_uuid(),
      version_id uuid not null references public.finance_versions(id) on delete cascade,
      category_id uuid not null references public.finance_categories(id) on delete restrict,
      cost_center_id uuid references public.finance_cost_centers(id) on delete set null,
      period text not null, -- YYYY-MM
      amount numeric not null default 0,
      currency public.finance_currency_t not null default 'ARS',
      notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (version_id, category_id, cost_center_id, period, currency)
    );

    -- Table: finance_forecast_adjustments
    create table public.finance_forecast_adjustments (
      id uuid primary key default gen_random_uuid(),
      date date not null,
      due_date date,
      direction public.finance_direction_t not null,
      amount numeric not null,
      currency public.finance_currency_t not null default 'ARS',
      account_group public.finance_account_group_t not null default 'bancos',
      bank_account_id uuid references public.bank_accounts(id) on delete set null,
      counterpart text,
      concept text not null,
      category_id uuid references public.finance_categories(id) on delete set null,
      cost_center_id uuid references public.finance_cost_centers(id) on delete set null,
      status public.finance_forecast_status_t not null default 'proyectado',
      certainty_level public.finance_certainty_level_t not null default 'alta',
      is_recurring boolean not null default false,
      recurrence_rule text,
      notes text,
      evidence_url text,
      matched_movement_id uuid references public.treasury_movements(id) on delete set null,
      created_by uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    -- Table: finance_scenarios
    create table public.finance_scenarios (
      id uuid primary key default gen_random_uuid(),
      version_id uuid not null references public.finance_versions(id) on delete cascade,
      name text not null,
      description text,
      base_scenario_id uuid references public.finance_scenarios(id) on delete set null,
      fx_rate_override numeric,
      inflation_override numeric,
      volume_factor numeric not null default 1.0,
      is_active boolean not null default true,
      created_at timestamptz not null default now()
    );

    -- Table: finance_report_snapshots
    create table public.finance_report_snapshots (
      id uuid primary key default gen_random_uuid(),
      period text not null,
      report_type text not null,
      title text not null,
      data jsonb not null,
      version_id uuid references public.finance_versions(id) on delete set null,
      created_by uuid,
      created_at timestamptz not null default now()
    );

    -- Table: finance_document_inbox
    create table public.finance_document_inbox (
      id uuid primary key default gen_random_uuid(),
      sender text not null,
      subject text not null,
      received_at timestamptz not null default now(),
      status text not null check (status in ('borrador', 'en_revision', 'procesado', 'descartado')) default 'borrador',
      extracted_data jsonb not null default '{}'::jsonb,
      raw_email_url text,
      attachment_url text,
      reviewed_by uuid,
      reviewed_at timestamptz,
      notes text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    -- Table: finance_quicken_imports
    create table public.finance_quicken_imports (
      id uuid primary key default gen_random_uuid(),
      filename text not null,
      file_hash text not null,
      total_records integer not null default 0,
      total_amount_ars numeric not null default 0,
      total_amount_usd numeric not null default 0,
      status text not null check (status in ('preview', 'validated', 'imported', 'failed')) default 'preview',
      summary jsonb not null default '{}'::jsonb,
      created_by uuid,
      created_at timestamptz not null default now()
    );

    -- 3.4 Índices Canónicos
    create index if not exists finance_plan_lines_version_period_idx
      on public.finance_plan_lines (version_id, period);

    create index if not exists finance_forecast_date_idx
      on public.finance_forecast_adjustments (date);

    create index if not exists finance_forecast_status_idx
      on public.finance_forecast_adjustments (status);

    create index if not exists finance_forecast_acc_group_idx
      on public.finance_forecast_adjustments (account_group);

    create index if not exists finance_document_inbox_status_idx
      on public.finance_document_inbox (status);

    create index if not exists finance_categories_type_idx
      on public.finance_categories (category_type);

    -- 3.5 RLS y Políticas Canónicas en las 7 tablas recreadas
    alter table public.finance_assumptions enable row level security;
    alter table public.finance_plan_lines enable row level security;
    alter table public.finance_forecast_adjustments enable row level security;
    alter table public.finance_scenarios enable row level security;
    alter table public.finance_report_snapshots enable row level security;
    alter table public.finance_document_inbox enable row level security;
    alter table public.finance_quicken_imports enable row level security;

    -- Políticas de lectura (finanzas.view)
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

    -- Políticas de escritura (finanzas.plan / finanzas.admin)
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

    -- 3.6 Grants a authenticated
    grant select, insert, update, delete on
      public.finance_assumptions,
      public.finance_plan_lines,
      public.finance_forecast_adjustments,
      public.finance_scenarios,
      public.finance_report_snapshots,
      public.finance_document_inbox,
      public.finance_quicken_imports
    to authenticated;

    raise notice '0262a: Alineación canónica completada exitosamente.';
  end if;

  -- =======================================================================
  -- 4. POSTSONDAS FAIL-CLOSED
  -- =======================================================================

  -- 4.1 Verificar que finance_plan_lines posee columna period text
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'finance_plan_lines' and column_name = 'period' and data_type = 'text'
  ) then
    raise exception 'STOP — 0262a POSTSONDA FALLÓ: finance_plan_lines.period text no existe';
  end if;

  -- 4.2 Verificar que finance_forecast_adjustments posee date y matched_movement_id
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'finance_forecast_adjustments' and column_name = 'date' and data_type = 'date'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'finance_forecast_adjustments' and column_name = 'matched_movement_id' and data_type = 'uuid'
  ) then
    raise exception 'STOP — 0262a POSTSONDA FALLÓ: finance_forecast_adjustments columnas canónicas ausentes';
  end if;

  -- 4.3 Verificar que finance_assumptions posee driver_key
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'finance_assumptions' and column_name = 'driver_key' and data_type = 'text'
  ) then
    raise exception 'STOP — 0262a POSTSONDA FALLÓ: finance_assumptions.driver_key no existe';
  end if;

  -- 4.4 Verificar que finance_categories no contiene pnl_section
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'finance_categories' and column_name = 'pnl_section'
  ) then
    raise exception 'STOP — 0262a POSTSONDA FALLÓ: finance_categories.pnl_section sigue presente';
  end if;

  -- 4.5 Verificar que finance_cost_centers no contiene manager_id
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'finance_cost_centers' and column_name = 'manager_id'
  ) then
    raise exception 'STOP — 0262a POSTSONDA FALLÓ: finance_cost_centers.manager_id sigue presente';
  end if;

  -- 4.6 Verificar RLS habilitada en las 10 tablas
  select count(*) into v_count
  from pg_tables
  where schemaname = 'public'
    and tablename in (
      'finance_versions', 'finance_categories', 'finance_cost_centers', 'finance_assumptions',
      'finance_plan_lines', 'finance_forecast_adjustments', 'finance_scenarios',
      'finance_report_snapshots', 'finance_document_inbox', 'finance_quicken_imports'
    )
    and rowsecurity = true;
  if v_count <> 10 then
    raise exception 'STOP — 0262a POSTSONDA FALLÓ: RLS no está habilitada en las 10 tablas (encontradas: %)', v_count;
  end if;

  -- 4.7 Verificar exactamente 20 políticas RLS financieras
  select count(*) into v_count
  from pg_policies
  where schemaname = 'public' and tablename like 'finance_%';
  if v_count <> 20 then
    raise exception 'STOP — 0262a POSTSONDA FALLÓ: Se esperaban 20 políticas RLS, encontradas: %', v_count;
  end if;

  -- 4.8 Verificar preservación de seeds y conteos
  select count(*) into v_count from public.finance_versions;
  if v_count <> 1 then raise exception 'STOP — 0262a POSTSONDA FALLÓ: finance_versions count = %', v_count; end if;

  select count(*) into v_count from public.finance_categories;
  if v_count <> 13 then raise exception 'STOP — 0262a POSTSONDA FALLÓ: finance_categories count = %', v_count; end if;

  select count(*) into v_count from public.finance_cost_centers;
  if v_count <> 5 then raise exception 'STOP — 0262a POSTSONDA FALLÓ: finance_cost_centers count = %', v_count; end if;

end $$;

notify pgrst, 'reload schema';
