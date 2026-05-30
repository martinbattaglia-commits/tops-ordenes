# FASE 1A · MIGRATION 0014 (DISEÑO)

**Archivo target propuesto:** `supabase/migrations/0014_recurring_billing_and_customer_accounts.sql`
**Estado:** **DISEÑO PURO** · NO ejecutar · NO aplicar · NO crear el archivo todavía.
**Compatibilidad:** aditivo, idempotente, con down-migration comentada.
**Convenciones obligatorias:** FASE 0 governance DB + PARIDAD-3 closure.

---

## 0 · Reservas de numeración

| # | Status | Notas |
|---|--------|-------|
| 0012 | reservada | per memoria persistente; **NO usar** |
| 0013 | aplicada | `0013_invoices_storage_isolation.sql` |
| **0014** | **propuesta esta sesión** | facturación recurrente + CC cliente |

Si el usuario decide reservar otro número (ej 0014 para algo más urgente), bumpear esta a 0015 sin reescribir contenido.

---

## 1 · Encabezado propuesto

```sql
-- =========================================================================
-- TOPS NEXUS — FASE 1A · Facturación Recurrente + Cuenta Corriente Cliente
--
-- Aplica DESPUÉS de 0001-0013. Asume:
--   - mig 0009 (RBAC): tablas roles, permissions, role_permissions, user_roles
--                       funciones current_role(), has_permission()
--   - mig 0011 (ARCA billing): customer_invoices, invoice_items, fiscal_config,
--                              puntos_venta, trigger tg_lock_authorized_invoice
--   - mig 0013 (storage isolation): pattern de buckets multi-tenant
--
-- NO modifica:
--   - customer_invoices schema
--   - invoice_items schema
--   - trigger tg_lock_authorized_invoice
--   - RLS de tablas existentes
--
-- Convenciones:
--   - Todo "create" con "if not exists" / "do$$ … exception when …$$" guard
--   - Enums con guard duplicate_object
--   - Triggers via drop+create
--   - Comentarios obligatorios por tabla
--   - Down-migration comentada al final
--
-- Antes de aplicar:
--   1. Backup externo Supabase verificado (riesgo RG5)
--   2. supabase migration list confirma que 0013 es el último aplicado
--   3. Aplicar con `supabase migration up --linked` desde host con CLI auth
--
-- Después de aplicar:
--   1. `supabase migration list` debe mostrar 0014 como applied
--   2. Smoke tests T1-T12 de FASE-1A-RLS.md
-- =========================================================================
```

---

## 2 · Sección 1: Enums

```sql
-- Frecuencia de facturación recurrente
do $$ begin
  create type recurring_freq_t as enum ('MENSUAL','TRIMESTRAL','SEMESTRAL','ANUAL');
exception when duplicate_object then null; end $$;

-- Estado del contrato recurrente
do $$ begin
  create type recurring_contract_status_t as enum (
    'BORRADOR','ACTIVO','PAUSADO','FINALIZADO','CANCELADO'
  );
exception when duplicate_object then null; end $$;

-- Categoría de línea (filtro UI + reporting)
do $$ begin
  create type recurring_line_category_t as enum (
    'ALMACENAJE_ANMAT','ALMACENAJE_GRAL','OFICINA','COWORK','ABONO','OTRO'
  );
exception when duplicate_object then null; end $$;

-- Estado del run
do $$ begin
  create type recurring_run_status_t as enum (
    'PENDIENTE','OK','FAILED','SKIPPED','MANUAL_OVERRIDE'
  );
exception when duplicate_object then null; end $$;

-- Trigger del run
do $$ begin
  create type run_trigger_t as enum ('CRON','MANUAL','BACKFILL');
exception when duplicate_object then null; end $$;

-- Tipos de movimiento de cuenta corriente
do $$ begin
  create type customer_transaction_t as enum (
    'INVOICE','CREDIT_NOTE','DEBIT_NOTE','PAYMENT','ADJUSTMENT','LATE_FEE','REFUND'
  );
exception when duplicate_object then null; end $$;

-- Dirección contable simple
do $$ begin
  create type direction_t as enum ('DEBIT','CREDIT');
exception when duplicate_object then null; end $$;

-- Métodos de pago (FASE 3 lo amplía/reemplaza)
do $$ begin
  create type payment_method_t as enum (
    'TRANSFERENCIA','CHEQUE','ECHEQ','EFECTIVO','TARJETA','MERCADOPAGO','OTRO'
  );
exception when duplicate_object then null; end $$;

-- Estado del cobro
do $$ begin
  create type payment_status_t as enum (
    'BORRADOR','CONFIRMADO','RECHAZADO','ANULADO'
  );
exception when duplicate_object then null; end $$;

-- Capitalización de intereses por mora
do $$ begin
  create type compounding_t as enum ('SIMPLE','COMPUESTO');
exception when duplicate_object then null; end $$;
```

