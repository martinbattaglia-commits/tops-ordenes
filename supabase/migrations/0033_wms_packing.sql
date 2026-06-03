-- =========================================================================
-- 0033_wms_packing.sql — GATE 4B: PACKING (armado de bultos).
--
-- Consolida la mercadería ya PICKEADA de un pedido en UNIDADES LOGÍSTICAS
-- (bultos/cajas/pallets) y deja el pedido listo para despacho. Transiciones:
--   · stock_allocations.status : 'pickeada'  → 'empacada'
--   · logistics_order_items    : 'pickeado'  → 'empacado'
--   · logistics_orders         : 'en_preparacion' → 'preparado'
--
-- ALCANCE (aprobado Gate 4B — mantener EXACTO):
--   · D1 Allocation ATÓMICA por bulto: una reserva 'pickeada' entra ENTERA en
--     UN bulto (unique(allocation_id)). 'quantity' se guarda para forward-compat
--     (packing parcial futuro) pero en 4B siempre = stock_allocations.quantity.
--   · D2 Pedido → 'preparado' cuando TODAS las líneas no canceladas están
--     'empacado' (derivado; no requiere cerrar bultos).
--   · D3 confirm_packing_order CREA un bulto, empaca todo y lo CIERRA.
--   · D4 public_id de bulto con prefijo 'BLT-'.
--   · D5 Reversa incluida: unpack_allocation + reopen_packing_unit.
--   · ADDITIVE ONLY: no altera tablas ni RPC de Gates 1–4A. No crea permisos
--     nuevos (la authz de las RPC valida current_role() como en 0032).
--
-- NO MODIFICA (garantía explícita Gate 4B): NO toca stock_available /
--   stock_reserved, NI inventory_lots, NI inventory_movements. La propiedad
--   física del stock sigue gobernada por Gate 3 (reserva) y Gate 4C (egreso).
--   Packing es solo cambio de estado de la reserva + agrupación en bultos.
--
-- ROLL-UP (order_item_status_t / logistics_order_status_t congelados en 0030):
--   Línea → 'empacado' cuando no le queda allocation 'pickeada' y tiene ≥1
--   'empacada'/'despachada'. Pedido → 'preparado' cuando todas sus líneas no
--   canceladas están 'empacado'/'despachado'. unpack revierte ambos.
--
-- AUDITORÍA (audit_log, único mecanismo): packing.create / packing.pack /
--   packing.unpack / packing.close / packing.reopen. RPC SECURITY DEFINER
--   (owner) → bypassan RLS para el insert, igual que 0027/0032.
--
-- GATE 5 (forward-compat · NO implementar acá): packing_units es la ENTIDAD
--   FÍSICA CANÓNICA para QR, fotografías, evidencia visual, cadena de custodia y
--   tracking de bultos. Las extensiones de Gate 5 son additive sobre
--   packing_units / packing_unit_items, sin rediseñar Packing.
--
-- HOTFIX 42804 (uniforme con 0031/0032): CAST EXPLÍCITO a enum en TODA
--   asignación. Las comparaciones van sin cast.
--
-- Re-ejecutable: create [or replace] / if not exists / revoke/grant idempotentes.
-- ⚠️ Requiere 0024/0026/0027 + 0029/0030/0031 + 0032 APLICADAS. NO aplicar aún.
-- =========================================================================

create extension if not exists "pgcrypto";

-- ---- Enum nuevo ----------------------------------------------------------
-- 'despachada' se declara YA (congela el dominio) y la consume Gate 4C.
do $$ begin
  create type packing_status_t as enum ('abierta', 'cerrada', 'despachada', 'anulada');
exception when duplicate_object then null; end $$;

-- =========================================================================
-- Tablas: packing_units (bulto) + packing_unit_items (contenido)
-- =========================================================================
create sequence if not exists public.packing_unit_short_id_seq start 1;

