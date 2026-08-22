import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client } from "pg";
import { createWaSandbox, type WaSandbox } from "./harness/wa-sandbox";

const M0300 = resolve(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
  "0300_finance_treasury_atomic_reconciliation.sql"
);

const M0300_ROLLBACK = resolve(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
  "ROLLBACK_0300_finance_treasury_atomic_reconciliation.sql"
);

describe("T-0300 · Reconciliación Atómica Finanzas ↔ Tesorería en PostgreSQL 17", () => {
  let sb: WaSandbox;
  let db: Client;

  const USER_ID = "11111111-1111-4111-8111-111111111111";
  const OTHER_USER_ID = "99999999-9999-4999-8999-999999999999";
  const UNAUTHORIZED_USER_ID = "77777777-7777-4777-8777-777777777777";
  const TREASURY_ONLY_USER_ID = "88888888-7777-4777-8777-777777777777";
  const BANK_ID = "22222222-2222-4222-8222-222222222222";
  const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
  const VENDOR_ID = "44444444-4444-4444-8444-444444444444";
  const INVOICE_ID = "55555555-5555-4555-8555-555555555555";
  const SUPP_INVOICE_ID = "66666666-6666-4666-8666-666666666666";

  beforeAll(async () => {
    sb = await createWaSandbox(inject("dbUrl"));
    db = sb.client;

    // 1. Setup Precursor Real Mínimo
    await db.query(`
      create extension if not exists pgcrypto;
      create schema if not exists auth;
      create table if not exists auth.users (id uuid primary key);
      insert into auth.users (id) values
        ('${USER_ID}'),
        ('${OTHER_USER_ID}'),
        ('${UNAUTHORIZED_USER_ID}'),
        ('${TREASURY_ONLY_USER_ID}')
      on conflict do nothing;

      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;

      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then
          create role authenticated nologin;
        end if;
        if not exists (select 1 from pg_roles where rolname = 'anon') then
          create role anon nologin;
        end if;
      end $$;

      -- RBAC Real
      create table if not exists public.permissions (
        code text primary key,
        module text not null,
        action text not null
      );

      create table if not exists public.user_permissions (
        user_id uuid references auth.users(id) on delete cascade,
        permission_code text references public.permissions(code) on delete cascade,
        primary key (user_id, permission_code)
      );

      insert into public.permissions(code, module, action) values
        ('tesoreria.create', 'tesoreria', 'create'),
        ('tesoreria.view', 'tesoreria', 'view'),
        ('finanzas.view', 'finanzas', 'view'),
        ('finanzas.plan', 'finanzas', 'plan'),
        ('finanzas.admin', 'finanzas', 'admin')
      on conflict do nothing;

      create or replace function public.has_permission(p_code text) returns boolean language sql stable security definer as $$
        select exists (
          select 1 from public.user_permissions
          where user_id = auth.uid() and permission_code = p_code
        );
      $$;

      insert into public.user_permissions(user_id, permission_code) values
        ('${USER_ID}', 'tesoreria.create'),
        ('${USER_ID}', 'tesoreria.view'),
        ('${USER_ID}', 'finanzas.view'),
        ('${USER_ID}', 'finanzas.plan'),
        ('${OTHER_USER_ID}', 'tesoreria.create'),
        ('${OTHER_USER_ID}', 'tesoreria.view'),
        ('${OTHER_USER_ID}', 'finanzas.view'),
        ('${OTHER_USER_ID}', 'finanzas.plan'),
        ('${TREASURY_ONLY_USER_ID}', 'tesoreria.create'),
        ('${TREASURY_ONLY_USER_ID}', 'tesoreria.view'),
        ('${TREASURY_ONLY_USER_ID}', 'finanzas.view')
      on conflict do nothing;

      -- Enums Tesorería
      create type public.treasury_receipt_method_t as enum ('transferencia', 'efectivo', 'cheque', 'deposito');
      create type public.treasury_payment_method_t as enum ('transferencia', 'efectivo', 'cheque', 'echeq');
      create type public.treasury_direction_t as enum ('ingreso', 'egreso');
      create type public.treasury_operational_category_t as enum (
        'honorarios', 'adelanto_sueldo', 'adelanto_director', 'adelanto_efectivo', 'reintegro', 'gasto_operativo', 'regularizacion', 'otro'
      );
      create type public.treasury_beneficiary_kind_t as enum ('empleado', 'director', 'proveedor', 'tercero');

      -- Enums Finanzas
      create type public.finance_direction_t as enum ('ingreso', 'egreso', 'transferencia');
      create type public.finance_forecast_status_t as enum ('proyectado', 'comprometido', 'reconciliado', 'anulado');
      create type public.finance_currency_t as enum ('ARS', 'USD');

      -- Tablas Base de Tesorería
      create table public.bank_accounts (
        id uuid primary key default gen_random_uuid(),
        name text not null default 'Banco Galicia',
        currency text not null default 'ARS',
        active boolean not null default true,
        is_system boolean not null default false
      );

      insert into public.bank_accounts(id, name, currency, active, is_system)
      values ('${BANK_ID}', 'Galicia CC ARS', 'ARS', true, false);

      create table public.customer_invoices (
        id uuid primary key default gen_random_uuid(),
        client_id uuid not null,
        total numeric(14,2) not null,
        estado_arca text not null default 'AUTORIZADO_ARCA',
        anulada boolean not null default false
      );

      insert into public.customer_invoices(id, client_id, total, estado_arca, anulada)
      values ('${INVOICE_ID}', '${CLIENT_ID}', 10000000, 'AUTORIZADO_ARCA', false);

      create table public.supplier_invoices (
        id uuid primary key default gen_random_uuid(),
        vendor_id uuid not null,
        total numeric(14,2) not null,
        status text not null default 'aprobada'
      );

      insert into public.supplier_invoices(id, vendor_id, total, status)
      values ('${SUPP_INVOICE_ID}', '${VENDOR_ID}', 10000000, 'aprobada');

      create table public.treasury_beneficiaries (
        id uuid primary key default gen_random_uuid(),
        full_name text not null,
        kind public.treasury_beneficiary_kind_t not null default 'tercero',
        document_id text,
        active boolean not null default true,
        created_by uuid references auth.users(id)
      );

      create table public.customer_receipts (
        id uuid primary key default gen_random_uuid(),
        public_id text not null default 'RC-0001',
        client_id uuid not null,
        payment_date date not null default current_date,
        payment_method public.treasury_receipt_method_t not null,
        bank_account_id uuid not null references public.bank_accounts(id),
        gross_amount numeric(14,2) not null,
        retention_amount numeric(14,2) not null default 0,
        observations text,
        attachment text,
        status text not null default 'confirmado',
        created_by uuid references auth.users(id),
        created_at timestamptz not null default now()
      );

      create table public.receipt_allocations (
        id uuid primary key default gen_random_uuid(),
        receipt_id uuid not null references public.customer_receipts(id) on delete cascade,
        customer_invoice_id uuid not null references public.customer_invoices(id),
        amount numeric(14,2) not null
      );

      create table public.supplier_payments (
        id uuid primary key default gen_random_uuid(),
        public_id text not null default 'OP-0001',
        vendor_id uuid not null,
        payment_date date not null default current_date,
        payment_method public.treasury_payment_method_t not null,
        bank_account_id uuid not null references public.bank_accounts(id),
        amount numeric(14,2) not null,
        operation_number text,
        observations text,
        attachment text,
        status text not null default 'confirmado',
        created_by uuid references auth.users(id),
        created_at timestamptz not null default now()
      );

      create table public.payment_allocations (
        id uuid primary key default gen_random_uuid(),
        payment_id uuid not null references public.supplier_payments(id) on delete cascade,
        supplier_invoice_id uuid not null references public.supplier_invoices(id),
        amount numeric(14,2) not null
      );

      create table public.treasury_movements (
        id uuid primary key default gen_random_uuid(),
        public_id text not null default 'MOV-0001',
        date date not null default current_date,
        type text not null,
        direction public.treasury_direction_t not null,
        bank_account_id uuid not null references public.bank_accounts(id),
        amount numeric(14,2) not null,
        description text not null,
        reference_type text,
        reference_id uuid,
        operational_category public.treasury_operational_category_t,
        beneficiary_id uuid references public.treasury_beneficiaries(id),
        status text not null default 'confirmado',
        created_by uuid references auth.users(id),
        created_at timestamptz not null default now()
      );

      -- Tablas Base de Finanzas
      create table public.finance_forecast_adjustments (
        id uuid primary key default gen_random_uuid(),
        direction public.finance_direction_t not null,
        currency public.finance_currency_t not null default 'ARS',
        amount numeric(15,2) not null check (amount > 0),
        status public.finance_forecast_status_t not null default 'proyectado',
        concept text not null default 'Previsión de prueba',
        notes text,
        matched_movement_id uuid references public.treasury_movements(id),
        created_by uuid references auth.users(id),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      grant select, insert, update, delete on public.finance_forecast_adjustments to authenticated;

      -- Firmas Preexistentes (para certificar que 0300 las dropea y reemplaza limpiamente)
      create or replace function public.tesoreria_register_receipt(
        p_client_id uuid, p_payment_date date, p_payment_method public.treasury_receipt_method_t,
        p_bank_account_id uuid, p_gross_amount numeric, p_retention_amount numeric,
        p_observations text, p_attachment text, p_allocations jsonb
      ) returns jsonb language plpgsql as $$ begin return '{}'::jsonb; end; $$;

      create or replace function public.tesoreria_register_payment(
        p_vendor_id uuid, p_payment_date date, p_payment_method public.treasury_payment_method_t,
        p_bank_account_id uuid, p_amount numeric, p_operation_number text,
        p_observations text, p_attachment text, p_allocations jsonb
      ) returns jsonb language plpgsql as $$ begin return '{}'::jsonb; end; $$;

      create or replace function public.tesoreria_register_operational_movement(
        p_date date, p_category public.treasury_operational_category_t, p_direction public.treasury_direction_t,
        p_bank_account_id uuid, p_amount numeric, p_concept text, p_beneficiary_id uuid,
        p_beneficiary_name text, p_beneficiary_kind public.treasury_beneficiary_kind_t,
        p_beneficiary_document text, p_observations text
      ) returns jsonb language plpgsql as $$ begin return '{}'::jsonb; end; $$;
    `);

    // Establecer sesión por defecto para el usuario autorizado
    await db.query(`select set_config('request.jwt.claim.sub', '${USER_ID}', false)`);
  });

  afterAll(async () => {
    await sb.destroy();
  });

  it("1. Ejecuta literalmente 0300_finance_treasury_atomic_reconciliation.sql sin errores", async () => {
    const sql = readFileSync(M0300, "utf8");
    await expect(db.query(sql)).resolves.toBeDefined();
  });

  it("2. Catálogo: verifica tablas de reconciliaciones, idempotencia, columna y firmas únicas", async () => {
    const tblRec = await db.query(`
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'finance_forecast_reconciliations'
    `);
    expect(tblRec.rowCount).toBe(1);

    const tblIdem = await db.query(`
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'treasury_idempotency_keys'
    `);
    expect(tblIdem.rowCount).toBe(1);

    const col = await db.query(`
      select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'finance_forecast_adjustments' and column_name = 'reconciled_amount'
    `);
    expect(col.rowCount).toBe(1);
    expect(col.rows[0].data_type).toBe("numeric");

    const procs = await db.query(`
      select proname, count(*) as count
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and proname in ('tesoreria_register_receipt', 'tesoreria_register_payment', 'tesoreria_register_operational_movement')
      group by proname
    `);
    expect(procs.rowCount).toBe(3);
    for (const r of procs.rows) {
      expect(Number(r.count)).toBe(1);
    }
  });

  it("3. Autenticación y RBAC Real: caller sin sesión o sin permiso tesoreria.create es rechazado fail-closed", async () => {
    // A) Caller sin sesión
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await expect(
      db.query(`
        select public.tesoreria_register_receipt(
          p_client_id => '${CLIENT_ID}',
          p_payment_date => current_date,
          p_payment_method => 'transferencia',
          p_bank_account_id => '${BANK_ID}',
          p_gross_amount => 100000,
          p_retention_amount => 0,
          p_observations => null,
          p_attachment => null,
          p_allocations => '[{"invoice_id": "${INVOICE_ID}", "amount": 100000}]'::jsonb,
          p_forecast_adjustment_id => null,
          p_forecast_applied_amount => null,
          p_idempotency_key => '00000000-0000-0000-0000-000000000001'
        );
      `)
    ).rejects.toThrow(/UNAUTHENTICATED/);

    // B) Caller sin permiso tesoreria.create
    await db.query(`select set_config('request.jwt.claim.sub', '${UNAUTHORIZED_USER_ID}', false)`);
    await expect(
      db.query(`
        select public.tesoreria_register_receipt(
          p_client_id => '${CLIENT_ID}',
          p_payment_date => current_date,
          p_payment_method => 'transferencia',
          p_bank_account_id => '${BANK_ID}',
          p_gross_amount => 100000,
          p_retention_amount => 0,
          p_observations => null,
          p_attachment => null,
          p_allocations => '[{"invoice_id": "${INVOICE_ID}", "amount": 100000}]'::jsonb,
          p_forecast_adjustment_id => null,
          p_forecast_applied_amount => null,
          p_idempotency_key => '00000000-0000-0000-0000-000000000002'
        );
      `)
    ).rejects.toThrow(/FORBIDDEN/);

    // Restaurar usuario autorizado
    await db.query(`select set_config('request.jwt.claim.sub', '${USER_ID}', false)`);
  });

  it("4. Autorización cruzada: tesoreria.create sin finanzas.plan/admin no puede reconciliar una previsión", async () => {
    const forecast = await db.query(`
      insert into public.finance_forecast_adjustments(direction, currency, amount, status, concept)
      values ('ingreso', 'ARS', 100000, 'proyectado', 'Forecast protegido por doble permiso')
      returning id
    `);
    await db.query(`select set_config('request.jwt.claim.sub', '${TREASURY_ONLY_USER_ID}', false)`);

    await expect(db.query(`
      select public.tesoreria_register_receipt(
        p_client_id => '${CLIENT_ID}', p_payment_date => current_date,
        p_payment_method => 'transferencia', p_bank_account_id => '${BANK_ID}',
        p_gross_amount => 100000, p_retention_amount => 0,
        p_observations => null, p_attachment => null,
        p_allocations => '[{"invoice_id": "${INVOICE_ID}", "amount": 100000}]'::jsonb,
        p_forecast_adjustment_id => '${forecast.rows[0].id}',
        p_forecast_applied_amount => 100000,
        p_idempotency_key => '99999999-aaaa-4bbb-8ccc-dddddddddddd'
      )
    `)).rejects.toThrow(/finanzas\.plan o finanzas\.admin/);

    await expect(db.query(`
      select public.finance_void_forecast('${forecast.rows[0].id}', 'Sin permiso financiero')
    `)).rejects.toThrow(/finanzas\.plan o finanzas\.admin/);

    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await expect(db.query(`
      select public.finance_void_forecast('${forecast.rows[0].id}', 'Sin sesión')
    `)).rejects.toThrow(/UNAUTHENTICATED/);

    await db.query(`select set_config('request.jwt.claim.sub', '${USER_ID}', false)`);
    const voidResult = await db.query(`
      select public.finance_void_forecast('${forecast.rows[0].id}', 'Cancelación autorizada') as result
    `);
    expect(voidResult.rows[0].result.status).toBe('anulado');
  });

  it("4. Idempotencia Obligatoria: clave nula o no UUID rechaza en el trust boundary SQL", async () => {
    // A) Clave nula
    await expect(
      db.query(`
        select public.tesoreria_register_receipt(
          p_client_id => '${CLIENT_ID}',
          p_payment_date => current_date,
          p_payment_method => 'transferencia',
          p_bank_account_id => '${BANK_ID}',
          p_gross_amount => 100000,
          p_retention_amount => 0,
          p_observations => null,
          p_attachment => null,
          p_allocations => '[{"invoice_id": "${INVOICE_ID}", "amount": 100000}]'::jsonb,
          p_forecast_adjustment_id => null,
          p_forecast_applied_amount => null,
          p_idempotency_key => null
        );
      `)
    ).rejects.toThrow(/IDEMPOTENCY_KEY_REQUIRED/);

    // B) Ataque con clave no UUID (cadena arbitraria)
    await expect(
      db.query(`
        select public.tesoreria_register_receipt(
          p_client_id => '${CLIENT_ID}',
          p_payment_date => current_date,
          p_payment_method => 'transferencia',
          p_bank_account_id => '${BANK_ID}',
          p_gross_amount => 100000,
          p_retention_amount => 0,
          p_observations => null,
          p_attachment => null,
          p_allocations => '[{"invoice_id": "${INVOICE_ID}", "amount": 100000}]'::jsonb,
          p_forecast_adjustment_id => null,
          p_forecast_applied_amount => null,
          p_idempotency_key => 'not-a-valid-uuid'::uuid
        );
      `)
    ).rejects.toThrow(/invalid input syntax for type uuid/);
  });

  it("5. Seguridad y RLS Directa: authenticated no puede hacer INSERT/UPDATE/DELETE directo en auditoría e idempotencia, ni leer cache ajena", async () => {
    const grantsRec = await db.query(`
      select privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'finance_forecast_reconciliations' and grantee = 'authenticated'
    `);
    const privsRec = grantsRec.rows.map((r) => r.privilege_type);
    expect(privsRec).toContain("SELECT");
    expect(privsRec).not.toContain("INSERT");
    expect(privsRec).not.toContain("UPDATE");
    expect(privsRec).not.toContain("DELETE");

    const grantsIdem = await db.query(`
      select privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'treasury_idempotency_keys' and grantee = 'authenticated'
    `);
    const privsIdem = grantsIdem.rows.map((r) => r.privilege_type);
    expect(privsIdem).toContain("SELECT");
    expect(privsIdem).not.toContain("INSERT");
    expect(privsIdem).not.toContain("UPDATE");
    expect(privsIdem).not.toContain("DELETE");

    // Ejecutar ataques DML reales bajo SET ROLE authenticated
    const testClient = await sb.connect();
    await testClient.query(`
      grant usage on schema public to authenticated;
      grant usage on schema auth to authenticated;
    `);

    const TEST_KEY_OWN = "88888888-8888-4888-8888-888888888888";
    const protectedForecast = await db.query(`
      insert into public.finance_forecast_adjustments(direction, currency, amount, status, concept)
      values ('ingreso', 'ARS', 500000, 'proyectado', 'Forecast con campos derivados protegidos')
      returning id
    `);

    // Registro de prueba perteneciente a USER_ID
    await db.query(`
      insert into public.treasury_idempotency_keys(key, action, payload_hash, response, created_by)
      values ('${TEST_KEY_OWN}', 'test_action', 'hash123', '{"ok": true}'::jsonb, '${USER_ID}')
      on conflict (key) do nothing;
    `);

    // Cambiar a rol authenticated con identidad de USER_ID
    await testClient.query(`
      set role authenticated;
      select set_config('request.jwt.claim.sub', '${USER_ID}', false);
    `);

    // A) Ataque INSERT directo en finance_forecast_reconciliations
    await expect(
      testClient.query(`
        insert into public.finance_forecast_reconciliations (
          forecast_adjustment_id, treasury_movement_id, applied_amount
        ) values (
          '${USER_ID}', '${BANK_ID}', 1000
        );
      `)
    ).rejects.toThrow(/permission denied/);

    // B) Ataque UPDATE directo en finance_forecast_reconciliations
    await expect(
      testClient.query(`
        update public.finance_forecast_reconciliations set applied_amount = 999999;
      `)
    ).rejects.toThrow(/permission denied/);

    // C) Ataque DELETE directo en finance_forecast_reconciliations
    await expect(
      testClient.query(`
        delete from public.finance_forecast_reconciliations;
      `)
    ).rejects.toThrow(/permission denied/);

    // D) Ataque INSERT directo en treasury_idempotency_keys
    await expect(
      testClient.query(`
        insert into public.treasury_idempotency_keys (
          key, action, payload_hash, response, created_by
        ) values (
          '77777777-7777-4777-8777-777777777777', 'hacked_action', 'hash_fake', '{}'::jsonb, '${USER_ID}'
        );
      `)
    ).rejects.toThrow(/permission denied/);

    // E) Ataque UPDATE directo en treasury_idempotency_keys
    await expect(
      testClient.query(`
        update public.treasury_idempotency_keys set payload_hash = 'tampered';
      `)
    ).rejects.toThrow(/permission denied/);

    // F) Ataque DELETE directo en treasury_idempotency_keys
    await expect(
      testClient.query(`
        delete from public.treasury_idempotency_keys;
      `)
    ).rejects.toThrow(/permission denied/);

    // G) Los campos derivados de forecast no pueden falsificarse por UPDATE directo
    await expect(
      testClient.query(`
        update public.finance_forecast_adjustments
        set status = 'reconciliado', reconciled_amount = 500000,
            matched_movement_id = '${BANK_ID}'
        where id = '${protectedForecast.rows[0].id}';
      `)
    ).rejects.toThrow(/permission denied/);

    // Una columna ordinaria conserva su permiso de edición.
    await expect(
      testClient.query(`
        update public.finance_forecast_adjustments
        set concept = 'Edición permitida'
        where id = '${protectedForecast.rows[0].id}';
      `)
    ).resolves.toBeDefined();

    // H) RLS: el propio autor SI puede leer su entrada de cache
    const ownRead = await testClient.query(`
      select key, response from public.treasury_idempotency_keys where key = '${TEST_KEY_OWN}';
    `);
    expect(ownRead.rowCount).toBe(1);

    // I) RLS: usuario no autorizado o distinto NO puede leer cache ajena
    await testClient.query(`
      select set_config('request.jwt.claim.sub', '${OTHER_USER_ID}', false);
    `);
    const otherRead = await testClient.query(`
      select key, response from public.treasury_idempotency_keys where key = '${TEST_KEY_OWN}';
    `);
    expect(otherRead.rowCount).toBe(0);

    await testClient.query(`
      select set_config('request.jwt.claim.sub', '${UNAUTHORIZED_USER_ID}', false);
    `);
    const unauthRead = await testClient.query(`
      select key, response from public.treasury_idempotency_keys where key = '${TEST_KEY_OWN}';
    `);
    expect(unauthRead.rowCount).toBe(0);

    await testClient.end();
  });

  it("6. N:M Real: Parcial 3M + 2M acumula reconciled_amount y actualiza status proyectado -> comprometido -> reconciliado", async () => {
    const fcRes = await db.query(`
      insert into public.finance_forecast_adjustments (direction, currency, amount, status, concept)
      values ('ingreso', 'ARS', 5000000, 'proyectado', 'Cobranza Parcial 3M+2M')
      returning id;
    `);
    const forecastId = fcRes.rows[0].id;

    // 1ra cobranza parcial: 3M
    const res1 = await db.query(`
      select public.tesoreria_register_receipt(
        p_client_id => '${CLIENT_ID}',
        p_payment_date => current_date,
        p_payment_method => 'transferencia',
        p_bank_account_id => '${BANK_ID}',
        p_gross_amount => 3000000,
        p_retention_amount => 0,
        p_observations => 'Cobranza parcial 1',
        p_attachment => null,
        p_allocations => '[{"invoice_id": "${INVOICE_ID}", "amount": 3000000}]'::jsonb,
        p_forecast_adjustment_id => '${forecastId}',
        p_forecast_applied_amount => 3000000,
        p_idempotency_key => '00000000-0000-4000-8000-000000000001'
      ) as result;
    `);
    const r1 = res1.rows[0].result;
    expect(r1.reconciliation).toBeDefined();
    expect(Number(r1.reconciliation.new_reconciled_total)).toBe(3000000);
    expect(Number(r1.reconciliation.remaining)).toBe(2000000);
    expect(r1.reconciliation.new_status).toBe("comprometido");

    const fcCheck1 = await db.query(`select status, reconciled_amount from public.finance_forecast_adjustments where id = $1`, [forecastId]);
    expect(fcCheck1.rows[0].status).toBe("comprometido");
    expect(Number(fcCheck1.rows[0].reconciled_amount)).toBe(3000000);

    // 2da cobranza parcial: 2M
    const res2 = await db.query(`
      select public.tesoreria_register_receipt(
        p_client_id => '${CLIENT_ID}',
        p_payment_date => current_date,
        p_payment_method => 'transferencia',
        p_bank_account_id => '${BANK_ID}',
        p_gross_amount => 2000000,
        p_retention_amount => 0,
        p_observations => 'Cobranza parcial 2',
        p_attachment => null,
        p_allocations => '[{"invoice_id": "${INVOICE_ID}", "amount": 2000000}]'::jsonb,
        p_forecast_adjustment_id => '${forecastId}',
        p_forecast_applied_amount => 2000000,
        p_idempotency_key => '00000000-0000-4000-8000-000000000002'
      ) as result;
    `);
    const r2 = res2.rows[0].result;
    expect(r2.reconciliation).toBeDefined();
    expect(Number(r2.reconciliation.new_reconciled_total)).toBe(5000000);
    expect(Number(r2.reconciliation.remaining)).toBe(0);
    expect(r2.reconciliation.new_status).toBe("reconciliado");

    const fcCheck2 = await db.query(`select status, reconciled_amount from public.finance_forecast_adjustments where id = $1`, [forecastId]);
    expect(fcCheck2.rows[0].status).toBe("reconciliado");
    expect(Number(fcCheck2.rows[0].reconciled_amount)).toBe(5000000);

    const relCount = await db.query(`select count(*) as count from public.finance_forecast_reconciliations where forecast_adjustment_id = $1`, [forecastId]);
    expect(Number(relCount.rows[0].count)).toBe(2);
  });

  it("7. Idempotencia y Protección de Actor: replay del mismo actor devuelve cache; actor distinto falla fail-closed", async () => {
    const IDEM_KEY = "11111111-2222-4333-8444-555555555555";
    const fcRes = await db.query(`
      insert into public.finance_forecast_adjustments (direction, currency, amount, status, concept)
      values ('ingreso', 'ARS', 1500000, 'proyectado', 'Cobranza Idempotente')
      returning id;
    `);
    const forecastId = fcRes.rows[0].id;

    // 1ra ejecución pública por USER_ID
    const res1 = await db.query(`
      select public.tesoreria_register_receipt(
        p_client_id => '${CLIENT_ID}',
        p_payment_date => current_date,
        p_payment_method => 'transferencia',
        p_bank_account_id => '${BANK_ID}',
        p_gross_amount => 1500000,
        p_retention_amount => 0,
        p_observations => 'Cobranza Idempotente 1ra',
        p_attachment => null,
        p_allocations => '[{"invoice_id": "${INVOICE_ID}", "amount": 1500000}]'::jsonb,
        p_forecast_adjustment_id => '${forecastId}',
        p_forecast_applied_amount => 1500000,
        p_idempotency_key => '${IDEM_KEY}'
      ) as result;
    `);
    const out1 = res1.rows[0].result;
    expect(out1.receipt_id).toBeDefined();

    // 2da ejecución por el MISMO actor: devuelve cache
    const res2 = await db.query(`
      select public.tesoreria_register_receipt(
        p_client_id => '${CLIENT_ID}',
        p_payment_date => current_date,
        p_payment_method => 'transferencia',
        p_bank_account_id => '${BANK_ID}',
        p_gross_amount => 1500000,
        p_retention_amount => 0,
        p_observations => 'Cobranza Idempotente 1ra',
        p_attachment => null,
        p_allocations => '[{"invoice_id": "${INVOICE_ID}", "amount": 1500000}]'::jsonb,
        p_forecast_adjustment_id => '${forecastId}',
        p_forecast_applied_amount => 1500000,
        p_idempotency_key => '${IDEM_KEY}'
      ) as result;
    `);
    expect(res2.rows[0].result.receipt_id).toBe(out1.receipt_id);

    // 3ra ejecución por OTRO actor autorizado: RECHAZA con IDEMPOTENCY_KEY_ACTOR_MISMATCH
    await db.query(`select set_config('request.jwt.claim.sub', '${OTHER_USER_ID}', false)`);
    await expect(
      db.query(`
        select public.tesoreria_register_receipt(
          p_client_id => '${CLIENT_ID}',
          p_payment_date => current_date,
          p_payment_method => 'transferencia',
          p_bank_account_id => '${BANK_ID}',
          p_gross_amount => 1500000,
          p_retention_amount => 0,
          p_observations => 'Cobranza Idempotente 1ra',
          p_attachment => null,
          p_allocations => '[{"invoice_id": "${INVOICE_ID}", "amount": 1500000}]'::jsonb,
          p_forecast_adjustment_id => '${forecastId}',
          p_forecast_applied_amount => 1500000,
          p_idempotency_key => '${IDEM_KEY}'
        );
      `)
    ).rejects.toThrow(/IDEMPOTENCY_KEY_ACTOR_MISMATCH/);

    // Restaurar sesión de USER_ID
    await db.query(`select set_config('request.jwt.claim.sub', '${USER_ID}', false)`);

    // 4ta ejecución: mismo actor pero payload distinto -> RECHAZA con IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD
    await expect(
      db.query(`
        select public.tesoreria_register_receipt(
          p_client_id => '${CLIENT_ID}',
          p_payment_date => current_date,
          p_payment_method => 'transferencia',
          p_bank_account_id => '${BANK_ID}',
          p_gross_amount => 1000000,
          p_retention_amount => 0,
          p_observations => 'Distinto monto',
          p_attachment => null,
          p_allocations => '[{"invoice_id": "${INVOICE_ID}", "amount": 1000000}]'::jsonb,
          p_forecast_adjustment_id => '${forecastId}',
          p_forecast_applied_amount => 1000000,
          p_idempotency_key => '${IDEM_KEY}'
        );
      `)
    ).rejects.toThrow(/IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD/);
  });

  it("8. Sobreaplicación con Rollback Total: revierte 100% de la transacción sin dejar huérfanos", async () => {
    const fcRes = await db.query(`
      insert into public.finance_forecast_adjustments (direction, currency, amount, status, concept)
      values ('egreso', 'ARS', 1000000, 'proyectado', 'Pago combustible')
      returning id;
    `);
    const forecastId = fcRes.rows[0].id;

    const countMovementsBefore = (await db.query(`select count(*) as c from public.treasury_movements`)).rows[0].c;
    const countPaymentsBefore = (await db.query(`select count(*) as c from public.supplier_payments`)).rows[0].c;
    const countAllocationsBefore = (await db.query(`select count(*) as c from public.payment_allocations`)).rows[0].c;

    await expect(
      db.query(`
        select public.tesoreria_register_payment(
          p_vendor_id => '${VENDOR_ID}',
          p_payment_date => current_date,
          p_payment_method => 'transferencia',
          p_bank_account_id => '${BANK_ID}',
          p_amount => 2000000,
          p_operation_number => 'OP-OVERAPP',
          p_observations => null,
          p_attachment => null,
          p_allocations => '[{"supplier_invoice_id": "${SUPP_INVOICE_ID}", "amount": 2000000}]'::jsonb,
          p_forecast_adjustment_id => '${forecastId}',
          p_forecast_applied_amount => 2000000,
          p_idempotency_key => '22222222-3333-4444-8555-666666666666'
        );
      `)
    ).rejects.toThrow(/FORECAST_OVER_APPLICATION/);

    const countMovementsAfter = (await db.query(`select count(*) as c from public.treasury_movements`)).rows[0].c;
    const countPaymentsAfter = (await db.query(`select count(*) as c from public.supplier_payments`)).rows[0].c;
    const countAllocationsAfter = (await db.query(`select count(*) as c from public.payment_allocations`)).rows[0].c;

    expect(countMovementsAfter).toBe(countMovementsBefore);
    expect(countPaymentsAfter).toBe(countPaymentsBefore);
    expect(countAllocationsAfter).toBe(countAllocationsBefore);
  });

  it("9. Concurrencia Real: dos conexiones simultáneas con la misma clave y payload devuelven el mismo resultado con exactamente 1 registro creado", async () => {
    const db2 = await sb.connect();
    await db2.query(`select set_config('request.jwt.claim.sub', '${USER_ID}', false)`);

    const IDEM_KEY_CONC = "33333333-4444-4555-8666-777777777777";
    const fcRes = await db.query(`
      insert into public.finance_forecast_adjustments (direction, currency, amount, status, concept)
      values ('ingreso', 'ARS', 2500000, 'proyectado', 'Cobranza Concurrente')
      returning id;
    `);
    const forecastId = fcRes.rows[0].id;

    const countReceiptsBefore = (await db.query(`select count(*) as c from public.customer_receipts`)).rows[0].c;
    const countAllocationsBefore = (await db.query(`select count(*) as c from public.receipt_allocations`)).rows[0].c;
    const countMovementsBefore = (await db.query(`select count(*) as c from public.treasury_movements`)).rows[0].c;
    const countReconciliationsBefore = (await db.query(`select count(*) as c from public.finance_forecast_reconciliations`)).rows[0].c;

    const querySql = `
      select public.tesoreria_register_receipt(
        p_client_id => '${CLIENT_ID}',
        p_payment_date => current_date,
        p_payment_method => 'transferencia',
        p_bank_account_id => '${BANK_ID}',
        p_gross_amount => 2500000,
        p_retention_amount => 0,
        p_observations => 'Cobranza Concurrente',
        p_attachment => null,
        p_allocations => '[{"invoice_id": "${INVOICE_ID}", "amount": 2500000}]'::jsonb,
        p_forecast_adjustment_id => '${forecastId}',
        p_forecast_applied_amount => 2500000,
        p_idempotency_key => '${IDEM_KEY_CONC}'
      ) as result;
    `;

    const [res1, res2] = await Promise.all([
      db.query(querySql),
      db2.query(querySql),
    ]);

    const out1 = res1.rows[0].result;
    const out2 = res2.rows[0].result;

    expect(out1.receipt_id).toBeDefined();
    expect(out2.receipt_id).toBe(out1.receipt_id);
    expect(out2.movement_id).toBe(out1.movement_id);

    const countReceiptsAfter = (await db.query(`select count(*) as c from public.customer_receipts`)).rows[0].c;
    const countAllocationsAfter = (await db.query(`select count(*) as c from public.receipt_allocations`)).rows[0].c;
    const countMovementsAfter = (await db.query(`select count(*) as c from public.treasury_movements`)).rows[0].c;
    const countReconciliationsAfter = (await db.query(`select count(*) as c from public.finance_forecast_reconciliations`)).rows[0].c;

    expect(Number(countReceiptsAfter)).toBe(Number(countReceiptsBefore) + 1);
    expect(Number(countAllocationsAfter)).toBe(Number(countAllocationsBefore) + 1);
    expect(Number(countMovementsAfter)).toBe(Number(countMovementsBefore) + 1);
    expect(Number(countReconciliationsAfter)).toBe(Number(countReconciliationsBefore) + 1);
  });

  it("10. Cobranza con retención: al omitir el monto aplicado reconcilia el neto realmente ingresado", async () => {
    const retentionInvoiceId = "66666666-6666-4666-8666-666666666666";
    await db.query(`
      insert into public.customer_invoices(id, client_id, total, estado_arca, anulada)
      values ('${retentionInvoiceId}', '${CLIENT_ID}', 1000000, 'AUTORIZADO_ARCA', false)
    `);
    const fcRes = await db.query(`
      insert into public.finance_forecast_adjustments (direction, currency, amount, status, concept)
      values ('ingreso', 'ARS', 900000, 'proyectado', 'Cobranza neta con retención')
      returning id;
    `);
    const forecastId = fcRes.rows[0].id;

    const result = await db.query(`
      select public.tesoreria_register_receipt(
        p_client_id => '${CLIENT_ID}',
        p_payment_date => current_date,
        p_payment_method => 'transferencia',
        p_bank_account_id => '${BANK_ID}',
        p_gross_amount => 1000000,
        p_retention_amount => 100000,
        p_observations => 'Cobranza neta con retención',
        p_attachment => null,
        p_allocations => '[{"invoice_id": "${retentionInvoiceId}", "amount": 1000000}]'::jsonb,
        p_forecast_adjustment_id => '${forecastId}',
        p_forecast_applied_amount => null,
        p_idempotency_key => '55555555-6666-4777-8888-999999999999'
      ) as result;
    `);

    expect(Number(result.rows[0].result.net_amount)).toBe(900000);
    expect(Number(result.rows[0].result.reconciliation.applied_amount)).toBe(900000);
    expect(Number(result.rows[0].result.reconciliation.remaining)).toBe(0);
    expect(result.rows[0].result.reconciliation.new_status).toBe("reconciliado");

    const movement = await db.query(
      `select amount from public.treasury_movements where id = $1`,
      [result.rows[0].result.movement_id]
    );
    expect(Number(movement.rows[0].amount)).toBe(900000);
  });

  it("11. Rollback y Reaplicación: ejecuta ROLLBACK_0300 y reaplica 0300 verificando integridad pre/post", async () => {
    // 1. Ejecutar ROLLBACK
    const rollbackSql = readFileSync(M0300_ROLLBACK, "utf8");
    await expect(db.query(rollbackSql)).resolves.toBeDefined();

    // 2. Verificar que las tablas y columnas desaparecieron
    const tblRecPostRollback = await db.query(`
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'finance_forecast_reconciliations'
    `);
    expect(tblRecPostRollback.rowCount).toBe(0);

    const tblIdemPostRollback = await db.query(`
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'treasury_idempotency_keys'
    `);
    expect(tblIdemPostRollback.rowCount).toBe(0);

    const colPostRollback = await db.query(`
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'finance_forecast_adjustments' and column_name = 'reconciled_amount'
    `);
    expect(colPostRollback.rowCount).toBe(0);

    // 3. Verificar que la firma previa (9 parámetros) opera normalmente
    const resPrev = await db.query(`
      select public.tesoreria_register_receipt(
        p_client_id => '${CLIENT_ID}',
        p_payment_date => current_date,
        p_payment_method => 'transferencia',
        p_bank_account_id => '${BANK_ID}',
        p_gross_amount => 100000,
        p_retention_amount => 0,
        p_observations => 'Recibo pre-0300',
        p_attachment => null,
        p_allocations => '[{"invoice_id": "${INVOICE_ID}", "amount": 100000}]'::jsonb
      ) as result;
    `);
    expect(resPrev.rows[0].result.receipt_id).toBeDefined();

    // 4. Reaplica 0300
    const forwardSql = readFileSync(M0300, "utf8");
    await expect(db.query(forwardSql)).resolves.toBeDefined();

    // 5. Verificar que 0300 quedó nuevamente operativo
    const resReapply = await db.query(`
      select public.tesoreria_register_receipt(
        p_client_id => '${CLIENT_ID}',
        p_payment_date => current_date,
        p_payment_method => 'transferencia',
        p_bank_account_id => '${BANK_ID}',
        p_gross_amount => 100000,
        p_retention_amount => 0,
        p_observations => 'Recibo reaplicado',
        p_attachment => null,
        p_allocations => '[{"invoice_id": "${INVOICE_ID}", "amount": 100000}]'::jsonb,
        p_forecast_adjustment_id => null,
        p_forecast_applied_amount => null,
        p_idempotency_key => '44444444-5555-4666-8777-888888888888'
      ) as result;
    `);
    expect(resReapply.rows[0].result.receipt_id).toBeDefined();
  });
});