---

## 3 · Sección 2: `payment_terms` (catálogo)

```sql
create table if not exists public.payment_terms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_split boolean not null default false,
  splits jsonb,
  default_days_to_due int not null default 30,
  active boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seeds idempotentes
insert into public.payment_terms (code, name, is_split, default_days_to_due, is_system) values
  ('CASH',      'Contado',          false,  0, true),
  ('D7',        '7 días',           false,  7, true),
  ('D15',       '15 días',          false, 15, true),
  ('D30',       '30 días',          false, 30, true),
  ('D60',       '60 días',          false, 60, true),
  ('D90',       '90 días',          false, 90, true)
on conflict (code) do nothing;

insert into public.payment_terms (code, name, is_split, splits, default_days_to_due, is_system) values
  ('D30_60',
   '30/60 días',
   true,
   '[{"days":30,"pct":50},{"days":60,"pct":50}]'::jsonb,
   30, true),
  ('D30_60_90',
   '30/60/90 días',
   true,
   '[{"days":30,"pct":33.33},{"days":60,"pct":33.33},{"days":90,"pct":33.34}]'::jsonb,
   30, true)
on conflict (code) do nothing;

-- RLS
alter table public.payment_terms enable row level security;

drop policy if exists "payment_terms read all auth" on public.payment_terms;
create policy "payment_terms read all auth"
  on public.payment_terms for select
  using (auth.role() = 'authenticated');

drop policy if exists "payment_terms write admin" on public.payment_terms;
create policy "payment_terms write admin"
  on public.payment_terms for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');
```

---

## 4 · Sección 3: `recurring_contracts`

```sql
create table if not exists public.recurring_contracts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  code text not null unique,
  descripcion text,
  frequency recurring_freq_t not null,
  start_date date not null,
  end_date date,
  next_run_date date,
  billing_day smallint not null default 1
    check (billing_day between 1 and 28),
  payment_term_id uuid not null references public.payment_terms(id) on delete restrict,
  auto_emit boolean not null default false,
  concepto_arca smallint not null default 2,
  tipo_comprobante_default comprobante_tipo_t not null default 'FACTURA_A',
  punto_venta int not null,
  currency text not null default 'PES',
  cotizacion_source text not null default 'BCRA_OFICIAL',
  cotizacion_fija numeric(15,6),
  iva_default numeric(5,2) not null default 21,
  status recurring_contract_status_t not null default 'BORRADOR',
  notas text,
  signed_at timestamptz,
  signature_path text,
  last_run_at timestamptz,
  last_run_invoice_id uuid references public.customer_invoices(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  check (
    (cotizacion_source = 'FIJO' and cotizacion_fija is not null)
    or cotizacion_source <> 'FIJO'
  )
);

create index if not exists recurring_contracts_client_idx
  on public.recurring_contracts(client_id);
create index if not exists recurring_contracts_status_next_run_idx
  on public.recurring_contracts(status, next_run_date)
  where status = 'ACTIVO';
create index if not exists recurring_contracts_code_idx
  on public.recurring_contracts(code);
```

---

