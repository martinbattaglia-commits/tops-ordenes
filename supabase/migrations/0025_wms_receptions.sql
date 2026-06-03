-- =========================================================================
-- 0025_wms_receptions.sql — FASE 8C (WMS Sprint 2): Recepciones.
--
-- Ingreso de mercadería de terceros: cabecera (receptions) + líneas
-- (reception_items). Al confirmar una recepción, la lógica de aplicación
-- escribe inventory_items / inventory_lots y registra el movimiento INGRESO en
-- inventory_movements (0026). ADDITIVE ONLY: no altera tablas existentes.
--
-- ⚠️ Requiere baseline 0020-0024 (inventory_items, warehouse_positions). NO aplicar.
-- Sin seeds. Modelo congelado en FASE 8B.
-- =========================================================================

create extension if not exists "pgcrypto";

-- ---- Enums --------------------------------------------------------------
-- business_unit_t: compartido con el futuro 0027_facility_spaces (Twin v2).
-- Create idempotente → quien corra primero lo crea, el otro no falla.
do $$ begin
  create type business_unit_t as enum ('ANMAT', 'GENERAL', 'CORPORATE');
exception when duplicate_object then null; end $$;

-- 'parcial' NO se persiste: es estado DERIVADO (items recibidos vs esperados).
-- Mientras quedan items pendientes, la recepción está 'en_recepcion'.
do $$ begin
  create type reception_status_t as enum (
    'borrador', 'pendiente', 'en_recepcion', 'cuarentena', 'recibida', 'anulada'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type reception_item_status_t as enum ('pendiente', 'recibido', 'cuarentena');
exception when duplicate_object then null; end $$;

-- ---- Recepciones (cabecera) ---------------------------------------------
create sequence if not exists public.reception_short_id_seq start 1;

create table if not exists public.receptions (
  id uuid primary key default gen_random_uuid(),
  short_id int not null default nextval('public.reception_short_id_seq'),
  public_id text not null unique,                  -- 'REC-2026-0001'
  client_name text not null,                       -- depositante
  business_unit business_unit_t not null default 'GENERAL',  -- única dimensión regulatoria
  status reception_status_t not null default 'borrador',
  numero_oc text,
  numero_remito text,
  transportista text,
  patente text,
  chofer text,
  requires_quarantine boolean not null default false,  -- decisión operativa (NO por BU)
  received_at timestamptz,                          -- se setea al confirmar
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists receptions_client_idx on public.receptions (client_name);
create index if not exists receptions_status_idx on public.receptions (status);
create index if not exists receptions_bu_idx on public.receptions (business_unit);
create index if not exists receptions_created_idx on public.receptions (created_at desc);

create or replace function public.set_reception_public_id()
returns trigger as $$
declare yr text;
begin
  if new.public_id is null or new.public_id = '' then
    yr := to_char(coalesce(new.created_at, now()), 'YYYY');
    new.public_id := 'REC-' || yr || '-' || lpad(new.short_id::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_reception_public_id on public.receptions;
create trigger trg_set_reception_public_id
  before insert on public.receptions
  for each row execute function public.set_reception_public_id();

-- ---- Líneas de recepción ------------------------------------------------
-- Enforcement ANMAT (invariante #5) a nivel BASE DE DATOS, no app:
--   · business_unit se DENORMALIZA desde la cabecera (trigger de sync abajo).
--   · CHECK declarativo: si business_unit='ANMAT' ⇒ lot_number + expiration_date
--     obligatorios. Inviolable por cualquier rol (incl. service_role).
create table if not exists public.reception_items (
  id uuid primary key default gen_random_uuid(),
  reception_id uuid not null references public.receptions(id) on delete cascade,
  business_unit business_unit_t not null,          -- heredado de la cabecera (trigger)
  sku text not null,
  description text not null,
  lot_number text,
  expiration_date date,
  quantity numeric(14,3) not null,
  position_id uuid references public.warehouse_positions(id) on delete set null,  -- destino
  status reception_item_status_t not null default 'pendiente',
  inventory_item_id uuid references public.inventory_items(id) on delete set null, -- vínculo al confirmar
  created_at timestamptz not null default now(),
  constraint reception_items_anmat_lot_chk check (
    business_unit <> 'ANMAT'
    or (lot_number is not null and expiration_date is not null)
  )
);
create index if not exists reception_items_reception_idx on public.reception_items (reception_id);
create index if not exists reception_items_sku_idx on public.reception_items (sku);
create index if not exists reception_items_position_idx on public.reception_items (position_id);
create index if not exists reception_items_bu_idx on public.reception_items (business_unit);

-- ---- Enforcement ANMAT: sync de business_unit + cascada -----------------
-- (1) BEFORE INSERT/UPDATE en reception_items: hereda el BU de la cabecera.
create or replace function public.sync_reception_item_business_unit()
returns trigger as $$
begin
  select r.business_unit into new.business_unit
  from public.receptions r where r.id = new.reception_id;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_reception_item_bu on public.reception_items;
create trigger trg_reception_item_bu
  before insert or update of reception_id on public.reception_items
  for each row execute function public.sync_reception_item_business_unit();

-- (2) AFTER UPDATE del BU en la cabecera: re-sincroniza los items → el CHECK
--     se re-evalúa y bloquea si algún item ANMAT quedó sin lote/vencimiento.
create or replace function public.cascade_reception_business_unit()
returns trigger as $$
begin
  if new.business_unit is distinct from old.business_unit then
    update public.reception_items set business_unit = new.business_unit
    where reception_id = new.id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_reception_cascade_bu on public.receptions;
create trigger trg_reception_cascade_bu
  after update of business_unit on public.receptions
  for each row execute function public.cascade_reception_business_unit();

-- =========================================================================
-- RLS — lectura auth · insert/update admin/operaciones/supervisor · delete admin.
-- =========================================================================
alter table public.receptions enable row level security;
alter table public.reception_items enable row level security;

-- receptions
drop policy if exists "receptions read" on public.receptions;
create policy "receptions read" on public.receptions for select
  using (auth.role() = 'authenticated');
drop policy if exists "receptions insert" on public.receptions;
create policy "receptions insert" on public.receptions for insert
  with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "receptions update" on public.receptions;
create policy "receptions update" on public.receptions for update
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "receptions delete admin" on public.receptions;
create policy "receptions delete admin" on public.receptions for delete
  using (public.current_role() = 'admin');

-- reception_items
drop policy if exists "reception_items read" on public.reception_items;
create policy "reception_items read" on public.reception_items for select
  using (auth.role() = 'authenticated');
drop policy if exists "reception_items insert" on public.reception_items;
create policy "reception_items insert" on public.reception_items for insert
  with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "reception_items update" on public.reception_items;
create policy "reception_items update" on public.reception_items for update
  using (public.current_role() in ('admin','operaciones','supervisor'))
  with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "reception_items delete admin" on public.reception_items;
create policy "reception_items delete admin" on public.reception_items for delete
  using (public.current_role() = 'admin');

notify pgrst, 'reload schema';
