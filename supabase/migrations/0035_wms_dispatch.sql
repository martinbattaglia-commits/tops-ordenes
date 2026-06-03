-- =========================================================================
-- 0035_wms_dispatch.sql — GATE 4C: DESPACHO + ENTREGA.
--
-- PRIMER EGRESO IRREVERSIBLE DEL SISTEMA. Saca la mercadería ya empacada del
-- depósito y cierra el ciclo logístico. Transiciones:
--   · stock_allocations : 'empacada'  → 'despachada'   (y reversa)
--   · logistics_order_items : 'empacado' → 'despachado'  (derivado)
--   · packing_units : 'cerrada' → 'despachada'  (+ shipment_id)  (y reversa)
--   · logistics_orders : 'preparado' → 'despachado' → 'entregado' (derivado)
--
-- ALCANCE (aprobado · GATE_4C_DISPATCH_DESIGN + GATE_4C_IMPLEMENTATION_PLAN):
--   · D1=A: exige TODOS los bultos del pedido 'cerrada' (sin 'abierta'). Los
--     vacíos se anulan con anular_packing_unit (Mini-Gate 4B.1, 0034).
--   · D2=A: 1 shipment por pedido (índice parcial unique). Additive:
--     packing_units.shipment_id deja la puerta a consolidación futura.
--   · D3=C: egreso FEFO por lote si el ítem tiene lotes; si no, solo stock_reserved.
--   · D5=A: FEFO REAL materializado al egresar (multi-lote), sin reabrir Gate 3.
--   · D6=A: 'despachado'→'entregado'. Rechazo/devolución = gate posterior.
--   · Despacho WHOLE-ORDER atómico (todo o nada). Sin despacho parcial en 4C.
--
-- EGRESO (clave): decrementa stock_reserved (NO stock_available) + inventory_lots
--   por lote (FEFO). NO reutiliza la rama 'egreso' de confirm_movement (0027),
--   que opera sobre stock_available — incorrecto para despacho (hallazgo L1).
--
-- LEDGER (inventory_movements, inmutable por trigger 0026): SOLO se INSERTA.
--   · Despacho: un asiento 'egreso' POR LOTE (reference_type='despacho',
--     reference_id=shipment.id).
--   · Reversión: asientos 'ingreso' COMPENSATORIOS nuevos
--     (reason='reversion_despacho'). JAMÁS UPDATE/DELETE sobre el ledger.
--
-- ROLL-UPS derivados (wms_dispatch_recompute): líneas/pedido se derivan de
--   stock_allocations + estado del shipment. Sin flags sueltos. Despacho-seguro.
--
-- AUDITORÍA (audit_log): dispatch.confirm / delivery.confirm / dispatch.revert.
--
-- HOTFIX 42804 (uniforme con 0031/0032/0033/0034): CAST EXPLÍCITO a enum en
--   TODA asignación. Comparaciones sin cast.
--
-- Re-ejecutable: create [or replace] / if not exists / revoke/grant idempotentes.
-- ⚠️ Requiere 0024/0026/0027 + 0029/0030/0031 + 0032 + 0033 + 0034 APLICADAS.
--    PITR NO habilitado: backup manual previo OBLIGATORIO. revert_dispatch es la
--    red de seguridad primaria ante un despacho erróneo.
-- =========================================================================

create extension if not exists "pgcrypto";

-- =========================================================================
-- Enum nuevo — estado del despacho. Nace en el egreso ('despachado').
-- =========================================================================
do $$ begin
  create type shipment_status_t as enum ('despachado', 'entregado', 'anulado');
exception when duplicate_object then null; end $$;

-- =========================================================================
-- Tabla nueva — shipments (cabecera de despacho · 1 por pedido, D2=A)
-- =========================================================================
create sequence if not exists public.shipment_short_id_seq start 1;

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  short_id int not null default nextval('public.shipment_short_id_seq'),
  public_id text not null unique,                  -- 'DSP-2026-0001'
  order_id uuid not null references public.logistics_orders(id) on delete restrict,
  status shipment_status_t not null default 'despachado',
  carrier text,                                    -- transportista (opcional, D4)
  vehicle_ref text,                                -- patente / id de vehículo (→ Traccar)
  tracking_ref text,                               -- id externo de seguimiento
  dispatched_at timestamptz not null default now(),
  dispatched_by uuid references auth.users(id) on delete set null,
  delivered_at timestamptz,
  delivered_by uuid references auth.users(id) on delete set null,
  received_by_name text,                           -- prueba simple de entrega
  reverted_at timestamptz,
  reverted_by uuid references auth.users(id) on delete set null,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists shipments_order_idx  on public.shipments (order_id);
