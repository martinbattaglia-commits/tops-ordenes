-- =========================================================================
-- 0083_accounting_core.sql — Capa Contable · Núcleo (plan de cuentas, períodos,
--                            asientos por partida doble)
--
-- Convierte la capa fiscal/operativa existente (IVA Compras 0056-0059, IVA
-- Ventas 0072-0073, Tesorería 0053-0055) en una verdadera CONTABILIDAD: plan de
-- cuentas, períodos contables y libro diario por partida doble. El asiento es un
-- REFLEJO del documento (el subledger manda, el GL refleja): cada asiento
-- referencia su documento origen (source_type + source_id) y es trazable.
--
-- PRINCIPIOS (heredados de G10 / ERP-FINANCE-ARCHITECTURE.md):
--   · Partida doble: todo asiento POSTED balancea (Σ debe = Σ haber).
--   · Append-only: un asiento posteado no se edita; se REVIERTE (asiento inverso).
--   · Solo cuentas imputables (hoja) reciben líneas.
--   · Idempotencia: a lo sumo un asiento activo por (source_type, source_id).
--
-- NATURALEZA: ADITIVA. No modifica ninguna tabla fiscal ni de tesorería; solo
-- las referencia por dato (no por FK, para no acoplar la baja de documentos).
-- Requiere 0001-0081 aplicadas. El valor permission_module_t='contabilidad'
-- (0082) NO se usa acá (se usa en 0084).
-- =========================================================================

create extension if not exists "pgcrypto";

