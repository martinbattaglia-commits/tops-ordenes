-- =========================================================================
-- GATE 4A · PICKING — Kit de validación (smoke-test formal).
-- Para el SQL Editor de Supabase. Correr DESPUÉS de aplicar 0032_wms_picking.sql.
--
-- DOBLE GARANTÍA DE 0 FOOTPRINT (no ensucia datos productivos):
--   1) Todo el script va envuelto en BEGIN … ROLLBACK de nivel superior.
--   2) Además, cada caso es un bloque DO $$..$$ que revierte su propio fixture
--      con el sentinel '__qa_rollback__' (savepoint implícito del bloque
--      BEGIN..EXCEPTION de PL/pgSQL) → incluso corriendo bloque por bloque
--      queda 0 footprint. Picking NO escribe inventory_movements, así que el
--      rollback no choca con el trigger de inmutabilidad del ledger.
--
-- Cada bloque:
--   · auto-descubre un profiles.id con rol habilitado y simula el JWT
--     (set_config request.jwt.claims) → current_role()/auth.uid() resuelven.
--   · arma stock real vía confirm_reception + allocate_order, ejecuta las RPC
--     de picking y verifica con RAISE NOTICE 'OK ...' / 'FALLO ...'.
--
-- Cobertura (Gate 4A):
--   1. confirm_picking()           — Caso 1
--   2. unpick_allocation()         — Caso 2
--   3. confirm_picking_order()     — Caso 3
--   4. Roll-up de líneas           — Casos 1, 3, 4 (incl. reservado_parcial→pickeado)
--   5. audit_log                   — Caso 5
--   6. Invariante NO-STOCK         — Caso 6
--   7. Invariante NO-LEDGER        — Caso 6 (+ inventory_lots intacto)
--   8. logistics_orders.status     — Caso 7
--   9. Idempotencia                — Caso 8
--  10. Casos límite / guards       — Casos 9 (guards) y 10 (autorización)
--
-- Resultado esperado: solo líneas "OK ...", ninguna "FALLO ...".
-- ⚠️ Requiere 0024/0026/0027 + 0029/0030/0031 + 0032 APLICADAS.
-- =========================================================================

begin;  -- ← transacción de nivel superior (ROLLBACK al final, ver pie del archivo)

-- =========================================================================
-- CASO 1 — confirm_picking(): reservada → pickeada · línea → pickeado ·
--          sin stock · sin ledger · header sin cambios.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_oid uuid; v_line uuid; v_alloc uuid;
  v_av0 numeric; v_rv0 numeric; v_av1 numeric; v_rv1 numeric;
  v_mov0 int; v_mov1 int; v_ast text; v_lst text; v_ost0 text; v_ost1 text;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then raise notice 'SKIP Caso 1: sin rol habilitado'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then raise notice 'SKIP Caso 1: sin posiciones cargadas'; return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PICK_C1','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-A', 'Item A', 100, v_pos, 'L-A', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    select id into v_inv from public.inventory_items where client_name='TEST_QA_PICK_C1' and sku='SKU-A' limit 1;

    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PICK_C1','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-A', 'Item A', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='reservada' limit 1;

    -- snapshot PRE-picking
    select stock_available, stock_reserved into v_av0, v_rv0 from public.inventory_items where id=v_inv;
    select count(*) into v_mov0 from public.inventory_movements;
    select status into v_ost0 from public.logistics_orders where id=v_oid;

    perform public.confirm_picking(v_alloc);

    -- snapshot POST-picking
    select status into v_ast from public.stock_allocations where id=v_alloc;
    select status into v_lst from public.logistics_order_items where id=v_line;
    select stock_available, stock_reserved into v_av1, v_rv1 from public.inventory_items where id=v_inv;
    select count(*) into v_mov1 from public.inventory_movements;
    select status into v_ost1 from public.logistics_orders where id=v_oid;

    if v_ast='pickeada' and v_lst='pickeado' then
      raise notice 'OK Caso 1a: allocation pickeada · línea pickeado';
    else raise notice 'FALLO Caso 1a: alloc=% línea=% (esperado pickeada/pickeado)', v_ast, v_lst; end if;

    if v_av1=v_av0 and v_rv1=v_rv0 and v_av1=40 and v_rv1=60 then
      raise notice 'OK Caso 1b: NO-STOCK (avail % y reserved % sin cambios)', v_av1, v_rv1;
    else raise notice 'FALLO Caso 1b: stock cambió (avail %->%, reserved %->%)', v_av0, v_av1, v_rv0, v_rv1; end if;

    if v_mov1=v_mov0 then
      raise notice 'OK Caso 1c: NO-LEDGER (inventory_movements % sin crecer)', v_mov1;
    else raise notice 'FALLO Caso 1c: ledger creció (% -> %)', v_mov0, v_mov1; end if;

    if v_ost1=v_ost0 and v_ost1='en_preparacion' then
      raise notice 'OK Caso 1d: header sin cambios (en_preparacion)';
    else raise notice 'FALLO Caso 1d: header cambió (% -> %)', v_ost0, v_ost1; end if;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm='__qa_rollback__' then raise notice 'Caso 1: revertido (0 footprint).';
    else raise; end if;
  end;
