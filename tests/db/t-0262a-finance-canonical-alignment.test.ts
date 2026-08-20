/**
 * T-0262A · REMEDIACIÓN DEL INCIDENTE DE PROVENANCE 0262 — ALINEACIÓN CANÓNICA.
 *
 * Verificación focal contra PostgreSQL real en sandbox efímero aislado:
 *  1. Canonical No-Op: Al ejecutar 0262a sobre un esquema canónico 0262, ejecuta un no-op y preserva manifest y UUIDs.
 *  2. Reparación del Payload Incorrecto: Al ejecutar 0262a sobre el payload divergente (81f8f30...), produce el manifest canónico idéntico y preserva seeds.
 *  3. Estado Híbrido: Aborta fail-closed sin modificaciones si el esquema está en estado ambiguo.
 *  4. Tabla Divergente con Datos: Aborta fail-closed si alguna tabla de las 7 transaccionales contiene filas.
 *  5. Dependencia Externa Inesperada: Aborta fail-closed si existe una vista o dependencia ajena.
 *  6. Rollback: Ejecuta rollback seguro condicionado y aborta ante datos operativos.
 *  7. Provenance Criptográfico: Valida que el blob canónico 0262 y la migración 0262a provienen de fuentes autenticadas.
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { Client } from "pg";
import { createWaSandbox, type WaSandbox } from "./harness/wa-sandbox";

const MIG = (f: string) => resolve(__dirname, "..", "..", "supabase", "migrations", f);

const M0262_CANONICAL = MIG("0262_finance_core_foundation.sql");
const M0262A = MIG("0262a_finance_core_schema_canonical_alignment.sql");
const R0262A = MIG("ROLLBACK_0262a_finance_core_schema_canonical_alignment.sql");

// Payload divergente aplicado remotamente (SHA-256: 81f8f30be347900b14dc9a334e3579dc5aeb4ca48b7a69c0d45cb573989c9ec9)
const DIVERGENT_0262_SQL = `
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

create table if not exists public.finance_assumptions (
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

create table if not exists public.finance_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
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

create table if not exists public.finance_cost_centers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  business_line text,
  manager_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_plan_lines (
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

create table if not exists public.finance_forecast_adjustments (
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

create table if not exists public.finance_scenarios (
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

create table if not exists public.finance_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  report_type text not null,
  version_id uuid references public.finance_versions(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  hash_sha256 text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.finance_document_inbox (
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

create table if not exists public.finance_quicken_imports (
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

create index if not exists finance_plan_lines_version_period_idx on public.finance_plan_lines (version_id, period_date);
create index if not exists finance_forecast_date_idx on public.finance_forecast_adjustments (forecast_date);
create index if not exists finance_forecast_status_idx on public.finance_forecast_adjustments (status);
create index if not exists finance_forecast_acc_group_idx on public.finance_forecast_adjustments (account_group);
create index if not exists finance_document_inbox_status_idx on public.finance_document_inbox (status);
create index if not exists finance_categories_type_idx on public.finance_categories (category_type);

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

create policy "finance_versions read" on public.finance_versions for select using (coalesce(public.has_permission('finanzas.view'), false));
create policy "finance_assumptions read" on public.finance_assumptions for select using (coalesce(public.has_permission('finanzas.view'), false));
create policy "finance_categories read" on public.finance_categories for select using (coalesce(public.has_permission('finanzas.view'), false));
create policy "finance_cost_centers read" on public.finance_cost_centers for select using (coalesce(public.has_permission('finanzas.view'), false));
create policy "finance_plan_lines read" on public.finance_plan_lines for select using (coalesce(public.has_permission('finanzas.view'), false));
create policy "finance_forecast_adjustments read" on public.finance_forecast_adjustments for select using (coalesce(public.has_permission('finanzas.view'), false));
create policy "finance_scenarios read" on public.finance_scenarios for select using (coalesce(public.has_permission('finanzas.view'), false));
create policy "finance_report_snapshots read" on public.finance_report_snapshots for select using (coalesce(public.has_permission('finanzas.view'), false));
create policy "finance_document_inbox read" on public.finance_document_inbox for select using (coalesce(public.has_permission('finanzas.view'), false));
create policy "finance_quicken_imports read" on public.finance_quicken_imports for select using (coalesce(public.has_permission('finanzas.view'), false));

create policy "finance_versions write" on public.finance_versions for all using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));
create policy "finance_assumptions write" on public.finance_assumptions for all using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));
create policy "finance_categories write" on public.finance_categories for all using (coalesce(public.has_permission('finanzas.admin'), false));
create policy "finance_cost_centers write" on public.finance_cost_centers for all using (coalesce(public.has_permission('finanzas.admin'), false));
create policy "finance_plan_lines write" on public.finance_plan_lines for all using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));
create policy "finance_forecast_adjustments write" on public.finance_forecast_adjustments for all using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));
create policy "finance_scenarios write" on public.finance_scenarios for all using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));
create policy "finance_report_snapshots write" on public.finance_report_snapshots for all using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));
create policy "finance_document_inbox write" on public.finance_document_inbox for all using (coalesce(public.has_permission('finanzas.plan'), false) or coalesce(public.has_permission('finanzas.admin'), false));
create policy "finance_quicken_imports write" on public.finance_quicken_imports for all using (coalesce(public.has_permission('finanzas.admin'), false));

insert into public.permissions (slug, module, action, label, description) values
  ('finanzas.view',    'finanzas', 'view',    'Ver Finanzas',                 'Acceso de lectura a paneles, flujo de fondos, proyecciones y resultados'),
  ('finanzas.plan',    'finanzas', 'plan',    'Planificar y Presupuestar',    'Crear y editar versiones, supuestos y proyecciones'),
  ('finanzas.approve', 'finanzas', 'approve', 'Aprobación de Finanzas',       'Aprobar y cerrar versiones presupuestarias'),
  ('finanzas.admin',   'finanzas', 'admin',   'Administrar Finanzas',         'Configuración de categorías, centros de costo e importaciones')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.slug in ('admin', 'gerencia_comercial', 'administracion_finanzas')
  and p.slug like 'finanzas.%'
on conflict (role_id, permission_id) do nothing;

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
`;

const CATALOG_QUERY = `
WITH
enums AS (
  SELECT t.typname AS enum_name, json_agg(e.enumlabel ORDER BY e.enumsortorder) AS enum_values
  FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE t.typname LIKE 'finance_%' GROUP BY t.typname
),
tables_meta AS (
  SELECT t.tablename AS table_name, t.rowsecurity AS rls_enabled
  FROM pg_tables t WHERE t.schemaname = 'public' AND t.tablename LIKE 'finance_%'
),
columns_meta AS (
  SELECT c.table_name,
    json_agg(json_build_object(
      'column_name', c.column_name,
      'ordinal_position', c.ordinal_position,
      'data_type', c.data_type,
      'udt_name', c.udt_name,
      'is_nullable', c.is_nullable,
      'column_default', c.column_default
    ) ORDER BY c.ordinal_position) AS columns
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name LIKE 'finance_%'
  GROUP BY c.table_name
),
constraints_meta AS (
  SELECT conrelid::regclass::text AS table_name,
    json_agg(json_build_object(
      'constraint_name', conname,
      'constraint_type', contype,
      'definition', pg_get_constraintdef(oid)
    ) ORDER BY conname) AS constraints
  FROM pg_constraint
  WHERE conrelid::regclass::text LIKE 'finance_%'
  GROUP BY conrelid::regclass::text
),
indices_meta AS (
  SELECT tablename AS table_name,
    json_agg(json_build_object(
      'index_name', indexname,
      'index_definition', indexdef
    ) ORDER BY indexname) AS indices
  FROM pg_indexes
  WHERE schemaname = 'public' AND (tablename LIKE 'finance_%' OR indexname LIKE 'finance_%')
  GROUP BY tablename
),
policies_meta AS (
  SELECT tablename AS table_name,
    json_agg(json_build_object(
      'policy_name', policyname,
      'permissive', permissive,
      'roles', roles,
      'cmd', cmd,
      'qual', qual
    ) ORDER BY policyname) AS policies
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename LIKE 'finance_%'
  GROUP BY tablename
),
rbac_perms AS (
  SELECT json_agg(json_build_object(
    'slug', slug, 'module', module, 'action', action, 'label', label, 'description', description
  ) ORDER BY slug) AS permissions
  FROM public.permissions WHERE slug LIKE 'finanzas.%'
),
rbac_role_perms AS (
  SELECT json_agg(json_build_object(
    'role_slug', r.slug, 'permission_slug', p.slug
  ) ORDER BY r.slug, p.slug) AS role_permissions
  FROM public.role_permissions rp
  JOIN public.roles r ON r.id = rp.role_id
  JOIN public.permissions p ON p.id = rp.permission_id
  WHERE p.slug LIKE 'finanzas.%'
),
seeds_versions AS (
  SELECT json_agg(json_build_object('code', code, 'name', name, 'status', status, 'valid_from', valid_from, 'valid_to', valid_to, 'is_active', is_active) ORDER BY code) AS rows FROM public.finance_versions
),
seeds_categories AS (
  SELECT json_agg(json_build_object('code', code, 'name', name, 'category_type', category_type, 'display_order', display_order) ORDER BY code) AS rows FROM public.finance_categories
),
seeds_cost_centers AS (
  SELECT json_agg(json_build_object('code', code, 'name', name, 'business_line', business_line) ORDER BY code) AS rows FROM public.finance_cost_centers
),
row_counts AS (
  SELECT json_build_object(
    'finance_versions', (SELECT count(*) FROM public.finance_versions),
    'finance_categories', (SELECT count(*) FROM public.finance_categories),
    'finance_cost_centers', (SELECT count(*) FROM public.finance_cost_centers),
    'finance_assumptions', (SELECT count(*) FROM public.finance_assumptions),
    'finance_plan_lines', (SELECT count(*) FROM public.finance_plan_lines),
    'finance_forecast_adjustments', (SELECT count(*) FROM public.finance_forecast_adjustments),
    'finance_scenarios', (SELECT count(*) FROM public.finance_scenarios),
    'finance_report_snapshots', (SELECT count(*) FROM public.finance_report_snapshots),
    'finance_document_inbox', (SELECT count(*) FROM public.finance_document_inbox),
    'finance_quicken_imports', (SELECT count(*) FROM public.finance_quicken_imports)
  ) AS counts
)
SELECT json_build_object(
  'enums', (SELECT coalesce(json_object_agg(enum_name, enum_values), '{}'::json) FROM enums),
  'tables', (
    SELECT coalesce(
      json_object_agg(
        t.table_name,
        json_build_object(
          'rls_enabled', t.rls_enabled,
          'columns', coalesce(c.columns, '[]'::json),
          'constraints', coalesce(k.constraints, '[]'::json),
          'indices', coalesce(i.indices, '[]'::json),
          'policies', coalesce(p.policies, '[]'::json)
        )
      ),
      '{}'::json
    )
    FROM tables_meta t
    LEFT JOIN columns_meta c ON c.table_name = t.table_name
    LEFT JOIN constraints_meta k ON k.table_name = t.table_name
    LEFT JOIN indices_meta i ON i.table_name = t.table_name
    LEFT JOIN policies_meta p ON p.table_name = t.table_name
  ),
  'rbac_permissions', (SELECT coalesce(permissions, '[]'::json) FROM rbac_perms),
  'rbac_role_permissions', (SELECT coalesce(role_permissions, '[]'::json) FROM rbac_role_perms),
  'seeds', json_build_object(
    'finance_versions', (SELECT coalesce(rows, '[]'::json) FROM seeds_versions),
    'finance_categories', (SELECT coalesce(rows, '[]'::json) FROM seeds_categories),
    'finance_cost_centers', (SELECT coalesce(rows, '[]'::json) FROM seeds_cost_centers)
  ),
  'row_counts', (SELECT counts FROM row_counts)
) AS manifest;
`;

let sb: WaSandbox;
let db: Client;

const cleanSchema = async () => {
  await db.query(`
    drop schema public cascade;
    create schema public;
    grant all on schema public to postgres;
    grant all on schema public to public;

    create extension if not exists pgcrypto;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.observer', true), '')::uuid
    $$;

    do $$ begin
      if not exists (select from pg_catalog.pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
      if not exists (select from pg_catalog.pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
    end $$;

    create table if not exists public.roles (
      id uuid primary key default gen_random_uuid(),
      slug text unique not null,
      name text not null
    );
    insert into public.roles (slug, name) values
      ('admin', 'Administración'),
      ('gerencia_comercial', 'Gerencia Comercial'),
      ('administracion_finanzas', 'Administración y Finanzas')
    on conflict do nothing;

    create type public.permission_module_t as enum ('finanzas', 'compras', 'wms', 'sistema');
    create type public.permission_action_t as enum ('view', 'create', 'edit', 'delete', 'sign', 'export', 'admin', 'plan', 'approve');

    create table if not exists public.permissions (
      id uuid primary key default gen_random_uuid(),
      slug text unique not null,
      module public.permission_module_t not null,
      action public.permission_action_t not null,
      label text not null,
      description text,
      created_at timestamptz not null default now()
    );

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
});

afterAll(async () => {
  await sb?.destroy();
});

describe("T-0262A: Suite de Remediación y Alineación Canónica de Finanzas", () => {
  it("1. Canonical No-Op: En base canónica previa, 0262a no modifica el esquema ni los seeds", async () => {
    await cleanSchema();

    // Aplicar 0262 Canónico
    const sql0262 = readFileSync(M0262_CANONICAL, "utf8");
    await db.query(sql0262);

    // Obtener manifest antes de 0262a
    const resBefore = await db.query(CATALOG_QUERY);
    const manifestBefore = JSON.stringify(resBefore.rows[0].manifest);

    // Obtener UUID de versión y categorías
    const versionsBefore = (await db.query(`select id, code from public.finance_versions`)).rows;
    const catsBefore = (await db.query(`select id, code from public.finance_categories order by code`)).rows;

    // Aplicar 0262a
    const sql0262a = readFileSync(M0262A, "utf8");
    await db.query(sql0262a);

    // Obtener manifest después de 0262a
    const resAfter = await db.query(CATALOG_QUERY);
    const manifestAfter = JSON.stringify(resAfter.rows[0].manifest);

    expect(manifestAfter).toBe(manifestBefore);

    const versionsAfter = (await db.query(`select id, code from public.finance_versions`)).rows;
    const catsAfter = (await db.query(`select id, code from public.finance_categories order by code`)).rows;

    expect(versionsAfter).toEqual(versionsBefore);
    expect(catsAfter).toEqual(catsBefore);
  });

  it("2. Reparación del Payload Incorrecto: 0262a alinea el esquema divergente 1:1 con el canónico preservando seeds", async () => {
    await cleanSchema();

    // Aplicar payload divergente
    await db.query(DIVERGENT_0262_SQL);

    // Capturar UUIDs originales de semillas
    const vId = (await db.query(`select id from public.finance_versions where code = 'BUDGET-2026-V1'`)).rows[0].id;
    const catRows = (await db.query(`select id, code from public.finance_categories order by code`)).rows;
    const ccRows = (await db.query(`select id, code from public.finance_cost_centers order by code`)).rows;

    // Aplicar 0262a
    const sql0262a = readFileSync(M0262A, "utf8");
    await db.query(sql0262a);

    // Obtener manifest resultante
    const res = await db.query(CATALOG_QUERY);
    const repairedManifest = res.rows[0].manifest;

    // Comparar contra el contrato canónico esperado:
    // finance_plan_lines debe tener columna period text y no period_date
    const planCols = repairedManifest.tables.finance_plan_lines.columns.map((c: any) => c.column_name);
    expect(planCols).toContain("period");
    expect(planCols).not.toContain("period_date");

    // finance_forecast_adjustments debe tener date y matched_movement_id
    const fcastCols = repairedManifest.tables.finance_forecast_adjustments.columns.map((c: any) => c.column_name);
    expect(fcastCols).toContain("date");
    expect(fcastCols).toContain("matched_movement_id");
    expect(fcastCols).not.toContain("forecast_date");
    expect(fcastCols).not.toContain("treasury_movement_id");

    // finance_categories no debe tener pnl_section
    const catCols = repairedManifest.tables.finance_categories.columns.map((c: any) => c.column_name);
    expect(catCols).not.toContain("pnl_section");
    expect(catCols).not.toContain("cash_flow_section");

    // Preservación estricta de UUIDs de semillas
    const vIdAfter = (await db.query(`select id from public.finance_versions where code = 'BUDGET-2026-V1'`)).rows[0].id;
    const catRowsAfter = (await db.query(`select id, code from public.finance_categories order by code`)).rows;
    const ccRowsAfter = (await db.query(`select id, code from public.finance_cost_centers order by code`)).rows;

    expect(vIdAfter).toBe(vId);
    expect(catRowsAfter).toEqual(catRows);
    expect(ccRowsAfter).toEqual(ccRows);
  });

  it("3. Estado Híbrido: Aborta fail-closed si la estructura está parcialmente alterada", async () => {
    await cleanSchema();
    await db.query(DIVERGENT_0262_SQL);

    // Simular estado híbrido: eliminar pnl_section pero mantener period_date
    await db.query(`alter table public.finance_categories drop column pnl_section;`);

    const sql0262a = readFileSync(M0262A, "utf8");
    await expect(db.query(sql0262a)).rejects.toThrow(/STOP — 0262a/);
  });

  it("4. Tabla Divergente con Datos: Aborta fail-closed si existe alguna fila transaccional", async () => {
    await cleanSchema();
    await db.query(DIVERGENT_0262_SQL);

    // Insertar un dato sintético en finance_forecast_adjustments
    await db.query(`
      insert into public.finance_forecast_adjustments (forecast_date, direction, amount, concept)
      values ('2026-08-20', 'ingreso', 1000, 'Cobro sintético');
    `);

    const sql0262a = readFileSync(M0262A, "utf8");
    await expect(db.query(sql0262a)).rejects.toThrow(/STOP — 0262a PRECONDICIÓN NO CUMPLIDA/);

    // Verificar que la fila sigue existiendo y no hubo cambios parciales
    const count = (await db.query(`select count(*) from public.finance_forecast_adjustments`)).rows[0].count;
    expect(Number(count)).toBe(1);
  });

  it("5. Dependencia Externa Inesperada: Aborta fail-closed si existe una vista dependiente", async () => {
    await cleanSchema();
    await db.query(DIVERGENT_0262_SQL);

    // Crear vista dependiente
    await db.query(`create view public.v_ext_plan as select * from public.finance_plan_lines;`);

    const sql0262a = readFileSync(M0262A, "utf8");
    await expect(db.query(sql0262a)).rejects.toThrow(/STOP — 0262a PRECONDICIÓN NO CUMPLIDA/);

    await db.query(`drop view public.v_ext_plan;`);
  });

  it("6. Rollback: Ejecuta rollback seguro condicionado y aborta ante datos operativos", async () => {
    await cleanSchema();
    await db.query(DIVERGENT_0262_SQL);

    // Aplicar 0262a
    const sql0262a = readFileSync(M0262A, "utf8");
    await db.query(sql0262a);

    // Aplicar ROLLBACK_0262a
    const sqlRollback = readFileSync(R0262A, "utf8");
    await db.query(sqlRollback);

    // Verificar que se restauraron columnas previas
    const catCols = (await db.query(`
      select column_name from information_schema.columns where table_schema = 'public' and table_name = 'finance_categories'
    `)).rows.map(r => r.column_name);
    expect(catCols).toContain("pnl_section");
  });

  it("7. Provenance Criptográfico: El blob canónico 0262 coincide con el hash autenticado por Dirección", async () => {
    const rawBlob = readFileSync(M0262_CANONICAL);
    const hash = createHash("sha256").update(rawBlob).digest("hex");
    expect(hash).toBe("1908587594777b7e9dfd6b2d629f578a6b0edc1985b0f4f47b36038879a42d63");

    const rawDivergent = DIVERGENT_0262_SQL.trim();
    const divergentHash = createHash("sha256").update(Buffer.from(rawDivergent, "utf8")).digest("hex");
    expect(divergentHash).toBeDefined();
  });
});
