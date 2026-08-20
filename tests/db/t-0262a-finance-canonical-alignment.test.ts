import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inject } from "vitest";
import { createWaSandbox, type WaSandbox } from "./harness/wa-sandbox";
import { Client } from "pg";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createHash } from "crypto";

const M0262_CANONICAL = resolve(__dirname, "../../supabase/migrations/0262_finance_core_foundation.sql");
const M0262A = resolve(__dirname, "../../supabase/migrations/0262a_finance_core_schema_canonical_alignment.sql");
const R0262A = resolve(__dirname, "../../supabase/migrations/ROLLBACK_0262a_finance_core_schema_canonical_alignment.sql");

// Payload divergente exacto ejecutado en Supabase (statements[0] del ledger de migraciones)
// SHA-256 certificado: d6bfeb1024e0bc8924a5a55610604510c1efc47a227a8ba180775ad55e905fc6
const DIVERGENT_0262_PAYLOAD = "-- =========================================================================\n-- 0262_finance_core_foundation.sql \u2014 M\u00f3dulo Nativo NEXUS Finanzas\n--\n-- Expediente: \"M\u00f3dulo Nativo NEXUS Finanzas e Integraci\u00f3n con Tesorer\u00eda\"\n-- Autoridad: Direcci\u00f3n (Master de Continuaci\u00f3n Full Push Aut\u00f3nomo).\n-- R\u00e9gimen: Aditivo forward-only. RLS estricto, RBAC finanzas.*, idempotente.\n--\n-- Contenido:\n--   1) Tipos y enums del dominio financiero.\n--   2) Tablas de versiones, supuestos, categor\u00edas, centros de costo, planes.\n--   3) Tablas de flujo proyectado, escenarios, snapshots, inbox e importaci\u00f3n Quicken.\n--   4) Pol\u00edticas RLS (m\u00ednimo privilegio, tenant isolation).\n--   5) Permisos RBAC finanzas.* y grants a roles del sistema.\n--   6) Seed inicial de categor\u00edas anal\u00edticas, centros de costo y versi\u00f3n base 2026.\n-- =========================================================================\n\n-- =========================================================================\n-- 1. Tipos y Enums\n-- =========================================================================\n\ndo $$\nbegin\n  if not exists (select 1 from pg_type where typname = 'finance_version_status_t' and typnamespace = 'public'::regnamespace) then\n    create type public.finance_version_status_t as enum ('draft', 'in_review', 'approved', 'closed');\n  end if;\n\n  if not exists (select 1 from pg_type where typname = 'finance_direction_t' and typnamespace = 'public'::regnamespace) then\n    create type public.finance_direction_t as enum ('ingreso', 'egreso', 'transferencia');\n  end if;\n\n  if not exists (select 1 from pg_type where typname = 'finance_account_group_t' and typnamespace = 'public'::regnamespace) then\n    create type public.finance_account_group_t as enum ('bancos', 'caja', 'ahorros', 'tarjetas');\n  end if;\n\n  if not exists (select 1 from pg_type where typname = 'finance_certainty_level_t' and typnamespace = 'public'::regnamespace) then\n    create type public.finance_certainty_level_t as enum ('alta', 'media', 'baja');\n  end if;\n\n  if not exists (select 1 from pg_type where typname = 'finance_forecast_status_t' and typnamespace = 'public'::regnamespace) then\n    create type public.finance_forecast_status_t as enum ('proyectado', 'comprometido', 'reconciliado', 'anulado');\n  end if;\n\n  if not exists (select 1 from pg_type where typname = 'finance_currency_t' and typnamespace = 'public'::regnamespace) then\n    create type public.finance_currency_t as enum ('ARS', 'USD');\n  end if;\nend $$;\n\n-- =========================================================================\n-- 2. Tablas del Modelo Financiero\n-- =========================================================================\n\n-- 2.1 Versiones de Presupuesto y Modelos\ncreate table if not exists public.finance_versions (\n  id uuid primary key default gen_random_uuid(),\n  code text not null unique,\n  name text not null,\n  description text,\n  status public.finance_version_status_t not null default 'draft',\n  valid_from date not null,\n  valid_to date not null,\n  parent_version_id uuid references public.finance_versions(id) on delete set null,\n  is_active boolean not null default true,\n  approved_at timestamptz,\n  approved_by uuid,\n  created_by uuid,\n  created_at timestamptz not null default now(),\n  updated_at timestamptz not null default now()\n);\n\n-- 2.2 Supuestos y Drivers\ncreate table if not exists public.finance_assumptions (\n  id uuid primary key default gen_random_uuid(),\n  version_id uuid not null references public.finance_versions(id) on delete cascade,\n  key text not null,\n  name text not null,\n  category text not null default 'general',\n  value_numeric numeric(18, 6),\n  value_text text,\n  value_json jsonb,\n  unit text,\n  valid_from date,\n  valid_to date,\n  notes text,\n  created_at timestamptz not null default now(),\n  updated_at timestamptz not null default now(),\n  unique (version_id, key)\n);\n\n-- 2.3 Categor\u00edas Financieras Anal\u00edticas (\u00c1rbol P&L y Cash Flow)\ncreate table if not exists public.finance_categories (\n  id uuid primary key default gen_random_uuid(),\n  code text not null unique,\n  name text not null,\n  parent_id uuid references public.finance_categories(id) on delete set null,\n  category_type public.finance_direction_t not null,\n  pnl_section text, -- 'revenue', 'cogs', 'opex', 'tax', 'financial'\n  cash_flow_section text, -- 'operating', 'investing', 'financing'\n  display_order integer not null default 0,\n  is_active boolean not null default true,\n  created_at timestamptz not null default now(),\n  updated_at timestamptz not null default now()\n);\n\n-- 2.4 Centros de Costo y Unidades de Negocio\ncreate table if not exists public.finance_cost_centers (\n  id uuid primary key default gen_random_uuid(),\n  code text not null unique,\n  name text not null,\n  business_line text, -- 'cargas_generales', 'anmat', 'almacenamiento', 'distribucion', 'corporativo'\n  manager_id uuid,\n  is_active boolean not null default true,\n  created_at timestamptz not null default now(),\n  updated_at timestamptz not null default now()\n);\n\n-- 2.5 L\u00edneas de Plan Presupuestario\ncreate table if not exists public.finance_plan_lines (\n  id uuid primary key default gen_random_uuid(),\n  version_id uuid not null references public.finance_versions(id) on delete cascade,\n  category_id uuid not null references public.finance_categories(id) on delete restrict,\n  cost_center_id uuid references public.finance_cost_centers(id) on delete set null,\n  period_date date not null, -- Primer d\u00eda del mes o per\u00edodo (ej. '2026-01-01')\n  currency public.finance_currency_t not null default 'ARS',\n  amount_planned numeric(18, 4) not null default 0,\n  amount_forecast numeric(18, 4) not null default 0,\n  amount_actual numeric(18, 4) not null default 0,\n  notes text,\n  created_at timestamptz not null default now(),\n  updated_at timestamptz not null default now(),\n  unique (version_id, category_id, cost_center_id, period_date, currency)\n);\n\n-- =========================================================================\n-- 3. Flujo Proyectado, Escenarios, Inbox y Quicken\n-- =========================================================================\n\n-- 3.1 Ajustes y Proyecciones de Flujo de Fondos (Integraci\u00f3n con Tesorer\u00eda)\ncreate table if not exists public.finance_forecast_adjustments (\n  id uuid primary key default gen_random_uuid(),\n  forecast_date date not null,\n  direction public.finance_direction_t not null,\n  account_group public.finance_account_group_t not null default 'bancos',\n  bank_account_id uuid references public.bank_accounts(id) on delete set null,\n  category_id uuid references public.finance_categories(id) on delete set null,\n  cost_center_id uuid references public.finance_cost_centers(id) on delete set null,\n  currency public.finance_currency_t not null default 'ARS',\n  amount numeric(18, 4) not null check (amount > 0),\n  certainty_level public.finance_certainty_level_t not null default 'media',\n  status public.finance_forecast_status_t not null default 'proyectado',\n  concept text not null,\n  entity_type text, -- 'purchase_order', 'service_order', 'vendor_invoice', 'payroll', 'tax_obligation'\n  entity_id uuid,\n  treasury_movement_id uuid references public.treasury_movements(id) on delete set null,\n  notes text,\n  created_by uuid,\n  created_at timestamptz not null default now(),\n  updated_at timestamptz not null default now()\n);\n\n-- 3.2 Escenarios y Sensibilidad\ncreate table if not exists public.finance_scenarios (\n  id uuid primary key default gen_random_uuid(),\n  version_id uuid not null references public.finance_versions(id) on delete cascade,\n  code text not null,\n  name text not null,\n  description text,\n  is_base_case boolean not null default false,\n  inflation_rate numeric(8, 4) default 0,\n  fx_rate_usd numeric(12, 4),\n  volume_variation_pct numeric(8, 4) default 0,\n  parameters_override jsonb default '{}'::jsonb,\n  created_at timestamptz not null default now(),\n  updated_at timestamptz not null default now(),\n  unique (version_id, code)\n);\n\n-- 3.3 Snapshots Hist\u00f3ricos y Cierres\ncreate table if not exists public.finance_report_snapshots (\n  id uuid primary key default gen_random_uuid(),\n  snapshot_date date not null,\n  report_type text not null, -- 'cash_flow_daily', 'pnl_monthly', 'balance_sheet_summary'\n  version_id uuid references public.finance_versions(id) on delete set null,\n  payload jsonb not null default '{}'::jsonb,\n  hash_sha256 text,\n  created_by uuid,\n  created_at timestamptz not null default now()\n);\n\n-- 3.4 Inbox Documental Financiero\ncreate table if not exists public.finance_document_inbox (\n  id uuid primary key default gen_random_uuid(),\n  file_name text not null,\n  file_size integer not null,\n  mime_type text not null,\n  storage_path text not null,\n  status text not null default 'pending' check (status in ('pending', 'processing', 'parsed', 'linked', 'error')),\n  extracted_data jsonb default '{}'::jsonb,\n  matched_entity_type text,\n  matched_entity_id uuid,\n  error_message text,\n  uploaded_by uuid,\n  created_at timestamptz not null default now(),\n  updated_at timestamptz not null default now()\n);\n\n-- 3.5 Importaciones Quicken y Legacy Finanzas\ncreate table if not exists public.finance_quicken_imports (\n  id uuid primary key default gen_random_uuid(),\n  file_name text not null,\n  storage_path text not null,\n  imported_at timestamptz not null default now(),\n  total_records integer not null default 0,\n  reconciled_records integer not null default 0,\n  status text not null default 'completed' check (status in ('completed', 'with_errors', 'rolled_back')),\n  summary jsonb default '{}'::jsonb,\n  imported_by uuid\n);\n\n-- \u00cdndices de Rendimiento\ncreate index if not exists finance_plan_lines_version_period_idx\n  on public.finance_plan_lines (version_id, period_date);\n\ncreate index if not exists finance_forecast_date_idx\n  on public.finance_forecast_adjustments (forecast_date);\n\ncreate index if not exists finance_forecast_status_idx\n  on public.finance_forecast_adjustments (status);\n\ncreate index if not exists finance_forecast_acc_group_idx\n  on public.finance_forecast_adjustments (account_group);\n\ncreate index if not exists finance_document_inbox_status_idx\n  on public.finance_document_inbox (status);\n\ncreate index if not exists finance_categories_type_idx\n  on public.finance_categories (category_type);\n\n-- =========================================================================\n-- 4. Row Level Security (RLS)\n-- =========================================================================\n\nalter table public.finance_versions enable row level security;\nalter table public.finance_assumptions enable row level security;\nalter table public.finance_categories enable row level security;\nalter table public.finance_cost_centers enable row level security;\nalter table public.finance_plan_lines enable row level security;\nalter table public.finance_forecast_adjustments enable row level security;\nalter table public.finance_scenarios enable row level security;\nalter table public.finance_report_snapshots enable row level security;\nalter table public.finance_document_inbox enable row level security;\nalter table public.finance_quicken_imports enable row level security;\n\n-- Pol\u00edticas de lectura (finanzas.view)\ncreate policy \"finance_versions read\" on public.finance_versions for select\n  using (coalesce(public.has_permission('finanzas.view'), false));\n\ncreate policy \"finance_assumptions read\" on public.finance_assumptions for select\n  using (coalesce(public.has_permission('finanzas.view'), false));\n\ncreate policy \"finance_categories read\" on public.finance_categories for select\n  using (coalesce(public.has_permission('finanzas.view'), false));\n\ncreate policy \"finance_cost_centers read\" on public.finance_cost_centers for select\n  using (coalesce(public.has_permission('finanzas.view'), false));\n\ncreate policy \"finance_plan_lines read\" on public.finance_plan_lines for select\n  using (coalesce(public.has_permission('finanzas.view'), false));\n\ncreate policy \"finance_forecast_adjustments read\" on public.finance_forecast_adjustments for select\n  using (coalesce(public.has_permission('finanzas.view'), false));\n\ncreate policy \"finance_scenarios read\" on public.finance_scenarios for select\n  using (coalesce(public.has_permission('finanzas.view'), false));\n\ncreate policy \"finance_report_snapshots read\" on public.finance_report_snapshots for select\n  using (coalesce(public.has_permission('finanzas.view'), false));\n\ncreate policy \"finance_document_inbox read\" on public.finance_document_inbox for select\n  using (coalesce(public.has_permission('finanzas.view'), false));\n\ncreate policy \"finance_quicken_imports read\" on public.finance_quicken_imports for select\n  using (coalesce(public.has_permission('finanzas.view'), false));\n\n-- Pol\u00edticas de escritura (finanzas.plan / finanzas.admin)\ncreate policy \"finance_versions write\" on public.finance_versions for all\n  using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));\n\ncreate policy \"finance_assumptions write\" on public.finance_assumptions for all\n  using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));\n\ncreate policy \"finance_categories write\" on public.finance_categories for all\n  using (coalesce(public.has_permission('finanzas.admin'), false));\n\ncreate policy \"finance_cost_centers write\" on public.finance_cost_centers for all\n  using (coalesce(public.has_permission('finanzas.admin'), false));\n\ncreate policy \"finance_plan_lines write\" on public.finance_plan_lines for all\n  using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));\n\ncreate policy \"finance_forecast_adjustments write\" on public.finance_forecast_adjustments for all\n  using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));\n\ncreate policy \"finance_scenarios write\" on public.finance_scenarios for all\n  using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));\n\ncreate policy \"finance_report_snapshots write\" on public.finance_report_snapshots for all\n  using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));\n\ncreate policy \"finance_document_inbox write\" on public.finance_document_inbox for all\n  using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));\n\ncreate policy \"finance_quicken_imports write\" on public.finance_quicken_imports for all\n  using (coalesce(public.has_permission('finanzas.admin'), false));\n\n-- =========================================================================\n-- 5. Permisos RBAC y Grants\n-- =========================================================================\n\ninsert into public.permissions (slug, module, action, label, description)\nvalues\n  ('finanzas.view',    'finanzas', 'view',    'Ver Finanzas',                 'Acceso de lectura a paneles, flujo de fondos, proyecciones y resultados'),\n  ('finanzas.plan',    'finanzas', 'plan',    'Planificar y Presupuestar',    'Crear y editar versiones, supuestos y proyecciones'),\n  ('finanzas.approve', 'finanzas', 'approve', 'Aprobaci\u00f3n de Finanzas',       'Aprobar y cerrar versiones presupuestarias'),\n  ('finanzas.admin',   'finanzas', 'admin',   'Administrar Finanzas',         'Configuraci\u00f3n de categor\u00edas, centros de costo e importaciones')\non conflict do nothing;\n\n-- Asignar permisos a roles internos\ninsert into public.role_permissions (role_id, permission_id)\nselect r.id, p.id\nfrom public.roles r\ncross join public.permissions p\nwhere r.slug in ('admin', 'gerencia_comercial', 'administracion_finanzas')\n  and p.slug like 'finanzas.%'\non conflict (role_id, permission_id) do nothing;\n\n-- Permisos a authenticated para PostgREST\ngrant select, insert, update, delete on\n  public.finance_versions,\n  public.finance_assumptions,\n  public.finance_categories,\n  public.finance_cost_centers,\n  public.finance_plan_lines,\n  public.finance_forecast_adjustments,\n  public.finance_scenarios,\n  public.finance_report_snapshots,\n  public.finance_document_inbox,\n  public.finance_quicken_imports\nto authenticated;\n\n-- =========================================================================\n-- 6. SEED Inicial de Categor\u00edas y Centros de Costo\n-- =========================================================================\n\ninsert into public.finance_categories (code, name, category_type, display_order) values\n  ('ING_FLETES',        'Ingresos por Fletes y Distribuci\u00f3n', 'ingreso', 10),\n  ('ING_ALMACEN',       'Ingresos por Almacenamiento y M2',   'ingreso', 20),\n  ('ING_LOG_FARMACIA',  'Ingresos Log\u00edstica Farmac\u00e9utica ANMAT', 'ingreso', 30),\n  ('ING_SERVICIOS_ESP', 'Ingresos por Servicios Especiales',  'ingreso', 40),\n  ('EGR_SUELDOS',       'Sueldos y Cargas Sociales',          'egreso',  100),\n  ('EGR_COMBUSTIBLE',   'Combustible y Peajes',               'egreso',  110),\n  ('EGR_MANTENIMIENTO', 'Mantenimiento de Flota y Edilicio',  'egreso',  120),\n  ('EGR_SEGUROS',       'Seguros y P\u00f3lizas de Carga',         'egreso',  130),\n  ('EGR_ALQUILERES',    'Alquileres de Dep\u00f3sitos',            'egreso',  140),\n  ('EGR_IMPUESTOS',     'Impuestos, Tasas y AFIP/ARBA',       'egreso',  150),\n  ('EGR_HONORARIOS',    'Honorarios Profesionales y Asesor\u00eda', 'egreso', 160),\n  ('EGR_SERVICIOS',     'Servicios P\u00fablicos e Internet',      'egreso',  170),\n  ('EGR_OTROS',         'Otros Gastos Operativos',            'egreso',  180)\non conflict (code) do nothing;\n\ninsert into public.finance_cost_centers (code, name, business_line) values\n  ('CC_CARGAS_GEN', 'Operaciones Cargas Generales', 'cargas_generales'),\n  ('CC_ANMAT',      'Operaciones Reguladas ANMAT',  'anmat'),\n  ('CC_DEPOSITO',   'Dep\u00f3sito y Almacenamiento',    'almacenamiento'),\n  ('CC_DISTRIB',    'Distribuci\u00f3n Urbana y Flota',  'distribucion'),\n  ('CC_ADMIN_CORP', 'Administraci\u00f3n y Corporativo', 'corporativo')\non conflict (code) do nothing;\n\ninsert into public.finance_versions (code, name, description, status, valid_from, valid_to, is_active) values\n  ('BUDGET-2026-V1', 'Presupuesto Operativo 2026 v1.0', 'Presupuesto anual base aprobado para el ejercicio fiscal 2026.', 'approved', '2026-01-01', '2026-12-31', true)\non conflict (code) do nothing;\n\nnotify pgrst, 'reload schema';";

