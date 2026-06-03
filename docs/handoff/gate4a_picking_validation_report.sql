-- =========================================================================
-- GATE 4A · PICKING — Kit de validación con REPORTE EN FILAS.
-- Para el SQL Editor de Supabase. Correr DESPUÉS de aplicar 0032_wms_picking.sql.
--
-- Variante de gate4a_picking_validation.sql pensada para editores que NO
-- muestran RAISE NOTICE (Supabase web): cada chequeo se escribe como FILA en
-- una tabla temporal y al final un SELECT lo muestra en la grilla.
--
-- MECANISMO (0 footprint sobre tablas reales):
--   · Cada caso arma su fixture (confirm_reception + allocate_order + RPC de
--     picking) dentro de un sub-bloque BEGIN..EXCEPTION y lo REVIERTE con el
--     sentinel '__qa_rollback__' (savepoint implícito de PL/pgSQL). El rollback
--     no es DELETE → no choca con el trigger de inmutabilidad de
--     inventory_movements.
--   · Las MEDICIONES quedan en variables PL/pgSQL (no son transaccionales →
--     sobreviven al rollback del fixture). Las filas de resultado se insertan en
--     _qa_pick_report DESPUÉS del sub-bloque (fuera del savepoint revertido), por
--     lo que persisten para el SELECT final.
--   · _qa_pick_report es TEMP (se descarta al cerrar la sesión).
--
-- Resultado esperado: todas las filas con resultado='OK' (ninguna 'FALLO').
-- 'SKIP' = no había rol/posición para montar el caso (no es fallo de la RPC).
-- ⚠️ Requiere 0024/0026/0027 + 0029/0030/0031 + 0032 APLICADAS.
-- =========================================================================

drop table if exists _qa_pick_report;
create temp table _qa_pick_report (
  seq       serial primary key,
  caso      text,
  chk       text,
  resultado text,
  detalle   text
);

-- =========================================================================
-- CASO 1 — confirm_picking(): reservada → pickeada · línea → pickeado ·
--          sin stock · sin ledger · header sin cambios.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_oid uuid; v_line uuid; v_alloc uuid;
  v_av0 numeric; v_rv0 numeric; v_av1 numeric; v_rv1 numeric;
  v_mov0 int; v_mov1 int; v_ast text; v_lst text; v_ost0 text; v_ost1 text;
  v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 1','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 1','setup','SKIP','sin posiciones cargadas'); return; end if;

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

    select stock_available, stock_reserved into v_av0, v_rv0 from public.inventory_items where id=v_inv;
    select count(*) into v_mov0 from public.inventory_movements;
    select status into v_ost0 from public.logistics_orders where id=v_oid;

    perform public.confirm_picking(v_alloc);

    select status into v_ast from public.stock_allocations where id=v_alloc;
    select status into v_lst from public.logistics_order_items where id=v_line;
    select stock_available, stock_reserved into v_av1, v_rv1 from public.inventory_items where id=v_inv;
    select count(*) into v_mov1 from public.inventory_movements;
    select status into v_ost1 from public.logistics_orders where id=v_oid;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 1','ejecución','FALLO', v_err);
  else
    insert into _qa_pick_report(caso,chk,resultado,detalle) values
      ('Caso 1','1a alloc pickeada · línea pickeado',
        case when v_ast='pickeada' and v_lst='pickeado' then 'OK' else 'FALLO' end,
        format('alloc=%s linea=%s (esperado pickeada/pickeado)', v_ast, v_lst)),
      ('Caso 1','1b NO-STOCK (avail/reserved sin cambios)',
        case when v_av1=v_av0 and v_rv1=v_rv0 and v_av1=40 and v_rv1=60 then 'OK' else 'FALLO' end,
        format('avail %s->%s reserved %s->%s (esperado 40/60)', v_av0, v_av1, v_rv0, v_rv1)),
      ('Caso 1','1c NO-LEDGER (inventory_movements sin crecer)',
        case when v_mov1=v_mov0 then 'OK' else 'FALLO' end,
        format('movements %s->%s', v_mov0, v_mov1)),
      ('Caso 1','1d header en_preparacion (sin cambios)',
        case when v_ost1=v_ost0 and v_ost1='en_preparacion' then 'OK' else 'FALLO' end,
        format('header %s->%s', v_ost0, v_ost1));
  end if;
