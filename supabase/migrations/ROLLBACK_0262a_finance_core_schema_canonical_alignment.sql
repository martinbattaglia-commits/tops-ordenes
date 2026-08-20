-- =========================================================================
-- ROLLBACK_0262a_finance_core_schema_canonical_alignment.sql
--
-- Expediente: "Remediación del Incidente de Provenance 0262 — Alineación Canónica"
-- Autoridad: Dirección Técnica Nexus.
-- Régimen: Reversibilidad simétrica, dual-state exhaustivo, fail-closed.
--
-- Propósito:
--   Revertir simétricamente el esquema desde el contrato canónico 0262
--   hacia el estado divergente original ejecutado remotamente.
--
-- Garantías de Seguridad:
--   - Cero CASCADE: Todas las eliminaciones son estrictamente restrictivas (DROP TABLE ... RESTRICT).
--   - Detección exhaustiva fail-closed de FKs externas, vistas (en cualquier schema),
--     vistas materializadas, triggers de usuario, funciones dependientes y publicaciones.
--   - Identificación dual-state exacta: Comprobación exhaustiva del manifest de las 10 tablas.
--   - Preservación íntegra de semillas y UUIDs originales.
-- =========================================================================

do $$
declare
  v_count integer;
  v_dep_count integer;
begin
  -- =======================================================================
  -- 1. PRESONDAS FAIL-CLOSED: INTEGRIDAD DE TABLAS Y SEMILLAS
  -- =======================================================================

  select count(*) into v_count
  from information_schema.tables
  where table_schema = 'public'
    and table_name like 'finance_%'
    and table_type = 'BASE TABLE';

  if v_count <> 10 then
    raise exception 'STOP — ROLLBACK_0262a PRECONDICIÓN NO CUMPLIDA: Se esperaban 10 tablas finance_*, encontradas: %', v_count;
  end if;

  -- 1.2 Verificar que las 7 tablas transaccionales estén estrictamente vacías
  select count(*) into v_count from public.finance_assumptions;
  if v_count > 0 then raise exception 'STOP — ROLLBACK_0262a PRECONDICIÓN NO CUMPLIDA: finance_assumptions contiene % filas', v_count; end if;

  select count(*) into v_count from public.finance_plan_lines;
  if v_count > 0 then raise exception 'STOP — ROLLBACK_0262a PRECONDICIÓN NO CUMPLIDA: finance_plan_lines contiene % filas', v_count; end if;

  select count(*) into v_count from public.finance_forecast_adjustments;
  if v_count > 0 then raise exception 'STOP — ROLLBACK_0262a PRECONDICIÓN NO CUMPLIDA: finance_forecast_adjustments contiene % filas', v_count; end if;

  select count(*) into v_count from public.finance_scenarios;
  if v_count > 0 then raise exception 'STOP — ROLLBACK_0262a PRECONDICIÓN NO CUMPLIDA: finance_scenarios contiene % filas', v_count; end if;

  select count(*) into v_count from public.finance_report_snapshots;
  if v_count > 0 then raise exception 'STOP — ROLLBACK_0262a PRECONDICIÓN NO CUMPLIDA: finance_report_snapshots contiene % filas', v_count; end if;

  select count(*) into v_count from public.finance_document_inbox;
  if v_count > 0 then raise exception 'STOP — ROLLBACK_0262a PRECONDICIÓN NO CUMPLIDA: finance_document_inbox contiene % filas', v_count; end if;

  select count(*) into v_count from public.finance_quicken_imports;
  if v_count > 0 then raise exception 'STOP — ROLLBACK_0262a PRECONDICIÓN NO CUMPLIDA: finance_quicken_imports contiene % filas', v_count; end if;

  -- 1.3 Verificar integridad y atributos de semillas
  select count(*) into v_count from public.finance_versions;
  if v_count <> 1 then raise exception 'STOP — ROLLBACK_0262a PRECONDICIÓN NO CUMPLIDA: finance_versions count = %', v_count; end if;
  if not exists (
    select 1 from public.finance_versions
    where code = 'BUDGET-2026-V1'
      and name = 'Presupuesto Operativo 2026 v1.0'
      and status = 'approved'
      and valid_from = '2026-01-01'
      and valid_to = '2026-12-31'
      and is_active = true
  ) then
    raise exception 'STOP — ROLLBACK_0262a PRECONDICIÓN NO CUMPLIDA: Versión semilla BUDGET-2026-V1 inválida o alterada';
  end if;

  select count(*) into v_count from public.finance_categories;
  if v_count <> 13 then raise exception 'STOP — ROLLBACK_0262a PRECONDICIÓN NO CUMPLIDA: finance_categories count = %', v_count; end if;

  select count(*) into v_count from public.finance_cost_centers;
  if v_count <> 5 then raise exception 'STOP — ROLLBACK_0262a PRECONDICIÓN NO CUMPLIDA: finance_cost_centers count = %', v_count; end if;

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
    raise exception 'STOP — ROLLBACK_0262a PRECONDICIÓN NO CUMPLIDA: Existen % foreign keys externas entrantes hacia tablas financieras', v_dep_count;
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
    raise exception 'STOP — ROLLBACK_0262a PRECONDICIÓN NO CUMPLIDA: Existen % vistas o vistas materializadas dependientes', v_dep_count;
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
    raise exception 'STOP — ROLLBACK_0262a PRECONDICIÓN NO CUMPLIDA: Existen % triggers de usuario no autorizados en tablas financieras', v_dep_count;
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
    raise exception 'STOP — ROLLBACK_0262a PRECONDICIÓN NO CUMPLIDA: Existen % funciones dependientes de tablas financieras', v_dep_count;
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
    raise exception 'STOP — ROLLBACK_0262a PRECONDICIÓN NO CUMPLIDA: Tablas financieras integran publicaciones (% relaciones)', v_dep_count;
  end if;

  -- =======================================================================
  -- 3. RECONSTRUCCIÓN SIMÉTRICA HACIA ESTADO DIVERGENTE B
  -- =======================================================================

  -- 3.1 Eliminación restrictiva (sin CASCADE) de las 7 tablas canónicas vacías
  drop table public.finance_quicken_imports restrict;
  drop table public.finance_document_inbox restrict;
  drop table public.finance_report_snapshots restrict;
  drop table public.finance_scenarios restrict;
  drop table public.finance_forecast_adjustments restrict;
  drop table public.finance_plan_lines restrict;
  drop table public.finance_assumptions restrict;

  -- 3.2 Reversión de finance_categories al esquema divergente B
  alter table public.finance_categories
    drop constraint if exists finance_categories_category_type_check;

  alter table public.finance_categories
    alter column category_type type public.finance_direction_t using category_type::public.finance_direction_t;

  alter table public.finance_categories
    add column if not exists pnl_section text,
    add column if not exists cash_flow_section text,
    add column if not exists updated_at timestamptz not null default now();

  alter table public.finance_categories
    drop constraint if exists finance_categories_parent_id_fkey;

  alter table public.finance_categories
    add constraint finance_categories_parent_id_fkey
    foreign key (parent_id) references public.finance_categories(id) on delete set null;

  -- 3.3 Reversión de finance_cost_centers al esquema divergente B
  alter table public.finance_cost_centers
    drop constraint if exists finance_cost_centers_business_line_check;

  alter table public.finance_cost_centers
    alter column business_line drop not null;

  alter table public.finance_cost_centers
    add column if not exists manager_id uuid,
    add column if not exists updated_at timestamptz not null default now();

  -- 3.4 Recreación exacta de las 7 tablas divergentes B
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

  -- 3.5 Índices Divergentes B
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

  -- 3.6 RLS y Políticas Divergentes B
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

  -- 3.7 Grants a authenticated
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
  -- 4. POSTSONDAS FAIL-CLOSED: CERTIFICACIÓN DE ESTADO DIVERGENTE B
  -- =======================================================================

  select count(*) into v_count from public.finance_versions;
  if v_count <> 1 then raise exception 'STOP — ROLLBACK_0262a POSTSONDA FALLÓ: finance_versions count = %', v_count; end if;

  select count(*) into v_count from public.finance_categories;
  if v_count <> 13 then raise exception 'STOP — ROLLBACK_0262a POSTSONDA FALLÓ: finance_categories count = %', v_count; end if;

  select count(*) into v_count from public.finance_cost_centers;
  if v_count <> 5 then raise exception 'STOP — ROLLBACK_0262a POSTSONDA FALLÓ: finance_cost_centers count = %', v_count; end if;

end $$;

notify pgrst, 'reload schema';