// Consulta de manifest exhaustiva 1:1
const CATALOG_QUERY = `
SELECT jsonb_object_agg(
  t.table_name,
  jsonb_build_object(
    'rls', jsonb_build_object(
      'rowsecurity', tm.rowsecurity,
      'forcerowsecurity', tm.forcerowsecurity
    ),
    'columns', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'column_name', c.column_name,
          'data_type', c.data_type,
          'udt_name', c.udt_name,
          'is_nullable', c.is_nullable,
          'column_default', c.column_default
        ) ORDER BY c.column_name
      )
      FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = t.table_name
    ),
    'constraints', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'constraint_name', con.conname,
          'constraint_type', con.contype,
          'definition', pg_get_constraintdef(con.oid, true)
        ) ORDER BY con.conname
      ), '[]'::jsonb)
      FROM pg_constraint con
      JOIN pg_class r ON con.conrelid = r.oid
      JOIN pg_namespace n ON r.relnamespace = n.oid
      WHERE n.nspname = 'public' AND r.relname = t.table_name
        AND (con.contype != 'c' OR con.conname NOT SIMILAR TO '[0-9]+_[0-9]+_[0-9]+_not_null')
    ),
    'indexes', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'indexname', i.relname,
          'indexdef', pg_get_indexdef(i.oid, 0, true)
        ) ORDER BY i.relname
      ), '[]'::jsonb)
      FROM pg_index x
      JOIN pg_class c ON c.oid = x.indrelid
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'public' AND c.relname = t.table_name
    ),
    'policies', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'policyname', p.policyname,
          'cmd', p.cmd,
          'roles', p.roles,
          'qual', p.qual,
          'with_check', p.with_check
        ) ORDER BY p.policyname
      ), '[]'::jsonb)
      FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = t.table_name
    ),
    'grants', (
      SELECT coalesce(jsonb_agg(
        jsonb_build_object(
          'grantee', g.grantee,
          'privilege_type', g.privilege_type
        ) ORDER BY g.grantee, g.privilege_type
      ), '[]'::jsonb)
      FROM information_schema.role_table_grants g
      WHERE g.table_schema = 'public' AND g.table_name = t.table_name
        AND g.grantee = 'authenticated'
    )
  ) ORDER BY t.table_name
) AS manifest
FROM (
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name LIKE 'finance_%'
  ORDER BY table_name
) t
LEFT JOIN (
  SELECT c.relname AS table_name, c.relrowsecurity AS rowsecurity, c.relforcerowsecurity AS forcerowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE n.nspname = 'public' AND c.relname LIKE 'finance_%' AND c.relkind = 'r'
) tm ON tm.table_name = t.table_name;
`;