end $$;

-- =========================================================================
-- CASO 2 — unpick_allocation(): pickeada → reservada · roll-up revierte ·
--          sin stock · header sin cambios.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_oid uuid; v_line uuid; v_alloc uuid;
  v_av numeric; v_rv numeric; v_ast text; v_lst text; v_ost text;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then raise notice 'SKIP Caso 2: sin rol habilitado'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PICK_C2','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-B', 'Item B', 100, v_pos, 'L-B', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    select id into v_inv from public.inventory_items where client_name='TEST_QA_PICK_C2' and sku='SKU-B' limit 1;

    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PICK_C2','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-B', 'Item B', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='reservada' limit 1;

    perform public.confirm_picking(v_alloc);          -- → pickeada / pickeado
    perform public.unpick_allocation(v_alloc);         -- ← reservada / reservado

    select status into v_ast from public.stock_allocations where id=v_alloc;
    select status into v_lst from public.logistics_order_items where id=v_line;
    select stock_available, stock_reserved into v_av, v_rv from public.inventory_items where id=v_inv;
    select status into v_ost from public.logistics_orders where id=v_oid;

    if v_ast='reservada' and v_lst='reservado' then
      raise notice 'OK Caso 2a: unpick revirtió (allocation reservada · línea reservado)';
    else raise notice 'FALLO Caso 2a: alloc=% línea=% (esperado reservada/reservado)', v_ast, v_lst; end if;

    if v_av=40 and v_rv=60 then
      raise notice 'OK Caso 2b: NO-STOCK tras unpick (avail=40 reserved=60)';
    else raise notice 'FALLO Caso 2b: avail=% reserved=%', v_av, v_rv; end if;

    if v_ost='en_preparacion' then
      raise notice 'OK Caso 2c: header sin cambios (en_preparacion)';
    else raise notice 'FALLO Caso 2c: header=%', v_ost; end if;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm='__qa_rollback__' then raise notice 'Caso 2: revertido (0 footprint).';
    else raise; end if;
  end;
end $$;

-- =========================================================================
-- CASO 3 — confirm_picking_order(): pickea TODAS las reservas (2 líneas) ·
--          ambas líneas → pickeado · header sin cambios · sin stock/ledger.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_invA uuid; v_invB uuid; v_oid uuid;
  v_lineA uuid; v_lineB uuid; v_lstA text; v_lstB text; v_ost text;
  v_pick int; v_resv int; v_mov0 int; v_mov1 int;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then raise notice 'SKIP Caso 3: sin rol habilitado'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PICK_C3','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-A', 'Item A', 100, v_pos, 'L-A', date '2027-01-01');
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-B', 'Item B', 100, v_pos, 'L-B', date '2027-02-01');
    perform public.confirm_reception(v_rec);
    select id into v_invA from public.inventory_items where client_name='TEST_QA_PICK_C3' and sku='SKU-A' limit 1;
    select id into v_invB from public.inventory_items where client_name='TEST_QA_PICK_C3' and sku='SKU-B' limit 1;

    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PICK_C3','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-A', 'Item A', 60) returning id into v_lineA;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-B', 'Item B', 20) returning id into v_lineB;
    perform public.allocate_order(v_oid);

    select count(*) into v_mov0 from public.inventory_movements;

    perform public.confirm_picking_order(v_oid);

    select count(*) into v_mov1 from public.inventory_movements;
    select status into v_lstA from public.logistics_order_items where id=v_lineA;
    select status into v_lstB from public.logistics_order_items where id=v_lineB;
    select status into v_ost  from public.logistics_orders where id=v_oid;
    select count(*) into v_pick from public.stock_allocations sa join public.logistics_order_items li on li.id=sa.order_item_id
      where li.order_id=v_oid and sa.status='pickeada';
    select count(*) into v_resv from public.stock_allocations sa join public.logistics_order_items li on li.id=sa.order_item_id
      where li.order_id=v_oid and sa.status='reservada';

    if v_lstA='pickeado' and v_lstB='pickeado' and v_pick=2 and v_resv=0 then
      raise notice 'OK Caso 3a: ambas líneas pickeado · 2 allocations pickeadas · 0 reservadas';
    else raise notice 'FALLO Caso 3a: lA=% lB=% pickeadas=% reservadas=%', v_lstA, v_lstB, v_pick, v_resv; end if;

    if v_ost='en_preparacion' then
      raise notice 'OK Caso 3b: header sin cambios (en_preparacion · NO pasa a preparado en 4A)';
    else raise notice 'FALLO Caso 3b: header=% (esperado en_preparacion)', v_ost; end if;

    if v_mov1=v_mov0 then
      raise notice 'OK Caso 3c: NO-LEDGER (inventory_movements sin crecer)';
    else raise notice 'FALLO Caso 3c: ledger % -> %', v_mov0, v_mov1; end if;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm='__qa_rollback__' then raise notice 'Caso 3: revertido (0 footprint).';
    else raise; end if;
  end;
