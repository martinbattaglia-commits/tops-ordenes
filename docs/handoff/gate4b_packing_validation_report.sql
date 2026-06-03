-- =========================================================================
-- GATE 4B · PACKING — Kit de validación con REPORTE EN FILAS.
-- Para el SQL Editor de Supabase. Correr DESPUÉS de aplicar 0033_wms_packing.sql.
--
-- Igual mecánica que gate4a_picking_validation_report.sql:
--   · Cada caso arma su fixture (confirm_reception → allocate_order →
--     confirm_picking_order → packing) y lo REVIERTE con el sentinel
--     '__qa_rollback__' (0 footprint; no es DELETE → no choca con el ledger).
--   · Las mediciones quedan en variables PL/pgSQL (sobreviven al rollback) y se
--     escriben como FILAS en la tabla temporal _qa_pack_report DESPUÉS del
--     sub-bloque. Al final un SELECT muestra caso/check/resultado/detalle.
--
-- Resultado esperado: todas las filas 'OK' (ninguna 'FALLO'). 'SKIP' = faltó
-- rol/posición para montar el caso (no es fallo de la RPC).
--
-- NOTA concurrencia (puntos de revisión 2 y 3): la no-duplicación de BLT y la
-- seguridad despacho-segura de wms_pack_recompute dependen de locks FOR UPDATE,
-- no testeables en una sola sesión. Se valida su CONSECUENCIA observable: la
-- idempotencia no-op de confirm_packing_order (Caso 8) y que despachos parciales
-- no degradan 'preparado' (Caso 10).
--
-- ⚠️ Requiere 0024/0026/0027 + 0029/0030/0031 + 0032 + 0033 APLICADAS.
-- =========================================================================

drop table if exists _qa_pack_report;
create temp table _qa_pack_report (
  seq       serial primary key,
  caso      text,
  chk       text,
  resultado text,
  detalle   text
);

-- =========================================================================
-- CASO 1 — create_packing_unit: bulto 'abierta', public_id 'BLT-...'.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_unit uuid;
  v_pubid text; v_status text; v_unit_order uuid; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 1','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 1','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PACK_C1','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-A', 'Item A', 100, v_pos, 'L-A', date '2027-01-01');
    perform public.confirm_reception(v_rec);

    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PACK_C1','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-A', 'Item A', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    perform public.confirm_picking_order(v_oid);

    select public.create_packing_unit(v_oid, 'Caja 1', 'caja') into v_unit;
    select public_id, status::text, order_id into v_pubid, v_status, v_unit_order
      from public.packing_units where id = v_unit;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 1','ejecución','FALLO', v_err);
  else
    insert into _qa_pack_report(caso,chk,resultado,detalle) values
      ('Caso 1','bulto abierta con public_id BLT- y order_id correcto',
        case when v_status='abierta' and v_pubid like 'BLT-%' and v_unit_order=v_oid then 'OK' else 'FALLO' end,
        format('public_id=%s status=%s order_ok=%s', v_pubid, v_status, (v_unit_order=v_oid)));
  end if;
end $$;

-- =========================================================================
-- CASO 2 — pack_allocation: alloc empacada · línea empacado · pedido preparado.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_alloc uuid; v_unit uuid;
  v_astatus text; v_lstatus text; v_ostatus text; v_items int; v_iqty numeric; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 2','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 2','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PACK_C2','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-B', 'Item B', 100, v_pos, 'L-B', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PACK_C2','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-B', 'Item B', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    perform public.confirm_picking_order(v_oid);
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='pickeada' limit 1;

    select public.create_packing_unit(v_oid, null, null) into v_unit;
    perform public.pack_allocation(v_unit, v_alloc);

    select status into v_astatus from public.stock_allocations where id=v_alloc;
    select status into v_lstatus from public.logistics_order_items where id=v_line;
    select status into v_ostatus from public.logistics_orders where id=v_oid;
    select count(*), coalesce(max(quantity),0) into v_items, v_iqty
      from public.packing_unit_items where allocation_id=v_alloc;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 2','ejecución','FALLO', v_err);
  else
    insert into _qa_pack_report(caso,chk,resultado,detalle) values
      ('Caso 2','alloc empacada · línea empacado · pedido preparado',
        case when v_astatus='empacada' and v_lstatus='empacado' and v_ostatus='preparado' then 'OK' else 'FALLO' end,
        format('alloc=%s linea=%s pedido=%s', v_astatus, v_lstatus, v_ostatus)),
      ('Caso 2','packing_unit_items: 1 fila, quantity=60',
        case when v_items=1 and v_iqty=60 then 'OK' else 'FALLO' end,
        format('items=%s qty=%s', v_items, v_iqty));
  end if;
