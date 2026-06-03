-- =========================================================================
-- 0027_wms_functions.sql — FASE 8E: núcleo transaccional WMS Sprint 2.
--
-- Contiene (additive · NO altera estructura de columnas existentes):
--   1. Unique constraints de IDENTIDAD del inventario (ajuste 3):
--        inventory_items  : (client_name, sku, position_id)
--        inventory_lots   : (inventory_item_id, lot_number, expiration_date)
--      → un ítem por cliente+sku+posición; un lote por (ítem, lote, vencimiento)
--        → lotes distintos NO se fusionan; misma combinación ACUMULA (regla 1).
--   2. Lockdown RLS (regla 2): inventory_items / inventory_lots /
--      inventory_movements quedan SOLO-LECTURA para roles normales. Toda
--      escritura de stock pasa EXCLUSIVAMENTE por las RPC (SECURITY DEFINER).
--   3. RPC transaccionales: confirm_reception · release_quarantine ·
--      confirm_movement (atómicas, con row-locking y validación de referencias).
--
-- ⚠️ Requiere 0020-0026 aplicadas. NO aplicar todavía. Baselines intactos.
-- =========================================================================

-- ---- 1) Identidad (unique índices idempotentes) -------------------------
create unique index if not exists inventory_items_identity_uk
  on public.inventory_items (client_name, sku, position_id);
create unique index if not exists inventory_lots_identity_uk
  on public.inventory_lots (inventory_item_id, lot_number, expiration_date);

-- ---- 2) Lockdown RLS: stock solo escribible vía RPC (regla 2) -----------
-- Se eliminan las policies de escritura (insert/update/delete) que 0024/0026
-- daban a admin/operaciones/supervisor. Quedan SOLO las de lectura. Las RPC
-- SECURITY DEFINER escriben con privilegios del owner (bypass RLS).
drop policy if exists "inventory_items insert"        on public.inventory_items;
drop policy if exists "inventory_items update"        on public.inventory_items;
drop policy if exists "inventory_items delete admin"  on public.inventory_items;
drop policy if exists "inventory_lots insert"         on public.inventory_lots;
drop policy if exists "inventory_lots update"         on public.inventory_lots;
drop policy if exists "inventory_lots delete admin"   on public.inventory_lots;
drop policy if exists "inventory_movements insert"    on public.inventory_movements;