create table if not exists public.packing_units (
  id uuid primary key default gen_random_uuid(),
  short_id int not null default nextval('public.packing_unit_short_id_seq'),
  public_id text not null unique,                  -- 'BLT-2026-0001'
  order_id uuid not null references public.logistics_orders(id) on delete cascade,
  label text,                                      -- rótulo operativo ("Caja 1")
  unit_type text,                                  -- 'caja' | 'pallet' | 'bulto' (texto libre v1)
  status packing_status_t not null default 'abierta',
  weight_kg numeric(12,3),                         -- opcional
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists packing_units_order_idx  on public.packing_units (order_id);
create index if not exists packing_units_status_idx on public.packing_units (status);

create or replace function public.set_packing_unit_public_id()
returns trigger as $$
declare yr text;
begin
  if new.public_id is null or new.public_id = '' then
    yr := to_char(coalesce(new.created_at, now()), 'YYYY');
    new.public_id := 'BLT-' || yr || '-' || lpad(new.short_id::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_packing_unit_public_id on public.packing_units;
create trigger trg_set_packing_unit_public_id
  before insert on public.packing_units
  for each row execute function public.set_packing_unit_public_id();

create table if not exists public.packing_unit_items (
  id uuid primary key default gen_random_uuid(),
  packing_unit_id uuid not null references public.packing_units(id) on delete cascade,
  allocation_id uuid not null references public.stock_allocations(id) on delete restrict,
  quantity numeric(14,3) not null,                 -- = allocation.quantity en 4B
  created_at timestamptz not null default now(),
  constraint packing_unit_items_qty_chk check (quantity > 0),
  constraint packing_unit_items_alloc_uk unique (allocation_id)  -- 1 reserva → 1 bulto (D1)
);
create index if not exists packing_unit_items_unit_idx on public.packing_unit_items (packing_unit_id);

-- =========================================================================
-- RLS — lectura authenticated · escritura SOLO vía RPC (lockdown, igual que
-- inventory_* en 0027 / stock_allocations en 0031). Sin policies de escritura:
-- las RPC SECURITY DEFINER (owner) bypassan RLS.
-- =========================================================================
alter table public.packing_units      enable row level security;
alter table public.packing_unit_items enable row level security;

drop policy if exists "packing_units read" on public.packing_units;
create policy "packing_units read" on public.packing_units for select
  using (auth.role() = 'authenticated');

drop policy if exists "packing_unit_items read" on public.packing_unit_items;
create policy "packing_unit_items read" on public.packing_unit_items for select
  using (auth.role() = 'authenticated');

-- =========================================================================
-- 0) Helper interno: recalcula estado de LÍNEA (pickeado↔empacado) y, derivado,
--    de PEDIDO (en_preparacion↔preparado). REVOKE de public/authenticated.
-- =========================================================================
create or replace function public.wms_pack_recompute(p_order_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_oid uuid;
  v_cur order_item_status_t;
  v_has_pickeada boolean;
  v_has_empacada boolean;
  v_ord_status logistics_order_status_t;
  v_noncxl int;
  v_incomplete int;
begin
  select order_id, status into v_oid, v_cur
    from public.logistics_order_items where id = p_order_item_id;
  if not found then return; end if;

  -- Línea: solo dentro del tramo picking/packing (no toca reservado/parcial/
  -- pendiente ni terminales cancelado/despachado).
  if v_cur in ('pickeado','empacado') then
    select exists(select 1 from public.stock_allocations
      where order_item_id = p_order_item_id and status = 'pickeada') into v_has_pickeada;
    select exists(select 1 from public.stock_allocations
      where order_item_id = p_order_item_id and status in ('empacada','despachada')) into v_has_empacada;

    update public.logistics_order_items
      set status = (case
                     when v_has_pickeada then 'pickeado'
                     when v_has_empacada then 'empacado'
                     else v_cur                -- sin allocations vivas: sin cambio
                   end)::order_item_status_t
      where id = p_order_item_id;
  end if;

  -- Pedido: solo flip entre 'en_preparacion' y 'preparado' (D2).
  -- INVARIANTE DESPACHO-SEGURO (revisión Gate 4B):
  --   · El guard de abajo (in 'en_preparacion','preparado') hace esta función
  --     INERTE sobre pedidos ya 'despachado'/'entregado' (los setea Gate 4C).
  --   · Las líneas 'despachado' se cuentan como COMPLETAS (excluidas de
  --     v_incomplete) → un pedido 'preparado' con despachos parciales NUNCA se
  --     degrada por esas líneas. Solo baja a 'en_preparacion' si reaparece una
  --     línea 'pickeado' (p.ej. por unpack de una línea aún empacada), lo cual
  --     es el reflejo correcto. Las líneas 'despachado' jamás se modifican acá
  --     (el bloque de línea solo corre para 'pickeado'/'empacado').
  select status into v_ord_status from public.logistics_orders where id = v_oid for update;
  if v_ord_status in ('en_preparacion','preparado') then
    select count(*) into v_noncxl
      from public.logistics_order_items where order_id = v_oid and status <> 'cancelado';
    select count(*) into v_incomplete
      from public.logistics_order_items
      where order_id = v_oid and status not in ('empacado','despachado','cancelado');

    if v_noncxl > 0 and v_incomplete = 0 then
      update public.logistics_orders
        set status = 'preparado'::logistics_order_status_t where id = v_oid;
    else
      update public.logistics_orders
        set status = 'en_preparacion'::logistics_order_status_t where id = v_oid;
    end if;
  end if;
end;
$$;

revoke execute on function public.wms_pack_recompute(uuid) from public;
revoke execute on function public.wms_pack_recompute(uuid) from authenticated;

-- =========================================================================
-- 1) create_packing_unit — abre un bulto para un pedido en preparación.
-- =========================================================================
create or replace function public.create_packing_unit(
  p_order_id   uuid,
  p_label      text default null,
  p_unit_type  text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.logistics_orders;
  v_unit_id uuid;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  select * into v_order from public.logistics_orders where id = p_order_id for update;
  if not found then
    raise exception 'pedido % no existe', p_order_id using errcode = 'no_data_found';
  end if;
  if v_order.status <> 'en_preparacion' then
    raise exception 'pedido % no está en preparación (estado %) — no se pueden armar bultos',
      v_order.public_id, v_order.status;
  end if;

  insert into public.packing_units (order_id, label, unit_type, status, created_by)
    values (p_order_id, p_label, p_unit_type, 'abierta'::packing_status_t, auth.uid())
    returning id into v_unit_id;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'packing_unit', v_unit_id, 'packing.create',
          jsonb_build_object('order_id', p_order_id, 'label', p_label, 'unit_type', p_unit_type));

  return v_unit_id;
end;
$$;

-- =========================================================================
-- 2) pack_allocation — mete una reserva 'pickeada' en un bulto 'abierta'.
-- =========================================================================
create or replace function public.pack_allocation(
  p_packing_unit_id uuid,
  p_allocation_id   uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit  public.packing_units;
  v_alloc public.stock_allocations;
  v_line_order uuid;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  select * into v_unit from public.packing_units where id = p_packing_unit_id for update;
  if not found then
    raise exception 'bulto % no existe', p_packing_unit_id using errcode = 'no_data_found';
  end if;
  if v_unit.status <> 'abierta' then
    raise exception 'bulto % no está abierto (estado %)', v_unit.public_id, v_unit.status;
  end if;

  select * into v_alloc from public.stock_allocations where id = p_allocation_id for update;
  if not found then
    raise exception 'allocation % no existe', p_allocation_id using errcode = 'no_data_found';
  end if;
  if v_alloc.status <> 'pickeada' then
    raise exception 'allocation % no está pickeada (estado %) — no se puede empacar',
      p_allocation_id, v_alloc.status;
  end if;

  -- Integridad: la reserva debe pertenecer al pedido del bulto.
  select li.order_id into v_line_order
    from public.logistics_order_items li where li.id = v_alloc.order_item_id;
  if v_line_order is distinct from v_unit.order_id then
    raise exception 'la reserva % no pertenece al pedido del bulto %', p_allocation_id, v_unit.public_id;
  end if;

  -- 1 reserva → 1 bulto. Idempotencia en 3 capas (revisión Gate 4B):
  --   (a) guard de estado 'pickeada' (un 2.º intento la ve 'empacada' → corta);
  --   (b) FOR UPDATE sobre la allocation serializa llamadas concurrentes;
  --   (c) unique(allocation_id) es el backstop duro a nivel tabla (también
  --       impide la misma reserva en dos bultos distintos).
  insert into public.packing_unit_items (packing_unit_id, allocation_id, quantity)
    values (p_packing_unit_id, p_allocation_id, v_alloc.quantity);

  update public.stock_allocations
    set status = 'empacada'::alloc_status_t
    where id = p_allocation_id;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'stock_allocation', v_alloc.id, 'packing.pack',
          jsonb_build_object(
            'packing_unit_id',   p_packing_unit_id,
            'order_item_id',     v_alloc.order_item_id,
            'inventory_item_id', v_alloc.inventory_item_id,
            'lot_number',        v_alloc.lot_number,
            'quantity',          v_alloc.quantity,
            'from',              'pickeada',
            'to',                'empacada'));

  perform public.wms_pack_recompute(v_alloc.order_item_id);