## 5 · Sección 4: `recurring_contract_lines`

```sql
create table if not exists public.recurring_contract_lines (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.recurring_contracts(id) on delete cascade,
  orden int not null default 0,
  descripcion text not null,
  categoria recurring_line_category_t not null default 'OTRO',
  unidad text not null default 'mes',
  cantidad numeric(12,4) not null check (cantidad > 0),
  precio_unitario numeric(15,4) not null check (precio_unitario >= 0),
  iva_rate numeric(5,2) not null default 21,
  apply_indexacion boolean not null default false,
  notes text,
  active boolean not null default true
);

create index if not exists recurring_contract_lines_contract_idx
  on public.recurring_contract_lines(contract_id);
```

---

## 6 · Sección 5: `recurring_runs`

```sql
create table if not exists public.recurring_runs (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.recurring_contracts(id) on delete cascade,
  periodo text not null,
  run_date date not null default current_date,
  intended_for_date date not null,
  status recurring_run_status_t not null default 'PENDIENTE',
  invoice_id uuid references public.customer_invoices(id) on delete set null,
  total_estimado numeric(15,2) not null default 0,
  currency_snapshot text not null default 'PES',
  cotizacion_snapshot numeric(15,6) not null default 1,
  error_message text,
  dry_run boolean not null default false,
  triggered_by run_trigger_t not null default 'CRON',
  triggered_by_user uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists recurring_runs_contract_idx
  on public.recurring_runs(contract_id);
create index if not exists recurring_runs_status_idx
  on public.recurring_runs(status)
  where status = 'PENDIENTE';
create index if not exists recurring_runs_run_date_idx
  on public.recurring_runs(run_date desc);

-- Idempotencia crítica: no doble-emisión por contrato+periodo
create unique index if not exists recurring_runs_unique_active
  on public.recurring_runs(contract_id, periodo)
  where status in ('OK','PENDIENTE');
```

---

## 7 · Sección 6: `customer_accounts`

```sql
create table if not exists public.customer_accounts (
  client_id uuid primary key references public.clients(id) on delete cascade,
  credit_limit numeric(15,2) not null default 0,
  default_payment_term_id uuid references public.payment_terms(id) on delete set null,
  default_late_fee_rate numeric(6,4),
  late_fee_grace_days smallint not null default 0,
  stop_billing boolean not null default false,
  last_invoice_at timestamptz,
  last_payment_at timestamptz,
  last_balance_calc_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create 1 row por cliente existente (idempotente)
insert into public.customer_accounts (client_id)
select id from public.clients
on conflict (client_id) do nothing;

-- Trigger para crear customer_accounts auto al insertar nuevo cliente
create or replace function public.tg_create_customer_account()
returns trigger language plpgsql security definer as $$
begin
  insert into public.customer_accounts (client_id) values (new.id)
  on conflict (client_id) do nothing;
  return new;
end;
$$;

drop trigger if exists clients_create_account on public.clients;
create trigger clients_create_account
  after insert on public.clients
  for each row execute function public.tg_create_customer_account();
```

---

## 8 · Sección 7: `customer_transactions`