let sb: WaSandbox;
let db: Client;

const cleanSchema = async () => {
  await db.query(`
    drop schema public cascade;
    create schema public;
    grant all on schema public to public;
    grant all on schema public to authenticated;

    create type public.permission_module_t as enum ('finanzas', 'ordenes', 'operaciones', 'sistema');
    create type public.permission_action_t as enum ('view', 'create', 'edit', 'delete', 'plan', 'approve', 'admin');

    create table if not exists public.roles (
      id uuid primary key default gen_random_uuid(),
      slug text unique not null,
      name text not null
    );
    insert into public.roles (slug, name) values ('admin', 'Administrador'), ('gerencia_comercial', 'Gerencia Comercial'), ('administracion_finanzas', 'Administración y Finanzas') on conflict do nothing;

    create table if not exists public.permissions (
      id uuid primary key default gen_random_uuid(),
      slug text unique not null,
      module public.permission_module_t not null,
      action public.permission_action_t not null,
      label text not null,
      description text,
      created_at timestamptz not null default now()
    );

    insert into public.permissions (slug, module, action, label, description) values
      ('finanzas.view', 'finanzas', 'view', 'Ver Finanzas', 'Acceso de lectura a Finanzas'),
      ('finanzas.plan', 'finanzas', 'plan', 'Planificar Finanzas', 'Crear y editar presupuestos y supuestos'),
      ('finanzas.approve', 'finanzas', 'approve', 'Aprobar Finanzas', 'Aprobar versiones y proyecciones'),
      ('finanzas.admin', 'finanzas', 'admin', 'Administrar Finanzas', 'Administración total del módulo')
    on conflict (slug) do nothing;

    create table if not exists public.role_permissions (
      role_id uuid not null references public.roles(id) on delete cascade,
      permission_id uuid not null references public.permissions(id) on delete cascade,
      primary key (role_id, permission_id)
    );

    create table if not exists public.bank_accounts (
      id uuid primary key default gen_random_uuid(),
      name text not null
    );

    create table if not exists public.treasury_movements (
      id uuid primary key default gen_random_uuid(),
      concept text
    );

    create or replace function public.has_permission(p_slug text)
    returns boolean language sql as $$ select true $$;

    create or replace function public.is_admin()
    returns boolean language sql as $$ select true $$;
  `);
};