end $$;

-- =========================================================================
-- CASO 2 — unpick_allocation(): pickeada → reservada · roll-up revierte ·
--          sin stock · header sin cambios.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_oid uuid; v_line uuid; v_alloc uuid;
  v_av numeric; v_rv numeric; v_ast text; v_lst text; v_ost text; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 2','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 2','setup','SKIP','sin posiciones cargadas'); return; end if;

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

    perform public.confirm_picking(v_alloc);
    perform public.unpick_allocation(v_alloc);

    select status into v_ast from public.stock_allocations where id=v_alloc;
    select status into v_lst from public.logistics_order_items where id=v_line;
    select stock_available, stock_reserved into v_av, v_rv from public.inventory_items where id=v_inv;
    select status into v_ost from public.logistics_orders where id=v_oid;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 2','ejecución','FALLO', v_err);
  else
    insert into _qa_pick_report(caso,chk,resultado,detalle) values
      ('Caso 2','2a unpick revierte (alloc reservada · línea reservado)',
        case when v_ast='reservada' and v_lst='reservado' then 'OK' else 'FALLO' end,
        format('alloc=%s linea=%s (esperado reservada/reservado)', v_ast, v_lst)),
      ('Caso 2','2b NO-STOCK tras unpick',
        case when v_av=40 and v_rv=60 then 'OK' else 'FALLO' end,
        format('avail=%s reserved=%s (esperado 40/60)', v_av, v_rv)),
      ('Caso 2','2c header en_preparacion',
        case when v_ost='en_preparacion' then 'OK' else 'FALLO' end,
        format('header=%s', v_ost));
  end if;
end $$;

-- =========================================================================
-- CASO 3 — confirm_picking_order(): 2 líneas → ambas pickeado · header sin
--          cambios · sin ledger.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid;
  v_lineA uuid; v_lineB uuid; v_lstA text; v_lstB text; v_ost text;
  v_pick int; v_resv int; v_mov0 int; v_mov1 int; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 3','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 3','setup','SKIP','sin posiciones cargadas'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PICK_C3','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-A', 'Item A', 100, v_pos, 'L-A', date '2027-01-01');
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-B', 'Item B', 100, v_pos, 'L-B', date '2027-02-01');
    perform public.confirm_reception(v_rec);

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

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 3','ejecución','FALLO', v_err);
  else
    insert into _qa_pick_report(caso,chk,resultado,detalle) values
      ('Caso 3','3a ambas líneas pickeado · 2 pickeadas · 0 reservadas',
        case when v_lstA='pickeado' and v_lstB='pickeado' and v_pick=2 and v_resv=0 then 'OK' else 'FALLO' end,
        format('lA=%s lB=%s pickeadas=%s reservadas=%s', v_lstA, v_lstB, v_pick, v_resv)),
      ('Caso 3','3b header en_preparacion (NO pasa a preparado en 4A)',
        case when v_ost='en_preparacion' then 'OK' else 'FALLO' end,
        format('header=%s', v_ost)),
      ('Caso 3','3c NO-LEDGER (inventory_movements sin crecer)',
        case when v_mov1=v_mov0 then 'OK' else 'FALLO' end,
        format('movements %s->%s', v_mov0, v_mov1));
  end if;
end $$;