```sql
create table if not exists public.customer_transactions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  type customer_transaction_t not null,
  direction direction_t not null,
  amount numeric(15,2) not null check (amount > 0),
  currency text not null default 'PES',
  cotizacion numeric(15,6) not null default 1,
  amount_pes numeric(15,2) generated always as (amount * cotizacion) stored,
  tx_date date not null default current_date,
  due_date date,
  period text,
  source_table text not null,
  source_id uuid,
  applies_to_tx_id uuid references public.customer_transactions(id) on delete set null,
  description text,
  posted boolean not null default true,
  voided boolean not null default false,
  voided_at timestamptz,
  voided_reason text,
  voided_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (source_table in ('customer_invoices','customer_payments','customer_late_fee_charges','manual')),
  check ((voided = true and voided_reason is not null) or voided = false)
);

create index if not exists customer_transactions_client_idx
  on public.customer_transactions(client_id);
create index if not exists customer_transactions_due_date_idx
  on public.customer_transactions(due_date)
  where direction = 'DEBIT' and voided = false;
create index if not exists customer_transactions_source_idx
  on public.customer_transactions(source_table, source_id);
create index if not exists customer_transactions_created_at_idx
  on public.customer_transactions(created_at desc);
create index if not exists customer_transactions_period_idx
  on public.customer_transactions(period)
  where period is not null;

-- UNIQUE para evitar doble-registro del mismo origen
create unique index if not exists customer_transactions_source_unique
  on public.customer_transactions(source_table, source_id, type)
  where source_id is not null and voided = false;

-- Trigger lock pattern (replica tg_lock_authorized_invoice)
create or replace function public.tg_lock_posted_transaction()
returns trigger language plpgsql as $$
begin
  if old.posted = true then
    if new.amount is distinct from old.amount
       or new.direction is distinct from old.direction
       or new.type is distinct from old.type
       or new.source_table is distinct from old.source_table
       or new.source_id is distinct from old.source_id
       or new.tx_date is distinct from old.tx_date
       or new.due_date is distinct from old.due_date
       or new.client_id is distinct from old.client_id then
      raise exception 'Transaction POSTED: no se pueden modificar campos económicos. Usá voided=true con voided_reason.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists customer_transactions_lock on public.customer_transactions;
create trigger customer_transactions_lock
  before update on public.customer_transactions
  for each row execute function public.tg_lock_posted_transaction();

-- Trigger update last_payment_at / last_invoice_at en customer_accounts
create or replace function public.tg_update_customer_account_timestamps()
returns trigger language plpgsql as $$
begin
  if new.type = 'INVOICE' and not new.voided then
    update public.customer_accounts
       set last_invoice_at = greatest(coalesce(last_invoice_at, new.tx_date::timestamptz), new.tx_date::timestamptz)
     where client_id = new.client_id;
  elsif new.type = 'PAYMENT' and not new.voided then
    update public.customer_accounts
       set last_payment_at = greatest(coalesce(last_payment_at, new.tx_date::timestamptz), new.tx_date::timestamptz)
     where client_id = new.client_id;
  end if;
  return new;
end;
$$;

drop trigger if exists customer_transactions_update_account on public.customer_transactions;
create trigger customer_transactions_update_account
  after insert on public.customer_transactions
  for each row execute function public.tg_update_customer_account_timestamps();
```

---

## 9 · Sección 8: `customer_payments` + `customer_payment_applications`

