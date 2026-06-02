-- =========================================================================
-- 0024_wms_inventory.sql — FASE 5 (WMS Sprint 1): capa de inventario.
--
-- Inventario de terceros: ítems de stock por SKU + cliente + ubicación física,
-- y sus lotes (trazabilidad / vencimiento ANMAT). La ubicación física apunta a
-- warehouse_positions (clave de integración con el Digital Twin).
-- ADDITIVE ONLY. ⚠️ Requiere 0020 aplicada (warehouse_positions).
--
-- Sin seeds. Sin datos demo. No modifica tablas existentes.
-- =========================================================================

create extension if not exists "pgcrypto";

-- ---- Ítems de inventario ------------------------------------------------
create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  description text not null,
  client_name text not null,                 -- depositante / cliente propietario
  position_id uuid references public.warehouse_positions(id) on delete set null,  -- ubicación física
  stock_available numeric(14,3) not null default 0,
  stock_reserved numeric(14,3) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists inventory_items_sku_idx on public.inventory_items (sku);
create index if not exists inventory_items_position_idx on public.inventory_items (position_id);

-- ---- Lotes (trazabilidad / vencimiento ANMAT) ---------------------------
create table if not exists public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  lot_number text not null,
  expiration_date date,
  quantity numeric(14,3) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists inventory_lots_item_idx on public.inventory_lots (inventory_item_id);
create index if not exists inventory_lots_lot_number_idx on public.inventory_lots (lot_number);
create index if not exists inventory_lots_expiration_idx on public.inventory_lots (expiration_date);

-- =========================================================================
-- RLS — lectura para autenticados, escritura admin/operaciones/supervisor,
-- delete sólo admin.
-- =========================================================================
alter table public.inventory_items enable row level security;
alter table public.inventory_lots  enable row level security;

-- inventory_items
drop policy if exists "inventory_items read" on public.inventory_items;
create policy "inventory_items read" on public.inventory_items for select
  using (auth.role() = 'authenticated');
drop policy if exists "inventory_items insert" on public.inventory_items;
create policy "inventory_items insert" on public.inventory_items for insert
  with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "inventory_items update" on public.inventory_items;
create policy "inventory_items update" on public.inventory_items for update
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "inventory_items delete admin" on public.inventory_items;
create policy "inventory_items delete admin" on public.inventory_items for delete
  using (public.current_role() = 'admin');

-- inventory_lots
drop policy if exists "inventory_lots read" on public.inventory_lots;
create policy "inventory_lots read" on public.inventory_lots for select
  using (auth.role() = 'authenticated');
drop policy if exists "inventory_lots insert" on public.inventory_lots;
create policy "inventory_lots insert" on public.inventory_lots for insert
  with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "inventory_lots update" on public.inventory_lots;
create policy "inventory_lots update" on public.inventory_lots for update
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "inventory_lots delete admin" on public.inventory_lots;
create policy "inventory_lots delete admin" on public.inventory_lots for delete
  using (public.current_role() = 'admin');

notify pgrst, 'reload schema';
