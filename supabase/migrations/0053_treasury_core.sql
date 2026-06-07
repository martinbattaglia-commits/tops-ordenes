-- =========================================================================
-- 0053_treasury_core.sql — ERP-A1 (Tesorería Foundation · Modelo de datos)
-- VERSIÓN REESCRITA (corrige H1–H6 de ERP_A1_MIGRATION_AUDIT.md de origen).
--
-- Capa base de Tesorería de TOPS Nexus. Fuente única de verdad financiera
-- para cobros, pagos, bancos, movimientos y saldos. Diseño congelado en
-- docs/handoff/ERP_A_TREASURY_DESIGN.md (D1–D5). Plan de reescritura en
-- docs/handoff/ERP_A1_REWRITE_PLAN.md (C1–C8).
--
-- CORRECCIONES INCORPORADAS DE ORIGEN:
--   C1 Append-only real: lock de UPDATE en filas confirmadas (única
--      transición confirmado→anulado, exige voided_at/by/reason).
--   C2 Bloqueo DELETE absoluto (triggers) en movimientos/recibos/pagos/allocs.
--   C3 Allocations solo nacen de RPC (guard via_rpc), inmutables, FK restrict.
--   C4 Cuenta CAJA (account_type='caja', is_system=true); efectivo sin NULL:
--      customer_receipts.bank_account_id NOT NULL.
--   C5 RLS ≤ RBAC: escritura directa solo 'admin' (fino vía has_permission en RPC).
--   C6 Confidencialidad: lectura solo roles internos (excluye 'cliente').
--   C7 CHECK type↔direction + CHECK reference_type↔entidad.
--   C8 Precisión numeric(15,2) en el lado ventas (igual a customer_invoices).
--   R11 Integridad de la base D1: opening_balance/currency/account_type
--      inmutables una vez que la cuenta tiene movimientos; naturaleza de
--      cuentas de sistema (CAJA) protegida.
--
-- ALCANCE (A1): solo modelo de datos. Vistas derivadas y RPCs van en 0054 (A4),
-- donde se implementan F1 (lock por factura) y F4 (vistas status='confirmado').
--
-- D1 saldo derivado · D2 allocations N:M · D3 numeración automática
-- D4 retenciones simplificadas · D5 cuenta corriente derivada — CONGELADAS.
--
-- NATURALEZA: aditiva. No modifica customer_invoices / supplier_invoices
-- (se referencian por FK desde las allocations).
-- =========================================================================

create extension if not exists "pgcrypto";