create index if not exists shipments_status_idx on public.shipments (status);
-- 1 shipment VIGENTE por pedido (permite re-despacho tras reversión: anulado libera el slot).
create unique index if not exists shipments_order_uk on public.shipments (order_id) where status <> 'anulado';

create or replace function public.set_shipment_public_id()
returns trigger as $$
declare yr text;
begin
  if new.public_id is null or new.public_id = '' then
    yr := to_char(coalesce(new.created_at, now()), 'YYYY');
    new.public_id := 'DSP-' || yr || '-' || lpad(new.short_id::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_shipment_public_id on public.shipments;
create trigger trg_set_shipment_public_id
  before insert on public.shipments
  for each row execute function public.set_shipment_public_id();

-- =========================================================================
-- Columna nueva (única alteración a tabla existente · aditiva)
-- =========================================================================
alter table public.packing_units
  add column if not exists shipment_id uuid references public.shipments(id) on delete set null;
create index if not exists packing_units_shipment_idx on public.packing_units (shipment_id);

-- =========================================================================
-- RLS — lectura authenticated · escritura SOLO vía RPC (lockdown, igual que
-- stock_allocations 0031 / packing_units 0033). Sin policies de escritura.
-- =========================================================================
alter table public.shipments enable row level security;

drop policy if exists "shipments read" on public.shipments;
create policy "shipments read" on public.shipments for select
  using (auth.role() = 'authenticated');

-- =========================================================================
-- 0) Helper interno: recalcula estado de LÍNEA (empacado↔despachado) y, derivado,
--    de PEDIDO (preparado↔despachado↔entregado). REVOKE de public/authenticated.
--    Despacho-seguro: inerte fuera de su tramo de estados.
-- =========================================================================
create or replace function public.wms_dispatch_recompute(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
  v_has_empacada boolean;
  v_has_despachada boolean;
  v_ord_status logistics_order_status_t;
  v_ship_status shipment_status_t;
  v_noncxl int;
  v_not_dispatched int;
begin
  -- LÍNEAS: solo dentro del tramo empacado/despachado (no toca otros estados).
  for v_line in
    select id from public.logistics_order_items
    where order_id = p_order_id and status in ('empacado','despachado')
  loop
    select exists(select 1 from public.stock_allocations
      where order_item_id = v_line.id and status = 'empacada') into v_has_empacada;
    select exists(select 1 from public.stock_allocations
      where order_item_id = v_line.id and status = 'despachada') into v_has_despachada;
    update public.logistics_order_items
      set status = (case
                     when v_has_empacada then 'empacado'
                     when v_has_despachada then 'despachado'
                     else status
                   end)::order_item_status_t
      where id = v_line.id;
  end loop;

  -- PEDIDO: flip entre preparado / despachado / entregado, derivado del shipment
  -- vigente + completitud de líneas. INERTE sobre borrador/pendiente/en_preparacion/cancelado.
  select status into v_ord_status from public.logistics_orders where id = p_order_id for update;
  if v_ord_status in ('preparado','despachado','entregado') then
    select status into v_ship_status from public.shipments
      where order_id = p_order_id and status <> 'anulado'
      order by created_at desc limit 1;

    select count(*) into v_noncxl from public.logistics_order_items
      where order_id = p_order_id and status <> 'cancelado';
    select count(*) into v_not_dispatched from public.logistics_order_items
      where order_id = p_order_id and status not in ('despachado','cancelado');

    if v_ship_status = 'entregado' then
      update public.logistics_orders set status = 'entregado'::logistics_order_status_t where id = p_order_id;
    elsif v_ship_status = 'despachado' and v_noncxl > 0 and v_not_dispatched = 0 then
      update public.logistics_orders set status = 'despachado'::logistics_order_status_t where id = p_order_id;
    else
      -- sin shipment vigente (revertido) o líneas no completas → preparado
      update public.logistics_orders set status = 'preparado'::logistics_order_status_t where id = p_order_id;
    end if;
  end if;
end;
$$;

revoke execute on function public.wms_dispatch_recompute(uuid) from public;
revoke execute on function public.wms_dispatch_recompute(uuid) from authenticated;

-- =========================================================================
-- 1) confirm_dispatch — EGRESO IRREVERSIBLE. Whole-order atómico.
--    Crea el shipment, egresa FEFO por lote (stock_reserved + inventory_lots),
--    escribe el ledger ('egreso' por lote), transiciona allocations/bultos/líneas/pedido.
-- =========================================================================
create or replace function public.confirm_dispatch(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.logistics_orders;
  v_open_units int;
  v_empacadas int;
  v_existing uuid;
  v_shipment_id uuid;
  v_alloc record;
  v_lot record;
  v_remaining numeric;
  v_dec numeric;
  v_before numeric;
  v_after numeric;
  v_has_lots boolean;
  v_avail_lots numeric;
  v_egreso_count int := 0;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  select * into v_order from public.logistics_orders where id = p_order_id for update;
  if not found then
    raise exception 'pedido % no existe', p_order_id using errcode = 'no_data_found';
  end if;
  if v_order.status <> 'preparado' then
    raise exception 'pedido % no está preparado (estado %) — no se puede despachar',
      v_order.public_id, v_order.status;
  end if;

  -- D1=A: ningún bulto 'abierta' (los vacíos se anulan con anular_packing_unit, 4B.1).
  select count(*) into v_open_units from public.packing_units
    where order_id = p_order_id and status = 'abierta';
  if v_open_units > 0 then
    raise exception 'el pedido % tiene % bulto(s) abierto(s) — cerralos o anulalos antes de despachar',
      v_order.public_id, v_open_units;
  end if;

  -- Debe haber reservas empacadas.
  select count(*) into v_empacadas from public.stock_allocations sa
    join public.logistics_order_items li on li.id = sa.order_item_id
    where li.order_id = p_order_id and sa.status = 'empacada';
  if v_empacadas = 0 then
    raise exception 'el pedido % no tiene reservas empacadas para despachar', v_order.public_id;
  end if;

  -- Unicidad: no debe existir shipment vigente.
  select id into v_existing from public.shipments
    where order_id = p_order_id and status <> 'anulado' limit 1;
  if v_existing is not null then
    raise exception 'el pedido % ya tiene un despacho vigente', v_order.public_id;
  end if;

  -- Crea el shipment (nace 'despachado').
  insert into public.shipments (order_id, status, dispatched_by)
    values (p_order_id, 'despachado'::shipment_status_t, auth.uid())
    returning id into v_shipment_id;

  -- EGRESO por cada allocation empacada (orden estable; FOR UPDATE).
  for v_alloc in
    select sa.id, sa.order_item_id, sa.inventory_item_id, sa.lot_number, sa.quantity
    from public.stock_allocations sa
    join public.logistics_order_items li on li.id = sa.order_item_id
    where li.order_id = p_order_id and sa.status = 'empacada'
    order by sa.inventory_item_id, sa.id
    for update of sa
  loop
    select exists(select 1 from public.inventory_lots
      where inventory_item_id = v_alloc.inventory_item_id and active and quantity > 0) into v_has_lots;

    if v_has_lots then
      -- Guard de consistencia: Σ lotes disponibles >= cantidad (sin egreso parcial).
      select coalesce(sum(quantity),0) into v_avail_lots from public.inventory_lots
        where inventory_item_id = v_alloc.inventory_item_id and active and quantity > 0;
      if v_avail_lots < v_alloc.quantity then
        raise exception 'incoherencia stock/lotes en ítem % (disp %, requerido %) — egreso abortado',
          v_alloc.inventory_item_id, v_avail_lots, v_alloc.quantity;
      end if;

      -- FEFO REAL: decremento lote a lote (más próximo a vencer primero).
      v_remaining := v_alloc.quantity;
      for v_lot in
        select id, lot_number, quantity
        from public.inventory_lots
        where inventory_item_id = v_alloc.inventory_item_id and active and quantity > 0
        order by expiration_date asc nulls last, lot_number
        for update
      loop
        exit when v_remaining <= 0;
        v_dec := least(v_remaining, v_lot.quantity);
        if v_dec <= 0 then continue; end if;

        select stock_available + stock_reserved into v_before
          from public.inventory_items where id = v_alloc.inventory_item_id;

        update public.inventory_lots set quantity = quantity - v_dec where id = v_lot.id;
        update public.inventory_items
          set stock_reserved = stock_reserved - v_dec,
              active = case when (stock_available + stock_reserved - v_dec) <= 0 then false else true end
          where id = v_alloc.inventory_item_id;

        v_after := v_before - v_dec;

        insert into public.inventory_movements
          (movement_type, inventory_item_id, lot_number, quantity, before_quantity, after_quantity,
           from_position_id, to_position_id, reason, notes, reference_type, reference_id, created_by)
        select 'egreso'::movement_type_t, v_alloc.inventory_item_id, v_lot.lot_number, v_dec, v_before, v_after,
               ii.position_id, null, 'despacho', null, 'despacho'::movement_reference_t, v_shipment_id, auth.uid()
          from public.inventory_items ii where ii.id = v_alloc.inventory_item_id;

        v_egreso_count := v_egreso_count + 1;
        v_remaining := v_remaining - v_dec;
      end loop;

      if v_remaining > 0 then
        raise exception 'no se pudo cubrir el egreso del ítem % (faltan %)',
          v_alloc.inventory_item_id, v_remaining;
      end if;
    else
      -- D3=C: ítem sin lotes → decremento solo de stock_reserved; 1 asiento lot null.
      select stock_available + stock_reserved into v_before
        from public.inventory_items where id = v_alloc.inventory_item_id;
      update public.inventory_items
        set stock_reserved = stock_reserved - v_alloc.quantity,
            active = case when (stock_available + stock_reserved - v_alloc.quantity) <= 0 then false else true end
        where id = v_alloc.inventory_item_id;
      v_after := v_before - v_alloc.quantity;
      insert into public.inventory_movements
        (movement_type, inventory_item_id, lot_number, quantity, before_quantity, after_quantity,
         from_position_id, to_position_id, reason, notes, reference_type, reference_id, created_by)
      select 'egreso'::movement_type_t, v_alloc.inventory_item_id, null, v_alloc.quantity, v_before, v_after,
             ii.position_id, null, 'despacho', null, 'despacho'::movement_reference_t, v_shipment_id, auth.uid()
        from public.inventory_items ii where ii.id = v_alloc.inventory_item_id;
      v_egreso_count := v_egreso_count + 1;
    end if;

    update public.stock_allocations set status = 'despachada'::alloc_status_t where id = v_alloc.id;

    insert into public.audit_log (user_id, entity, entity_id, action, payload)
    values (auth.uid(), 'stock_allocation', v_alloc.id, 'dispatch.confirm',
            jsonb_build_object(
              'shipment_id',       v_shipment_id,
              'order_id',          p_order_id,
              'inventory_item_id', v_alloc.inventory_item_id,
              'lot_number',        v_alloc.lot_number,
              'quantity',          v_alloc.quantity,
              'from',              'empacada',
              'to',                'despachada'));
  end loop;

  -- Vincula bultos cerrados al shipment → 'despachada'.
  update public.packing_units
    set shipment_id = v_shipment_id, status = 'despachada'::packing_status_t
    where order_id = p_order_id and status = 'cerrada';

  -- Roll-up (líneas → despachado · pedido → despachado).
  perform public.wms_dispatch_recompute(p_order_id);

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'shipment', v_shipment_id, 'dispatch.confirm',
          jsonb_build_object(
            'order_id',           p_order_id,
            'allocations',        v_empacadas,
            'movimientos_egreso', v_egreso_count));

  return v_shipment_id;
