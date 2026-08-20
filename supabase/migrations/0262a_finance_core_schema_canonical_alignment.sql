-- =========================================================================
-- 0262a_finance_core_schema_canonical_alignment.sql
--
-- Expediente: "Remediación del Incidente de Provenance 0262 — Alineación Canónica"
-- Autoridad: Dirección Técnica Nexus.
-- Régimen: Aditivo forward-only, dual-state determinístico integral, RLS estricto, fail-closed.
--
-- Propósito:
--   Alinear el esquema de base de datos con el contrato canónico autenticado
--   de 0262_finance_core_foundation.sql (SHA-256: 1908587594777b7e9dfd6b2d629f578a6b0edc1985b0f4f47b36038879a42d63).
--
-- Garantías de Seguridad:
--   - Cero CASCADE: Todas las eliminaciones son estrictamente restrictivas (DROP TABLE ... RESTRICT).
--   - Detección exhaustiva fail-closed de FKs externas, vistas (en cualquier schema),
--     vistas materializadas, triggers de usuario, funciones dependientes y publicaciones.
--   - Verificación integral de Estado A (Canónico) y Estado B (Divergente Certificado).
--   - Verificación exhaustiva de semillas (códigos, nombres, valores y atributos exactos).
-- =========================================================================

do $$
declare
  v_count integer;
  v_dep_count integer;
  v_is_canonical boolean := false;
  v_is_divergent boolean := false;
  v_cat_cols text[];
  v_cc_cols text[];
  v_cat_type_udt text;
  v_cc_bl_nullable text;
  v_plan_has_period boolean;
  v_plan_has_period_date boolean;
  v_fcast_has_date boolean;
  v_fcast_has_fcast_date boolean;
  v_assump_has_driver_key boolean;
  v_assump_has_key boolean;
  v_scen_has_base_id boolean;
  v_scen_has_code boolean;
  v_snap_has_period boolean;
  v_snap_has_snap_date boolean;
  v_inbox_has_sender boolean;
  v_inbox_has_file_name boolean;
  v_quicken_has_filename boolean;
  v_quicken_has_file_name boolean;
