-- =========================================================================
-- 0026_inventory_movements.sql — FASE 8C (WMS Sprint 2): ledger de movimientos.
--
-- Libro de auditoría APPEND-ONLY de todo movimiento de stock: ingreso
-- (recepción), traslado (origen→destino), egreso (despacho, fase futura) y
-- ajuste. Cada fila guarda saldo antes/después para reconstruir la historia.
-- ADDITIVE ONLY. ⚠️ Requiere baseline 0020-0024 + 0025. NO aplicar. Sin seeds.
--
-- Inmutabilidad: garantizada por TRIGGER (bloquea UPDATE/DELETE/TRUNCATE para
-- TODOS los roles, incl. service_role) + RLS sin policies de update/delete.
-- Una corrección exige dropear el trigger (DDL auditable); el flujo normal usa
-- movimientos compensatorios. Modelo congelado en FASE 8B.
-- =========================================================================

create extension if not exists "pgcrypto";

-- ---- Enums --------------------------------------------------------------
do $$ begin
  create type movement_type_t as enum ('ingreso', 'traslado', 'egreso', 'ajuste');
exception when duplicate_object then null; end $$;

do $$ begin
  create type movement_reference_t as enum ('recepcion', 'movimiento', 'ajuste', 'despacho');
exception when duplicate_object then null; end $$;

-- ---- Ledger -------------------------------------------------------------
create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  movement_type movement_type_t not null,
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  lot_number text,
  quantity numeric(14,3) not null,             -- delta del movimiento
  before_quantity numeric(14,3) not null,      -- saldo del ítem ANTES
  after_quantity numeric(14,3) not null,       -- saldo del ítem DESPUÉS
  from_position_id uuid references public.warehouse_positions(id) on delete set null, -- null = externo
  to_position_id uuid references public.warehouse_positions(id) on delete set null,   -- null = externo
  reason text,                                 -- clasificación estructurada del motivo
  notes text,                                  -- explicación libre para auditoría operativa
  reference_type movement_reference_t,         -- recepcion | movimiento | ajuste | despacho
  reference_id uuid,                           -- referencia polimórfica (sin FK dura)
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists inventory_movements_item_idx on public.inventory_movements (inventory_item_id);
create index if not exists inventory_movements_created_idx on public.inventory_movements (created_at desc);
create index if not exists inventory_movements_ref_idx on public.inventory_movements (reference_type, reference_id);
create index if not exists inventory_movements_type_idx on public.inventory_movements (movement_type);

-- =========================================================================
-- INMUTABILIDAD — trigger que bloquea mutaciones para TODOS los roles
-- (incluido service_role, que bypasea RLS). Garantía dura de append-only.
-- =========================================================================
create or replace function public.prevent_inventory_movement_mutation()
returns trigger as $$
begin
  raise exception 'inventory_movements es un ledger append-only: % no está permitido', tg_op
    using errcode = 'restrict_violation';
end;
$$ language plpgsql;

drop trigger if exists trg_inventory_movements_immutable on public.inventory_movements;
create trigger trg_inventory_movements_immutable
  before update or delete on public.inventory_movements
  for each row execute function public.prevent_inventory_movement_mutation();

-- TRUNCATE saltea los triggers de fila → guard a nivel statement.
drop trigger if exists trg_inventory_movements_no_truncate on public.inventory_movements;
create trigger trg_inventory_movements_no_truncate
  before truncate on public.inventory_movements
  for each statement execute function public.prevent_inventory_movement_mutation();

-- =========================================================================
-- RLS — defensa en capas: lectura auth · inserción admin/operaciones/supervisor.
-- SIN policies de update/delete (el trigger es la garantía dura; esto bloquea
-- además a los roles normales en la primera barrera).
-- =========================================================================
alter table public.inventory_movements enable row level security;

drop policy if exists "inventory_movements read" on public.inventory_movements;
create policy "inventory_movements read" on public.inventory_movements for select
  using (auth.role() = 'authenticated');

drop policy if exists "inventory_movements insert" on public.inventory_movements;
create policy "inventory_movements insert" on public.inventory_movements for insert
  with check (public.current_role() in ('admin','operaciones','supervisor'));

notify pgrst, 'reload schema';