-- =========================================================================
-- CASO 4 — Roll-up parcial: reservado_parcial → pickeado (faltante derivado).
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_oid uuid; v_line uuid; v_alloc uuid;
  v_lst0 text; v_lst1 text; v_alloc_qty numeric; v_req numeric; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 4','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 4','setup','SKIP','sin posiciones cargadas'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PICK_C4','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-P', 'Item P', 40, v_pos, 'L-P', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    select id into v_inv from public.inventory_items where client_name='TEST_QA_PICK_C4' and sku='SKU-P' limit 1;

    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PICK_C4','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-P', 'Item P', 100) returning id into v_line;
    perform public.allocate_order(v_oid);

    select status into v_lst0 from public.logistics_order_items where id=v_line;
    select id, quantity into v_alloc, v_alloc_qty from public.stock_allocations where order_item_id=v_line and status='reservada' limit 1;

    perform public.confirm_picking(v_alloc);

    select status into v_lst1 from public.logistics_order_items where id=v_line;
    select quantity_requested into v_req from public.logistics_order_items where id=v_line;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 4','ejecución','FALLO', v_err);
  else
    insert into _qa_pick_report(caso,chk,resultado,detalle) values
      ('Caso 4','reservado_parcial(40/100) → pickeado (faltante derivado)',
        case when v_lst0='reservado_parcial' and v_lst1='pickeado' and v_alloc_qty=40 and v_req=100 then 'OK' else 'FALLO' end,
        format('lst0=%s lst1=%s alloc=%s req=%s', v_lst0, v_lst1, v_alloc_qty, v_req));
  end if;
end $$;

-- =========================================================================
-- CASO 5 — audit_log: confirm_picking + unpick → filas correctas.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_oid uuid; v_line uuid; v_alloc uuid;
  v_n0 int; v_n_conf int; v_n_unp int;
  v_act text; v_from text; v_to text; v_qty numeric; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 5','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 5','setup','SKIP','sin posiciones cargadas'); return; end if;

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
    select action, payload->>'from', payload->>'to', (payload->>'quantity')::numeric
      into v_act, v_from, v_to, v_qty
      from public.audit_log where entity='stock_allocation' and entity_id=v_alloc and action='picking.confirm'
      order by ts desc limit 1;

    perform public.unpick_allocation(v_alloc);
    select count(*) into v_n_unp from public.audit_log
      where entity='stock_allocation' and entity_id=v_alloc and action='picking.unpick';

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 5','ejecución','FALLO', v_err);
  else
    insert into _qa_pick_report(caso,chk,resultado,detalle) values
      ('Caso 5','5a 1 picking.confirm + 1 picking.unpick',
        case when v_n0=0 and v_n_conf=1 and v_n_unp=1 then 'OK' else 'FALLO' end,
        format('pre=%s confirm=%s unpick=%s', v_n0, v_n_conf, v_n_unp)),
      ('Caso 5','5b payload confirm (from/to/qty)',
        case when v_act='picking.confirm' and v_from='reservada' and v_to='pickeada' and v_qty=60 then 'OK' else 'FALLO' end,
        format('act=%s from=%s to=%s qty=%s', v_act, v_from, v_to, v_qty));
  end if;
end $$;

-- =========================================================================
-- CASO 6 — Invariantes duras NO-STOCK + NO-LEDGER + inventory_lots intacto.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_oid uuid; v_line uuid;
  v_av0 numeric; v_rv0 numeric; v_av1 numeric; v_rv1 numeric;
  v_lot0 numeric; v_lot1 numeric; v_mov0 int; v_mov1 int; v_items0 int; v_items1 int; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 6','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 6','setup','SKIP','sin posiciones cargadas'); return; end if;

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

    select stock_available, stock_reserved into v_av0, v_rv0 from public.inventory_items where id=v_inv;
    select quantity into v_lot0 from public.inventory_lots where inventory_item_id=v_inv and lot_number='L-INV';
    select count(*) into v_mov0 from public.inventory_movements;
    select count(*) into v_items0 from public.inventory_items;

    perform public.confirm_picking_order(v_oid);

    select stock_available, stock_reserved into v_av1, v_rv1 from public.inventory_items where id=v_inv;
    select quantity into v_lot1 from public.inventory_lots where inventory_item_id=v_inv and lot_number='L-INV';
    select count(*) into v_mov1 from public.inventory_movements;
    select count(*) into v_items1 from public.inventory_items;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 6','ejecución','FALLO', v_err);
  else
    insert into _qa_pick_report(caso,chk,resultado,detalle) values
      ('Caso 6','6a NO-STOCK (avail=30 reserved=70 sin cambios)',
        case when v_av1=v_av0 and v_rv1=v_rv0 and v_av1=30 and v_rv1=70 then 'OK' else 'FALLO' end,
        format('avail %s->%s reserved %s->%s', v_av0, v_av1, v_rv0, v_rv1)),
      ('Caso 6','6b inventory_lots INTACTO (quantity=100)',
        case when v_lot1=v_lot0 and v_lot1=100 then 'OK' else 'FALLO' end,
        format('lot %s->%s', v_lot0, v_lot1)),
      ('Caso 6','6c NO-LEDGER (inventory_movements sin crecer)',
        case when v_mov1=v_mov0 then 'OK' else 'FALLO' end,
        format('movements %s->%s', v_mov0, v_mov1)),
      ('Caso 6','6d inventory_items sin filas nuevas',
        case when v_items1=v_items0 then 'OK' else 'FALLO' end,
        format('items %s->%s', v_items0, v_items1));
  end if;
