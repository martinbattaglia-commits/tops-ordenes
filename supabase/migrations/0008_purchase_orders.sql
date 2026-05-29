-- =========================================================================
-- TOPS Órdenes de Compra (OC) — schema completo
-- Convive con el schema previo de Órdenes de Servicio (OS) — ambos viven
-- en el mismo proyecto. Las OC son el flujo "Compras a proveedores"
-- firmado por el Director de Operaciones.
-- =========================================================================

create extension if not exists "pgcrypto";

-- ---- Enums OC -----------------------------------------------------------
do $$ begin
  create type po_status_t as enum (
    'borrador',
    'pendiente',
    'firmada',
    'enviada',
    'recibida_parcial',
    'conciliada',
    'facturada',
    'anulada'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type po_event_kind_t as enum (
    'created',
    'updated',
    'signed',
    'sent_email',
    'received',
    'reconciled',
    'invoiced',
    'cancelled',
    'drive_synced'
  );
exception when duplicate_object then null; end $$;

-- ---- Vendors (proveedores) ---------------------------------------------
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  razon text not null,
  cuit text not null,
  domicilio text,
  telefono text,
  contacto text,
  email text,
  categoria text,
  cond_pago text default '30 días',
  tags text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (cuit)
);

create index if not exists vendors_razon_idx on public.vendors (razon);
create index if not exists vendors_cat_idx on public.vendors (categoria);

-- ---- Products catalog ---------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  label text not null,
  unit text not null default 'un',
  price numeric(14,2) not null default 0,
  vendor_id uuid references public.vendors(id) on delete set null,
  categoria text,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists products_label_idx on public.products (label);
create index if not exists products_vendor_idx on public.products (vendor_id);

-- ---- Purchase orders ----------------------------------------------------
create sequence if not exists public.po_short_id_seq start 348;

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  short_id int not null default nextval('public.po_short_id_seq'),
  public_id text not null unique,
  date timestamptz not null default now(),
  depot depot_t not null default 'MAGALDI',
  destino text,
  entrega text default 'Inmediata',
  categoria text,
  cond_pago text default '30 días',
  status po_status_t not null default 'borrador',
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  emisor_name text not null default 'José Luis Battaglia',
  emisor_email text not null default 'joseluis@logisticatops.com',
  emisor_role text not null default 'Director de Operaciones',
  observ text,
  neto numeric(14,2) not null default 0,
  iva numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  signed_by text,
  signed_at timestamptz,
  signature_url text,
  signature_hash text,
  integrity_hash text,
  pdf_url text,
  drive_folder text,
  drive_file_id text,
  factura_id text,
  recibido_por text,
  recibido_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists po_date_idx on public.purchase_orders (date desc);
create index if not exists po_vendor_idx on public.purchase_orders (vendor_id);
create index if not exists po_status_idx on public.purchase_orders (status);

create or replace function public.set_po_public_id()
returns trigger as $$
declare yr text;
begin
  if new.public_id is null or new.public_id = '' then
    yr := to_char(coalesce(new.date, now()), 'YYYY');
    new.public_id := 'OC-' || yr || '-' || lpad(new.short_id::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_po_public_id on public.purchase_orders;
create trigger trg_set_po_public_id
before insert on public.purchase_orders
for each row execute function public.set_po_public_id();

-- ---- PO items -----------------------------------------------------------
create table if not exists public.po_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  sku text,
  label text not null,
  unit text not null default 'un',
  qty numeric(12,2) not null,
  price numeric(14,2) not null,
  subtotal numeric(14,2) not null,
  pos int not null default 0
);
create index if not exists po_items_order_idx on public.po_items(order_id);

-- ---- PO events (trazabilidad append-only) -------------------------------
create table if not exists public.po_events (
  id bigserial primary key,
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  ts timestamptz not null default now(),
  kind po_event_kind_t not null,
  actor text,
  actor_email text,
  ip text,
  meta jsonb default '{}'::jsonb
);
create index if not exists po_events_order_idx on public.po_events(order_id);

-- ---- Email envíos por OC -----------------------------------------------
create table if not exists public.po_email_sends (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  to_email text not null,
  tag text,
  status text not null default 'queued',
  provider_id text,
  error text,
  sent_at timestamptz default now(),
  opened_at timestamptz
);
create index if not exists po_email_order_idx on public.po_email_sends(order_id);

-- =========================================================================
-- RLS — Row Level Security
-- =========================================================================
alter table public.vendors enable row level security;
alter table public.products enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.po_items enable row level security;
alter table public.po_events enable row level security;
alter table public.po_email_sends enable row level security;