-- -------------------------------------------------------------------------
-- 1. Enums (tipos nuevos → uso en la misma migración es seguro)
-- -------------------------------------------------------------------------
do $$ begin
  create type public.account_type_t as enum (
    'activo',
    'pasivo',
    'patrimonio_neto',
    'ingreso',            -- resultado positivo
    'gasto',              -- resultado negativo (incluye costos)
    'orden'               -- cuentas de orden
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.accounting_period_status_t as enum ('open','closed','locked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.journal_entry_status_t as enum ('draft','posted','reversed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.journal_source_t as enum (
    'customer_invoice',   -- factura de venta (débito fiscal)
    'supplier_invoice',   -- factura de compra (crédito fiscal)
    'customer_receipt',   -- cobranza
    'supplier_payment',   -- pago a proveedor
    'manual',             -- asiento manual
    'adjustment',         -- ajuste / reclasificación
    'opening'             -- asiento de apertura
  );
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------------------
-- 2. chart_of_accounts — plan de cuentas (jerárquico, gestionable)
-- -------------------------------------------------------------------------
create table if not exists public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                 -- '1.1.03'
  name text not null,
  type public.account_type_t not null,
  subtype text,                              -- 'corriente'|'no_corriente'|'operativo'|...
  parent_id uuid references public.chart_of_accounts(id) on delete restrict,
  -- Solo las cuentas imputables (hoja) reciben líneas de asiento.
  is_postable boolean not null default true,
  is_active boolean not null default true,
  is_system boolean not null default false,  -- protege cuentas estructurales del seed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists coa_type_idx     on public.chart_of_accounts (type);
create index if not exists coa_parent_idx   on public.chart_of_accounts (parent_id);
create index if not exists coa_active_idx    on public.chart_of_accounts (is_active);

drop trigger if exists trg_coa_updated_at on public.chart_of_accounts;
create trigger trg_coa_updated_at
before update on public.chart_of_accounts
for each row execute function public.touch_updated_at();

-- -------------------------------------------------------------------------
-- 3. accounting_periods — períodos contables mensuales
-- -------------------------------------------------------------------------
create table if not exists public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  year  int not null,
  month int not null check (month between 1 and 12),
  start_date date not null,
  end_date   date not null,
  status public.accounting_period_status_t not null default 'open',
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (year, month)
);
create index if not exists ap_status_idx on public.accounting_periods (status);
create index if not exists ap_dates_idx  on public.accounting_periods (start_date, end_date);

-- -------------------------------------------------------------------------
-- 4. journal_entries — cabecera de asiento
-- -------------------------------------------------------------------------
create sequence if not exists public.journal_entry_number_seq start 1;

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_number bigint,                       -- correlativo; se asigna al postear
  entry_date date not null default current_date,
  period_id uuid references public.accounting_periods(id) on delete restrict,
  source_type public.journal_source_t not null,
  source_id uuid,                            -- documento origen (trazabilidad)
  description text,
  status public.journal_entry_status_t not null default 'draft',
  reversed_entry_id uuid references public.journal_entries(id) on delete restrict, -- si este asiento es la reversa de otro
  reversal_of_reason text,
  created_by uuid references auth.users(id) on delete set null,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists je_period_idx on public.journal_entries (period_id);
create index if not exists je_source_idx on public.journal_entries (source_type, source_id);
create index if not exists je_status_idx on public.journal_entries (status);
create index if not exists je_date_idx   on public.journal_entries (entry_date);
create index if not exists je_number_idx on public.journal_entries (entry_number);

-- Idempotencia: a lo sumo UN asiento activo (draft|posted) por documento origen,
-- excluyendo asientos de reversa (que comparten source_id pero llevan
-- reversed_entry_id). Evita doble contabilización (backfill re-ejecutable).
create unique index if not exists je_source_unique
  on public.journal_entries (source_type, source_id)
  where source_id is not null
    and status in ('draft','posted')
    and reversed_entry_id is null;

drop trigger if exists trg_je_updated_at on public.journal_entries;
create trigger trg_je_updated_at
before update on public.journal_entries
for each row execute function public.touch_updated_at();

-- -------------------------------------------------------------------------
-- 5. journal_entry_lines — líneas del asiento (debe / haber)
-- -------------------------------------------------------------------------
create table if not exists public.journal_entry_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
  account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
  description text,
  debit  numeric(15,2) not null default 0,
  credit numeric(15,2) not null default 0,
  currency text not null default 'ARS',
  exchange_rate numeric(15,6) not null default 1,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  line_no int not null default 0,
  created_at timestamptz not null default now(),
  -- Debe/haber no negativos y excluyentes (una línea es debe O haber).
  constraint jel_debit_credit_ck check (
    debit >= 0 and credit >= 0 and not (debit > 0 and credit > 0)
  )
);
create index if not exists jel_entry_idx   on public.journal_entry_lines (journal_entry_id);
create index if not exists jel_account_idx on public.journal_entry_lines (account_id);
create index if not exists jel_cc_idx      on public.journal_entry_lines (cost_center_id);

-- -------------------------------------------------------------------------
-- 6. Guards e invariantes
-- -------------------------------------------------------------------------

-- 6a. Una línea solo puede imputar a una cuenta imputable y activa.
create or replace function public.tg_jel_account_postable()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
declare v_postable boolean; v_active boolean; v_code text;
begin
  select is_postable, is_active, code into v_postable, v_active, v_code
  from public.chart_of_accounts where id = new.account_id;
  if v_postable is null then
    raise exception 'JEL_ACCOUNT_NOT_FOUND: cuenta % inexistente', new.account_id using errcode='check_violation';
  end if;
  if not v_postable then
    raise exception 'JEL_ACCOUNT_NOT_POSTABLE: la cuenta % (%) no es imputable', v_code, new.account_id using errcode='check_violation';
  end if;
  if not v_active then
    raise exception 'JEL_ACCOUNT_INACTIVE: la cuenta % (%) está inactiva', v_code, new.account_id using errcode='check_violation';
  end if;
  return new;
end; $$;

drop trigger if exists trg_jel_account_postable on public.journal_entry_lines;
create trigger trg_jel_account_postable
before insert or update on public.journal_entry_lines
for each row execute function public.tg_jel_account_postable();