-- =========================================================================
-- 3a) confirm_reception — confirma una recepción en una transacción.
--     requires_quarantine=true → ingresa a CUARENTENA (stock_reserved);
--     false → stock_available. Es decisión OPERATIVA explícita, NO derivada del
--     business_unit (ANMAT solo exige lote+vencimiento, no cuarentena).
--     "Parcial" = derivado (quedan items pendientes).
-- =========================================================================
create or replace function public.confirm_reception(p_reception_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.receptions;
  v_item public.reception_items;
  v_inv_id uuid;
  v_lot_id uuid;
  v_before numeric(14,3);
  v_after numeric(14,3);
  v_quar boolean;
  v_pending int;
begin
  -- DEFINER bypasea RLS → autorización explícita
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  select * into v_rec from public.receptions where id = p_reception_id for update;
  if not found then
    raise exception 'recepción % no existe', p_reception_id using errcode = 'no_data_found';
  end if;
  if v_rec.status not in ('pendiente','en_recepcion','cuarentena') then
    raise exception 'recepción % no es confirmable (estado %)', v_rec.public_id, v_rec.status;
  end if;

  v_quar := v_rec.requires_quarantine;   -- cuarentena = decisión operativa explícita

  for v_item in
    select * from public.reception_items
    where reception_id = p_reception_id and status = 'pendiente'
    order by created_at
  loop
    -- find-or-create inventory_item por (cliente, sku, posición)
    select id into v_inv_id from public.inventory_items
      where client_name = v_rec.client_name and sku = v_item.sku
        and position_id is not distinct from v_item.position_id
      for update;
    if v_inv_id is null then
      insert into public.inventory_items
        (sku, description, client_name, position_id, stock_available, stock_reserved, active, created_by)
        values (v_item.sku, v_item.description, v_rec.client_name, v_item.position_id, 0, 0, true, auth.uid())
        returning id into v_inv_id;
    end if;

    select stock_available + stock_reserved into v_before from public.inventory_items where id = v_inv_id;

    -- find-or-create lote (regla 1: misma combinación ACUMULA, nunca duplica)
    if v_item.lot_number is not null then
      select id into v_lot_id from public.inventory_lots
        where inventory_item_id = v_inv_id and lot_number = v_item.lot_number
          and expiration_date is not distinct from v_item.expiration_date
        for update;
      if v_lot_id is null then
        insert into public.inventory_lots
          (inventory_item_id, lot_number, expiration_date, quantity, active, created_by)
          values (v_inv_id, v_item.lot_number, v_item.expiration_date, v_item.quantity, true, auth.uid());
      else
        update public.inventory_lots set quantity = quantity + v_item.quantity where id = v_lot_id;
      end if;
    end if;

    -- incremento del bucket del ítem (cuarentena → reserved; resto → available)
    if v_quar then
      update public.inventory_items
        set stock_reserved = stock_reserved + v_item.quantity, active = true where id = v_inv_id;
    else
      update public.inventory_items
        set stock_available = stock_available + v_item.quantity, active = true where id = v_inv_id;
    end if;

    select stock_available + stock_reserved into v_after from public.inventory_items where id = v_inv_id;

    insert into public.inventory_movements
      (movement_type, inventory_item_id, lot_number, quantity, before_quantity, after_quantity,
       from_position_id, to_position_id, reason, notes, reference_type, reference_id, created_by)
    values
      ('ingreso', v_inv_id, v_item.lot_number, v_item.quantity, v_before, v_after,
       null, v_item.position_id,
       'Recepción ' || v_rec.public_id || case when v_quar then ' (cuarentena)' else '' end,
       null, 'recepcion', p_reception_id, auth.uid());

    update public.reception_items
      set status = (case when v_quar then 'cuarentena' else 'recibido' end)::reception_item_status_t,
          inventory_item_id = v_inv_id
      where id = v_item.id;
  end loop;

  select count(*) into v_pending
    from public.reception_items where reception_id = p_reception_id and status = 'pendiente';

  update public.receptions
    set status = (case when v_quar then 'cuarentena'
                       when v_pending = 0 then 'recibida'
                       else 'en_recepcion' end)::reception_status_t,
        received_at = coalesce(received_at, now())
    where id = p_reception_id;
end;
$$;

-- =========================================================================
-- 3b) release_quarantine — libera una recepción ANMAT: reserved → available.
-- =========================================================================
create or replace function public.release_quarantine(p_reception_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec public.receptions;
  v_item public.reception_items;
  v_bal numeric(14,3);
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  select * into v_rec from public.receptions where id = p_reception_id for update;
  if not found then raise exception 'recepción % no existe', p_reception_id; end if;
  if v_rec.status <> 'cuarentena' then
    raise exception 'recepción % no está en cuarentena (estado %)', v_rec.public_id, v_rec.status;
  end if;

  for v_item in
    select * from public.reception_items
    where reception_id = p_reception_id and status = 'cuarentena' and inventory_item_id is not null
  loop
    update public.inventory_items
      set stock_available = stock_available + v_item.quantity,
          stock_reserved  = stock_reserved  - v_item.quantity
      where id = v_item.inventory_item_id;

    select stock_available + stock_reserved into v_bal
      from public.inventory_items where id = v_item.inventory_item_id;

    -- el total no cambia (solo el bucket): before = after = saldo actual
    insert into public.inventory_movements
      (movement_type, inventory_item_id, lot_number, quantity, before_quantity, after_quantity,
       from_position_id, to_position_id, reason, notes, reference_type, reference_id, created_by)
    values
      ('ajuste', v_item.inventory_item_id, v_item.lot_number, v_item.quantity, v_bal, v_bal,
       null, null, 'Liberación cuarentena ' || v_rec.public_id, null, 'recepcion', p_reception_id, auth.uid());

    update public.reception_items set status = 'recibido' where id = v_item.id;
  end loop;

  update public.receptions set status = 'recibida' where id = p_reception_id;
end;
$$;

-- =========================================================================
-- 3c) confirm_movement — traslado (completo) / ajuste / egreso.
--     Valida la referencia (ajuste 1) para evitar movimientos huérfanos.
-- =========================================================================
create or replace function public.confirm_movement(
  p_inventory_item_id uuid,
  p_movement_type     movement_type_t,
  p_to_position_id    uuid    default null,
  p_quantity          numeric default null,    -- ajuste(delta) / egreso(salida)
  p_reason            text    default null,
  p_notes             text    default null,
  p_reference_type    movement_reference_t default null,
  p_reference_id      uuid    default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.inventory_items;
  v_before numeric(14,3);
  v_after numeric(14,3);
  v_qty numeric(14,3);
  v_from uuid;
  v_to uuid;
  v_exists boolean;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;
  if p_movement_type = 'ingreso' then
    raise exception 'ingreso solo se registra vía confirm_reception';
  end if;

  -- Validación de referencia (ajuste 1): nunca huérfana
  if p_reference_type is not null and p_reference_id is not null then
    if p_reference_type = 'recepcion' then
      select exists(select 1 from public.receptions where id = p_reference_id) into v_exists;
    elsif p_reference_type = 'movimiento' then
      select exists(select 1 from public.inventory_movements where id = p_reference_id) into v_exists;
    else
      v_exists := true;   -- 'ajuste' / 'despacho' (shipments aún no existe): se valida al implementar Despachos
    end if;
    if not v_exists then
      raise exception 'reference % % no existe (movimiento huérfano)', p_reference_type, p_reference_id;
    end if;
  end if;

  select * into v_inv from public.inventory_items where id = p_inventory_item_id for update;
  if not found then raise exception 'inventory_item % no existe', p_inventory_item_id; end if;

  v_before := v_inv.stock_available + v_inv.stock_reserved;
  v_from := v_inv.position_id;
  v_to := v_inv.position_id;

  if p_movement_type = 'traslado' then
    -- movimiento COMPLETO (sin split): el ítem entero cambia de posición
    if p_to_position_id is null then raise exception 'traslado requiere posición destino'; end if;
    update public.inventory_items set position_id = p_to_position_id where id = p_inventory_item_id;
    v_to := p_to_position_id;
    v_after := v_before;          -- stock no cambia, solo la ubicación
    v_qty := v_before;
  elsif p_movement_type = 'ajuste' then
    if p_quantity is null then raise exception 'ajuste requiere cantidad (delta)'; end if;
    update public.inventory_items
      set stock_available = stock_available + p_quantity,
          active = case when (stock_available + p_quantity + stock_reserved) <= 0 then false else true end
      where id = p_inventory_item_id;
    v_after := v_before + p_quantity;
    v_qty := p_quantity;
  elsif p_movement_type = 'egreso' then
    if p_quantity is null or p_quantity <= 0 then raise exception 'egreso requiere cantidad positiva'; end if;
    update public.inventory_items
      set stock_available = stock_available - p_quantity,
          active = case when (stock_available - p_quantity + stock_reserved) <= 0 then false else true end
      where id = p_inventory_item_id;
    v_after := v_before - p_quantity;
    v_qty := p_quantity;
    v_to := null;                 -- sale del depósito
  end if;

  insert into public.inventory_movements
    (movement_type, inventory_item_id, lot_number, quantity, before_quantity, after_quantity,
     from_position_id, to_position_id, reason, notes, reference_type, reference_id, created_by)
  values
    (p_movement_type, p_inventory_item_id, null, v_qty, v_before, v_after,
     v_from, v_to, p_reason, p_notes, p_reference_type, p_reference_id, auth.uid());
end;
$$;

-- ---- Grants: las RPC se invocan desde la app (rol authenticated) --------
grant execute on function public.confirm_reception(uuid)  to authenticated;
grant execute on function public.release_quarantine(uuid) to authenticated;
grant execute on function public.confirm_movement(uuid, movement_type_t, uuid, numeric, text, text, movement_reference_t, uuid) to authenticated;

notify pgrst, 'reload schema';