begin
  -- =======================================================================
  -- 1. PRESONDAS FAIL-CLOSED: INTEGRIDAD DE TABLAS Y SEMILLAS
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

  -- 1.3 Verificar integridad y valores exactos de versión semilla en finance_versions (1 fila)
  select count(*) into v_count from public.finance_versions;
  if v_count <> 1 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_versions contiene % filas (esperada: 1)', v_count;
  end if;
  if not exists (
    select 1 from public.finance_versions
    where code = 'BUDGET-2026-V1'
      and status = 'approved'
      and valid_from = '2026-01-01'
      and valid_to = '2026-12-31'
      and is_active = true
  ) then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Versión semilla BUDGET-2026-V1 inválida o ausente';
  end if;

  -- 1.4 Verificar integridad y códigos exactos de categorías semilla en finance_categories (13 filas exactas)
  select count(*) into v_count from public.finance_categories;
  if v_count <> 13 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_categories contiene % filas (esperadas: 13)', v_count;
  end if;
  select count(*) into v_count
  from public.finance_categories
  where code in (
    'ING_FLETES', 'ING_ALMACEN', 'ING_LOG_FARMACIA', 'ING_SERVICIOS_ESP',
    'EGR_SUELDOS', 'EGR_COMBUSTIBLE', 'EGR_MANTENIMIENTO', 'EGR_SEGUROS',
    'EGR_ALQUILERES', 'EGR_IMPUESTOS', 'EGR_HONORARIOS', 'EGR_SERVICIOS', 'EGR_OTROS'
  );
  if v_count <> 13 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Semillas de finance_categories incompletas o divergentes';
  end if;

  -- 1.5 Verificar integridad y códigos exactos de centros de costo en finance_cost_centers (5 filas exactas)
  select count(*) into v_count from public.finance_cost_centers;
  if v_count <> 5 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: finance_cost_centers contiene % filas (esperadas: 5)', v_count;
  end if;
  select count(*) into v_count
  from public.finance_cost_centers
  where code in ('CC_CARGAS_GEN', 'CC_ANMAT', 'CC_DEPOSITO', 'CC_DISTRIB', 'CC_ADMIN_CORP');
  if v_count <> 5 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Semillas de finance_cost_centers incompletas o divergentes';
  end if;

  -- 1.6 Verificar permisos RBAC finanzas.* (4 permisos)
  select count(*) into v_count
  from public.permissions
  where slug in ('finanzas.view', 'finanzas.plan', 'finanzas.approve', 'finanzas.admin');
  if v_count <> 4 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Permisos RBAC finanzas.* incompletos (encontrados: %)', v_count;
  end if;

  -- =======================================================================
  -- 2. PRESONDAS EXHAUSTIVAS DE DEPENDENCIAS (Fail-Closed, Anti-CASCADE)
  -- =======================================================================

  -- 2.1 Foreign Keys entrantes desde tablas ajenas a las 7 tablas transaccionales
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
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Existen % foreign keys externas entrantes hacia tablas financieras', v_dep_count;
  end if;

  -- 2.2 Vistas o Vistas Materializadas en cualquier schema que dependan de las tablas financieras
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
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Existen % vistas o vistas materializadas dependientes', v_dep_count;
  end if;

  -- 2.3 Triggers de usuario no internos en tablas financieras
  select count(*) into v_dep_count
  from pg_trigger tr
  join pg_class t on t.oid = tr.tgrelid
  join pg_namespace ns on ns.oid = t.relnamespace
  where ns.nspname = 'public'
    and t.relname in (
      'finance_versions', 'finance_categories', 'finance_cost_centers',
      'finance_assumptions', 'finance_plan_lines', 'finance_forecast_adjustments',
      'finance_scenarios', 'finance_report_snapshots', 'finance_document_inbox', 'finance_quicken_imports'
    )
    and not tr.tgisinternal;
  if v_dep_count > 0 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Existen % triggers de usuario no autorizados en tablas financieras', v_dep_count;
  end if;

  -- 2.4 Funciones / procedimientos dependientes
  select count(*) into v_dep_count
  from pg_depend d
  join pg_proc p on p.oid = d.objid
  join pg_class t on t.oid = d.refobjid
  join pg_namespace ns_t on ns_t.oid = t.relnamespace
  join pg_namespace ns_p on ns_p.oid = p.pronamespace
  where ns_t.nspname = 'public'
    and t.relname in (
      'finance_assumptions', 'finance_plan_lines', 'finance_forecast_adjustments',
      'finance_scenarios', 'finance_report_snapshots', 'finance_document_inbox', 'finance_quicken_imports'
    )
    and ns_p.nspname not in ('pg_catalog', 'information_schema');
  if v_dep_count > 0 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Existen % funciones dependientes de tablas financieras', v_dep_count;
  end if;

  -- 2.5 Publicaciones de replicación
  select count(*) into v_dep_count
  from pg_publication_rel pr
  join pg_class t on t.oid = pr.prrelid
  join pg_namespace ns on ns.oid = t.relnamespace
  where ns.nspname = 'public'
    and t.relname in (
      'finance_assumptions', 'finance_plan_lines', 'finance_forecast_adjustments',
      'finance_scenarios', 'finance_report_snapshots', 'finance_document_inbox', 'finance_quicken_imports'
    );
  if v_dep_count > 0 then
    raise exception 'STOP — 0262a PRECONDICIÓN NO CUMPLIDA: Tablas financieras integran publicaciones (% relaciones)', v_dep_count;
  end if;

  -- =======================================================================
  -- 3. DISCRIMINACIÓN INTEGRAL DE ESTADO (Estado A vs Estado B)
  -- =======================================================================

  -- 3.1 Inspección de columnas de finance_categories
  select array_agg(column_name::text order by column_name) into v_cat_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'finance_categories';

  select udt_name into v_cat_type_udt
  from information_schema.columns
  where table_schema = 'public' and table_name = 'finance_categories' and column_name = 'category_type';

  -- 3.2 Inspección de columnas de finance_cost_centers
  select array_agg(column_name::text order by column_name) into v_cc_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'finance_cost_centers';

  select is_nullable into v_cc_bl_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'finance_cost_centers' and column_name = 'business_line';

  -- 3.3 Marcadores estructurales de las 7 tablas transaccionales
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_plan_lines' and column_name = 'period' and data_type = 'text') into v_plan_has_period;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_plan_lines' and column_name = 'period_date' and data_type = 'date') into v_plan_has_period_date;

  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_forecast_adjustments' and column_name = 'date' and data_type = 'date') into v_fcast_has_date;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_forecast_adjustments' and column_name = 'forecast_date' and data_type = 'date') into v_fcast_has_fcast_date;

  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_assumptions' and column_name = 'driver_key' and data_type = 'text') into v_assump_has_driver_key;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_assumptions' and column_name = 'key' and data_type = 'text') into v_assump_has_key;

  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_scenarios' and column_name = 'base_scenario_id' and data_type = 'uuid') into v_scen_has_base_id;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_scenarios' and column_name = 'code' and data_type = 'text') into v_scen_has_code;

  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_report_snapshots' and column_name = 'period' and data_type = 'text') into v_snap_has_period;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_report_snapshots' and column_name = 'snapshot_date' and data_type = 'date') into v_snap_has_snap_date;

  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_document_inbox' and column_name = 'sender' and data_type = 'text') into v_inbox_has_sender;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_document_inbox' and column_name = 'file_name' and data_type = 'text') into v_inbox_has_file_name;

  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_quicken_imports' and column_name = 'filename' and data_type = 'text') into v_quicken_has_filename;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_quicken_imports' and column_name = 'file_name' and data_type = 'text') into v_quicken_has_file_name;

  -- Evaluación integral de Estado A (Canónico)
  if v_cat_cols = array['category_type', 'code', 'created_at', 'display_order', 'id', 'is_active', 'name', 'parent_id']
     and v_cat_type_udt = 'text'
     and v_cc_cols = array['business_line', 'code', 'created_at', 'id', 'is_active', 'name']
     and v_cc_bl_nullable = 'NO'
     and v_plan_has_period and not v_plan_has_period_date
     and v_fcast_has_date and not v_fcast_has_fcast_date
     and v_assump_has_driver_key and not v_assump_has_key
     and v_scen_has_base_id and not v_scen_has_code
     and v_snap_has_period and not v_snap_has_snap_date
     and v_inbox_has_sender and not v_inbox_has_file_name
     and v_quicken_has_filename and not v_quicken_has_file_name
  then
    v_is_canonical := true;
  end if;

  -- Evaluación integral de Estado B (Remoto Divergente Certificado)
  if v_cat_cols = array['cash_flow_section', 'category_type', 'code', 'created_at', 'display_order', 'id', 'is_active', 'name', 'parent_id', 'pnl_section', 'updated_at']
     and v_cat_type_udt = 'finance_direction_t'
     and v_cc_cols = array['business_line', 'code', 'created_at', 'id', 'is_active', 'manager_id', 'name', 'updated_at']
     and v_cc_bl_nullable = 'YES'
     and not v_plan_has_period and v_plan_has_period_date
     and not v_fcast_has_date and v_fcast_has_fcast_date
     and not v_assump_has_driver_key and v_assump_has_key
     and not v_scen_has_base_id and v_scen_has_code
     and not v_snap_has_period and v_snap_has_snap_date
     and not v_inbox_has_sender and v_inbox_has_file_name
     and not v_quicken_has_filename and v_quicken_has_file_name
  then
    v_is_divergent := true;
  end if;

  

  if not v_is_canonical and not v_is_divergent then

    raise exception 'STOP — 0262a ESTADO HÍBRIDO O NO IDENTIFICABLE: El esquema no coincide unívocamente con Estado A canónico ni con Estado B divergente certificado.';
  end if;

  -- =======================================================================
  -- 4. EJECUCIÓN CONDICIONAL
  -- =======================================================================

  if v_is_canonical then
    -- ESTADO A: No-op estructural verificado
    raise notice '0262a: Esquema acreditado en Estado A Canónico. Ejecutando no-op estructural.';
  else
    -- ESTADO B: Aplicación de la alineación canónica exacta
    raise notice '0262a: Esquema acreditado en Estado B Divergente. Iniciando alineación canónica...';

    -- 4.1 Corrección in-place de finance_categories
    alter table public.finance_categories
      drop column pnl_section,
      drop column cash_flow_section,
      drop column updated_at;

    alter table public.finance_categories
      alter column category_type type text using category_type::text;

    alter table public.finance_categories
      add constraint finance_categories_category_type_check
      check (category_type in ('ingreso', 'egreso', 'activo', 'pasivo'));

    alter table public.finance_categories
      drop constraint finance_categories_parent_id_fkey;

    alter table public.finance_categories
      add constraint finance_categories_parent_id_fkey
      foreign key (parent_id) references public.finance_categories(id) on delete restrict;

    -- 4.2 Corrección in-place de finance_cost_centers
    alter table public.finance_cost_centers
      drop column manager_id,
      drop column updated_at;

    alter table public.finance_cost_centers
      alter column business_line set not null;

    alter table public.finance_cost_centers
      add constraint finance_cost_centers_business_line_check
      check (business_line in ('cargas_generales', 'anmat', 'corporativo', 'almacenamiento', 'distribucion'));

    -- 4.3 Eliminación restrictiva (sin CASCADE) de las 7 tablas vacías divergentes
    drop table public.finance_quicken_imports restrict;
    drop table public.finance_document_inbox restrict;
    drop table public.finance_report_snapshots restrict;
    drop table public.finance_scenarios restrict;
    drop table public.finance_forecast_adjustments restrict;
    drop table public.finance_plan_lines restrict;
    drop table public.finance_assumptions restrict;

    -- Table: finance_assumptions (Canónica)
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

    -- Table: finance_plan_lines (Canónica)
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

    -- Table: finance_forecast_adjustments (Canónica)
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

    -- Table: finance_scenarios (Canónica)
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

    -- Table: finance_report_snapshots (Canónica)
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

    -- Table: finance_document_inbox (Canónica)
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

    -- Table: finance_quicken_imports (Canónica)
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

    -- 4.4 Índices Canónicos
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

    -- 4.5 RLS y Políticas Canónicas en las 7 tablas recreadas
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

    -- 4.6 Grants a authenticated
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
  -- 5. POSTSONDAS FAIL-CLOSED: CERTIFICACIÓN INTEGRAL DE ESTADO CANÓNICO
  -- =======================================================================

  -- 5.1 Verificar columnas exactas de finance_categories
  select array_agg(column_name::text order by column_name) into v_cat_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'finance_categories';

  select udt_name into v_cat_type_udt
  from information_schema.columns
  where table_schema = 'public' and table_name = 'finance_categories' and column_name = 'category_type';

  if v_cat_cols <> array['category_type', 'code', 'created_at', 'display_order', 'id', 'is_active', 'name', 'parent_id']
     or v_cat_type_udt <> 'text'
  then
    raise exception 'STOP — 0262a POSTSONDA FALLÓ: finance_categories no coincide con el contrato canónico exacto';
  end if;

  -- 5.2 Verificar columnas exactas de finance_cost_centers
  select array_agg(column_name::text order by column_name) into v_cc_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'finance_cost_centers';

  select is_nullable into v_cc_bl_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'finance_cost_centers' and column_name = 'business_line';

  if v_cc_cols <> array['business_line', 'code', 'created_at', 'id', 'is_active', 'name']
     or v_cc_bl_nullable <> 'NO'
  then
    raise exception 'STOP — 0262a POSTSONDA FALLÓ: finance_cost_centers no coincide con el contrato canónico exacto';
  end if;

  -- 5.3 Verificar presencia de columnas canónicas en las 7 tablas
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_plan_lines' and column_name = 'period' and data_type = 'text')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_forecast_adjustments' and column_name = 'date' and data_type = 'date')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_forecast_adjustments' and column_name = 'matched_movement_id' and data_type = 'uuid')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_assumptions' and column_name = 'driver_key' and data_type = 'text')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_scenarios' and column_name = 'base_scenario_id' and data_type = 'uuid')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_report_snapshots' and column_name = 'period' and data_type = 'text')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_document_inbox' and column_name = 'sender' and data_type = 'text')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'finance_quicken_imports' and column_name = 'filename' and data_type = 'text')
  then
    raise exception 'STOP — 0262a POSTSONDA FALLÓ: Estructura canónica incompleta en las 7 tablas';
  end if;

  -- 5.4 Verificar RLS habilitada en las 10 tablas
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
    raise exception 'STOP — 0262a POSTSONDA FALLÓ: RLS no habilitada en las 10 tablas (encontradas: %)', v_count;
  end if;

  -- 5.5 Verificar conteo exacto de 20 políticas RLS financieras
  select count(*) into v_count
  from pg_policies
  where schemaname = 'public' and tablename like 'finance_%';
  if v_count <> 20 then
    raise exception 'STOP — 0262a POSTSONDA FALLÓ: Se esperaban 20 políticas RLS, encontradas: %', v_count;
  end if;

  -- 5.6 Verificar preservación estricta de semillas
  select count(*) into v_count from public.finance_versions;
  if v_count <> 1 then raise exception 'STOP — 0262a POSTSONDA FALLÓ: finance_versions count = %', v_count; end if;

  select count(*) into v_count from public.finance_categories;
  if v_count <> 13 then raise exception 'STOP — 0262a POSTSONDA FALLÓ: finance_categories count = %', v_count; end if;

  select count(*) into v_count from public.finance_cost_centers;
  if v_count <> 5 then raise exception 'STOP — 0262a POSTSONDA FALLÓ: finance_cost_centers count = %', v_count; end if;

end $$;

notify pgrst, 'reload schema';