-- 6b. Las líneas de un asiento POSTED son inmutables (append-only). Un asiento
--     posteado solo se corrige por reversa (asiento inverso).
create or replace function public.tg_jel_lock_posted()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
declare v_status public.journal_entry_status_t;
begin
  select status into v_status from public.journal_entries
  where id = coalesce(new.journal_entry_id, old.journal_entry_id);
  if v_status in ('posted','reversed','cancelled') then
    raise exception 'JEL_LOCKED: las líneas de un asiento % son inmutables (revertí el asiento)', v_status using errcode='check_violation';
  end if;
  return coalesce(new, old);
end; $$;

drop trigger if exists trg_jel_lock_posted on public.journal_entry_lines;
create trigger trg_jel_lock_posted
before insert or update or delete on public.journal_entry_lines
for each row execute function public.tg_jel_lock_posted();

-- 6c. Cabecera POSTED: solo transición a 'reversed' o 'cancelled' (datos
--     fiscales/contables inmutables). 'draft' es libremente editable.
create or replace function public.tg_je_lock_posted()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status = 'posted' then
    if new.status not in ('posted','reversed','cancelled') then
      raise exception 'JE_LOCKED: un asiento posteado solo puede pasar a reversed/cancelled' using errcode='check_violation';
    end if;
    if new.status = 'posted' and (
         new.entry_number is distinct from old.entry_number
      or new.entry_date  is distinct from old.entry_date
      or new.source_type is distinct from old.source_type
      or new.source_id   is distinct from old.source_id
      or new.period_id   is distinct from old.period_id
    ) then
      raise exception 'JE_LOCKED: no se pueden alterar datos de un asiento posteado' using errcode='check_violation';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists trg_je_lock_posted on public.journal_entries;
create trigger trg_je_lock_posted
before update on public.journal_entries
for each row execute function public.tg_je_lock_posted();

-- 6d. DELETE prohibido sobre cabecera (append-only; reutiliza el guard financiero 0053).
drop trigger if exists trg_je_no_delete on public.journal_entries;
create trigger trg_je_no_delete
before delete on public.journal_entries
for each row execute function public.tg_forbid_delete_financial();

-- 6e. Invariante de partida doble: todo asiento POSTED debe balancear y no caer
--     en período cerrado/bloqueado. Constraint trigger DIFERIDO: la RPC inserta
--     cabecera→líneas→post dentro de una transacción; el chequeo corre al commit.
create or replace function public.check_journal_entry_balanced()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_debit numeric; v_credit numeric; v_n int; v_pstatus public.accounting_period_status_t;
begin
  if new.status <> 'posted' then
    return null;
  end if;
  select coalesce(sum(debit),0), coalesce(sum(credit),0), count(*)
    into v_debit, v_credit, v_n
  from public.journal_entry_lines where journal_entry_id = new.id;

  if v_n = 0 then
    raise exception 'JE_NO_LINES: el asiento % no tiene líneas', new.id using errcode='check_violation';
  end if;
  if abs(v_debit - v_credit) > 0.00 then
    raise exception 'JE_UNBALANCED: asiento % descuadrado (debe=% / haber=%)', new.id, v_debit, v_credit using errcode='check_violation';
  end if;
  if new.period_id is not null then
    select status into v_pstatus from public.accounting_periods where id = new.period_id;
    if v_pstatus in ('closed','locked') then
      raise exception 'JE_PERIOD_CLOSED: el período del asiento % está % — no admite asientos', new.id, v_pstatus using errcode='check_violation';
    end if;
  end if;
  return null;
end; $$;

drop trigger if exists trg_je_balanced on public.journal_entries;
create constraint trigger trg_je_balanced
  after insert or update on public.journal_entries
  deferrable initially deferred
  for each row execute function public.check_journal_entry_balanced();

-- -------------------------------------------------------------------------
-- 7. Helpers (SECURITY DEFINER, search_path fijo)
-- -------------------------------------------------------------------------

-- Resuelve code → id (las RPC de posteo y los seeds referencian por código).
create or replace function public.acc_account_id(p_code text)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select id from public.chart_of_accounts where code = p_code;
$$;
revoke all on function public.acc_account_id(text) from public;
grant execute on function public.acc_account_id(text) to authenticated, service_role;

