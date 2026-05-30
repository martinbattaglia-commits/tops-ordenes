-- =========================================================================
-- TOPS Nexus — Fase 3 ERP: Facturas de proveedores (cuentas por pagar)
-- + Centros de costo.
--
-- Convive con el schema de OC (0008): una factura de proveedor se concilia
-- contra una OC y se imputa a un centro de costo. Es la base del núcleo
-- financiero que reemplaza a Neuralsoft (AP / cuentas por pagar).
-- =========================================================================

create extension if not exists "pgcrypto";

-- ---- Enums --------------------------------------------------------------
do $$ begin
  create type supplier_invoice_status_t as enum (
    'pendiente',   -- recibida, sin conciliar ni aprobar
    'conciliada',  -- matcheada contra una OC
    'aprobada',    -- aprobada para pago
    'pagada',      -- pagada al proveedor
    'anulada'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type supplier_comprobante_t as enum (
    'FACTURA_A','FACTURA_B','FACTURA_C',
    'NOTA_CREDITO_A','NOTA_CREDITO_B','NOTA_CREDITO_C',
    'NOTA_DEBITO_A','NOTA_DEBITO_B','NOTA_DEBITO_C',
    'RECIBO','OTRO'
  );
exception when duplicate_object then null; end $$;

-- ---- Centros de costo ---------------------------------------------------
create table if not exists public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  parent_id uuid references public.cost_centers(id) on delete set null,
  depot text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists cost_centers_code_idx on public.cost_centers (code);
create index if not exists cost_centers_parent_idx on public.cost_centers (parent_id);

-- ---- Facturas de proveedores (AP) --------------------------------------
create sequence if not exists public.supplier_invoice_short_id_seq start 1;

create table if not exists public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  short_id int not null default nextval('public.supplier_invoice_short_id_seq'),
  public_id text not null unique,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  tipo_comprobante supplier_comprobante_t not null default 'FACTURA_A',
  punto_venta int not null default 1,
  numero text not null,             -- nro del comprobante emitido por el proveedor
  cae text,
  fecha_emision date not null default current_date,
  fecha_vencimiento date,
  moneda text not null default 'ARS',
  neto numeric(14,2) not null default 0,
  iva numeric(14,2) not null default 0,
  percepciones numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  status supplier_invoice_status_t not null default 'pendiente',
  observ text,
  pdf_url text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  -- un proveedor no puede cargar dos veces el mismo comprobante
  unique (vendor_id, tipo_comprobante, punto_venta, numero)
);
create index if not exists si_vendor_idx on public.supplier_invoices (vendor_id);
create index if not exists si_status_idx on public.supplier_invoices (status);
create index if not exists si_fecha_idx on public.supplier_invoices (fecha_emision desc);
create index if not exists si_cc_idx on public.supplier_invoices (cost_center_id);
create index if not exists si_po_idx on public.supplier_invoices (purchase_order_id);

create or replace function public.set_supplier_invoice_public_id()
returns trigger as $$
declare yr text;
begin
  if new.public_id is null or new.public_id = '' then
    yr := to_char(coalesce(new.fecha_emision, current_date), 'YYYY');
    new.public_id := 'FP-' || yr || '-' || lpad(new.short_id::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_supplier_invoice_public_id on public.supplier_invoices;
create trigger trg_set_supplier_invoice_public_id
before insert on public.supplier_invoices
for each row execute function public.set_supplier_invoice_public_id();

-- =========================================================================
-- RLS — misma política que OC: lectura para autenticados, escritura interna.
-- =========================================================================
alter table public.cost_centers enable row level security;
alter table public.supplier_invoices enable row level security;

drop policy if exists "cost_centers read" on public.cost_centers;
create policy "cost_centers read"
  on public.cost_centers for select
  using (auth.role() = 'authenticated');

drop policy if exists "cost_centers write" on public.cost_centers;
create policy "cost_centers write"
  on public.cost_centers for all
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

drop policy if exists "supplier_invoices read" on public.supplier_invoices;
create policy "supplier_invoices read"
  on public.supplier_invoices for select
  using (auth.role() = 'authenticated');

drop policy if exists "supplier_invoices insert" on public.supplier_invoices;
create policy "supplier_invoices insert"
  on public.supplier_invoices for insert
  with check (public.current_role() in ('admin','operaciones','supervisor'));

drop policy if exists "supplier_invoices update" on public.supplier_invoices;
create policy "supplier_invoices update"
  on public.supplier_invoices for update
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));

drop policy if exists "supplier_invoices delete admin" on public.supplier_invoices;
create policy "supplier_invoices delete admin"
  on public.supplier_invoices for delete
  using (public.current_role() = 'admin');

-- =========================================================================
-- Seed mínimo de centros de costo (idempotente).
-- =========================================================================
insert into public.cost_centers (code, name, description) values
  ('CC-OPER',   'Operaciones',            'Costos operativos de depósito y logística'),
  ('CC-FLOTA',  'Flota & Transporte',     'Combustible, mantenimiento y seguros de flota'),
  ('CC-ADMIN',  'Administración',         'Gastos administrativos y de estructura'),
  ('CC-COMERC', 'Comercial',              'Marketing, ventas y comisiones'),
  ('CC-MANT',   'Mantenimiento & Infra',  'Mantenimiento edilicio e infraestructura')
on conflict (code) do nothing;
