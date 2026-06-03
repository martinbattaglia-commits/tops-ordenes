-- =========================================================================
-- 0031_pedidos_functions.sql — FASE 9B (Gate 2): motor de reservas FEFO.
--
-- Contiene (additive · NO altera estructura de columnas existentes):
--   1. Lockdown RLS de stock_allocations → SOLO-LECTURA para roles; toda
--      escritura de reservas pasa EXCLUSIVAMENTE por las RPC SECURITY DEFINER
--      (igual que inventory_items/movements quedaron en 0027).
--   2. RPC transaccionales:
--        allocate_order      — reserva FEFO + parcial + idempotente
--        release_allocation  — libera una reserva (reserved→available)
--        cancel_order        — cancela pedido y libera todas sus reservas
--
-- Reglas de negocio (aprobadas FASE 9B):
--   · FEFO para TODOS los clientes (orden por vencimiento más próximo del ítem).
--   · Reserva PARCIAL habilitada. Línea: 0 reservado → 'pendiente';
--     0<reservado<solicitado → 'reservado_parcial'; 100% → 'reservado'.
--   · allocate_order SOLO desde 'pendiente'/'en_preparacion'.
--   · La reserva es un shift de bucket stock_available→stock_reserved + fila en
--     stock_allocations. NO escribe inventory_movements (no es movimiento físico).
--   · Invariante: stock_reserved = Σ allocations 'reservada' + reservado_por_cuarentena.
--     (La cuarentena sube stock_reserved SIN allocation → nunca colisiona.)
--
-- HOTFIX (incidente 42804 / datatype_mismatch): un CASE con ramas de texto
--   resuelve a `text` y NO castea implícito a una columna ENUM. Se aplica CAST
--   EXPLÍCITO a TODAS las asignaciones de enum (order_item_status_t /
--   logistics_order_status_t / alloc_status_t): el CASE de release_allocation
--   (el que fallaba) y, por uniformidad/blindaje, también los literales y el
--   INSERT. Las COMPARACIONES (where/in/=/<>) quedan sin cast (el literal
--   `unknown` castea implícito; son seguras). Familia enum/text cerrada.
--
-- Re-ejecutable: create or replace + drop policy if exists son idempotentes →
-- correr este archivo de nuevo aplica el fix sobre las funciones vivas.
--
-- ⚠️ Requiere 0024/0026/0027 y 0029/0030 APLICADAS.
-- =========================================================================

-- ---- 1) Lockdown RLS: stock_allocations escribible SOLO vía RPC ----------
drop policy if exists "stock_allocations insert"       on public.stock_allocations;
drop policy if exists "stock_allocations update"       on public.stock_allocations;
drop policy if exists "stock_allocations delete admin" on public.stock_allocations;

-- =========================================================================
-- 2a) allocate_order — reserva FEFO con cobertura parcial e idempotencia.
-- =========================================================================
create or replace function public.allocate_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.logistics_orders;
  v_line  public.logistics_order_items;
  v_already       numeric(14,3);
  v_remaining     numeric(14,3);
  v_reserved_line numeric(14,3);
  v_cand   record;
  v_q      numeric(14,3);
  v_fefo_lot text;
  v_any_reserved boolean := false;
begin
  -- DEFINER bypasea RLS → autorización explícita
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  select * into v_order from public.logistics_orders where id = p_order_id for update;
  if not found then
    raise exception 'pedido % no existe', p_order_id using errcode = 'no_data_found';
  end if;
  if v_order.status not in ('pendiente','en_preparacion') then
    raise exception 'pedido % no es reservable (estado %)', v_order.public_id, v_order.status;
  end if;

  for v_line in
    select * from public.logistics_order_items
    where order_id = p_order_id and status in ('pendiente','reservado_parcial')
    order by created_at
  loop
    -- idempotencia: lo ya reservado de esta línea no se vuelve a reservar
    select coalesce(sum(quantity), 0) into v_already
      from public.stock_allocations
      where order_item_id = v_line.id and status = 'reservada';

    v_remaining := v_line.quantity_requested - v_already;
    if v_remaining <= 0 then
      update public.logistics_order_items
        set status = 'reservado'::order_item_status_t where id = v_line.id;
      v_any_reserved := true;
      continue;
    end if;

    -- Candidatos del (cliente, sku) ordenados FEFO y LOCKEADOS (orden consistente
    -- → sin deadlock y sin overselling entre allocate_order concurrentes).
    for v_cand in
      select ii.id as inv_id,
             ii.stock_available as avail,
             (select min(il.expiration_date) from public.inventory_lots il
                where il.inventory_item_id = ii.id and il.active) as fefo_date
      from public.inventory_items ii
      where ii.client_name = v_order.client_name
        and ii.sku = v_line.sku
        and ii.active
        and ii.stock_available > 0
      order by fefo_date asc nulls last, ii.id
      for update
    loop
      exit when v_remaining <= 0;
      v_q := least(v_remaining, v_cand.avail);
      if v_q <= 0 then continue; end if;

      -- lote FEFO representativo del ítem (más próximo a vencer) para trazabilidad
      select il.lot_number into v_fefo_lot
        from public.inventory_lots il
        where il.inventory_item_id = v_cand.inv_id and il.active
        order by il.expiration_date asc nulls last
        limit 1;

      update public.inventory_items
        set stock_available = stock_available - v_q,
            stock_reserved  = stock_reserved  + v_q
        where id = v_cand.inv_id;

      insert into public.stock_allocations
        (order_item_id, inventory_item_id, lot_number, quantity, status, reserved_at, created_by)
      values
        (v_line.id, v_cand.inv_id, v_fefo_lot, v_q, 'reservada'::alloc_status_t, now(), auth.uid());

      v_remaining := v_remaining - v_q;
    end loop;

    -- Estado de la línea (reglas aprobadas) — cast explícito al enum
    v_reserved_line := v_line.quantity_requested - v_remaining;  -- total reservado (incl. previo)
    if v_remaining <= 0 then
      update public.logistics_order_items
        set status = 'reservado'::order_item_status_t where id = v_line.id;
      v_any_reserved := true;
    elsif v_reserved_line > 0 then
      update public.logistics_order_items
        set status = 'reservado_parcial'::order_item_status_t where id = v_line.id;
      v_any_reserved := true;
    else
      update public.logistics_order_items
        set status = 'pendiente'::order_item_status_t where id = v_line.id;
    end if;
  end loop;

  -- Cabecera: si se reservó algo → en_preparacion; si nada → queda pendiente.
  if v_any_reserved then
    update public.logistics_orders
      set status = 'en_preparacion'::logistics_order_status_t where id = p_order_id;
  end if;