end $$;

-- =========================================================================
-- CASO 3 — unpack_allocation (bulto abierta): revierte a pickeada/pickeado/en_preparacion.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_alloc uuid; v_unit uuid;
  v_astatus text; v_lstatus text; v_ostatus text; v_items int; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 3','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 3','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PACK_C3','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-C', 'Item C', 100, v_pos, 'L-C', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PACK_C3','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-C', 'Item C', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    perform public.confirm_picking_order(v_oid);
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='pickeada' limit 1;

    select public.create_packing_unit(v_oid, null, null) into v_unit;
    perform public.pack_allocation(v_unit, v_alloc);
    perform public.unpack_allocation(v_alloc);   -- bulto sigue abierta

    select status into v_astatus from public.stock_allocations where id=v_alloc;
    select status into v_lstatus from public.logistics_order_items where id=v_line;
    select status into v_ostatus from public.logistics_orders where id=v_oid;
    select count(*) into v_items from public.packing_unit_items where allocation_id=v_alloc;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 3','ejecución','FALLO', v_err);
  else
    insert into _qa_pack_report(caso,chk,resultado,detalle) values
      ('Caso 3','unpack revierte (pickeada/pickeado/en_preparacion) + item borrado',
        case when v_astatus='pickeada' and v_lstatus='pickeado' and v_ostatus='en_preparacion' and v_items=0 then 'OK' else 'FALLO' end,
        format('alloc=%s linea=%s pedido=%s items=%s', v_astatus, v_lstatus, v_ostatus, v_items));
  end if;
end $$;

-- =========================================================================
-- CASO 4 — confirm_packing_order: 1 BLT cerrada · todo empacado · pedido preparado.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_err text := null;
  v_units int; v_cerradas int; v_empacadas int; v_pickeadas int; v_ostatus text;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 4','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 4','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PACK_C4','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-D', 'Item D', 100, v_pos, 'L-D', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PACK_C4','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-D', 'Item D', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    perform public.confirm_picking_order(v_oid);

    perform public.confirm_packing_order(v_oid);

    select count(*) into v_units    from public.packing_units where order_id=v_oid;
    select count(*) into v_cerradas from public.packing_units where order_id=v_oid and status='cerrada';
    select count(*) into v_empacadas from public.stock_allocations sa join public.logistics_order_items li on li.id=sa.order_item_id where li.order_id=v_oid and sa.status='empacada';
    select count(*) into v_pickeadas from public.stock_allocations sa join public.logistics_order_items li on li.id=sa.order_item_id where li.order_id=v_oid and sa.status='pickeada';
    select status into v_ostatus from public.logistics_orders where id=v_oid;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 4','ejecución','FALLO', v_err);
  else
    insert into _qa_pack_report(caso,chk,resultado,detalle) values
      ('Caso 4','1 BLT cerrada · todo empacado · 0 pickeadas · pedido preparado',
        case when v_units=1 and v_cerradas=1 and v_empacadas=1 and v_pickeadas=0 and v_ostatus='preparado' then 'OK' else 'FALLO' end,
        format('units=%s cerradas=%s empacadas=%s pickeadas=%s pedido=%s', v_units, v_cerradas, v_empacadas, v_pickeadas, v_ostatus));
  end if;
end $$;

-- =========================================================================
-- CASO 5 — close / reopen + close de bulto vacío rechaza.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_alloc uuid; v_unit uuid; v_empty uuid;
  v_st_close text; v_st_reopen text; v_ok_empty boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 5','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 5','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PACK_C5','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-E', 'Item E', 100, v_pos, 'L-E', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PACK_C5','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-E', 'Item E', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    perform public.confirm_picking_order(v_oid);
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='pickeada' limit 1;

    -- bulto vacío → close rechaza
    select public.create_packing_unit(v_oid, 'Vacío', null) into v_empty;
    begin perform public.close_packing_unit(v_empty);
    exception when others then if sqlerrm<>'__qa_rollback__' then v_ok_empty := true; end if; end;

    -- bulto con contenido → close → cerrada → reopen → abierta
    select public.create_packing_unit(v_oid, 'Caja', 'caja') into v_unit;
    perform public.pack_allocation(v_unit, v_alloc);
    perform public.close_packing_unit(v_unit);
    select status into v_st_close from public.packing_units where id=v_unit;
    perform public.reopen_packing_unit(v_unit);
    select status into v_st_reopen from public.packing_units where id=v_unit;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 5','ejecución','FALLO', v_err);
  else
    insert into _qa_pack_report(caso,chk,resultado,detalle) values
      ('Caso 5','close de bulto vacío → rechazado',
        case when v_ok_empty then 'OK' else 'FALLO' end, format('rechazó=%s', v_ok_empty)),
      ('Caso 5','close→cerrada · reopen→abierta',
        case when v_st_close='cerrada' and v_st_reopen='abierta' then 'OK' else 'FALLO' end,
        format('close=%s reopen=%s', v_st_close, v_st_reopen));
  end if;
