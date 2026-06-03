-- =========================================================================
-- 0032_wms_picking.sql — GATE 4A: confirmación de PICKING.
--
-- Avanza una reserva por el ciclo de preparación: 'reservada' → 'pickeada' (y la
-- reversa 'pickeada' → 'reservada'). El picking es la confirmación FÍSICA de que
-- el operario retiró la mercadería de su posición y la llevó a preparación.
--
-- ALCANCE (aprobado Gate 4A — mantener EXACTO):
--   · SIN waves: 1 pedido = 1 sesión de picking (no se crea picking_runs).
--   · Confirmación POR ALLOCATION/POSICIÓN (granularidad de ruta) +
--     conveniencia "pedido completo".
--   · CON unpick (deshacer un picking confirmado).
--   · NO toca stock: stock_available / stock_reserved quedan intactos (la
--     mercadería ya está en el bucket 'reservado' desde allocate_order). El
--     egreso real y el decremento de inventory_lots son de Gate 4C (Despacho).
--   · NO escribe inventory_movements (picking no es movimiento de stock; es un
--     cambio de estado de la reserva). El ledger físico se toca recién en 4C.
--   · NO modifica el header del pedido: logistics_orders.status queda en
--     'en_preparacion'. El avance a 'preparado' ocurre en 4B (Packing).
--   · ADDITIVE ONLY: no altera tablas ni RPC de Gates 1–3. No crea tablas
--     operativas nuevas (solo funciones + escritura en el audit_log existente).
--
-- NO MODIFICA (garantía explícita Gate 4A): esta migración NO toca
--   logistics_orders.status, NI inventory_movements, NI inventory_items, NI
--   inventory_lots. La PROPIEDAD FÍSICA del stock sigue gobernada por:
--     · Gate 3 (allocate_order)  → reserva: stock_available → stock_reserved.
--     · Gate 4C (confirm_dispatch) → egreso: salida del depósito + inventory_lots--.
--   Picking es SOLO un cambio de estado de la reserva (reservada↔pickeada): la
--   mercadería no cambia de bucket ni egresa; el stock no se mueve.
--
-- ROLL-UP DE LÍNEA (order_item_status_t, congelado en 0030):
--   La línea pasa a 'pickeado' cuando NO le queda ninguna allocation en
--   'reservada' y tiene al menos una pickeada/empacada/despachada. Una línea
--   'reservado_parcial' (cobertura < solicitado) cuyas reservas se pickearon
--   también queda 'pickeado' (el faltante se sigue derivando de
--   quantity_allocated < quantity_requested; el enum no tiene 'pickeado_parcial').
--
-- AUDITORÍA (hook pedido): cada transición reservada↔pickeada inserta una fila
--   en public.audit_log (entity='stock_allocation', action='picking.confirm' /
--   'picking.unpick', payload con ítem/lote/cantidad y from→to). Las RPC son
--   SECURITY DEFINER (owner) → bypassan RLS para el insert, igual que
--   confirm_reception sobre inventory_movements.
--
-- GATE 5 (forward-compat · NO implementar acá): la cadena de custodia digital
--   (QR único, evidencia fotográfica y trazabilidad POR UNIDAD logística) se
--   construye en Gate 5. Diseño deliberado para no bloquearlo: la allocation es
--   un BUCKET DE CANTIDAD (ítem+lote+posición+cantidad), NO asume "1 allocation =
--   1 unidad". Gate 5 podrá colgar identidad por unidad referenciando la
--   allocation (o el evento de picking) sin reabrir este gate.
--
-- HOTFIX 42804 (uniforme con 0031): CAST EXPLÍCITO a enum en TODA asignación
--   (::alloc_status_t / ::order_item_status_t). Las comparaciones van sin cast.
--
-- Re-ejecutable: create or replace + revoke/grant idempotentes.
-- ⚠️ Requiere 0024/0026/0027 y 0029/0030/0031 APLICADAS. NO aplicar todavía.
-- =========================================================================