beforeAll(async () => {
  sb = await createWaSandbox(inject("dbUrl"));
  db = sb.client;
}, 120_000);

afterAll(async () => {
  await sb?.destroy();
});

describe("T-0262a · Alineación Canónica Dual-State Exhaustiva y Reversibilidad Simétrica", () => {
  it("1. Canonical No-Op: En base canónica previa, 0262a no modifica el esquema ni los seeds", async () => {
    await cleanSchema();
    await db.query(readFileSync(M0262_CANONICAL, "utf8"));
    const manifestBefore = (await db.query(CATALOG_QUERY)).rows[0].manifest;

    await db.query(readFileSync(M0262A, "utf8"));
    const manifestAfter = (await db.query(CATALOG_QUERY)).rows[0].manifest;

    expect(manifestAfter).toEqual(manifestBefore);

    const { rows: versions } = await db.query("select code, status, is_active from public.finance_versions");
    expect(versions).toEqual([{ code: "BUDGET-2026-V1", status: "approved", is_active: true }]);

    const { rows: categories } = await db.query("select count(*) from public.finance_categories");
    expect(categories[0].count).toBe("13");
  });

  it("2. Reparación del Payload Divergente: 0262a alinea el esquema divergente 1:1 con el manifest canónico", async () => {
    // Generar manifest canónico de referencia
    await cleanSchema();
    await db.query(readFileSync(M0262_CANONICAL, "utf8"));
    const canonicalManifest = (await db.query(CATALOG_QUERY)).rows[0].manifest;

    // Cargar payload divergente
    await cleanSchema();
    await db.query(DIVERGENT_0262_PAYLOAD);

    // Aplicar remediación 0262a
    await db.query(readFileSync(M0262A, "utf8"));
    const repairedManifest = (await db.query(CATALOG_QUERY)).rows[0].manifest;

    expect(repairedManifest).toEqual(canonicalManifest);
  });

  it("3. Rollback Simétrico: ROLLBACK_0262a restaura 1:1 el manifest divergente previo", async () => {
    // Generar manifest divergente de referencia
    await cleanSchema();
    await db.query(DIVERGENT_0262_PAYLOAD);
    const divergentManifest = (await db.query(CATALOG_QUERY)).rows[0].manifest;

    // Aplicar 0262a
    await db.query(readFileSync(M0262A, "utf8"));

    // Aplicar ROLLBACK_0262a
    await db.query(readFileSync(R0262A, "utf8"));
    const postRollbackManifest = (await db.query(CATALOG_QUERY)).rows[0].manifest;

    expect(postRollbackManifest).toEqual(divergentManifest);
  });

  it("4. Ciclo Completo de Semillas: Preservación integral de UUIDs y atributos en Estado B -> 0262a -> Estado A -> rollback -> Estado B", async () => {
    await cleanSchema();
    await db.query(DIVERGENT_0262_PAYLOAD);

    const initialCats = (await db.query("select id, code, name, display_order, is_active, parent_id from public.finance_categories order by code")).rows;
    const initialCcs = (await db.query("select id, code, name, is_active from public.finance_cost_centers order by code")).rows;
    const initialVers = (await db.query("select id, code, name, status, valid_from, valid_to, is_active from public.finance_versions")).rows;

    expect(initialCats).toHaveLength(13);
    expect(initialCcs).toHaveLength(5);
    expect(initialVers).toHaveLength(1);

    // Forward
    await db.query(readFileSync(M0262A, "utf8"));

    const forwardCats = (await db.query("select id, code, name, display_order, is_active, parent_id from public.finance_categories order by code")).rows;
    const forwardCcs = (await db.query("select id, code, name, is_active from public.finance_cost_centers order by code")).rows;
    const forwardVers = (await db.query("select id, code, name, status, valid_from, valid_to, is_active from public.finance_versions")).rows;

    expect(forwardCats).toEqual(initialCats);
    expect(forwardCcs).toEqual(initialCcs);
    expect(forwardVers).toEqual(initialVers);

    // Rollback
    await db.query(readFileSync(R0262A, "utf8"));

    const rollbackCats = (await db.query("select id, code, name, display_order, is_active, parent_id from public.finance_categories order by code")).rows;
    const rollbackCcs = (await db.query("select id, code, name, is_active from public.finance_cost_centers order by code")).rows;
    const rollbackVers = (await db.query("select id, code, name, status, valid_from, valid_to, is_active from public.finance_versions")).rows;

    expect(rollbackCats).toEqual(initialCats);
    expect(rollbackCcs).toEqual(initialCcs);
    expect(rollbackVers).toEqual(initialVers);
  });

  it("5. Adversarial Forward - Columna Adicional: Aborta fail-closed con STOP y preserva el esquema sin mutaciones", async () => {
    await cleanSchema();
    await db.query(DIVERGENT_0262_PAYLOAD);
    await db.query("alter table public.finance_plan_lines add column extra_col text default 'test'");

    await expect(db.query(readFileSync(M0262A, "utf8"))).rejects.toThrow(/STOP/);

    const { rows } = await db.query(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'finance_plan_lines' and column_name = 'extra_col'
    `);
    expect(rows).toHaveLength(1);
  });

  it("6. Adversarial Forward - Default Modificado: Aborta fail-closed con STOP", async () => {
    await cleanSchema();
    await db.query(DIVERGENT_0262_PAYLOAD);
    await db.query("alter table public.finance_plan_lines alter column amount_planned set default 999");

    await expect(db.query(readFileSync(M0262A, "utf8"))).rejects.toThrow(/STOP/);
  });

  it("7. Adversarial Forward - Constraint Adicional: Aborta fail-closed con STOP", async () => {
    await cleanSchema();
    await db.query(DIVERGENT_0262_PAYLOAD);
    await db.query("alter table public.finance_plan_lines add constraint custom_amount_check check (amount_planned >= 0)");

    await expect(db.query(readFileSync(M0262A, "utf8"))).rejects.toThrow(/STOP/);
  });

  it("8. Adversarial Forward - Índice Adicional: Aborta fail-closed con STOP", async () => {
    await cleanSchema();
    await db.query(DIVERGENT_0262_PAYLOAD);
    await db.query("create index custom_idx on public.finance_plan_lines(currency)");

    await expect(db.query(readFileSync(M0262A, "utf8"))).rejects.toThrow(/STOP/);
  });

  it("9. Adversarial Forward - Política Adicional: Aborta fail-closed con STOP", async () => {
    await cleanSchema();
    await db.query(DIVERGENT_0262_PAYLOAD);
    await db.query("create policy custom_pol on public.finance_plan_lines for delete using (false)");

    await expect(db.query(readFileSync(M0262A, "utf8"))).rejects.toThrow(/STOP/);
  });

  it("10. Adversarial Forward - Grant Adicional: Aborta fail-closed con STOP", async () => {
    await cleanSchema();
    await db.query(DIVERGENT_0262_PAYLOAD);
    await db.query("grant truncate on public.finance_plan_lines to authenticated");

    await expect(db.query(readFileSync(M0262A, "utf8"))).rejects.toThrow(/STOP/);
  });

  it("11. Adversarial Forward - Alteración de RLS: Aborta fail-closed con STOP", async () => {
    await cleanSchema();
    await db.query(DIVERGENT_0262_PAYLOAD);
    await db.query("alter table public.finance_plan_lines disable row level security");

    await expect(db.query(readFileSync(M0262A, "utf8"))).rejects.toThrow(/STOP/);
  });

  it("12. Adversarial Forward - Foreign Key Externa Entrante: Aborta fail-closed con STOP", async () => {
    await cleanSchema();
    await db.query(DIVERGENT_0262_PAYLOAD);
    await db.query(`
      create table public.external_audit_ref (
        id uuid primary key default gen_random_uuid(),
        plan_line_id uuid references public.finance_plan_lines(id)
      )
    `);

    await expect(db.query(readFileSync(M0262A, "utf8"))).rejects.toThrow(/STOP/);
  });

  it("13. Adversarial Forward - Vista en Otro Esquema: Aborta fail-closed con STOP", async () => {
    await cleanSchema();
    await db.query(DIVERGENT_0262_PAYLOAD);
    await db.query("create schema if not exists audit");
    await db.query("create view audit.v_finance_plan as select id from public.finance_plan_lines");

    await expect(db.query(readFileSync(M0262A, "utf8"))).rejects.toThrow(/STOP/);
  });

  it("14. Adversarial Forward - Vista Materializada: Aborta fail-closed con STOP", async () => {
    await cleanSchema();
    await db.query(DIVERGENT_0262_PAYLOAD);
    await db.query("create materialized view public.mv_finance_plan as select id from public.finance_plan_lines");

    await expect(db.query(readFileSync(M0262A, "utf8"))).rejects.toThrow(/STOP/);
  });

  it("15. Adversarial Forward - Trigger de Usuario Inesperado: Aborta fail-closed con STOP", async () => {
    await cleanSchema();
    await db.query(DIVERGENT_0262_PAYLOAD);
    await db.query(`
      create or replace function public.audit_trigger_fn() returns trigger language plpgsql as $$
      begin return new; end; $$;
      create trigger trg_audit_test before insert on public.finance_plan_lines
      for each row execute function public.audit_trigger_fn();
    `);

    await expect(db.query(readFileSync(M0262A, "utf8"))).rejects.toThrow(/STOP/);
  });

  it("16. Adversarial Forward - Publicación de Replicación: Aborta fail-closed con STOP", async () => {
    await cleanSchema();
    await db.query(DIVERGENT_0262_PAYLOAD);
    try {
      await db.query("create publication pub_finance_test for table public.finance_plan_lines");
      await expect(db.query(readFileSync(M0262A, "utf8"))).rejects.toThrow(/STOP/);
    } catch (e: any) {
      if (e.message?.includes("cannot create publication")) {
        // En entornos sin wal_level = logical se omite
      } else {
        throw e;
      }
    }
  });

  it("17. Adversarial Forward - Datos Transaccionales Presentes: Aborta fail-closed con STOP", async () => {
    await cleanSchema();
    await db.query(DIVERGENT_0262_PAYLOAD);
    const verId = (await db.query("select id from public.finance_versions limit 1")).rows[0].id;
    await db.query(`
      insert into public.finance_assumptions (version_id, key, name, value_numeric)
      values ($1, 'TEST_KEY', 'Test Name', 100)
    `, [verId]);

    await expect(db.query(readFileSync(M0262A, "utf8"))).rejects.toThrow(/STOP/);
  });

  it("18. Adversarial Rollback - FK Externa Entrante: Aborta fail-closed con STOP", async () => {
    await cleanSchema();
    await db.query(readFileSync(M0262_CANONICAL, "utf8"));
    await db.query(`
      create table public.external_audit_ref (
        id uuid primary key default gen_random_uuid(),
        plan_line_id uuid references public.finance_plan_lines(id)
      )
    `);

    await expect(db.query(readFileSync(R0262A, "utf8"))).rejects.toThrow(/STOP/);
  });

  it("19. Adversarial Rollback - Vista en Otro Esquema: Aborta fail-closed con STOP", async () => {
    await cleanSchema();
    await db.query(readFileSync(M0262_CANONICAL, "utf8"));
    await db.query("create schema if not exists audit");
    await db.query("create view audit.v_finance_plan as select id from public.finance_plan_lines");

    await expect(db.query(readFileSync(R0262A, "utf8"))).rejects.toThrow(/STOP/);
  });

  it("20. Adversarial Rollback - Vista Materializada: Aborta fail-closed con STOP", async () => {
    await cleanSchema();
    await db.query(readFileSync(M0262_CANONICAL, "utf8"));
    await db.query("create materialized view public.mv_finance_plan as select id from public.finance_plan_lines");

    await expect(db.query(readFileSync(R0262A, "utf8"))).rejects.toThrow(/STOP/);
  });

  it("21. Adversarial Rollback - Trigger de Usuario: Aborta fail-closed con STOP", async () => {
    await cleanSchema();
    await db.query(readFileSync(M0262_CANONICAL, "utf8"));
    await db.query(`
      create or replace function public.audit_trigger_fn() returns trigger language plpgsql as $$
      begin return new; end; $$;
      create trigger trg_audit_test before insert on public.finance_plan_lines
      for each row execute function public.audit_trigger_fn();
    `);

    await expect(db.query(readFileSync(R0262A, "utf8"))).rejects.toThrow(/STOP/);
  });

  it("22. Adversarial Rollback - Publicación de Replicación: Aborta fail-closed con STOP", async () => {
    await cleanSchema();
    await db.query(readFileSync(M0262_CANONICAL, "utf8"));
    try {
      await db.query("create publication pub_finance_test_rb for table public.finance_plan_lines");
      await expect(db.query(readFileSync(R0262A, "utf8"))).rejects.toThrow(/STOP/);
    } catch (e: any) {
      if (e.message?.includes("cannot create publication")) {
        // Omisión segura
      } else {
        throw e;
      }
    }
  });

  it("23. Adversarial Rollback - Datos Transaccionales Presentes: Aborta fail-closed con STOP", async () => {
    await cleanSchema();
    await db.query(readFileSync(M0262_CANONICAL, "utf8"));
    const verId = (await db.query("select id from public.finance_versions limit 1")).rows[0].id;
    await db.query(`
      insert into public.finance_assumptions (version_id, driver_key, name, value)
      values ($1, 'TEST_DRIVER', 'Test Driver', 100)
    `, [verId]);

    await expect(db.query(readFileSync(R0262A, "utf8"))).rejects.toThrow(/STOP/);
  });

  it("24. Provenance Criptográfico: Blob canónico y fixture divergente coinciden con hashes certificados", () => {
    const rawCanonical = readFileSync(M0262_CANONICAL);
    const hashCanonical = createHash("sha256").update(rawCanonical).digest("hex");
    expect(hashCanonical).toBe("1908587594777b7e9dfd6b2d629f578a6b0edc1985b0f4f47b36038879a42d63");

    const rawDivergent = Buffer.from(DIVERGENT_0262_PAYLOAD, "utf8");
    const hashDivergent = createHash("sha256").update(rawDivergent).digest("hex");
    expect(hashDivergent).toBe("d6bfeb1024e0bc8924a5a55610604510c1efc47a227a8ba180775ad55e905fc6");
  });
});
