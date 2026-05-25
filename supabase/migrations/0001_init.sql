-- =========================================================================
-- TOPS Órdenes — schema inicial
-- Aplicar con: supabase db push  (o copiarlo al SQL Editor del proyecto)
-- =========================================================================

create extension if not exists "pgcrypto";

-- ---- Enums --------------------------------------------------------------
create type depot_t as enum ('MAGALDI', 'LUJAN');

create type order_status_t as enum (
  'BORRADOR',
  'PENDIENTE_FIRMA',
  'EN_CURSO',
  'FIRMADA',
  'FACTURADA',
  'OBSERVADA',
  'CANCELADA'
);

create type service_unit_t as enum ('hs','km','pal','mes','un');

create type user_role_t as enum ('admin','operaciones','supervisor','cliente');

-- ---- Profiles (linkeado a auth.users) -----------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  role user_role_t not null default 'operaciones',
  depot depot_t,
  client_id uuid,                   -- si es role=cliente, vincula al cliente
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---- Clients ------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  razon text not null,
  cuit text not null unique,
  domicilio text,
  telefono text,
  contacto text,
  email text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

-- ---- Operators (físicos en depósito) ------------------------------------
create table public.operators (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  role text,
  avatar text,
  depot depot_t,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---- Services catalog ---------------------------------------------------
create table public.services_catalog (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  unit service_unit_t not null,
  rate numeric(12,2) not null,
  icon text,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---- Orders -------------------------------------------------------------
create sequence if not exists public.orders_short_id_seq start 201600;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  short_id int not null default nextval('public.orders_short_id_seq'),
  public_id text not null unique,
  date timestamptz not null default now(),
  depot depot_t not null,
  status order_status_t not null default 'BORRADOR',
  client_id uuid not null references public.clients(id) on delete restrict,
  operator_id uuid references public.operators(id) on delete set null,
  h_start text,
  h_end text,
  hours int not null default 0,
  pallets int not null default 0,
  units int not null default 0,
  km int not null default 0,
  observ text,
  total numeric(14,2) not null default 0,
  signed_by text,
  signed_doc text,
  signed_at timestamptz,
  signature_url text,
  signature_hash text,
  pdf_url text,
  geo_lat double precision,
  geo_lng double precision,
  ip text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index orders_date_idx on public.orders (date desc);
create index orders_client_idx on public.orders (client_id);
create index orders_status_idx on public.orders (status);
create index orders_depot_idx on public.orders (depot);

-- Auto public_id en INSERT si no viene seteado
create or replace function public.set_public_id()
returns trigger as $$
begin
  if new.public_id is null or new.public_id = '' then
    new.public_id := 'OS-' || lpad(new.short_id::text, 6, '0');
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_set_public_id
before insert on public.orders
for each row execute function public.set_public_id();

-- ---- Order services -----------------------------------------------------
create table public.order_services (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  service_slug text not null,
  label text not null,
  qty numeric(10,2) not null,
  unit service_unit_t not null,
  rate numeric(12,2) not null,
  subtotal numeric(14,2) not null
);
create index order_services_order_idx on public.order_services(order_id);

-- ---- Email sends --------------------------------------------------------
create table public.email_sends (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  to_email text not null,
  tag text,
  status text not null default 'queued',  -- queued | sent | failed | opened
  provider_id text,
  error text,
  sent_at timestamptz default now()
);
create index email_sends_order_idx on public.email_sends(order_id);

-- ---- Audit log (append-only) --------------------------------------------
create table public.audit_log (
  id bigserial primary key,
  ts timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  entity text not null,
  entity_id uuid,
  action text not null,
  payload jsonb,
  ip text
);
create index audit_log_entity_idx on public.audit_log(entity, entity_id);

-- =========================================================================
-- RLS — Row Level Security
-- =========================================================================

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.operators enable row level security;
alter table public.services_catalog enable row level security;
alter table public.orders enable row level security;
alter table public.order_services enable row level security;
alter table public.email_sends enable row level security;
alter table public.audit_log enable row level security;

-- Helper: rol del usuario actual
create or replace function public.current_role()
returns user_role_t
language sql stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ---- Profiles ----
create policy "profiles self read"
  on public.profiles for select
  using (id = auth.uid() or public.current_role() in ('admin','supervisor'));

create policy "profiles admin write"
  on public.profiles for all
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- ---- Clients ----
create policy "clients read internal"
  on public.clients for select
  using (
    public.current_role() in ('admin','operaciones','supervisor')
    or id = (select client_id from public.profiles where id = auth.uid())
  );

create policy "clients write internal"
  on public.clients for all
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

-- ---- Operators / services_catalog (lectura amplia) ----
create policy "ops read all" on public.operators for select using (auth.role() = 'authenticated');
create policy "ops admin write" on public.operators for all
  using (public.current_role() in ('admin','supervisor'))
  with check (public.current_role() in ('admin','supervisor'));

create policy "catalog read all" on public.services_catalog for select using (auth.role() = 'authenticated');
create policy "catalog admin write" on public.services_catalog for all
  using (public.current_role() in ('admin','supervisor'))
  with check (public.current_role() in ('admin','supervisor'));

-- ---- Orders ----
-- Internos ven todo. Clientes ven sólo las suyas.
create policy "orders read"
  on public.orders for select
  using (
    public.current_role() in ('admin','operaciones','supervisor')
    or client_id = (select client_id from public.profiles where id = auth.uid())
  );

create policy "orders insert internal"
  on public.orders for insert
  with check (public.current_role() in ('admin','operaciones','supervisor'));

create policy "orders update internal"
  on public.orders for update
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

create policy "orders delete admin"
  on public.orders for delete
  using (public.current_role() = 'admin');

-- ---- Order services (sigue la regla de la order) ----
create policy "order_services read"
  on public.order_services for select
  using (exists (select 1 from public.orders o where o.id = order_id));
create policy "order_services write internal"
  on public.order_services for all
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

-- ---- email_sends / audit_log: solo lectura internos ----
create policy "email_sends read internal"
  on public.email_sends for select
  using (public.current_role() in ('admin','operaciones','supervisor'));
create policy "email_sends write internal"
  on public.email_sends for all
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

create policy "audit_log read admin"
  on public.audit_log for select
  using (public.current_role() in ('admin','supervisor'));
create policy "audit_log insert any auth"
  on public.audit_log for insert
  with check (auth.role() = 'authenticated');

-- =========================================================================
-- Trigger: bootstrap de profile al crear user
-- =========================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'operaciones')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