-- =========================================================================
-- 0) Helper interno: recalcula el estado de UNA línea según sus allocations.
--    SECURITY DEFINER + REVOKE de public/authenticated → NO invocable desde la
--    API; solo lo llaman las RPC de picking (owner). Simétrico para confirm/
--    unpick: deriva el estado de la línea de la realidad de stock_allocations.
-- =========================================================================
create or replace function public.wms_pick_recompute_line(p_order_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur  order_item_status_t;
  v_req  numeric(14,3);
  v_active numeric(14,3);          -- Σ reservas NO liberadas (reservada+pickeada+…)
  v_has_reservada boolean;         -- queda algo por pickear
  v_has_picked    boolean;         -- hay al menos una pickeada/empacada/despachada
begin
  select status, quantity_requested into v_cur, v_req
    from public.logistics_order_items where id = p_order_item_id;
  if not found then return; end if;

  -- Solo se recalculan líneas dentro del tramo reserva/picking. No se tocan
  -- 'pendiente' (sin reservas), ni estados posteriores/terminales que gobiernan
  -- otros gates (empacado/despachado/cancelado).
  if v_cur not in ('reservado','reservado_parcial','pickeado') then
    return;
  end if;

  select coalesce(sum(quantity), 0) into v_active
    from public.stock_allocations
    where order_item_id = p_order_item_id and status <> 'liberada';

  select exists(
    select 1 from public.stock_allocations
    where order_item_id = p_order_item_id and status = 'reservada'
  ) into v_has_reservada;

  select exists(
    select 1 from public.stock_allocations
    where order_item_id = p_order_item_id and status in ('pickeada','empacada','despachada')
  ) into v_has_picked;

  update public.logistics_order_items
    set status = (case
                   when v_has_reservada and v_active >= v_req then 'reservado'
                   when v_has_reservada                        then 'reservado_parcial'
                   when v_has_picked                           then 'pickeado'
                   else 'pendiente'
                 end)::order_item_status_t
    where id = p_order_item_id;
end;
$$;

revoke execute on function public.wms_pick_recompute_line(uuid) from public;
revoke execute on function public.wms_pick_recompute_line(uuid) from authenticated;

-- =========================================================================
-- 1) confirm_picking — confirma el picking de UNA allocation (una parada de la
--    ruta: ítem+lote+posición). 'reservada' → 'pickeada'. Sin stock, sin ledger.
-- =========================================================================
create or replace function public.confirm_picking(p_allocation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alloc public.stock_allocations;
begin
  -- DEFINER bypasea RLS → autorización explícita
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  select * into v_alloc from public.stock_allocations where id = p_allocation_id for update;
  if not found then
    raise exception 'allocation % no existe', p_allocation_id using errcode = 'no_data_found';
  end if;
  if v_alloc.status <> 'reservada' then
    raise exception 'allocation % no está reservada (estado %) — no se puede pickear',
      p_allocation_id, v_alloc.status;
  end if;

  update public.stock_allocations
    set status = 'pickeada'::alloc_status_t
    where id = p_allocation_id;

  -- Hook de auditoría: reservada → pickeada
  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'stock_allocation', v_alloc.id, 'picking.confirm',
          jsonb_build_object(
            'order_item_id',     v_alloc.order_item_id,
            'inventory_item_id', v_alloc.inventory_item_id,
            'lot_number',        v_alloc.lot_number,
            'quantity',          v_alloc.quantity,
            'from',              'reservada',
            'to',                'pickeada'));

  perform public.wms_pick_recompute_line(v_alloc.order_item_id);
end;
$$;