```sql
create table if not exists public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  payment_date date not null default current_date,
  amount numeric(15,2) not null check (amount > 0),
  currency text not null default 'PES',
  cotizacion numeric(15,6) not null default 1,
  amount_pes numeric(15,2) generated always as (amount * cotizacion) stored,
  method payment_method_t not null,
  reference text,
  bank text,
  receipt_path text,
  unapplied_amount numeric(15,2) not null default 0
    check (unapplied_amount >= 0),
  status payment_status_t not null default 'BORRADOR',
  tx_id uuid references public.customer_transactions(id) on delete set null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_payments_client_idx on public.customer_payments(client_id);
create index if not exists customer_payments_status_idx on public.customer_payments(status);
create index if not exists customer_payments_date_idx
  on public.customer_payments(payment_date desc);

-- Trigger lock CONFIRMADO
create or replace function public.tg_lock_confirmed_payment()
returns trigger language plpgsql as $$
begin
  if old.status = 'CONFIRMADO' then
    if new.amount is distinct from old.amount
       or new.method is distinct from old.method
       or new.reference is distinct from old.reference
       or new.currency is distinct from old.currency
       or new.client_id is distinct from old.client_id then
      raise exception 'Payment CONFIRMADO: no se pueden modificar datos económicos. Anulá y registrá uno nuevo.';
    end if;
    if new.status not in ('CONFIRMADO','ANULADO') then
      raise exception 'Payment CONFIRMADO solo puede pasar a ANULADO.';
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists customer_payments_lock on public.customer_payments;
create trigger customer_payments_lock
  before update on public.customer_payments
  for each row execute function public.tg_lock_confirmed_payment();


create table if not exists public.customer_payment_applications (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.customer_payments(id) on delete cascade,
  invoice_id uuid not null references public.customer_invoices(id) on delete restrict,
  applied_amount numeric(15,2) not null check (applied_amount > 0),
  applied_amount_pes numeric(15,2) generated always as (applied_amount * 1) stored,
  applied_at timestamptz not null default now(),
  notes text,
  unique (payment_id, invoice_id)
);

create index if not exists cpa_payment_idx on public.customer_payment_applications(payment_id);
create index if not exists cpa_invoice_idx on public.customer_payment_applications(invoice_id);

-- Validación trigger: suma applications <= payment.amount
create or replace function public.tg_validate_payment_application()
returns trigger language plpgsql as $$
declare
  total_applied numeric(15,2);
  payment_amount numeric(15,2);
begin
  select coalesce(sum(applied_amount), 0)
    into total_applied
    from public.customer_payment_applications
    where payment_id = new.payment_id;

  select amount
    into payment_amount
    from public.customer_payments
    where id = new.payment_id;

  if total_applied > payment_amount then
    raise exception 'Suma de aplicaciones (%) excede el monto del payment (%).',
      total_applied, payment_amount;
  end if;

  return new;
end;
$$;

drop trigger if exists cpa_validate on public.customer_payment_applications;
create trigger cpa_validate
  after insert or update on public.customer_payment_applications
  for each row execute function public.tg_validate_payment_application();
```

---

## 10 · Sección 9: `late_fee_rules` + `customer_late_fee_charges`

```sql
create table if not exists public.late_fee_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rate_monthly numeric(6,4) not null check (rate_monthly >= 0),
  compounding compounding_t not null default 'SIMPLE',
  grace_days smallint not null default 0,
  active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- Solo 1 regla puede ser default
create unique index if not exists late_fee_rules_unique_default
  on public.late_fee_rules((is_default))
  where is_default = true;

-- Seed default
insert into public.late_fee_rules (name, rate_monthly, compounding, grace_days, is_default)
values ('Mora estándar 3% mensual', 0.0300, 'SIMPLE', 0, true)
on conflict do nothing;

alter table public.late_fee_rules enable row level security;

drop policy if exists "late_fee_rules read all auth" on public.late_fee_rules;
create policy "late_fee_rules read all auth"
  on public.late_fee_rules for select
  using (auth.role() = 'authenticated');

drop policy if exists "late_fee_rules write admin" on public.late_fee_rules;
create policy "late_fee_rules write admin"
  on public.late_fee_rules for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');


create table if not exists public.customer_late_fee_charges (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  invoice_id uuid not null references public.customer_invoices(id) on delete cascade,
  rule_id uuid not null references public.late_fee_rules(id) on delete restrict,
  days_overdue int not null,
  principal numeric(15,2) not null,
  fee_amount numeric(15,2) not null,
  applied_at date not null default current_date,
  period text not null,
  tx_id uuid references public.customer_transactions(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  unique (invoice_id, period)
);

create index if not exists late_charges_invoice_idx
  on public.customer_late_fee_charges(invoice_id);
create index if not exists late_charges_client_idx
  on public.customer_late_fee_charges(client_id);
```

---

## 11 · Sección 10: View `customer_balances`