end;
$$;

-- =========================================================================
-- 3) unpack_allocation — saca una reserva de su bulto: 'empacada' → 'pickeada'.
--    Requiere bulto 'abierta' (si está cerrado, reabrir primero). Bloqueado si
--    la línea ya avanzó a despachado/cancelado.
-- =========================================================================
create or replace function public.unpack_allocation(p_allocation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alloc public.stock_allocations;
  v_line_status order_item_status_t;
  v_pui public.packing_unit_items;
  v_unit_status packing_status_t;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  select * into v_alloc from public.stock_allocations where id = p_allocation_id for update;
  if not found then
    raise exception 'allocation % no existe', p_allocation_id using errcode = 'no_data_found';
  end if;
  if v_alloc.status <> 'empacada' then
    raise exception 'allocation % no está empacada (estado %) — solo se desempaca lo empacado',
      p_allocation_id, v_alloc.status;
  end if;

  select status into v_line_status
    from public.logistics_order_items where id = v_alloc.order_item_id;
  if v_line_status in ('despachado','cancelado') then
    raise exception 'la línea ya avanzó (estado %) — no se puede desempacar', v_line_status;
  end if;

  -- El bulto debe estar abierto para retirar contenido.
  select pui.* into v_pui from public.packing_unit_items pui where pui.allocation_id = p_allocation_id;
  if found then
    select status into v_unit_status from public.packing_units where id = v_pui.packing_unit_id;
    if v_unit_status <> 'abierta' then
      raise exception 'el bulto está % — reabrilo antes de desempacar', v_unit_status;
    end if;
    delete from public.packing_unit_items where id = v_pui.id;
  end if;

  update public.stock_allocations
    set status = 'pickeada'::alloc_status_t
    where id = p_allocation_id;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'stock_allocation', v_alloc.id, 'packing.unpack',
          jsonb_build_object(
            'order_item_id',     v_alloc.order_item_id,
            'inventory_item_id', v_alloc.inventory_item_id,
            'lot_number',        v_alloc.lot_number,
            'quantity',          v_alloc.quantity,
            'from',              'empacada',
            'to',                'pickeada'));

  perform public.wms_pack_recompute(v_alloc.order_item_id);