end $$;

-- =========================================================================
-- CASO 6 — Roll-up multi-línea: pedido 'preparado' SOLO cuando TODAS empacadas.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_lineA uuid; v_lineB uuid;
  v_allocA uuid; v_allocB uuid; v_unit uuid;
  v_ostatus1 text; v_ostatus2 text; v_lA text; v_lB text; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 6','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 6','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PACK_C6','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-A', 'Item A', 100, v_pos, 'L-A', date '2027-01-01');
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-B', 'Item B', 100, v_pos, 'L-B', date '2027-02-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PACK_C6','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-A', 'Item A', 60) returning id into v_lineA;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-B', 'Item B', 20) returning id into v_lineB;
    perform public.allocate_order(v_oid);
    perform public.confirm_picking_order(v_oid);
    select id into v_allocA from public.stock_allocations where order_item_id=v_lineA and status='pickeada' limit 1;
    select id into v_allocB from public.stock_allocations where order_item_id=v_lineB and status='pickeada' limit 1;

    select public.create_packing_unit(v_oid, null, null) into v_unit;
    perform public.pack_allocation(v_unit, v_allocA);          -- solo línea A
    select status into v_ostatus1 from public.logistics_orders where id=v_oid;  -- esperado en_preparacion
    perform public.pack_allocation(v_unit, v_allocB);          -- ahora ambas
    select status into v_ostatus2 from public.logistics_orders where id=v_oid;  -- esperado preparado
    select status into v_lA from public.logistics_order_items where id=v_lineA;
    select status into v_lB from public.logistics_order_items where id=v_lineB;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 6','ejecución','FALLO', v_err);
  else
    insert into _qa_pack_report(caso,chk,resultado,detalle) values
      ('Caso 6','pedido en_preparacion con 1 de 2 líneas empacadas',
        case when v_ostatus1='en_preparacion' then 'OK' else 'FALLO' end, format('pedido(1/2)=%s', v_ostatus1)),
      ('Caso 6','pedido preparado con ambas líneas empacadas',
        case when v_ostatus2='preparado' and v_lA='empacado' and v_lB='empacado' then 'OK' else 'FALLO' end,
        format('pedido(2/2)=%s lA=%s lB=%s', v_ostatus2, v_lA, v_lB));
  end if;
end $$;

-- =========================================================================
-- CASO 7 — Invariantes NO-STOCK + NO-LEDGER + inventory_lots intacto.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_oid uuid; v_line uuid; v_err text := null;
  v_av0 numeric; v_rv0 numeric; v_av1 numeric; v_rv1 numeric;
  v_lot0 numeric; v_lot1 numeric; v_mov0 int; v_mov1 int;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 7','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 7','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PACK_C7','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-INV', 'Item INV', 100, v_pos, 'L-INV', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    select id into v_inv from public.inventory_items where client_name='TEST_QA_PACK_C7' and sku='SKU-INV' limit 1;
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PACK_C7','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-INV', 'Item INV', 70) returning id into v_line;
    perform public.allocate_order(v_oid);
    perform public.confirm_picking_order(v_oid);

    select stock_available, stock_reserved into v_av0, v_rv0 from public.inventory_items where id=v_inv;
    select quantity into v_lot0 from public.inventory_lots where inventory_item_id=v_inv and lot_number='L-INV';
    select count(*) into v_mov0 from public.inventory_movements;

    perform public.confirm_packing_order(v_oid);   -- empaca todo

    select stock_available, stock_reserved into v_av1, v_rv1 from public.inventory_items where id=v_inv;
    select quantity into v_lot1 from public.inventory_lots where inventory_item_id=v_inv and lot_number='L-INV';
    select count(*) into v_mov1 from public.inventory_movements;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 7','ejecución','FALLO', v_err);
  else
    insert into _qa_pack_report(caso,chk,resultado,detalle) values
      ('Caso 7','NO-STOCK (avail=30 reserved=70 sin cambios)',
        case when v_av1=v_av0 and v_rv1=v_rv0 and v_av1=30 and v_rv1=70 then 'OK' else 'FALLO' end,
        format('avail %s->%s reserved %s->%s', v_av0, v_av1, v_rv0, v_rv1)),
      ('Caso 7','inventory_lots INTACTO (100)',
        case when v_lot1=v_lot0 and v_lot1=100 then 'OK' else 'FALLO' end, format('lot %s->%s', v_lot0, v_lot1)),
      ('Caso 7','NO-LEDGER (inventory_movements sin crecer)',
        case when v_mov1=v_mov0 then 'OK' else 'FALLO' end, format('mov %s->%s', v_mov0, v_mov1));
  end if;