```sql
create or replace view public.customer_balances as
select
  ca.client_id,
  c.razon as client_name,
  ca.credit_limit,
  ca.stop_billing,

  coalesce(sum(case when t.direction='DEBIT'  and not t.voided then t.amount_pes else 0 end), 0)
    as total_debit_pes,
  coalesce(sum(case when t.direction='CREDIT' and not t.voided then t.amount_pes else 0 end), 0)
    as total_credit_pes,
  coalesce(sum(case when t.direction='DEBIT'  and not t.voided then  t.amount_pes
                    when t.direction='CREDIT' and not t.voided then -t.amount_pes
                    else 0 end), 0)
    as balance_pes,

  coalesce(sum(case when t.type='INVOICE' and not t.voided
                    and t.due_date is not null
                    and t.due_date < current_date
                    and t.due_date >= current_date - interval '30 days'
                    then t.amount_pes else 0 end), 0)
    as overdue_0_30_pes,
  coalesce(sum(case when t.type='INVOICE' and not t.voided
                    and t.due_date < current_date - interval '30 days'
                    and t.due_date >= current_date - interval '60 days'
                    then t.amount_pes else 0 end), 0)
    as overdue_30_60_pes,
  coalesce(sum(case when t.type='INVOICE' and not t.voided
                    and t.due_date < current_date - interval '60 days'
                    and t.due_date >= current_date - interval '90 days'
                    then t.amount_pes else 0 end), 0)
    as overdue_60_90_pes,
  coalesce(sum(case when t.type='INVOICE' and not t.voided
                    and t.due_date < current_date - interval '90 days'
                    then t.amount_pes else 0 end), 0)
    as overdue_90_plus_pes,

  max(t.tx_date) filter (where t.type='PAYMENT' and not t.voided) as last_payment_date,
  max(t.tx_date) filter (where t.type='INVOICE' and not t.voided) as last_invoice_date

from public.customer_accounts ca
join public.clients c on c.id = ca.client_id
left join public.customer_transactions t on t.client_id = ca.client_id
group by ca.client_id, c.razon, ca.credit_limit, ca.stop_billing;

-- Notify PostgREST schema
notify pgrst, 'reload schema';
```

---

## 12 · Sección 11: RBAC slugs nuevos

```sql
-- Catálogo: agregar permisos billing.*
insert into public.permissions (slug, module, action, label, description)
values
  ('billing.view',                'billing', 'view',   'Ver facturas + recurrentes + CC', null),
  ('billing.create',              'billing', 'create', 'Crear / editar / emitir facturas directas', null),
  ('billing.recurring.manage',    'billing', 'edit',   'Gestionar contratos recurrentes', null),
  ('billing.recurring.run',       'billing', 'create', 'Disparar runs manualmente', null),
  ('billing.payments.register',   'billing', 'create', 'Registrar cobros', null),
  ('billing.payments.apply',      'billing', 'edit',   'Aplicar cobros a facturas', null),
  ('billing.late_fees.manage',    'billing', 'edit',   'Configurar reglas de mora', null),
  ('billing.adjustments.create',  'billing', 'create', 'Crear ajustes manuales', null),
  ('billing.delete',              'billing', 'delete', 'Anular facturas/cobros', null)
on conflict (slug) do nothing;

-- Asignación a roles
-- (cada par role_slug ↔ permission_slug, idempotente vía conflict)
with role_map as (
  select id, slug from public.roles
),
perm_map as (
  select id, slug from public.permissions
)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from role_map r
cross join perm_map p
where (r.slug, p.slug) in (
  -- DIRECTOR: todos
  ('director', 'billing.view'),
  ('director', 'billing.create'),
  ('director', 'billing.recurring.manage'),
  ('director', 'billing.recurring.run'),
  ('director', 'billing.payments.register'),
  ('director', 'billing.payments.apply'),
  ('director', 'billing.late_fees.manage'),
  ('director', 'billing.adjustments.create'),
  ('director', 'billing.delete'),
  -- ADMINISTRACION: todos menos delete
  ('administracion', 'billing.view'),
  ('administracion', 'billing.create'),
  ('administracion', 'billing.recurring.manage'),
  ('administracion', 'billing.recurring.run'),
  ('administracion', 'billing.payments.register'),
  ('administracion', 'billing.payments.apply'),
  ('administracion', 'billing.late_fees.manage'),
  ('administracion', 'billing.adjustments.create'),
  -- OPERACIONES: view + register payments
  ('operaciones', 'billing.view'),
  ('operaciones', 'billing.payments.register'),
  -- COMERCIAL: solo view
  ('comercial', 'billing.view'),
  -- SUPERVISOR: view + recurring.manage
  ('supervisor', 'billing.view'),
  ('supervisor', 'billing.recurring.manage'),
  -- AUDITOR: solo view
  ('auditor', 'billing.view')
)
on conflict (role_id, permission_id) do nothing;
```