end $$;

-- =========================================================================
-- CASO 4 — Roll-up parcial: línea 'reservado_parcial' cuyas reservas se
--          pickean → 'pickeado' (el faltante se deriva, no hay pickeado_parcial).
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_oid uuid; v_line uuid; v_alloc uuid;
  v_lst0 text; v_lst1 text; v_alloc_qty numeric; v_req numeric;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then raise notice 'SKIP Caso 4: sin rol habilitado'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PICK_C4','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-P', 'Item P', 40, v_pos, 'L-P', date '2027-01-01');   -- stock 40
    perform public.confirm_reception(v_rec);
    select id into v_inv from public.inventory_items where client_name='TEST_QA_PICK_C4' and sku='SKU-P' limit 1;

    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PICK_C4','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-P', 'Item P', 100) returning id into v_line;                 -- pide 100
    perform public.allocate_order(v_oid);                                              -- reserva 40 → parcial

    select status into v_lst0 from public.logistics_order_items where id=v_line;
    select id, quantity into v_alloc, v_alloc_qty from public.stock_allocations where order_item_id=v_line and status='reservada' limit 1;

    perform public.confirm_picking(v_alloc);

    select status into v_lst1 from public.logistics_order_items where id=v_line;
    select quantity_requested into v_req from public.logistics_order_items where id=v_line;

    if v_lst0='reservado_parcial' and v_lst1='pickeado' and v_alloc_qty=40 and v_req=100 then
      raise notice 'OK Caso 4: reservado_parcial(40/100) → pickeado tras pickear su reserva (faltante 60 derivado)';
    else raise notice 'FALLO Caso 4: lst0=% lst1=% alloc=% req=%', v_lst0, v_lst1, v_alloc_qty, v_req; end if;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm='__qa_rollback__' then raise notice 'Caso 4: revertido (0 footprint).';
    else raise; end if;
  end;
end $$;

-- =========================================================================
-- CASO 5 — audit_log: confirm_picking + unpick generan filas correctas
--          (entity='stock_allocation', actions picking.confirm/unpick, from→to).
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_oid uuid; v_line uuid; v_alloc uuid;
  v_n0 int; v_n_conf int; v_n_unp int;
  v_act text; v_from text; v_to text; v_eid uuid; v_qty numeric;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then raise notice 'SKIP Caso 5: sin rol habilitado'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PICK_C5','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-AUD', 'Item AUD', 100, v_pos, 'L-AUD', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    select id into v_inv from public.inventory_items where client_name='TEST_QA_PICK_C5' and sku='SKU-AUD' limit 1;

    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PICK_C5','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-AUD', 'Item AUD', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='reservada' limit 1;

    select count(*) into v_n0 from public.audit_log where entity='stock_allocation' and entity_id=v_alloc;

    perform public.confirm_picking(v_alloc);
    select count(*) into v_n_conf from public.audit_log
      where entity='stock_allocation' and entity_id=v_alloc and action='picking.confirm';
    -- inspeccionar el payload del confirm
    select action, payload->>'from', payload->>'to', (payload->>'quantity')::numeric
      into v_act, v_from, v_to, v_qty
      from public.audit_log where entity='stock_allocation' and entity_id=v_alloc and action='picking.confirm'
      order by ts desc limit 1;

    perform public.unpick_allocation(v_alloc);
    select count(*) into v_n_unp from public.audit_log
      where entity='stock_allocation' and entity_id=v_alloc and action='picking.unpick';

    if v_n0=0 and v_n_conf=1 and v_n_unp=1 then
      raise notice 'OK Caso 5a: audit_log registró 1 picking.confirm + 1 picking.unpick';
    else raise notice 'FALLO Caso 5a: pre=% confirm=% unpick=%', v_n0, v_n_conf, v_n_unp; end if;

    if v_act='picking.confirm' and v_from='reservada' and v_to='pickeada' and v_qty=60 then
      raise notice 'OK Caso 5b: payload confirm correcto (from=reservada to=pickeada qty=60)';
    else raise notice 'FALLO Caso 5b: act=% from=% to=% qty=%', v_act, v_from, v_to, v_qty; end if;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm='__qa_rollback__' then raise notice 'Caso 5: revertido (0 footprint).';
    else raise; end if;
  end;