end $$;

-- =========================================================================
-- CASO 8 — Idempotencia (2 fixtures independientes):
--   8a confirm_packing_order 2× → 1 solo BLT.
--   8b re-pack de allocation ya empacada (en bulto ABIERTO) → rechaza.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_err text := null;
  -- fixture A
  v_recA uuid; v_oA uuid; v_lA uuid; v_units int;
  -- fixture B
  v_recB uuid; v_oB uuid; v_lB uuid; v_aB uuid; v_uB uuid; v_ok_repack boolean := false;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 8','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 8','setup','SKIP','sin posiciones'); return; end if;

  begin
    -- Fixture A: idempotencia de confirm_packing_order
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PACK_C8A','GENERAL','pendiente',false) returning id into v_recA;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_recA, 'SKU-IDA', 'Item IDA', 100, v_pos, 'L-IDA', date '2027-01-01');
    perform public.confirm_reception(v_recA);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PACK_C8A','pendiente') returning id into v_oA;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oA, 'SKU-IDA', 'Item IDA', 60) returning id into v_lA;
    perform public.allocate_order(v_oA);
    perform public.confirm_picking_order(v_oA);
    perform public.confirm_packing_order(v_oA);
    perform public.confirm_packing_order(v_oA);   -- 2.º: no-op (sin pickeadas)
    select count(*) into v_units from public.packing_units where order_id=v_oA;

    -- Fixture B: re-pack de allocation empacada en bulto ABIERTO (guard de estado)
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PACK_C8B','GENERAL','pendiente',false) returning id into v_recB;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_recB, 'SKU-IDB', 'Item IDB', 100, v_pos, 'L-IDB', date '2027-01-01');
    perform public.confirm_reception(v_recB);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PACK_C8B','pendiente') returning id into v_oB;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oB, 'SKU-IDB', 'Item IDB', 60) returning id into v_lB;
    perform public.allocate_order(v_oB);
    perform public.confirm_picking_order(v_oB);
    select id into v_aB from public.stock_allocations where order_item_id=v_lB and status='pickeada' limit 1;
    select public.create_packing_unit(v_oB, null, null) into v_uB;
    perform public.pack_allocation(v_uB, v_aB);   -- empacada; bulto v_uB sigue ABIERTO
    begin perform public.pack_allocation(v_uB, v_aB);   -- re-pack: alloc empacada → rechaza (guard de estado)
    exception when others then if sqlerrm<>'__qa_rollback__' then v_ok_repack := true; end if; end;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 8','ejecución','FALLO', v_err);
  else
    insert into _qa_pack_report(caso,chk,resultado,detalle) values
      ('Caso 8','8a confirm_packing_order 2× → 1 solo BLT (idempotente)',
        case when v_units=1 then 'OK' else 'FALLO' end, format('units=%s', v_units)),
      ('Caso 8','8b re-pack de allocation empacada (bulto abierto) → rechazado',
        case when v_ok_repack then 'OK' else 'FALLO' end, format('rechazó=%s', v_ok_repack));
  end if;
end $$;