---

## 13 · Sección 12: RLS por tabla nueva

```sql
-- recurring_contracts
alter table public.recurring_contracts enable row level security;

drop policy if exists "recurring_contracts read" on public.recurring_contracts;
create policy "recurring_contracts read"
  on public.recurring_contracts for select
  using (
    public.current_role() in ('admin','operaciones','supervisor','auditor')
    or client_id = (select client_id from public.profiles where id = auth.uid())
  );

drop policy if exists "recurring_contracts write internal" on public.recurring_contracts;
create policy "recurring_contracts write internal"
  on public.recurring_contracts for all
  using (public.current_role() in ('admin','operaciones'))
  with check (public.current_role() in ('admin','operaciones'));

-- ... (igual para recurring_contract_lines, recurring_runs,
--      customer_accounts, customer_transactions, customer_payments,
--      customer_payment_applications, customer_late_fee_charges)
--
-- Ver FASE-1A-RLS.md para el detalle exacto de cada policy.
```

(El SQL completo de RLS se desarrolla en la sección equivalente de `FASE-1A-RLS.md` — acá solo va el esqueleto para no duplicar.)

---

## 14 · Sección 13: Storage buckets nuevos

```sql
insert into storage.buckets (id, name, public) values
  ('receipts', 'receipts', false),
  ('contracts', 'contracts', false)
on conflict (id) do nothing;

-- RLS por bucket (replicar pattern 0013, primer segmento del path = client_id)
drop policy if exists "receipts read scoped" on storage.objects;
create policy "receipts read scoped"
  on storage.objects for select
  using (
    bucket_id = 'receipts'
    and (
      public.current_role() in ('admin','operaciones','supervisor','auditor')
      or split_part(name,'/',1) = (
        select client_id::text from public.profiles where id = auth.uid()
      )
    )
  );

drop policy if exists "receipts write internal" on storage.objects;
create policy "receipts write internal"
  on storage.objects for insert, update
  using (bucket_id='receipts' and public.current_role() in ('admin','operaciones'))
  with check (bucket_id='receipts' and public.current_role() in ('admin','operaciones'));

drop policy if exists "receipts delete admin" on storage.objects;
create policy "receipts delete admin"
  on storage.objects for delete
  using (bucket_id='receipts' and public.current_role() = 'admin');

-- contracts: idem (lo mismo replicado con bucket_id='contracts')
```

---

## 15 · Sección 14: Publicaciones Realtime

```sql
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.customer_transactions;
    alter publication supabase_realtime add table public.recurring_runs;
    alter publication supabase_realtime add table public.customer_payments;
  end if;
exception when duplicate_object then null; end $$;
```

---

## 16 · Sección 15: Down-migration (comentada al final)

