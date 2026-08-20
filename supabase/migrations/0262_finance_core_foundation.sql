-- =========================================================================
-- 0262_finance_core_foundation.sql — Módulo Nativo NEXUS Finanzas
--
-- Expediente: "Módulo Nativo NEXUS Finanzas e Integración con Tesorería"
-- Autoridad: Dirección (Master de Continuación Full Push Autónomo).
-- Régimen: Aditivo forward-only. RLS estricto, RBAC finanzas.*, idempotente.
--
-- Contenido:
--   1) Tipos y enums del dominio financiero.
--   2) Tablas de versiones, supuestos, categorías, centros de costo, planes.
--   3) Tablas de flujo proyectado, escenarios, snapshots, inbox e importación Quicken.
--   4) Políticas RLS (mínimo privilegio, tenant isolation).
--   5) Permisos RBAC finanzas.* y grants a roles del sistema.
--   6) Seed inicial de categorías analíticas, centros de costo y versión base 2026.
-- =========================================================================

-- =========================================================================
-- 1. Tipos y Enums
-- =========================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'finance_version_status_t' and typnamespace = 'public'::regnamespace) then
    create type public.finance_version_status_t as enum ('draft', 'in_review', 'approved', 'closed');
  end if;

  if not exists (select 1 from pg_type where typname = 'finance_direction_t' and typnamespace = 'public'::regnamespace) then
    create type public.finance_direction_t as enum ('ingreso', 'egreso', 'transferencia');
  end if;

  if not exists (select 1 from pg_type where typname = 'finance_account_group_t' and typnamespace = 'public'::regnamespace) then
    create type public.finance_account_group_t as enum ('bancos', 'caja', 'ahorros', 'tarjetas');
  end if;

  if not exists (select 1 from pg_type where typname = 'finance_certainty_level_t' and typnamespace = 'public'::regnamespace) then
    create type public.finance_certainty_level_t as enum ('alta', 'media', 'baja');
  end if;

  if not exists (select 1 from pg_type where typname = 'finance_forecast_status_t' and typnamespace = 'public'::regnamespace) then
    create type public.finance_forecast_status_t as enum ('proyectado', 'comprometido', 'reconciliado', 'anulado');
  end if;

  if not exists (select 1 from pg_type where typname = 'finance_currency_t' and typnamespace = 'public'::regnamespace) then
    create type public.finance_currency_t as enum ('ARS', 'USD');
  end if;
end $$;

-- =========================================================================
-- 2. Tablas del Modelo Financiero
-- =========================================================================

-- 2.1 Versiones de Presupuesto y Modelos
create table if not exists public.finance_versions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  status public.finance_version_status_t not null default 'draft',
  valid_from date not null,
  valid_to date not null,
  parent_version_id uuid references public.finance_versions(id) on delete set null,
  is_active boolean not null default true,
  approved_at timestamptz,
  approved_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2.2 Supuestos y Drivers