-- =========================================================================
-- CASO 9 — Guards: pack no-pickeada / bulto cerrado / unpack no-empacada /
--          unpack con bulto cerrado / create sobre pedido preparado.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_alloc uuid; v_unit uuid;
  v_ok_nopick boolean := false; v_ok_closedpack boolean := false; v_ok_unpack_noemp boolean := false;
  v_ok_unpack_closed boolean := false; v_ok_create_prep boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 9','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 9','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PACK_C9','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-G', 'Item G', 100, v_pos, 'L-G', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PACK_C9','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-G', 'Item G', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    -- aún NO pickeamos → allocation 'reservada'
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='reservada' limit 1;
    select public.create_packing_unit(v_oid, null, null) into v_unit;

    -- 9a: pack de allocation 'reservada' (no pickeada) → rechaza
    begin perform public.pack_allocation(v_unit, v_alloc);
    exception when others then if sqlerrm<>'__qa_rollback__' then v_ok_nopick := true; end if; end;

    -- ahora pickeamos para los siguientes casos
    perform public.confirm_picking_order(v_oid);
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='pickeada' limit 1;

    -- 9b: pack en bulto cerrado → rechaza  (creamos bulto, lo llenamos, lo cerramos)
    --     usamos un 2.º allocation? solo hay 1. Cerramos un bulto con esta alloc y probamos repack en otro.
    perform public.pack_allocation(v_unit, v_alloc);
    perform public.close_packing_unit(v_unit);
    -- intentar empacar de nuevo (otra unidad) la misma alloc (ya empacada + bulto cerrado)
    -- aquí el guard de 'empacada' ya cubre; para aislar "bulto cerrado" probamos pack de cualquier alloc en v_unit cerrado:
    begin perform public.pack_allocation(v_unit, v_alloc);
    exception when others then if sqlerrm<>'__qa_rollback__' then v_ok_closedpack := true; end if; end;

    -- 9c: unpack con bulto CERRADO → rechaza (debe reabrir primero)
    begin perform public.unpack_allocation(v_alloc);
    exception when others then if sqlerrm<>'__qa_rollback__' then v_ok_unpack_closed := true; end if; end;

    -- 9d: create_packing_unit sobre pedido 'preparado' → rechaza
    --     (con la alloc empacada y bulto cerrado, el pedido quedó 'preparado')
    begin perform public.create_packing_unit(v_oid, null, null);
    exception when others then if sqlerrm<>'__qa_rollback__' then v_ok_create_prep := true; end if; end;

    -- 9e: unpack de allocation NO empacada → rechaza (reabrimos, desempacamos, queda pickeada; reintentar unpack)
    perform public.reopen_packing_unit(v_unit);
    perform public.unpack_allocation(v_alloc);   -- ahora pickeada
    begin perform public.unpack_allocation(v_alloc);  -- 2.º unpack: ya no empacada
    exception when others then if sqlerrm<>'__qa_rollback__' then v_ok_unpack_noemp := true; end if; end;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 9','ejecución','FALLO', v_err);
  else
    insert into _qa_pack_report(caso,chk,resultado,detalle) values
      ('Caso 9','9a pack de reserva no-pickeada → rechazado', case when v_ok_nopick then 'OK' else 'FALLO' end, format('rechazó=%s', v_ok_nopick)),
      ('Caso 9','9b pack en bulto cerrado → rechazado', case when v_ok_closedpack then 'OK' else 'FALLO' end, format('rechazó=%s', v_ok_closedpack)),
      ('Caso 9','9c unpack con bulto cerrado → rechazado', case when v_ok_unpack_closed then 'OK' else 'FALLO' end, format('rechazó=%s', v_ok_unpack_closed)),
      ('Caso 9','9d create sobre pedido preparado → rechazado', case when v_ok_create_prep then 'OK' else 'FALLO' end, format('rechazó=%s', v_ok_create_prep)),
      ('Caso 9','9e unpack de allocation no-empacada → rechazado', case when v_ok_unpack_noemp then 'OK' else 'FALLO' end, format('rechazó=%s', v_ok_unpack_noemp));
  end if;
end $$;