end $$;

-- =========================================================================
-- CASO 7 — logistics_orders.status NO cambia por Picking.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_alloc uuid;
  v_s_alloc text; v_s_single text; v_s_order text; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 7','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 7','setup','SKIP','sin posiciones cargadas'); return; end if;

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
    select status into v_s_alloc from public.logistics_orders where id=v_oid;
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='reservada' limit 1;

    perform public.confirm_picking(v_alloc);
    select status into v_s_single from public.logistics_orders where id=v_oid;
    perform public.confirm_picking_order(v_oid);
    select status into v_s_order from public.logistics_orders where id=v_oid;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 7','ejecución','FALLO', v_err);
  else
    insert into _qa_pick_report(caso,chk,resultado,detalle) values
      ('Caso 7','header en_preparacion estable (allocate/parada/pedido)',
        case when v_s_alloc='en_preparacion' and v_s_single='en_preparacion' and v_s_order='en_preparacion' then 'OK' else 'FALLO' end,
        format('allocate=%s single=%s order=%s', v_s_alloc, v_s_single, v_s_order));
  end if;
end $$;

-- =========================================================================
-- CASO 8 — Idempotencia + rechazo de re-pick sobre allocation pickeada.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_alloc uuid;
  v_aud1 int; v_aud2 int; v_pick int; v_raised boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 8','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 8','setup','SKIP','sin posiciones cargadas'); return; end if;

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
    select count(*) into v_aud1 from public.audit_log where entity='stock_allocation'
      and entity_id in (select al.id from public.stock_allocations al join public.logistics_order_items li on li.id=al.order_item_id where li.order_id=v_oid);
    perform public.confirm_picking_order(v_oid);   -- 2.ª corrida: no debe duplicar
    select count(*) into v_aud2 from public.audit_log where entity='stock_allocation'
      and entity_id in (select al.id from public.stock_allocations al join public.logistics_order_items li on li.id=al.order_item_id where li.order_id=v_oid);
    select count(*) into v_pick from public.stock_allocations al join public.logistics_order_items li on li.id=al.order_item_id
      where li.order_id=v_oid and al.status='pickeada';

    begin
      perform public.confirm_picking(v_alloc);
    exception when others then
      if sqlerrm <> '__qa_rollback__' then v_raised := true; end if;
    end;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 8','ejecución','FALLO', v_err);
  else
    insert into _qa_pick_report(caso,chk,resultado,detalle) values
      ('Caso 8','8a confirm_picking_order idempotente (audit estable · 1 pickeada)',
        case when v_aud2=v_aud1 and v_pick=1 then 'OK' else 'FALLO' end,
        format('audit %s->%s pickeadas=%s', v_aud1, v_aud2, v_pick)),
      ('Caso 8','8b re-pick sobre allocation pickeada → rechazado',
        case when v_raised then 'OK' else 'FALLO' end,
        format('rechazó=%s', v_raised));
  end if;
end $$;