```sql
-- =========================================================================
-- DOWN MIGRATION (manual, comentada — descomentar y ejecutar en orden inverso
-- bajo riesgo. NO ejecutar automatic. Requiere backup previo.)
-- =========================================================================
-- begin;
--
-- -- 1. Remover publicaciones realtime
-- alter publication supabase_realtime drop table public.customer_payments;
-- alter publication supabase_realtime drop table public.recurring_runs;
-- alter publication supabase_realtime drop table public.customer_transactions;
--
-- -- 2. Storage policies + buckets
-- drop policy if exists "receipts read scoped" on storage.objects;
-- drop policy if exists "receipts write internal" on storage.objects;
-- drop policy if exists "receipts delete admin" on storage.objects;
-- drop policy if exists "contracts read scoped" on storage.objects;
-- drop policy if exists "contracts write internal" on storage.objects;
-- drop policy if exists "contracts delete admin" on storage.objects;
-- -- delete from storage.objects where bucket_id in ('receipts','contracts');  -- destructivo
-- delete from storage.buckets where id in ('receipts','contracts');
--
-- -- 3. RBAC role_permissions billing.*
-- delete from public.role_permissions where permission_id in (
--   select id from public.permissions where module='billing'
-- );
--
-- -- 4. RBAC permissions
-- delete from public.permissions where module='billing';
--
-- -- 5. View
-- drop view if exists public.customer_balances;
--
-- -- 6. Triggers
-- drop trigger if exists cpa_validate on public.customer_payment_applications;
-- drop trigger if exists customer_payments_lock on public.customer_payments;
-- drop trigger if exists customer_transactions_update_account on public.customer_transactions;
-- drop trigger if exists customer_transactions_lock on public.customer_transactions;
-- drop trigger if exists clients_create_account on public.clients;
--
-- -- 7. Funciones
-- drop function if exists public.tg_validate_payment_application();
-- drop function if exists public.tg_lock_confirmed_payment();
-- drop function if exists public.tg_update_customer_account_timestamps();
-- drop function if exists public.tg_lock_posted_transaction();
-- drop function if exists public.tg_create_customer_account();
--
-- -- 8. Tablas (orden inverso de FK)
-- drop table if exists public.customer_late_fee_charges;
-- drop table if exists public.late_fee_rules;
-- drop table if exists public.customer_payment_applications;
-- drop table if exists public.customer_payments;
-- drop table if exists public.customer_transactions;
-- drop table if exists public.customer_accounts;
-- drop table if exists public.recurring_runs;
-- drop table if exists public.recurring_contract_lines;
-- drop table if exists public.recurring_contracts;
-- drop table if exists public.payment_terms;
--
-- -- 9. Enums
-- drop type if exists compounding_t;
-- drop type if exists payment_status_t;
-- drop type if exists payment_method_t;
-- drop type if exists direction_t;
-- drop type if exists customer_transaction_t;
-- drop type if exists run_trigger_t;
-- drop type if exists recurring_run_status_t;
-- drop type if exists recurring_line_category_t;
-- drop type if exists recurring_contract_status_t;
-- drop type if exists recurring_freq_t;
--
-- commit;
```

---

## 17 · Footer

```sql
-- Notify PostgREST
notify pgrst, 'reload schema';

-- ✅ Fin de 0014_recurring_billing_and_customer_accounts.sql
```

---

## 18 · Pre-flight checklist antes de aplicar

| # | Check | Estado actual |
|---|-------|---------------|
| 1 | Backup externo Supabase verificado (RG5) | ❌ NO confirmado |
| 2 | `supabase migration list` muestra 0013 como último applied | ✅ asumido por memoria GATE 2 |
| 3 | `config.toml` local presente para CLI (PARIDAD-3 cierre) | ⚠️ parcial |
| 4 | RBAC seedeado (al menos director + admin asignados a usuarios reales) | ❌ user_roles dormida |
| 5 | Smoke tests de FASE-1A-RLS.md preparados | ⚠️ documentados, no ejecutados |
| 6 | Rama / branch dedicada (ej `feature/fase-1a-recurring-billing`) | ❌ trabajo vive en `feature/nexus-fullstack` |
| 7 | Plan de rollback validado en sandbox | ❌ |

**No avanzar a aplicar 0014 sin cerrar #1 (backup), #4 (RBAC seed), #7 (rollback sandbox).**

---

## Restricciones honradas

- 🛑 **NO ejecutar este SQL**
- 🛑 NO crear el archivo `0014_*.sql` en `supabase/migrations/` todavía
- 🛑 NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT
- 🛑 NO TOCAR producción
- 🛑 NO CARGAR credenciales
- 🛑 NO MODIFICAR migraciones existentes
- 🛑 Idempotencia obligatoria en cada `create` (FASE 0 governance)
- 🛑 Down-migration comentada (no destructiva por accidente)