end $$;

-- =========================================================================
-- CASO 6 — Invariantes duras NO-STOCK + NO-LEDGER + inventory_lots intacto,
--          a lo largo de un ciclo completo (confirm_picking_order).
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_oid uuid; v_line uuid;
  v_av0 numeric; v_rv0 numeric; v_av1 numeric; v_rv1 numeric;
  v_lot0 numeric; v_lot1 numeric; v_mov0 int; v_mov1 int; v_items0 int; v_items1 int;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then raise notice 'SKIP Caso 6: sin rol habilitado'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PICK_C6','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-INV', 'Item INV', 100, v_pos, 'L-INV', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    select id into v_inv from public.inventory_items where client_name='TEST_QA_PICK_C6' and sku='SKU-INV' limit 1;

    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PICK_C6','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-INV', 'Item INV', 70) returning id into v_line;
    perform public.allocate_order(v_oid);

    -- snapshot PRE-picking
    select stock_available, stock_reserved into v_av0, v_rv0 from public.inventory_items where id=v_inv;
    select quantity into v_lot0 from public.inventory_lots where inventory_item_id=v_inv and lot_number='L-INV';
    select count(*) into v_mov0 from public.inventory_movements;
    select count(*) into v_items0 from public.inventory_items;

    perform public.confirm_picking_order(v_oid);

    -- snapshot POST-picking
    select stock_available, stock_reserved into v_av1, v_rv1 from public.inventory_items where id=v_inv;
    select quantity into v_lot1 from public.inventory_lots where inventory_item_id=v_inv and lot_number='L-INV';
    select count(*) into v_mov1 from public.inventory_movements;
    select count(*) into v_items1 from public.inventory_items;

    if v_av1=v_av0 and v_rv1=v_rv0 and v_av1=30 and v_rv1=70 then
      raise notice 'OK Caso 6a: NO-STOCK (avail=30 reserved=70 sin cambios)';
    else raise notice 'FALLO Caso 6a: avail %->% reserved %->%', v_av0, v_av1, v_rv0, v_rv1; end if;

    if v_lot1=v_lot0 and v_lot1=100 then
      raise notice 'OK Caso 6b: inventory_lots INTACTO (quantity=100; el decremento es de Gate 4C)';
    else raise notice 'FALLO Caso 6b: inventory_lots cambió (% -> %)', v_lot0, v_lot1; end if;

    if v_mov1=v_mov0 then
      raise notice 'OK Caso 6c: NO-LEDGER (inventory_movements sin crecer)';
    else raise notice 'FALLO Caso 6c: ledger % -> %', v_mov0, v_mov1; end if;

    if v_items1=v_items0 then
      raise notice 'OK Caso 6d: inventory_items sin filas nuevas';
    else raise notice 'FALLO Caso 6d: inventory_items % -> %', v_items0, v_items1; end if;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm='__qa_rollback__' then raise notice 'Caso 6: revertido (0 footprint).';
    else raise; end if;
  end;
end $$;