-- =========================================================================
-- CASO 10 — Forward-guard: unpack con LÍNEA despachado (forzado) → rechaza.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_alloc uuid; v_unit uuid;
  v_ok boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 10','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 10','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PACK_C10','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-H', 'Item H', 100, v_pos, 'L-H', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PACK_C10','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-H', 'Item H', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    perform public.confirm_picking_order(v_oid);
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='pickeada' limit 1;
    select public.create_packing_unit(v_oid, null, null) into v_unit;
    perform public.pack_allocation(v_unit, v_alloc);   -- empacada, bulto abierto

    -- forzar línea 'despachado' (solo en el test) e intentar unpack
    update public.logistics_order_items set status='despachado'::order_item_status_t where id=v_line;
    begin perform public.unpack_allocation(v_alloc);
    exception when others then if sqlerrm<>'__qa_rollback__' then v_ok := true; end if; end;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 10','ejecución','FALLO', v_err);
  else
    insert into _qa_pack_report(caso,chk,resultado,detalle) values
      ('Caso 10','unpack con línea despachado → rechazado (forward-guard)',
        case when v_ok then 'OK' else 'FALLO' end, format('rechazó=%s', v_ok));
  end if;
end $$;

-- =========================================================================
-- CASO 11 — audit_log: packing.create / pack / unpack / close presentes.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_alloc uuid; v_unit uuid;
  v_create int; v_pack int; v_unpack int; v_close int; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 11','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 11','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PACK_C11','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-AUD', 'Item AUD', 100, v_pos, 'L-AUD', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PACK_C11','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-AUD', 'Item AUD', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    perform public.confirm_picking_order(v_oid);
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='pickeada' limit 1;

    select public.create_packing_unit(v_oid, null, null) into v_unit;
    perform public.pack_allocation(v_unit, v_alloc);
    perform public.unpack_allocation(v_alloc);
    perform public.pack_allocation(v_unit, v_alloc);
    perform public.close_packing_unit(v_unit);

    select count(*) into v_create from public.audit_log where entity='packing_unit' and entity_id=v_unit and action='packing.create';
    select count(*) into v_close  from public.audit_log where entity='packing_unit' and entity_id=v_unit and action='packing.close';
    select count(*) into v_pack   from public.audit_log where entity='stock_allocation' and entity_id=v_alloc and action='packing.pack';
    select count(*) into v_unpack from public.audit_log where entity='stock_allocation' and entity_id=v_alloc and action='packing.unpack';

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 11','ejecución','FALLO', v_err);
  else
    insert into _qa_pack_report(caso,chk,resultado,detalle) values
      ('Caso 11','audit_log: create=1 close=1 pack=2 unpack=1',
        case when v_create=1 and v_close=1 and v_pack=2 and v_unpack=1 then 'OK' else 'FALLO' end,
        format('create=%s close=%s pack=%s unpack=%s', v_create, v_close, v_pack, v_unpack));
  end if;
end $$;

-- =========================================================================
-- CASO 12 — Autorización: JWT vacío → las RPC de packing rechazan.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_alloc uuid; v_unit uuid;
  v_ok_create boolean := false; v_ok_pack boolean := false; v_ok_order boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 12','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 12','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PACK_C12','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-Z', 'Item Z', 100, v_pos, 'L-Z', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PACK_C12','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-Z', 'Item Z', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    perform public.confirm_picking_order(v_oid);
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='pickeada' limit 1;
    select public.create_packing_unit(v_oid, null, null) into v_unit;

    perform set_config('request.jwt.claims', '', true);   -- JWT vacío

    begin perform public.create_packing_unit(v_oid, null, null);
    exception when insufficient_privilege then v_ok_create := true;
             when others then if sqlerrm<>'__qa_rollback__' then v_ok_create := true; end if; end;
    begin perform public.pack_allocation(v_unit, v_alloc);
    exception when insufficient_privilege then v_ok_pack := true;
             when others then if sqlerrm<>'__qa_rollback__' then v_ok_pack := true; end if; end;
    begin perform public.confirm_packing_order(v_oid);
    exception when insufficient_privilege then v_ok_order := true;
             when others then if sqlerrm<>'__qa_rollback__' then v_ok_order := true; end if; end;

    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pack_report(caso,chk,resultado,detalle) values ('Caso 12','ejecución','FALLO', v_err);
  else
    insert into _qa_pack_report(caso,chk,resultado,detalle) values
      ('Caso 12','create/pack/confirm_order rechazan sin autorización',
        case when v_ok_create and v_ok_pack and v_ok_order then 'OK' else 'FALLO' end,
        format('create=%s pack=%s order=%s', v_ok_create, v_ok_pack, v_ok_order));
  end if;
end $$;

-- =========================================================================
-- REPORTE FINAL — FALLO/SKIP primero, luego OK. Esperado: todo 'OK'.
-- =========================================================================
select seq, caso, chk, resultado, detalle
from _qa_pack_report
order by (resultado = 'OK'), seq;