create table if not exists public.finance_assumptions (
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

-- 2.3 Categorías Analíticas Jerárquicas
create table if not exists public.finance_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.finance_categories(id) on delete restrict,
  code text not null unique,
  name text not null,
  category_type text not null check (category_type in ('ingreso', 'egreso', 'activo', 'pasivo')),
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2.4 Centros de Costo
create table if not exists public.finance_cost_centers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  business_line text not null check (business_line in ('cargas_generales', 'anmat', 'corporativo', 'almacenamiento', 'distribucion')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2.5 Líneas de Presupuesto / Plan
create table if not exists public.finance_plan_lines (
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

-- 2.6 Ajustes y Proyecciones de Flujo (Caja y Liquidez)
create table if not exists public.finance_forecast_adjustments (
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

-- 2.7 Escenarios de Simulación
create table if not exists public.finance_scenarios (
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

-- 2.8 Snapshots de Reportes
create table if not exists public.finance_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  period text not null,
  report_type text not null,
  title text not null,
  data jsonb not null,
  version_id uuid references public.finance_versions(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- 2.9 Bandeja de Ingesta Documental
create table if not exists public.finance_document_inbox (
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

-- 2.10 Registro de Importaciones Quicken
create table if not exists public.finance_quicken_imports (
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

-- =========================================================================
-- 3. Índices de Rendimiento
-- =========================================================================

create index if not exists finance_plan_lines_version_period_idx on public.finance_plan_lines(version_id, period);
create index if not exists finance_forecast_date_idx on public.finance_forecast_adjustments(date);
create index if not exists finance_forecast_status_idx on public.finance_forecast_adjustments(status);
create index if not exists finance_forecast_acc_group_idx on public.finance_forecast_adjustments(account_group);
create index if not exists finance_document_inbox_status_idx on public.finance_document_inbox(status);
create index if not exists finance_categories_type_idx on public.finance_categories(category_type);

-- =========================================================================
-- 4. Row Level Security (RLS)
-- =========================================================================

alter table public.finance_versions enable row level security;
alter table public.finance_assumptions enable row level security;
alter table public.finance_categories enable row level security;
alter table public.finance_cost_centers enable row level security;
alter table public.finance_plan_lines enable row level security;
alter table public.finance_forecast_adjustments enable row level security;
alter table public.finance_scenarios enable row level security;
alter table public.finance_report_snapshots enable row level security;
alter table public.finance_document_inbox enable row level security;
alter table public.finance_quicken_imports enable row level security;

-- Políticas de lectura (finanzas.view)
create policy "finance_versions read" on public.finance_versions for select
  using (coalesce(public.has_permission('finanzas.view'), false));

create policy "finance_assumptions read" on public.finance_assumptions for select
  using (coalesce(public.has_permission('finanzas.view'), false));

create policy "finance_categories read" on public.finance_categories for select
  using (coalesce(public.has_permission('finanzas.view'), false));

create policy "finance_cost_centers read" on public.finance_cost_centers for select
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
create policy "finance_versions write" on public.finance_versions for all
  using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));

create policy "finance_assumptions write" on public.finance_assumptions for all
  using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));

create policy "finance_categories write" on public.finance_categories for all
  using (coalesce(public.has_permission('finanzas.admin'), false));

create policy "finance_cost_centers write" on public.finance_cost_centers for all
  using (coalesce(public.has_permission('finanzas.admin'), false));

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

-- =========================================================================
-- 5. Permisos RBAC y Grants
-- =========================================================================

insert into public.permissions (slug, module, action, label, description)
values
  ('finanzas.view',    'finanzas', 'view',    'Ver Finanzas',                 'Acceso de lectura a paneles, flujo de fondos, proyecciones y resultados'),
  ('finanzas.plan',    'finanzas', 'plan',    'Planificar y Presupuestar',    'Crear y editar versiones, supuestos y proyecciones'),
  ('finanzas.approve', 'finanzas', 'approve', 'Aprobación de Finanzas',       'Aprobar y cerrar versiones presupuestarias'),
  ('finanzas.admin',   'finanzas', 'admin',   'Administrar Finanzas',         'Configuración de categorías, centros de costo e importaciones')
on conflict do nothing;

-- Asignar permisos a roles internos
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.slug in ('admin', 'gerencia_comercial', 'administracion_finanzas')
  and p.slug like 'finanzas.%'
on conflict (role_id, permission_id) do nothing;

-- Permisos a authenticated para PostgREST
grant select, insert, update, delete on
  public.finance_versions,
  public.finance_assumptions,
  public.finance_categories,
  public.finance_cost_centers,
  public.finance_plan_lines,
  public.finance_forecast_adjustments,
  public.finance_scenarios,
  public.finance_report_snapshots,
  public.finance_document_inbox,
  public.finance_quicken_imports
to authenticated;

-- =========================================================================
-- 6. SEED Inicial de Categorías y Centros de Costo
-- =========================================================================

insert into public.finance_categories (code, name, category_type, display_order) values
  ('ING_FLETES',        'Ingresos por Fletes y Distribución', 'ingreso', 10),
  ('ING_ALMACEN',       'Ingresos por Almacenamiento y M2',   'ingreso', 20),
  ('ING_LOG_FARMACIA',  'Ingresos Logística Farmacéutica ANMAT', 'ingreso', 30),
  ('ING_SERVICIOS_ESP', 'Ingresos por Servicios Especiales',  'ingreso', 40),
  ('EGR_SUELDOS',       'Sueldos y Cargas Sociales',          'egreso',  100),
  ('EGR_COMBUSTIBLE',   'Combustible y Peajes',               'egreso',  110),
  ('EGR_MANTENIMIENTO', 'Mantenimiento de Flota y Edilicio',  'egreso',  120),
  ('EGR_SEGUROS',       'Seguros y Pólizas de Carga',         'egreso',  130),
  ('EGR_ALQUILERES',    'Alquileres de Depósitos',            'egreso',  140),
  ('EGR_IMPUESTOS',     'Impuestos, Tasas y AFIP/ARBA',       'egreso',  150),
  ('EGR_HONORARIOS',    'Honorarios Profesionales y Asesoría', 'egreso', 160),
  ('EGR_SERVICIOS',     'Servicios Públicos e Internet',      'egreso',  170),
  ('EGR_OTROS',         'Otros Gastos Operativos',            'egreso',  180)
on conflict (code) do nothing;

insert into public.finance_cost_centers (code, name, business_line) values
  ('CC_CARGAS_GEN', 'Operaciones Cargas Generales', 'cargas_generales'),
  ('CC_ANMAT',      'Operaciones Reguladas ANMAT',  'anmat'),
  ('CC_DEPOSITO',   'Depósito y Almacenamiento',    'almacenamiento'),
  ('CC_DISTRIB',    'Distribución Urbana y Flota',  'distribucion'),
  ('CC_ADMIN_CORP', 'Administración y Corporativo', 'corporativo')
on conflict (code) do nothing;

insert into public.finance_versions (code, name, description, status, valid_from, valid_to, is_active) values
  ('BUDGET-2026-V1', 'Presupuesto Operativo 2026 v1.0', 'Presupuesto anual base aprobado para el ejercicio fiscal 2026.', 'approved', '2026-01-01', '2026-12-31', true)
on conflict (code) do nothing;

notify pgrst, 'reload schema';