end;
$$;

-- =========================================================================
-- 2b) release_allocation — libera UNA reserva: reserved→available.
-- =========================================================================
create or replace function public.release_allocation(p_allocation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alloc public.stock_allocations;
  v_total numeric(14,3);
  v_req   numeric(14,3);
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  select * into v_alloc from public.stock_allocations where id = p_allocation_id for update;
  if not found then
    raise exception 'allocation % no existe', p_allocation_id using errcode = 'no_data_found';
  end if;
  if v_alloc.status <> 'reservada' then
    raise exception 'allocation % no está reservada (estado %)', p_allocation_id, v_alloc.status;
  end if;

  -- lock del ítem + revertir bucket
  perform 1 from public.inventory_items where id = v_alloc.inventory_item_id for update;
  update public.inventory_items
    set stock_reserved  = stock_reserved  - v_alloc.quantity,
        stock_available = stock_available + v_alloc.quantity
    where id = v_alloc.inventory_item_id;

  update public.stock_allocations
    set status = 'liberada'::alloc_status_t, released_at = now()
    where id = p_allocation_id;

  -- recalcular estado de la línea (si no está ya en una etapa posterior)
  select coalesce(sum(quantity), 0) into v_total
    from public.stock_allocations
    where order_item_id = v_alloc.order_item_id and status = 'reservada';
  select quantity_requested into v_req
    from public.logistics_order_items where id = v_alloc.order_item_id;

  -- HOTFIX 42804: el CASE resuelve a `text` → cast EXPLÍCITO al enum.
  update public.logistics_order_items
    set status = (case
                   when v_total <= 0    then 'pendiente'
                   when v_total < v_req then 'reservado_parcial'
                   else 'reservado'
                 end)::order_item_status_t
    where id = v_alloc.order_item_id
      and status not in ('cancelado','pickeado','empacado','despachado');
end;
$$;

-- =========================================================================
-- 2c) cancel_order — cancela el pedido y libera TODAS sus reservas activas.
-- =========================================================================
create or replace function public.cancel_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.logistics_orders;
  v_alloc record;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  select * into v_order from public.logistics_orders where id = p_order_id for update;
  if not found then
    raise exception 'pedido % no existe', p_order_id using errcode = 'no_data_found';
  end if;
  if v_order.status in ('despachado','entregado') then
    raise exception 'pedido % no se puede cancelar (estado %)', v_order.public_id, v_order.status;
  end if;
  if v_order.status = 'cancelado' then
    return;  -- idempotente
  end if;

  -- liberar todas las reservas activas del pedido (lock + revertir bucket)
  for v_alloc in
    select sa.id, sa.inventory_item_id, sa.quantity
    from public.stock_allocations sa
    join public.logistics_order_items li on li.id = sa.order_item_id
    where li.order_id = p_order_id and sa.status = 'reservada'
    order by sa.inventory_item_id   -- orden consistente de lock
    for update of sa
  loop
    perform 1 from public.inventory_items where id = v_alloc.inventory_item_id for update;
    update public.inventory_items
      set stock_reserved  = stock_reserved  - v_alloc.quantity,
          stock_available = stock_available + v_alloc.quantity
      where id = v_alloc.inventory_item_id;
    update public.stock_allocations
      set status = 'liberada'::alloc_status_t, released_at = now()
      where id = v_alloc.id;
  end loop;

  update public.logistics_order_items
    set status = 'cancelado'::order_item_status_t where order_id = p_order_id;
  update public.logistics_orders
    set status = 'cancelado'::logistics_order_status_t where id = p_order_id;
end;
$$;

-- ---- 3) Grants: las RPC se invocan desde la app (rol authenticated) ------
grant execute on function public.allocate_order(uuid)     to authenticated;
grant execute on function public.release_allocation(uuid) to authenticated;
grant execute on function public.cancel_order(uuid)       to authenticated;

notify pgrst, 'reload schema';