-- =========================================================================
-- 2) confirm_picking_order — conveniencia "pedido completo": pickea en UNA
--    transacción todas las allocations 'reservada' del pedido. Idempotente
--    (si no hay reservadas, es no-op). Orden de lock por inventory_item_id.
-- =========================================================================
create or replace function public.confirm_picking_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.logistics_orders;
  v_alloc record;
  v_line_id uuid;
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
    raise exception 'pedido % no está en preparación (estado %) — no se puede pickear',
      v_order.public_id, v_order.status;
  end if;

  for v_alloc in
    select sa.id, sa.order_item_id, sa.inventory_item_id, sa.lot_number, sa.quantity
    from public.stock_allocations sa
    join public.logistics_order_items li on li.id = sa.order_item_id
    where li.order_id = p_order_id and sa.status = 'reservada'
    order by sa.inventory_item_id            -- orden consistente de lock
    for update of sa
  loop
    update public.stock_allocations
      set status = 'pickeada'::alloc_status_t
      where id = v_alloc.id;

    insert into public.audit_log (user_id, entity, entity_id, action, payload)
    values (auth.uid(), 'stock_allocation', v_alloc.id, 'picking.confirm',
            jsonb_build_object(
              'order_item_id',     v_alloc.order_item_id,
              'inventory_item_id', v_alloc.inventory_item_id,
              'lot_number',        v_alloc.lot_number,
              'quantity',          v_alloc.quantity,
              'from',              'reservada',
              'to',                'pickeada',
              'via',               'order'));
  end loop;

  -- Recalcular el estado de todas las líneas del pedido.
  for v_line_id in
    select id from public.logistics_order_items where order_id = p_order_id
  loop
    perform public.wms_pick_recompute_line(v_line_id);
  end loop;
end;
$$;

-- =========================================================================
-- 3) unpick_allocation — deshacer un picking confirmado: 'pickeada' →
--    'reservada'. Solo si la línea NO avanzó a empacado/despachado/cancelado.
--    Sin stock, sin ledger. Reusa el roll-up (la línea vuelve a reservado/parcial).
-- =========================================================================
create or replace function public.unpick_allocation(p_allocation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alloc public.stock_allocations;
  v_line_status order_item_status_t;
begin
  if public.current_role() is null
     or public.current_role() not in ('admin','operaciones','supervisor') then
    raise exception 'no autorizado' using errcode = 'insufficient_privilege';
  end if;

  select * into v_alloc from public.stock_allocations where id = p_allocation_id for update;
  if not found then
    raise exception 'allocation % no existe', p_allocation_id using errcode = 'no_data_found';
  end if;
  if v_alloc.status <> 'pickeada' then
    raise exception 'allocation % no está pickeada (estado %) — solo se deshace un picking confirmado',
      p_allocation_id, v_alloc.status;
  end if;

  -- Blindaje: si la línea ya avanzó, no se puede revertir el picking.
  select status into v_line_status
    from public.logistics_order_items where id = v_alloc.order_item_id;
  if v_line_status in ('empacado','despachado','cancelado') then
    raise exception 'la línea ya avanzó (estado %) — no se puede deshacer el picking', v_line_status;
  end if;

  update public.stock_allocations
    set status = 'reservada'::alloc_status_t
    where id = p_allocation_id;

  -- Hook de auditoría: pickeada → reservada
  insert into public.audit_log (user_id, entity, entity_id, action, payload)
  values (auth.uid(), 'stock_allocation', v_alloc.id, 'picking.unpick',
          jsonb_build_object(
            'order_item_id',     v_alloc.order_item_id,
            'inventory_item_id', v_alloc.inventory_item_id,
            'lot_number',        v_alloc.lot_number,
            'quantity',          v_alloc.quantity,
            'from',              'pickeada',
            'to',                'reservada'));

  perform public.wms_pick_recompute_line(v_alloc.order_item_id);
end;
$$;

-- ---- Grants: las RPC públicas se invocan desde la app (rol authenticated) ----
grant execute on function public.confirm_picking(uuid)       to authenticated;
grant execute on function public.confirm_picking_order(uuid) to authenticated;
grant execute on function public.unpick_allocation(uuid)     to authenticated;

notify pgrst, 'reload schema';