end;
$$;

-- =========================================================================
-- 4a) close_packing_unit — sella un bulto: 'abierta' → 'cerrada'. Exige ≥1 ítem.
-- =========================================================================
create or replace function public.close_packing_unit(p_packing_unit_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.packing_units;
  v_items int;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  select * into v_unit from public.packing_units where id = p_packing_unit_id for update;
  if not found then
    raise exception 'bulto % no existe', p_packing_unit_id using errcode = 'no_data_found';
  end if;
  if v_unit.status <> 'abierta' then
    raise exception 'bulto % no está abierto (estado %)', v_unit.public_id, v_unit.status;
  end if;

  select count(*) into v_items from public.packing_unit_items where packing_unit_id = p_packing_unit_id;
  if v_items = 0 then
    raise exception 'bulto % vacío — no se puede cerrar', v_unit.public_id;
  end if;

  update public.packing_units set status = 'cerrada'::packing_status_t where id = p_packing_unit_id;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'packing_unit', p_packing_unit_id, 'packing.close',
          jsonb_build_object('order_id', v_unit.order_id, 'items', v_items));
end;
$$;

-- =========================================================================
-- 4b) reopen_packing_unit — reabre un bulto: 'cerrada' → 'abierta'.
--     Bloqueado si ya fue despachado (Gate 4C).
-- =========================================================================
create or replace function public.reopen_packing_unit(p_packing_unit_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit public.packing_units;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  select * into v_unit from public.packing_units where id = p_packing_unit_id for update;
  if not found then
    raise exception 'bulto % no existe', p_packing_unit_id using errcode = 'no_data_found';
  end if;
  if v_unit.status = 'despachada' then
    raise exception 'bulto % ya despachado — no se puede reabrir', v_unit.public_id;
  end if;
  if v_unit.status <> 'cerrada' then
    raise exception 'bulto % no está cerrado (estado %)', v_unit.public_id, v_unit.status;
  end if;

  update public.packing_units set status = 'abierta'::packing_status_t where id = p_packing_unit_id;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'packing_unit', p_packing_unit_id, 'packing.reopen',
          jsonb_build_object('order_id', v_unit.order_id));