-- Garantiza la existencia del período contable de una fecha y devuelve su id.
-- Crea el período en estado 'open' si no existía. Idempotente.
create or replace function public.acc_ensure_period(p_date date)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_id uuid; v_y int; v_m int; v_start date; v_end date;
begin
  v_y := extract(year from p_date)::int;
  v_m := extract(month from p_date)::int;
  select id into v_id from public.accounting_periods where year = v_y and month = v_m;
  if v_id is not null then
    return v_id;
  end if;
  v_start := make_date(v_y, v_m, 1);
  v_end := (v_start + interval '1 month - 1 day')::date;
  insert into public.accounting_periods (year, month, start_date, end_date, status)
  values (v_y, v_m, v_start, v_end, 'open')
  on conflict (year, month) do nothing;
  select id into v_id from public.accounting_periods where year = v_y and month = v_m;
  return v_id;
end; $$;
revoke all on function public.acc_ensure_period(date) from public;
grant execute on function public.acc_ensure_period(date) to authenticated, service_role;

-- -------------------------------------------------------------------------
-- 8. RLS — lectura roles internos / has_permission('contabilidad.view');
--    escritura admin / has_permission('contabilidad.edit'). Los asientos y
--    líneas se escriben vía RPC SECURITY DEFINER (0085); las policies de
--    escritura cubren el ABM manual del plan de cuentas.
-- -------------------------------------------------------------------------
alter table public.chart_of_accounts   enable row level security;
alter table public.accounting_periods  enable row level security;
alter table public.journal_entries     enable row level security;
alter table public.journal_entry_lines enable row level security;

-- chart_of_accounts
drop policy if exists "coa read internal" on public.chart_of_accounts;
create policy "coa read internal" on public.chart_of_accounts for select
  using (public.current_role() in ('admin','operaciones','supervisor')
         or public.has_permission('contabilidad.view'));
drop policy if exists "coa write" on public.chart_of_accounts;
create policy "coa write" on public.chart_of_accounts for all
  using (public.current_role() = 'admin' or public.has_permission('contabilidad.edit'))
  with check (public.current_role() = 'admin' or public.has_permission('contabilidad.edit'));

-- accounting_periods
drop policy if exists "ap read internal" on public.accounting_periods;
create policy "ap read internal" on public.accounting_periods for select
  using (public.current_role() in ('admin','operaciones','supervisor')
         or public.has_permission('contabilidad.view'));
drop policy if exists "ap write" on public.accounting_periods;
create policy "ap write" on public.accounting_periods for all
  using (public.current_role() = 'admin' or public.has_permission('contabilidad.admin'))
  with check (public.current_role() = 'admin' or public.has_permission('contabilidad.admin'));

-- journal_entries
drop policy if exists "je read internal" on public.journal_entries;
create policy "je read internal" on public.journal_entries for select
  using (public.current_role() in ('admin','operaciones','supervisor')
         or public.has_permission('contabilidad.view'));
drop policy if exists "je write" on public.journal_entries;
create policy "je write" on public.journal_entries for all
  using (public.current_role() = 'admin' or public.has_permission('contabilidad.create'))
  with check (public.current_role() = 'admin' or public.has_permission('contabilidad.create'));

-- journal_entry_lines (siguen al asiento)
drop policy if exists "jel read internal" on public.journal_entry_lines;
create policy "jel read internal" on public.journal_entry_lines for select
  using (public.current_role() in ('admin','operaciones','supervisor')
         or public.has_permission('contabilidad.view'));
drop policy if exists "jel write" on public.journal_entry_lines;
create policy "jel write" on public.journal_entry_lines for all
  using (public.current_role() = 'admin' or public.has_permission('contabilidad.create'))
  with check (public.current_role() = 'admin' or public.has_permission('contabilidad.create'));

notify pgrst, 'reload schema';