-- =========================================================================
-- CASO 7 — logistics_orders.status NO cambia por Picking (queda en_preparacion
--          tras parada individual Y tras pedido completo).
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_oid uuid; v_line uuid; v_alloc uuid;
  v_s_alloc text; v_s_single text; v_s_order text;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then raise notice 'SKIP Caso 7: sin rol habilitado'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PICK_C7','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-H', 'Item H', 100, v_pos, 'L-H', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PICK_C7','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-H', 'Item H', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    select status into v_s_alloc from public.logistics_orders where id=v_oid;     -- tras allocate
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='reservada' limit 1;

    perform public.confirm_picking(v_alloc);
    select status into v_s_single from public.logistics_orders where id=v_oid;     -- tras parada
    perform public.confirm_picking_order(v_oid);
    select status into v_s_order from public.logistics_orders where id=v_oid;      -- tras pedido completo

    if v_s_alloc='en_preparacion' and v_s_single='en_preparacion' and v_s_order='en_preparacion' then
      raise notice 'OK Caso 7: header en_preparacion estable en todo el ciclo de picking';
    else raise notice 'FALLO Caso 7: allocate=% single=% order=%', v_s_alloc, v_s_single, v_s_order; end if;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm='__qa_rollback__' then raise notice 'Caso 7: revertido (0 footprint).';
    else raise; end if;
  end;
end $$;

-- =========================================================================
-- CASO 8 — Idempotencia: confirm_picking_order 2x = estable (sin audit extra);
--          y un 2.º confirm_picking sobre allocation ya pickeada → rechaza.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_oid uuid; v_line uuid; v_alloc uuid;
  v_aud1 int; v_aud2 int; v_pick int; v_raised boolean := false;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then raise notice 'SKIP Caso 8: sin rol habilitado'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PICK_C8','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-ID', 'Item ID', 100, v_pos, 'L-ID', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PICK_C8','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-ID', 'Item ID', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='reservada' limit 1;

    perform public.confirm_picking_order(v_oid);
    select count(*) into v_aud1 from public.audit_log sa where entity='stock_allocation'
      and entity_id in (select al.id from public.stock_allocations al join public.logistics_order_items li on li.id=al.order_item_id where li.order_id=v_oid);
    perform public.confirm_picking_order(v_oid);   -- 2.ª corrida: no debe duplicar nada
    select count(*) into v_aud2 from public.audit_log sa where entity='stock_allocation'
      and entity_id in (select al.id from public.stock_allocations al join public.logistics_order_items li on li.id=al.order_item_id where li.order_id=v_oid);
    select count(*) into v_pick from public.stock_allocations al join public.logistics_order_items li on li.id=al.order_item_id
      where li.order_id=v_oid and al.status='pickeada';

    if v_aud2=v_aud1 and v_pick=1 then
      raise notice 'OK Caso 8a: confirm_picking_order idempotente (audit estable=% · 1 pickeada)', v_aud2;
    else raise notice 'FALLO Caso 8a: audit %->% pickeadas=%', v_aud1, v_aud2, v_pick; end if;

    -- 2.º confirm_picking sobre la MISMA allocation (ya pickeada) → debe rechazar
    begin
      perform public.confirm_picking(v_alloc);
    exception when others then
      if sqlerrm <> '__qa_rollback__' then v_raised := true; end if;
    end;
    if v_raised then
      raise notice 'OK Caso 8b: confirm_picking sobre allocation ya pickeada → rechazado';
    else raise notice 'FALLO Caso 8b: confirm_picking NO rechazó sobre allocation pickeada'; end if;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm='__qa_rollback__' then raise notice 'Caso 8: revertido (0 footprint).';
    else raise; end if;
  end;
end $$;