end;
$$;

-- =========================================================================
-- 2) confirm_delivery — shipment 'despachado' → 'entregado'. Sin stock.
-- =========================================================================
create or replace function public.confirm_delivery(p_shipment_id uuid, p_received_by text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ship public.shipments;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  select * into v_ship from public.shipments where id = p_shipment_id for update;
  if not found then
    raise exception 'despacho % no existe', p_shipment_id using errcode = 'no_data_found';
  end if;
  if v_ship.status <> 'despachado' then
    raise exception 'despacho % no está despachado (estado %) — no se puede entregar',
      v_ship.public_id, v_ship.status;
  end if;

  update public.shipments
    set status = 'entregado'::shipment_status_t,
        delivered_at = now(),
        delivered_by = auth.uid(),
        received_by_name = coalesce(p_received_by, received_by_name)
    where id = p_shipment_id;

  perform public.wms_dispatch_recompute(v_ship.order_id);

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'shipment', p_shipment_id, 'delivery.confirm',
          jsonb_build_object('order_id', v_ship.order_id, 'received_by', p_received_by,
                             'from', 'despachado', 'to', 'entregado'));
end;
$$;

-- =========================================================================
-- 3) revert_dispatch — reversión COMPENSATORIA de un despacho NO entregado.
--    Restituye stock con asientos 'ingreso' nuevos (jamás muta el ledger).
-- =========================================================================
create or replace function public.revert_dispatch(p_shipment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ship public.shipments;
  v_mov record;
  v_before numeric;
  v_after numeric;
  v_count int := 0;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  select * into v_ship from public.shipments where id = p_shipment_id for update;
  if not found then
    raise exception 'despacho % no existe', p_shipment_id using errcode = 'no_data_found';
  end if;
  if v_ship.status <> 'despachado' then
    raise exception 'despacho % no es revertible (estado %) — solo se revierte un despacho no entregado',
      v_ship.public_id, v_ship.status;
  end if;

  -- Restitución leída del LEDGER (egresos de este shipment) → asientos 'ingreso' compensatorios.
  for v_mov in
    select inventory_item_id, lot_number, quantity
    from public.inventory_movements
    where reference_type = 'despacho' and reference_id = p_shipment_id and movement_type = 'egreso'
    order by id
  loop
    select stock_available + stock_reserved into v_before
      from public.inventory_items where id = v_mov.inventory_item_id;

    if v_mov.lot_number is not null then
      update public.inventory_lots set quantity = quantity + v_mov.quantity
        where inventory_item_id = v_mov.inventory_item_id and lot_number = v_mov.lot_number;
    end if;
    update public.inventory_items
      set stock_reserved = stock_reserved + v_mov.quantity, active = true
      where id = v_mov.inventory_item_id;

    v_after := v_before + v_mov.quantity;

    insert into public.inventory_movements
      (movement_type, inventory_item_id, lot_number, quantity, before_quantity, after_quantity,
       from_position_id, to_position_id, reason, notes, reference_type, reference_id, created_by)
    select 'ingreso'::movement_type_t, v_mov.inventory_item_id, v_mov.lot_number, v_mov.quantity, v_before, v_after,
           null, ii.position_id, 'reversion_despacho', null, 'despacho'::movement_reference_t, p_shipment_id, auth.uid()
      from public.inventory_items ii where ii.id = v_mov.inventory_item_id;

    v_count := v_count + 1;
  end loop;

  -- Allocations despachada → empacada (las del pedido del shipment).
  update public.stock_allocations sa
    set status = 'empacada'::alloc_status_t
    from public.logistics_order_items li
    where sa.order_item_id = li.id and li.order_id = v_ship.order_id and sa.status = 'despachada';

  -- Bultos despachada → cerrada, desvinculados del shipment.
  update public.packing_units
    set status = 'cerrada'::packing_status_t, shipment_id = null
    where shipment_id = p_shipment_id and status = 'despachada';

  -- Shipment → anulado (antes del roll-up: deja de ser vigente).
  update public.shipments
    set status = 'anulado'::shipment_status_t,
        reverted_at = now(),
        reverted_by = auth.uid(),
        active = false
    where id = p_shipment_id;

  -- Roll-up (líneas → empacado · pedido → preparado).
  perform public.wms_dispatch_recompute(v_ship.order_id);

  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'shipment', p_shipment_id, 'dispatch.revert',
          jsonb_build_object('order_id', v_ship.order_id, 'movimientos_restituidos', v_count,
                             'from', 'despachado', 'to', 'anulado'));
end;
$$;

-- ---- Grants: las RPC públicas se invocan desde la app (rol authenticated) ----
grant execute on function public.confirm_dispatch(uuid)        to authenticated;
grant execute on function public.confirm_delivery(uuid, text)  to authenticated;
grant execute on function public.revert_dispatch(uuid)         to authenticated;

notify pgrst, 'reload schema';