-- =========================================================================
-- CASO 9 — Guards / casos límite (9a..9d).
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_alloc uuid; v_oid2 uuid;
  v_ok9a boolean := false; v_ok9b boolean := false; v_ok9c boolean := false; v_ok9d boolean := false;
  v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 9','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 9','setup','SKIP','sin posiciones cargadas'); return; end if;

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

    -- 9a: confirm_picking sobre liberada → rechaza
    perform public.release_allocation(v_alloc);
    begin perform public.confirm_picking(v_alloc);
    exception when others then if sqlerrm<>'__qa_rollback__' then v_ok9a := true; end if; end;

    -- 9b: unpick sobre reservada (no pickeada) → rechaza
    perform public.allocate_order(v_oid);
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='reservada' limit 1;
    begin perform public.unpick_allocation(v_alloc);
    exception when others then if sqlerrm<>'__qa_rollback__' then v_ok9b := true; end if; end;

    -- 9c: confirm_picking_order sobre pedido NO en_preparacion → rechaza
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PICK_C9','pendiente') returning id into v_oid2;
    begin perform public.confirm_picking_order(v_oid2);
    exception when others then if sqlerrm<>'__qa_rollback__' then v_ok9c := true; end if; end;

    -- 9d: forward-guard unpick con línea despachado (forzado solo en test)
    perform public.confirm_picking(v_alloc);
    update public.logistics_order_items set status='despachado'::order_item_status_t where id=v_line;
    begin perform public.unpick_allocation(v_alloc);
    exception when others then if sqlerrm<>'__qa_rollback__' then v_ok9d := true; end if; end;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 9','ejecución','FALLO', v_err);
  else
    insert into _qa_pick_report(caso,chk,resultado,detalle) values
      ('Caso 9','9a confirm_picking sobre liberada → rechazado',
        case when v_ok9a then 'OK' else 'FALLO' end, format('rechazó=%s', v_ok9a)),
      ('Caso 9','9b unpick sobre reservada (no pickeada) → rechazado',
        case when v_ok9b then 'OK' else 'FALLO' end, format('rechazó=%s', v_ok9b)),
      ('Caso 9','9c confirm_picking_order sobre pedido pendiente → rechazado',
        case when v_ok9c then 'OK' else 'FALLO' end, format('rechazó=%s', v_ok9c)),
      ('Caso 9','9d unpick forward-guard (línea despachado) → rechazado',
        case when v_ok9d then 'OK' else 'FALLO' end, format('rechazó=%s', v_ok9d));
  end if;
end $$;

-- =========================================================================
-- CASO 10 — Autorización: JWT vacío → las 3 RPC rechazan.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_alloc uuid;
  v_ok_conf boolean := false; v_ok_order boolean := false; v_ok_unp boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 10','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 10','setup','SKIP','sin posiciones cargadas'); return; end if;

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

    perform set_config('request.jwt.claims', '', true);   -- JWT vacío → current_role()=null

    begin perform public.confirm_picking(v_alloc);
    exception when insufficient_privilege then v_ok_conf := true;
             when others then if sqlerrm<>'__qa_rollback__' then v_ok_conf := true; end if; end;
    begin perform public.confirm_picking_order(v_oid);
    exception when insufficient_privilege then v_ok_order := true;
             when others then if sqlerrm<>'__qa_rollback__' then v_ok_order := true; end if; end;
    begin perform public.unpick_allocation(v_alloc);
    exception when insufficient_privilege then v_ok_unp := true;
             when others then if sqlerrm<>'__qa_rollback__' then v_ok_unp := true; end if; end;

    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_pick_report(caso,chk,resultado,detalle) values ('Caso 10','ejecución','FALLO', v_err);
  else
    insert into _qa_pick_report(caso,chk,resultado,detalle) values
      ('Caso 10','las 3 RPC rechazan sin autorización',
        case when v_ok_conf and v_ok_order and v_ok_unp then 'OK' else 'FALLO' end,
        format('confirm=%s order=%s unpick=%s', v_ok_conf, v_ok_order, v_ok_unp));
  end if;
end $$;

-- =========================================================================
-- REPORTE FINAL — FALLO/SKIP primero, luego OK. Esperado: todo 'OK'.
-- =========================================================================
select seq, caso, chk, resultado, detalle
from _qa_pick_report
order by (resultado = 'OK'), seq;