end;
$$;

-- =========================================================================
-- 5) confirm_packing_order — "empacar pedido completo" (D3): crea un bulto,
--    empaca TODAS las reservas 'pickeada' del pedido, lo cierra y deja el
--    pedido 'preparado'. Idempotente: si no hay 'pickeada', es no-op.
-- =========================================================================
create or replace function public.confirm_packing_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.logistics_orders;
  v_pending int;
  v_unit_id uuid;
  v_alloc record;
  v_line_id uuid;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  -- CONCURRENCIA (revisión Gate 4B): el FOR UPDATE lockea la fila del pedido →
  -- dos usuarios que ejecuten esta RPC sobre el MISMO pedido se serializan. El
  -- 2.º recién corre tras el commit del 1.º, re-lee el pedido y encuentra
  -- v_pending=0 (ya no hay 'pickeada') → no-op. Nunca se crean dos BLT.
  select * into v_order from public.logistics_orders where id = p_order_id for update;
  if not found then
    raise exception 'pedido % no existe', p_order_id using errcode = 'no_data_found';
  end if;
  if v_order.status not in ('en_preparacion','preparado') then
    raise exception 'pedido % no es empacable (estado %)', v_order.public_id, v_order.status;
  end if;

  -- Idempotencia: sin reservas pickeadas → no-op (no crea bulto vacío).
  select count(*) into v_pending
    from public.stock_allocations sa
    join public.logistics_order_items li on li.id = sa.order_item_id
    where li.order_id = p_order_id and sa.status = 'pickeada';
  if v_pending = 0 then
    return;
  end if;

  -- Crea un bulto y empaca todas las pickeadas (orden consistente de lock).
  insert into public.packing_units (order_id, label, unit_type, status, created_by)
    values (p_order_id, 'Bulto pedido completo', 'bulto', 'abierta'::packing_status_t, auth.uid())
    returning id into v_unit_id;

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'packing_unit', v_unit_id, 'packing.create',
          jsonb_build_object('order_id', p_order_id, 'via', 'order'));

  for v_alloc in
    select sa.id, sa.order_item_id, sa.inventory_item_id, sa.lot_number, sa.quantity
    from public.stock_allocations sa
    join public.logistics_order_items li on li.id = sa.order_item_id
    where li.order_id = p_order_id and sa.status = 'pickeada'
    order by sa.inventory_item_id
    for update of sa
  loop
    insert into public.packing_unit_items (packing_unit_id, allocation_id, quantity)
      values (v_unit_id, v_alloc.id, v_alloc.quantity);
    update public.stock_allocations
      set status = 'empacada'::alloc_status_t where id = v_alloc.id;
    insert into public.audit_log (user_id, entity, entity_id, action, payload)
    values (auth.uid(), 'stock_allocation', v_alloc.id, 'packing.pack',
            jsonb_build_object(
              'packing_unit_id',   v_unit_id,
              'order_item_id',     v_alloc.order_item_id,
              'inventory_item_id', v_alloc.inventory_item_id,
              'lot_number',        v_alloc.lot_number,
              'quantity',          v_alloc.quantity,
              'from',              'pickeada',
              'to',                'empacada',
              'via',               'order'));
  end loop;

  -- Cierra el bulto (D3).
  update public.packing_units set status = 'cerrada'::packing_status_t where id = v_unit_id;
  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'packing_unit', v_unit_id, 'packing.close',
          jsonb_build_object('order_id', p_order_id, 'via', 'order'));

  -- Recalcula líneas + pedido (→ preparado si todo empacado).
  for v_line_id in
    select id from public.logistics_order_items where order_id = p_order_id
  loop
    perform public.wms_pack_recompute(v_line_id);
  end loop;
end;
$$;

-- ---- Grants: las RPC públicas se invocan desde la app (rol authenticated) ----
grant execute on function public.create_packing_unit(uuid, text, text) to authenticated;
grant execute on function public.pack_allocation(uuid, uuid)           to authenticated;
grant execute on function public.unpack_allocation(uuid)               to authenticated;
grant execute on function public.close_packing_unit(uuid)              to authenticated;
grant execute on function public.reopen_packing_unit(uuid)             to authenticated;
grant execute on function public.confirm_packing_order(uuid)           to authenticated;

notify pgrst, 'reload schema';
