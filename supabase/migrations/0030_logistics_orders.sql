-- =========================================================================
-- 0030_logistics_orders.sql — FASE 9B (Gate 1): capa de datos de Pedidos.
--
-- Pedidos Logísticos (operación 3PL del cliente) + RESERVA de stock vía
-- stock_allocations (ledger de reservas INDEPENDIENTE). El stock_reserved del
-- ítem se compartirá con la cuarentena; stock_allocations es la fuente de verdad
-- de QUÉ reserva pertenece a QUÉ pedido. Invariante (se hará cumplir en las RPC
-- de Gate 2 / 0031):
--     stock_reserved(ítem) = Σ stock_allocations activas + reservado_por_cuarentena
--
-- ⚠️ Requiere 0024 (inventory_items) y 0029 (enum 'pedidos') APLICADAS Y
--    COMMITEADAS. ADDITIVE ONLY: NO altera inventory_items / receptions /
--    inventory_movements ni ninguna tabla existente.
--
-- GATE 1 = SOLO ESQUEMA. NO incluye RPC (allocate_order / release_allocation /
-- cancel_order) ni motor FEFO ni UI → eso es Gate 2 (0031). Las policies de
-- escritura de stock_allocations son PROVISIONALES y se reemplazarán por
-- lockdown "solo-RPC" en 0031 (igual que inventory_movements en 0026→0027).
-- =========================================================================

create extension if not exists "pgcrypto";

-- ---- Enums (CREATE TYPE nuevo → seguro en esta migración) ----------------
do $$ begin
  create type logistics_order_status_t as enum (
    'borrador', 'pendiente', 'en_preparacion', 'preparado',
    'despachado', 'entregado', 'cancelado'
  );
exception when duplicate_object then null; end $$;

-- 'reservado_parcial' = la línea no se cubrió 100% (reserva parcial habilitada).
-- Estados pickeado/empacado/despachado los consumen 9C/9D (declarados ya para
-- congelar el dominio).
do $$ begin
  create type order_item_status_t as enum (
    'pendiente', 'reservado', 'reservado_parcial',
    'pickeado', 'empacado', 'despachado', 'cancelado'
  );
exception when duplicate_object then null; end $$;

-- Ciclo de vida de una reserva. 9B usa 'reservada' / 'liberada'.
do $$ begin
  create type alloc_status_t as enum (
    'reservada', 'pickeada', 'empacada', 'despachada', 'liberada'
  );
exception when duplicate_object then null; end $$;

-- =========================================================================
-- Pedidos (cabecera) — patrón receptions (short_id + public_id por trigger)
-- =========================================================================
create sequence if not exists public.logistics_order_short_id_seq start 1;