-- Vendors: lectura para autenticados, escritura para internos
drop policy if exists "vendors read" on public.vendors;
create policy "vendors read"
  on public.vendors for select
  using (auth.role() = 'authenticated');

drop policy if exists "vendors write" on public.vendors;
create policy "vendors write"
  on public.vendors for all
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

-- Products: similar
drop policy if exists "products read" on public.products;
create policy "products read"
  on public.products for select
  using (auth.role() = 'authenticated');

drop policy if exists "products write" on public.products;
create policy "products write"
  on public.products for all
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

-- Purchase orders: internos ven todo
drop policy if exists "po read" on public.purchase_orders;
create policy "po read"
  on public.purchase_orders for select
  using (auth.role() = 'authenticated');

drop policy if exists "po insert" on public.purchase_orders;
create policy "po insert"
  on public.purchase_orders for insert
  with check (public.current_role() in ('admin','operaciones','supervisor'));

drop policy if exists "po update" on public.purchase_orders;
create policy "po update"
  on public.purchase_orders for update
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

drop policy if exists "po delete admin" on public.purchase_orders;
create policy "po delete admin"
  on public.purchase_orders for delete
  using (public.current_role() = 'admin');

-- PO items: hereda
drop policy if exists "po_items read" on public.po_items;
create policy "po_items read"
  on public.po_items for select
  using (auth.role() = 'authenticated');

drop policy if exists "po_items write" on public.po_items;
create policy "po_items write"
  on public.po_items for all
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

-- PO events: append-only para auth, lectura internos
drop policy if exists "po_events read" on public.po_events;
create policy "po_events read"
  on public.po_events for select
  using (public.current_role() in ('admin','operaciones','supervisor'));

drop policy if exists "po_events insert" on public.po_events;
create policy "po_events insert"
  on public.po_events for insert
  with check (auth.role() = 'authenticated');

-- Email envíos: internos
drop policy if exists "po_email read" on public.po_email_sends;
create policy "po_email read"
  on public.po_email_sends for select
  using (public.current_role() in ('admin','operaciones','supervisor'));

drop policy if exists "po_email write" on public.po_email_sends;
create policy "po_email write"
  on public.po_email_sends for all
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

-- =========================================================================
-- Storage bucket para firmas y PDFs de OC
-- =========================================================================
insert into storage.buckets (id, name, public)
values ('po-pdfs', 'po-pdfs', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('po-signatures', 'po-signatures', false)
on conflict (id) do nothing;

drop policy if exists "po-pdfs public read" on storage.objects;
create policy "po-pdfs public read"
  on storage.objects for select
  using (bucket_id = 'po-pdfs');

drop policy if exists "po-pdfs internal write" on storage.objects;
create policy "po-pdfs internal write"
  on storage.objects for all
  using (
    bucket_id = 'po-pdfs'
    and auth.role() = 'authenticated'
    and public.current_role() in ('admin','operaciones','supervisor')
  )
  with check (
    bucket_id = 'po-pdfs'
    and auth.role() = 'authenticated'
    and public.current_role() in ('admin','operaciones','supervisor')
  );

drop policy if exists "po-signatures internal" on storage.objects;
create policy "po-signatures internal"
  on storage.objects for all
  using (
    bucket_id = 'po-signatures'
    and auth.role() = 'authenticated'
    and public.current_role() in ('admin','operaciones','supervisor')
  )
  with check (
    bucket_id = 'po-signatures'
    and auth.role() = 'authenticated'
    and public.current_role() in ('admin','operaciones','supervisor')
  );

-- =========================================================================
-- Vista materializable de stats por proveedor (refrescada vía cron / on-demand)
-- =========================================================================
create or replace view public.vendor_stats as
select
  v.id as vendor_id,
  v.razon,
  count(po.id) filter (where po.status not in ('borrador','anulada')) as oc_count,
  sum(po.total) filter (where po.status not in ('borrador','anulada')
                              and date_part('year', po.date) = date_part('year', now())) as ytd_spend,
  max(po.date) filter (where po.status not in ('borrador','anulada')) as last_oc_at
from public.vendors v
left join public.purchase_orders po on po.vendor_id = v.id
group by v.id, v.razon;

-- =========================================================================
-- Seed mínimo: el emisor JL ya tiene un perfil
-- =========================================================================
-- (los proveedores y productos los seedea la app desde data/seed-vendors.ts
--  al primer arranque, si el dueño así lo pide)