-- =========================================================================
-- CASO 9 — Casos límite / guards:
--   9a confirm_picking sobre allocation 'liberada' → rechaza.
--   9b unpick_allocation sobre allocation 'reservada' (no pickeada) → rechaza.
--   9c confirm_picking_order sobre pedido NO en_preparacion → rechaza.
--   9d unpick forward-guard: línea despachado/empacado/cancelado → rechaza.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_alloc uuid; v_oid2 uuid;
  v_ok9a boolean := false; v_ok9b boolean := false; v_ok9c boolean := false; v_ok9d boolean := false;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then raise notice 'SKIP Caso 9: sin rol habilitado'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PICK_C9','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-G', 'Item G', 100, v_pos, 'L-G', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PICK_C9','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-G', 'Item G', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='reservada' limit 1;

    -- 9a: liberar la reserva y luego intentar pickearla
    perform public.release_allocation(v_alloc);
    begin perform public.confirm_picking(v_alloc);
    exception when others then if sqlerrm<>'__qa_rollback__' then v_ok9a := true; end if; end;
    if v_ok9a then raise notice 'OK Caso 9a: confirm_picking sobre liberada → rechazado';
    else raise notice 'FALLO Caso 9a: confirm_picking aceptó una allocation liberada'; end if;

    -- 9b: nueva reserva (re-allocate) y unpick sin haber pickeado
    perform public.allocate_order(v_oid);
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='reservada' limit 1;
    begin perform public.unpick_allocation(v_alloc);
    exception when others then if sqlerrm<>'__qa_rollback__' then v_ok9b := true; end if; end;
    if v_ok9b then raise notice 'OK Caso 9b: unpick sobre reservada (no pickeada) → rechazado';
    else raise notice 'FALLO Caso 9b: unpick aceptó una allocation no pickeada'; end if;

    -- 9c: pedido NO en_preparacion (queda en 'pendiente', sin reservas)
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PICK_C9','pendiente') returning id into v_oid2;
    begin perform public.confirm_picking_order(v_oid2);
    exception when others then if sqlerrm<>'__qa_rollback__' then v_ok9c := true; end if; end;
    if v_ok9c then raise notice 'OK Caso 9c: confirm_picking_order sobre pedido pendiente → rechazado';
    else raise notice 'FALLO Caso 9c: confirm_picking_order aceptó pedido no en_preparacion'; end if;

    -- 9d: forward-guard. Pickear, forzar línea 'despachado' (solo en el test) e intentar unpick.
    perform public.confirm_picking(v_alloc);
    update public.logistics_order_items set status='despachado'::order_item_status_t where id=v_line;
    begin perform public.unpick_allocation(v_alloc);
    exception when others then if sqlerrm<>'__qa_rollback__' then v_ok9d := true; end if; end;
    if v_ok9d then raise notice 'OK Caso 9d: unpick bloqueado con línea despachado (forward-guard)';
    else raise notice 'FALLO Caso 9d: unpick NO respetó el forward-guard'; end if;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm='__qa_rollback__' then raise notice 'Caso 9: revertido (0 footprint).';
    else raise; end if;
  end;
end $$;

-- =========================================================================
-- CASO 10 — Autorización: sin rol habilitado (JWT vacío) las RPC de picking
--           rechazan con insufficient_privilege.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_alloc uuid;
  v_ok_conf boolean := false; v_ok_order boolean := false; v_ok_unp boolean := false;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then raise notice 'SKIP Caso 10: sin rol habilitado'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PICK_C10','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-Z', 'Item Z', 100, v_pos, 'L-Z', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PICK_C10','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-Z', 'Item Z', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='reservada' limit 1;

    -- limpiar JWT → current_role() = null → todas deben rechazar
    perform set_config('request.jwt.claims', '', true);

    begin perform public.confirm_picking(v_alloc);
    exception when insufficient_privilege then v_ok_conf := true;
             when others then if sqlerrm<>'__qa_rollback__' then v_ok_conf := true; end if; end;
    begin perform public.confirm_picking_order(v_oid);
    exception when insufficient_privilege then v_ok_order := true;
             when others then if sqlerrm<>'__qa_rollback__' then v_ok_order := true; end if; end;
    begin perform public.unpick_allocation(v_alloc);
    exception when insufficient_privilege then v_ok_unp := true;
             when others then if sqlerrm<>'__qa_rollback__' then v_ok_unp := true; end if; end;

    if v_ok_conf and v_ok_order and v_ok_unp then
      raise notice 'OK Caso 10: confirm_picking / confirm_picking_order / unpick rechazan sin autorización';
    else raise notice 'FALLO Caso 10: conf=% order=% unpick=%', v_ok_conf, v_ok_order, v_ok_unp; end if;

    -- restaurar JWT para cerrar limpio
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm='__qa_rollback__' then raise notice 'Caso 10: revertido (0 footprint).';
    else raise; end if;
  end;
end $$;

rollback;  -- ← revierte TODO el smoke-test (doble seguro junto al sentinel por bloque)

-- =========================================================================
-- Verificación de 0 footprint (READ-ONLY, correr aparte tras el ROLLBACK):
--   select count(*) from public.logistics_orders where client_name like 'TEST_QA_PICK_%'; -- 0
--   select count(*) from public.inventory_items   where client_name like 'TEST_QA_PICK_%'; -- 0
--   select count(*) from public.audit_log where action in ('picking.confirm','picking.unpick')
--     and payload->>'order_item_id' is not null; -- sin filas de TEST (todas revertidas)
-- =========================================================================