-- =========================================================================
-- 1. ENUMS (idempotentes, prefijo treasury_*)
-- =========================================================================
do $$ begin
  create type public.treasury_movement_type_t as enum (
    'cobranza','pago_proveedor','transferencia','ajuste'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.treasury_direction_t as enum ('ingreso','egreso');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.treasury_status_t as enum ('pendiente','confirmado','anulado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.treasury_receipt_method_t as enum (
    'transferencia','efectivo','cheque','echeq'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.treasury_payment_method_t as enum (
    'transferencia','cheque','echeq'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.treasury_doc_status_t as enum ('confirmado','anulado');
exception when duplicate_object then null; end $$;

-- =========================================================================
-- 2. FUNCIONES DE TRIGGER COMPARTIDAS (C2 / C3)
--    (Los cuerpos plpgsql no se validan contra columnas al crearse; los
--     triggers se asocian a sus tablas más abajo.)
-- =========================================================================

-- C2: DELETE absoluto prohibido sobre cualquier registro financiero.
create or replace function public.tg_forbid_delete_financial()
returns trigger language plpgsql as $$
begin
  raise exception
    'TREASURY_APPEND_ONLY: prohibido eliminar registros financieros (usar anulación lógica)'
    using errcode = 'check_violation';
end; $$;

-- C3: las allocations solo pueden nacer desde una RPC oficial (via_rpc='on').
create or replace function public.guard_allocation_insert()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('treasury.via_rpc', true), 'off') <> 'on' then
    raise exception
      'ALLOCATION_DIRECT_INSERT_FORBIDDEN: las imputaciones solo pueden crearse vía RPC de tesorería'
      using errcode = 'check_violation';
  end if;
  return new;
end; $$;

-- C3: las allocations son inmutables (sin UPDATE directo).
create or replace function public.tg_forbid_update_allocation()
returns trigger language plpgsql as $$
begin
  raise exception
    'ALLOCATION_IMMUTABLE: las imputaciones no se editan (anular el recibo/pago padre)'
    using errcode = 'check_violation';
end; $$;

-- C4: protege cuentas de sistema (CAJA) de borrado.
create or replace function public.tg_protect_system_bank_account()
returns trigger language plpgsql as $$
begin
  if old.is_system then
    raise exception
      'BANK_ACCOUNT_SYSTEM_PROTECTED: no se puede eliminar una cuenta de sistema (ej. CAJA)'
      using errcode = 'check_violation';
  end if;
  return old;
end; $$;

-- =========================================================================
-- 3. BANK ACCOUNTS  (C4: + is_system, account_type 'caja')
-- =========================================================================
create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  bank_name text not null,
  account_name text not null,
  account_type text not null default 'cuenta_corriente'
    check (account_type in ('caja_ahorro','cuenta_corriente','caja')),  -- C4
  currency text not null default 'ARS',
  alias text,
  cbu text,
  opening_balance numeric(15,2) not null default 0,   -- D1 (C8: 15,2)
  active boolean not null default true,
  is_system boolean not null default false,            -- C4
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (bank_name, account_name)
);
create index if not exists bank_accounts_active_idx on public.bank_accounts (active);

drop trigger if exists trg_bank_accounts_updated_at on public.bank_accounts;
create trigger trg_bank_accounts_updated_at
before update on public.bank_accounts
for each row execute function public.touch_updated_at();

-- C4: protección de cuentas de sistema ante DELETE.
drop trigger if exists trg_protect_system_bank_account on public.bank_accounts;
create trigger trg_protect_system_bank_account
before delete on public.bank_accounts
for each row execute function public.tg_protect_system_bank_account();

-- R11 (audit reescritura): la base del saldo derivado (D1) es inmutable una
-- vez que la cuenta tiene movimientos. Evita re-basar el histórico al editar
-- opening_balance/currency/account_type. Las cuentas de sistema (CAJA) además
-- no pueden cambiar su naturaleza. (Editar alias/cbu/account_name/active sigue
-- permitido.)
create or replace function public.tg_lock_bank_account_basis()
returns trigger language plpgsql as $$
declare has_mov boolean;
begin
  if old.is_system and (
       new.is_system   is distinct from old.is_system or
       new.account_type is distinct from old.account_type) then
    raise exception 'BANK_ACCOUNT_SYSTEM_PROTECTED: no se puede alterar la naturaleza de una cuenta de sistema (ej. CAJA)'
      using errcode = 'check_violation';
  end if;
  select exists(
    select 1 from public.treasury_movements where bank_account_id = old.id
  ) into has_mov;
  if has_mov and (
       new.opening_balance is distinct from old.opening_balance or
       new.currency        is distinct from old.currency or
       new.account_type    is distinct from old.account_type) then
    raise exception 'BANK_ACCOUNT_BASIS_LOCKED: opening_balance/currency/account_type son inmutables una vez que la cuenta tiene movimientos'
      using errcode = 'check_violation';
  end if;
  return new;
end; $$;

drop trigger if exists trg_lock_bank_account_basis on public.bank_accounts;
create trigger trg_lock_bank_account_basis
before update on public.bank_accounts
for each row execute function public.tg_lock_bank_account_basis();

-- =========================================================================
-- 4. SEQUENCES para public_id legible (D3)
-- =========================================================================
create sequence if not exists public.treasury_movement_short_id_seq start 1;
create sequence if not exists public.customer_receipt_short_id_seq  start 1;
create sequence if not exists public.supplier_payment_short_id_seq  start 1;

-- =========================================================================
-- 5. TREASURY MOVEMENTS — fuente única de verdad (C7, C8, C1, C2, F6)
-- =========================================================================
create table if not exists public.treasury_movements (
  id uuid primary key default gen_random_uuid(),
  short_id int not null default nextval('public.treasury_movement_short_id_seq'),
  public_id text not null unique,                       -- MOV-YYYY-NNNNNN
  date date not null default current_date,
  type public.treasury_movement_type_t not null,
  direction public.treasury_direction_t not null,
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  amount numeric(15,2) not null check (amount > 0),     -- C8: 15,2
  description text,
  reference_type text,
  reference_id uuid,
  transfer_group_id uuid,
  status public.treasury_status_t not null default 'confirmado',
  -- F5: auditoría de anulación
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- C7: coherencia type ↔ direction (cobranza=ingreso, pago=egreso;
  --     transferencia y ajuste = ambas direcciones, controladas por RPC)
  constraint treasury_movements_type_direction_ck check (
    (type = 'cobranza'       and direction = 'ingreso') or
    (type = 'pago_proveedor' and direction = 'egreso')  or
    (type = 'transferencia') or
    (type = 'ajuste')
  ),
  -- C7: coherencia reference_type ↔ entidad
  constraint treasury_movements_reference_type_ck check (
    reference_type is null or
    reference_type in ('customer_receipt','supplier_payment','transfer','manual')
  )
);
create index if not exists tm_bank_idx     on public.treasury_movements (bank_account_id);
create index if not exists tm_status_idx   on public.treasury_movements (status);
create index if not exists tm_date_idx     on public.treasury_movements (date desc);
create index if not exists tm_ref_idx      on public.treasury_movements (reference_type, reference_id);
create index if not exists tm_transfer_idx on public.treasury_movements (transfer_group_id);
create index if not exists tm_type_idx     on public.treasury_movements (type);

create or replace function public.set_treasury_movement_public_id()
returns trigger as $$
declare yr text;
begin
  if new.public_id is null or new.public_id = '' then
    yr := to_char(coalesce(new.date, current_date), 'YYYY');
    new.public_id := 'MOV-' || yr || '-' || lpad(new.short_id::text, 6, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_treasury_movement_public_id on public.treasury_movements;
create trigger trg_set_treasury_movement_public_id
before insert on public.treasury_movements
for each row execute function public.set_treasury_movement_public_id();

-- F6 (sin cambios): INSERT directo solo type='ajuste'; cobranza/pago/transf.
-- exigen una RPC (que setea treasury.via_rpc='on' en su transacción).
create or replace function public.guard_treasury_movement_insert()
returns trigger as $$
begin
  if new.type <> 'ajuste'
     and coalesce(current_setting('treasury.via_rpc', true), 'off') <> 'on' then
    raise exception
      'TREASURY_DIRECT_INSERT_FORBIDDEN: movimientos de tipo % solo pueden crearse vía RPC (solo ''ajuste'' admite alta directa).', new.type
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_guard_treasury_movement_insert on public.treasury_movements;
create trigger trg_guard_treasury_movement_insert
before insert on public.treasury_movements
for each row execute function public.guard_treasury_movement_insert();

-- C1: append-only. Sobre filas confirmadas, la ÚNICA mutación permitida es
-- confirmado→anulado con voided_at/by/reason; todo lo demás inmutable.
create or replace function public.tg_lock_treasury_movement()
returns trigger language plpgsql as $$
begin
  if old.status = 'anulado' then
    raise exception 'TREASURY_IMMUTABLE: movimiento anulado es inmutable' using errcode='check_violation';
  end if;
  if old.status = 'confirmado' then
    -- ninguna columna salvo {status, voided_*} puede cambiar
    if row(new.id,new.short_id,new.public_id,new.date,new.type,new.direction,
           new.bank_account_id,new.amount,new.description,new.reference_type,
           new.reference_id,new.transfer_group_id,new.created_by,new.created_at)
       is distinct from
       row(old.id,old.short_id,old.public_id,old.date,old.type,old.direction,
           old.bank_account_id,old.amount,old.description,old.reference_type,
           old.reference_id,old.transfer_group_id,old.created_by,old.created_at) then
      raise exception 'TREASURY_CONFIRMED_IMMUTABLE: solo se permite confirmado→anulado, sin alterar datos' using errcode='check_violation';
    end if;
    if new.status <> 'anulado' then
      raise exception 'TREASURY_CONFIRMED_IMMUTABLE: única transición permitida confirmado→anulado' using errcode='check_violation';
    end if;
    if new.voided_at is null or new.voided_by is null
       or new.void_reason is null or btrim(new.void_reason) = '' then
      raise exception 'TREASURY_VOID_REQUIRES_AUDIT: voided_at/voided_by/void_reason obligatorios' using errcode='check_violation';
    end if;
  end if;
  -- old.status='pendiente' (reservado, no usado en A): se permite finalizar.
  return new;
end; $$;

drop trigger if exists trg_lock_treasury_movement on public.treasury_movements;
create trigger trg_lock_treasury_movement
before update on public.treasury_movements
for each row execute function public.tg_lock_treasury_movement();

-- C2: DELETE prohibido.
drop trigger if exists trg_forbid_delete_treasury_movement on public.treasury_movements;
create trigger trg_forbid_delete_treasury_movement
before delete on public.treasury_movements
for each row execute function public.tg_forbid_delete_financial();

-- =========================================================================
-- 6. CUSTOMER RECEIPTS — cobranzas (C8 15,2; C4 bank NOT NULL; C1; C2)
-- =========================================================================
create table if not exists public.customer_receipts (
  id uuid primary key default gen_random_uuid(),
  short_id int not null default nextval('public.customer_receipt_short_id_seq'),
  public_id text not null unique,                       -- REC-YYYY-NNNNNN
  client_id uuid not null references public.clients(id) on delete restrict,
  payment_date date not null default current_date,
  payment_method public.treasury_receipt_method_t not null,
  -- C4: obligatorio. Efectivo imputa a la cuenta de sistema CAJA. Sin NULL.
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  gross_amount numeric(15,2) not null check (gross_amount > 0),         -- C8
  retention_amount numeric(15,2) not null default 0 check (retention_amount >= 0),
  -- F2: la retención no puede superar el bruto (neto nunca < 0)
  constraint customer_receipts_retention_le_gross check (retention_amount <= gross_amount),
  net_amount numeric(15,2) generated always as (gross_amount - retention_amount) stored,  -- C8
  observations text,
  attachment text,                                      -- path en bucket 'treasury'
  status public.treasury_doc_status_t not null default 'confirmado',
  -- F5: auditoría de anulación
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists cr_client_idx on public.customer_receipts (client_id);
create index if not exists cr_date_idx    on public.customer_receipts (payment_date desc);
create index if not exists cr_status_idx  on public.customer_receipts (status);
create index if not exists cr_bank_idx    on public.customer_receipts (bank_account_id);

create or replace function public.set_customer_receipt_public_id()
returns trigger as $$
declare yr text;
begin
  if new.public_id is null or new.public_id = '' then
    yr := to_char(coalesce(new.payment_date, current_date), 'YYYY');
    new.public_id := 'REC-' || yr || '-' || lpad(new.short_id::text, 6, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_customer_receipt_public_id on public.customer_receipts;
create trigger trg_set_customer_receipt_public_id
before insert on public.customer_receipts
for each row execute function public.set_customer_receipt_public_id();

-- C1: lock append-only.
create or replace function public.tg_lock_customer_receipt()
returns trigger language plpgsql as $$
begin
  if old.status = 'anulado' then
    raise exception 'RECEIPT_IMMUTABLE: recibo anulado es inmutable' using errcode='check_violation';
  end if;
  if old.status = 'confirmado' then
    if row(new.id,new.short_id,new.public_id,new.client_id,new.payment_date,
           new.payment_method,new.bank_account_id,new.gross_amount,
           new.retention_amount,new.observations,new.attachment,
           new.created_by,new.created_at)
       is distinct from
       row(old.id,old.short_id,old.public_id,old.client_id,old.payment_date,
           old.payment_method,old.bank_account_id,old.gross_amount,
           old.retention_amount,old.observations,old.attachment,
           old.created_by,old.created_at) then
      raise exception 'RECEIPT_CONFIRMED_IMMUTABLE: solo confirmado→anulado sin alterar datos' using errcode='check_violation';
    end if;
    if new.status <> 'anulado' then
      raise exception 'RECEIPT_CONFIRMED_IMMUTABLE: única transición confirmado→anulado' using errcode='check_violation';
    end if;
    if new.voided_at is null or new.voided_by is null
       or new.void_reason is null or btrim(new.void_reason) = '' then
      raise exception 'RECEIPT_VOID_REQUIRES_AUDIT: voided_at/voided_by/void_reason obligatorios' using errcode='check_violation';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_lock_customer_receipt on public.customer_receipts;
create trigger trg_lock_customer_receipt
before update on public.customer_receipts
for each row execute function public.tg_lock_customer_receipt();

-- C2: DELETE prohibido.
drop trigger if exists trg_forbid_delete_customer_receipt on public.customer_receipts;
create trigger trg_forbid_delete_customer_receipt
before delete on public.customer_receipts
for each row execute function public.tg_forbid_delete_financial();

-- =========================================================================
-- 7. SUPPLIER PAYMENTS — pagos a proveedor (lado AP: numeric 14,2; C1; C2)
-- =========================================================================
create table if not exists public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  short_id int not null default nextval('public.supplier_payment_short_id_seq'),
  public_id text not null unique,                       -- PAG-YYYY-NNNNNN
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  payment_date date not null default current_date,
  payment_method public.treasury_payment_method_t not null,
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),     -- AP side = 14,2 (supplier_invoices)
  operation_number text,
  observations text,
  attachment text,
  status public.treasury_doc_status_t not null default 'confirmado',
  -- F5: auditoría de anulación
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sp_vendor_idx on public.supplier_payments (vendor_id);
create index if not exists sp_date_idx    on public.supplier_payments (payment_date desc);
create index if not exists sp_status_idx  on public.supplier_payments (status);
create index if not exists sp_bank_idx    on public.supplier_payments (bank_account_id);

create or replace function public.set_supplier_payment_public_id()
returns trigger as $$
declare yr text;
begin
  if new.public_id is null or new.public_id = '' then
    yr := to_char(coalesce(new.payment_date, current_date), 'YYYY');
    new.public_id := 'PAG-' || yr || '-' || lpad(new.short_id::text, 6, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_supplier_payment_public_id on public.supplier_payments;
create trigger trg_set_supplier_payment_public_id
before insert on public.supplier_payments
for each row execute function public.set_supplier_payment_public_id();

-- C1: lock append-only.
create or replace function public.tg_lock_supplier_payment()
returns trigger language plpgsql as $$
begin
  if old.status = 'anulado' then
    raise exception 'PAYMENT_IMMUTABLE: pago anulado es inmutable' using errcode='check_violation';
  end if;
  if old.status = 'confirmado' then
    if row(new.id,new.short_id,new.public_id,new.vendor_id,new.payment_date,
           new.payment_method,new.bank_account_id,new.amount,new.operation_number,
           new.observations,new.attachment,new.created_by,new.created_at)
       is distinct from
       row(old.id,old.short_id,old.public_id,old.vendor_id,old.payment_date,
           old.payment_method,old.bank_account_id,old.amount,old.operation_number,
           old.observations,old.attachment,old.created_by,old.created_at) then
      raise exception 'PAYMENT_CONFIRMED_IMMUTABLE: solo confirmado→anulado sin alterar datos' using errcode='check_violation';
    end if;
    if new.status <> 'anulado' then
      raise exception 'PAYMENT_CONFIRMED_IMMUTABLE: única transición confirmado→anulado' using errcode='check_violation';
    end if;
    if new.voided_at is null or new.voided_by is null
       or new.void_reason is null or btrim(new.void_reason) = '' then
      raise exception 'PAYMENT_VOID_REQUIRES_AUDIT: voided_at/voided_by/void_reason obligatorios' using errcode='check_violation';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_lock_supplier_payment on public.supplier_payments;
create trigger trg_lock_supplier_payment
before update on public.supplier_payments
for each row execute function public.tg_lock_supplier_payment();

-- C2: DELETE prohibido.
drop trigger if exists trg_forbid_delete_supplier_payment on public.supplier_payments;
create trigger trg_forbid_delete_supplier_payment
before delete on public.supplier_payments
for each row execute function public.tg_forbid_delete_financial();

-- =========================================================================
-- 8. ALLOCATIONS N:M (D2) — solo vía RPC, inmutables (C3, C2, C8)
--    FK al padre: on delete RESTRICT (refuerza append-only).
-- =========================================================================
create table if not exists public.receipt_allocations (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.customer_receipts(id) on delete restrict,   -- C3
  customer_invoice_id uuid not null references public.customer_invoices(id) on delete restrict,
  amount numeric(15,2) not null check (amount > 0),     -- C8 (lado ventas)
  created_at timestamptz not null default now(),
  unique (receipt_id, customer_invoice_id)
);
create index if not exists ra_receipt_idx on public.receipt_allocations (receipt_id);
create index if not exists ra_invoice_idx on public.receipt_allocations (customer_invoice_id);

create table if not exists public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.supplier_payments(id) on delete restrict,   -- C3
  supplier_invoice_id uuid not null references public.supplier_invoices(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),     -- AP side
  created_at timestamptz not null default now(),
  unique (payment_id, supplier_invoice_id)
);
create index if not exists pa_payment_idx on public.payment_allocations (payment_id);
create index if not exists pa_invoice_idx on public.payment_allocations (supplier_invoice_id);

-- C3: INSERT solo vía RPC.
drop trigger if exists trg_guard_receipt_allocation_insert on public.receipt_allocations;
create trigger trg_guard_receipt_allocation_insert
before insert on public.receipt_allocations
for each row execute function public.guard_allocation_insert();

drop trigger if exists trg_guard_payment_allocation_insert on public.payment_allocations;
create trigger trg_guard_payment_allocation_insert
before insert on public.payment_allocations
for each row execute function public.guard_allocation_insert();

-- C3: UPDATE prohibido (inmutables).
drop trigger if exists trg_forbid_update_receipt_allocation on public.receipt_allocations;
create trigger trg_forbid_update_receipt_allocation
before update on public.receipt_allocations
for each row execute function public.tg_forbid_update_allocation();

drop trigger if exists trg_forbid_update_payment_allocation on public.payment_allocations;
create trigger trg_forbid_update_payment_allocation
before update on public.payment_allocations
for each row execute function public.tg_forbid_update_allocation();

-- C2: DELETE prohibido.
drop trigger if exists trg_forbid_delete_receipt_allocation on public.receipt_allocations;
create trigger trg_forbid_delete_receipt_allocation
before delete on public.receipt_allocations
for each row execute function public.tg_forbid_delete_financial();

drop trigger if exists trg_forbid_delete_payment_allocation on public.payment_allocations;
create trigger trg_forbid_delete_payment_allocation
before delete on public.payment_allocations
for each row execute function public.tg_forbid_delete_financial();

-- =========================================================================
-- 9. RLS — C6 read interno (excluye 'cliente'); C5 write solo 'admin';
--    sin DELETE (C2 trigger ya lo bloquea de raíz). El control fino de
--    capacidades (director_ops, etc.) se ejerce en las RPC vía has_permission.
-- =========================================================================
alter table public.bank_accounts       enable row level security;
alter table public.treasury_movements  enable row level security;
alter table public.customer_receipts   enable row level security;
alter table public.supplier_payments   enable row level security;
alter table public.receipt_allocations enable row level security;
alter table public.payment_allocations enable row level security;

-- Helper de legibilidad: read interno = roles internos legacy (sin 'cliente').
-- (admin, operaciones, supervisor). compliance/comercial usan su rol legacy real.

-- ---- bank_accounts ----
drop policy if exists "bank_accounts read" on public.bank_accounts;
create policy "bank_accounts read"
  on public.bank_accounts for select
  using (public.current_role() in ('admin','operaciones','supervisor'));   -- C6

drop policy if exists "bank_accounts write admin" on public.bank_accounts;
create policy "bank_accounts write admin"
  on public.bank_accounts for all
  using (public.current_role() = 'admin')                                  -- C5
  with check (public.current_role() = 'admin');

-- ---- treasury_movements ----
drop policy if exists "treasury_movements read" on public.treasury_movements;
create policy "treasury_movements read"
  on public.treasury_movements for select
  using (public.current_role() in ('admin','operaciones','supervisor'));   -- C6

drop policy if exists "treasury_movements insert" on public.treasury_movements;
create policy "treasury_movements insert"
  on public.treasury_movements for insert
  with check (public.current_role() = 'admin');                            -- C5

drop policy if exists "treasury_movements update" on public.treasury_movements;
create policy "treasury_movements update"
  on public.treasury_movements for update
  using (public.current_role() = 'admin')                                  -- C5 (solo void; lock C1 lo acota)
  with check (public.current_role() = 'admin');
-- (sin DELETE policy; trigger C2 lo bloquea)

-- ---- customer_receipts ----
drop policy if exists "customer_receipts read" on public.customer_receipts;
create policy "customer_receipts read"
  on public.customer_receipts for select
  using (public.current_role() in ('admin','operaciones','supervisor'));

drop policy if exists "customer_receipts insert" on public.customer_receipts;
create policy "customer_receipts insert"
  on public.customer_receipts for insert
  with check (public.current_role() = 'admin');

drop policy if exists "customer_receipts update" on public.customer_receipts;
create policy "customer_receipts update"
  on public.customer_receipts for update
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- ---- supplier_payments ----
drop policy if exists "supplier_payments read" on public.supplier_payments;
create policy "supplier_payments read"
  on public.supplier_payments for select
  using (public.current_role() in ('admin','operaciones','supervisor'));

drop policy if exists "supplier_payments insert" on public.supplier_payments;
create policy "supplier_payments insert"
  on public.supplier_payments for insert
  with check (public.current_role() = 'admin');

drop policy if exists "supplier_payments update" on public.supplier_payments;
create policy "supplier_payments update"
  on public.supplier_payments for update
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- ---- receipt_allocations ----
drop policy if exists "receipt_allocations read" on public.receipt_allocations;
create policy "receipt_allocations read"
  on public.receipt_allocations for select
  using (public.current_role() in ('admin','operaciones','supervisor'));

drop policy if exists "receipt_allocations insert" on public.receipt_allocations;
create policy "receipt_allocations insert"
  on public.receipt_allocations for insert
  with check (public.current_role() = 'admin');   -- + guard via_rpc (C3) en trigger

-- ---- payment_allocations ----
drop policy if exists "payment_allocations read" on public.payment_allocations;
create policy "payment_allocations read"
  on public.payment_allocations for select
  using (public.current_role() in ('admin','operaciones','supervisor'));

drop policy if exists "payment_allocations insert" on public.payment_allocations;
create policy "payment_allocations insert"
  on public.payment_allocations for insert
  with check (public.current_role() = 'admin');

-- =========================================================================
-- 10. STORAGE — bucket privado 'treasury' (molde 0015). Acceso interno.
-- =========================================================================
insert into storage.buckets (id, name, public)
values ('treasury', 'treasury', false)
on conflict (id) do update set public = false;

drop policy if exists "treasury read internal" on storage.objects;
create policy "treasury read internal"
  on storage.objects for select
  using (bucket_id = 'treasury' and public.current_role() in ('admin','operaciones','supervisor'));

drop policy if exists "treasury write internal" on storage.objects;
create policy "treasury write internal"
  on storage.objects for insert
  with check (bucket_id = 'treasury' and public.current_role() in ('admin','operaciones','supervisor'));

drop policy if exists "treasury update internal" on storage.objects;
create policy "treasury update internal"
  on storage.objects for update
  using (bucket_id = 'treasury' and public.current_role() in ('admin','operaciones','supervisor'));

-- =========================================================================
-- 11. RBAC — catálogo de permisos 'tesoreria' + mapeo a roles.
--     Requiere el valor de enum 'tesoreria' ya committeado en 0052.
-- =========================================================================
insert into public.permissions (slug, module, action, label, description) values
  ('tesoreria.view',   'tesoreria', 'view',   'Ver tesorería',                 'Bancos, movimientos, saldos, cobranzas y pagos'),
  ('tesoreria.create', 'tesoreria', 'create', 'Registrar cobros/pagos/transf.', 'Alta de cobranzas, pagos y transferencias'),
  ('tesoreria.edit',   'tesoreria', 'edit',   'Anular movimientos',            'Anulación lógica (void) de movimientos, recibos y pagos'),
  ('tesoreria.export', 'tesoreria', 'export', 'Exportar tesorería',            'Reportes de caja/bancos/flujo de fondos'),
  ('tesoreria.admin',  'tesoreria', 'admin',  'Administrar cuentas bancarias', 'Alta/edición de cuentas bancarias')
on conflict (slug) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'director_ops' and p.module = 'tesoreria'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'admin' and p.module = 'tesoreria'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'operaciones' and p.slug = 'tesoreria.view'
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'compliance' and p.slug in ('tesoreria.view','tesoreria.export')
on conflict do nothing;

-- =========================================================================
-- 12. SEED — cuentas: CAJA (sistema) + bancos oficiales. opening_balance = 0.
-- =========================================================================
insert into public.bank_accounts (bank_name, account_name, account_type, currency, opening_balance, active, is_system) values
  ('Caja',            'Caja Efectivo',            'caja',             'ARS', 0, true, true),   -- C4
  ('Banco Santander', 'VEROTIN S.A. — Santander', 'cuenta_corriente', 'ARS', 0, true, false),
  ('Banco Galicia',   'VEROTIN S.A. — Galicia',   'cuenta_corriente', 'ARS', 0, true, false)
on conflict (bank_name, account_name) do nothing;

notify pgrst, 'reload schema';