create table if not exists public.logistics_orders (
  id uuid primary key default gen_random_uuid(),
  short_id int not null default nextval('public.logistics_order_short_id_seq'),
  public_id text not null unique,                  -- 'PED-2026-0001'
  client_name text not null,                       -- depositante (TEXT, consistencia WMS)
  customer_ref text,                               -- n° de pedido del cliente
  status logistics_order_status_t not null default 'borrador',
  priority int not null default 0,                 -- orden de atención (mayor = antes)
  requested_date date,                             -- fecha solicitada de preparación
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists logistics_orders_client_idx  on public.logistics_orders (client_name);
create index if not exists logistics_orders_status_idx  on public.logistics_orders (status);
create index if not exists logistics_orders_created_idx on public.logistics_orders (created_at desc);

create or replace function public.set_logistics_order_public_id()
returns trigger as $$
declare yr text;
begin
  if new.public_id is null or new.public_id = '' then
    yr := to_char(coalesce(new.created_at, now()), 'YYYY');
    new.public_id := 'PED-' || yr || '-' || lpad(new.short_id::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_logistics_order_public_id on public.logistics_orders;
create trigger trg_set_logistics_order_public_id
  before insert on public.logistics_orders
  for each row execute function public.set_logistics_order_public_id();

-- =========================================================================
-- Líneas del pedido
-- =========================================================================
create table if not exists public.logistics_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.logistics_orders(id) on delete cascade,
  sku text not null,
  description text not null,
  quantity_requested numeric(14,3) not null,
  lot_constraint text,                             -- lote/vencimiento exigido (opcional)
  status order_item_status_t not null default 'pendiente',
  created_at timestamptz not null default now(),
  constraint logistics_order_items_qty_chk check (quantity_requested > 0)
);
create index if not exists logistics_order_items_order_idx on public.logistics_order_items (order_id);
create index if not exists logistics_order_items_sku_idx   on public.logistics_order_items (sku);
-- quantity_allocated / picked / packed se DERIVAN de stock_allocations (no se persisten).

-- =========================================================================
-- Reservas (ledger INDEPENDIENTE · bridge a inventario)
-- =========================================================================
create table if not exists public.stock_allocations (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.logistics_order_items(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  lot_number text,                                 -- lote reservado (trazabilidad FEFO)
  quantity numeric(14,3) not null,
  status alloc_status_t not null default 'reservada',
  reserved_at timestamptz not null default now(),  -- trazabilidad: cuándo se reservó
  released_at timestamptz,                          -- cuándo se liberó (null = vigente)
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint stock_allocations_qty_chk check (quantity > 0)
);
create index if not exists stock_allocations_order_item_idx on public.stock_allocations (order_item_id);
create index if not exists stock_allocations_inv_item_idx   on public.stock_allocations (inventory_item_id);
create index if not exists stock_allocations_status_idx     on public.stock_allocations (status);

-- =========================================================================
-- RLS — lectura authenticated · escritura admin/operaciones/supervisor ·
-- delete admin (mismo patrón que receptions / inventory).
-- ⚠️ stock_allocations: estas policies de escritura son PROVISIONALES; 0031
--    las reemplazará por lockdown "solo-RPC" (allocate/release/cancel).
-- =========================================================================
alter table public.logistics_orders       enable row level security;
alter table public.logistics_order_items  enable row level security;
alter table public.stock_allocations       enable row level security;

-- logistics_orders
drop policy if exists "logistics_orders read" on public.logistics_orders;
create policy "logistics_orders read" on public.logistics_orders for select
  using (auth.role() = 'authenticated');
drop policy if exists "logistics_orders insert" on public.logistics_orders;
create policy "logistics_orders insert" on public.logistics_orders for insert
  with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "logistics_orders update" on public.logistics_orders;
create policy "logistics_orders update" on public.logistics_orders for update
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "logistics_orders delete admin" on public.logistics_orders;
create policy "logistics_orders delete admin" on public.logistics_orders for delete
  using (public.current_role() = 'admin');

-- logistics_order_items
drop policy if exists "logistics_order_items read" on public.logistics_order_items;
create policy "logistics_order_items read" on public.logistics_order_items for select
  using (auth.role() = 'authenticated');
drop policy if exists "logistics_order_items insert" on public.logistics_order_items;
create policy "logistics_order_items insert" on public.logistics_order_items for insert
  with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "logistics_order_items update" on public.logistics_order_items;
create policy "logistics_order_items update" on public.logistics_order_items for update
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "logistics_order_items delete admin" on public.logistics_order_items;
create policy "logistics_order_items delete admin" on public.logistics_order_items for delete
  using (public.current_role() = 'admin');

-- stock_allocations (PROVISIONAL → lockdown solo-RPC en 0031)
drop policy if exists "stock_allocations read" on public.stock_allocations;
create policy "stock_allocations read" on public.stock_allocations for select
  using (auth.role() = 'authenticated');
drop policy if exists "stock_allocations insert" on public.stock_allocations;
create policy "stock_allocations insert" on public.stock_allocations for insert
  with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "stock_allocations update" on public.stock_allocations;
create policy "stock_allocations update" on public.stock_allocations for update
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "stock_allocations delete admin" on public.stock_allocations;
create policy "stock_allocations delete admin" on public.stock_allocations for delete
  using (public.current_role() = 'admin');

-- =========================================================================
-- Seed RBAC del módulo 'pedidos' (patrón 0022 wms). Requiere 0029 commiteada.
-- Idempotente. action ∈ permission_action_t. unique(module, action) → 1 por acción.
-- =========================================================================
insert into public.permissions (slug, module, action, label, description) values
  ('pedidos.view',  'pedidos', 'view',  'Ver Pedidos Logísticos', 'Acceso al tablero de pedidos y su trazabilidad'),
  ('pedidos.edit',  'pedidos', 'edit',  'Operar Pedidos',         'Crear pedidos, reservar stock, picking/packing/despacho'),
  ('pedidos.admin', 'pedidos', 'admin', 'Administrar Pedidos',    'Configuración del módulo de pedidos')
on conflict (slug) do nothing;

-- Director de Operaciones: acceso total al módulo.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'director_ops' and p.module = 'pedidos'
on conflict do nothing;

-- Administración: ver + operar.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'admin' and p.slug in ('pedidos.view', 'pedidos.edit')
on conflict do nothing;

-- Operaciones (depósito): ver + operar.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'operaciones' and p.slug in ('pedidos.view', 'pedidos.edit')
on conflict do nothing;

-- Supervisor: ver + operar (alineado con las RLS, que ya incluyen 'supervisor').
-- ⚠️ NOTA: el rol 'supervisor' NO está sembrado en public.roles (0009 sembró
-- director_ops/admin/operaciones/compliance). Este INSERT es idempotente y queda
-- listo para cuando exista ese rol; mientras tanto es no-op. El acceso EFECTIVO
-- de supervisor ya está garantizado por las policies RLS de arriba.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'supervisor' and p.slug in ('pedidos.view', 'pedidos.edit')
on conflict do nothing;

-- Compliance / DT: solo lectura.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r, public.permissions p
where r.slug = 'compliance' and p.slug in ('pedidos.view')
on conflict do nothing;

notify pgrst, 'reload schema';
