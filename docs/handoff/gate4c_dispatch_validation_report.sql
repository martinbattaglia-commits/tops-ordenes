-- =========================================================================
-- GATE 4C · DESPACHO + ENTREGA — Kit de validación con REPORTE EN FILAS.
-- Para el SQL Editor de Supabase. Correr DESPUÉS de aplicar 0035_wms_dispatch.sql.
--
-- Misma mecánica que gate4b/gate4b1_*_report.sql:
--   · Cada caso arma su fixture (confirm_reception → allocate_order →
--     confirm_picking_order → confirm_packing_order → 'preparado') y lo REVIERTE
--     con el sentinel '__qa_rollback__' (0 footprint; los INSERT al ledger se
--     deshacen por el savepoint, NO por DELETE → no choca con la inmutabilidad).
--   · Las mediciones quedan en variables PL/pgSQL (sobreviven al rollback) y se
--     vuelcan como FILAS en _qa_dispatch_report DESPUÉS del sub-bloque.
--
-- Resultado esperado: todas las filas 'OK'. 'SKIP' = faltó rol/posición.
--
-- COBERTURA (14 casos):
--   C1 happy path · C2 egreso stock_reserved (no available) · C3 FEFO un lote ·
--   C4 FEFO multi-lote split · C5 D3 sin lote · C6 guard consistencia ·
--   C7 ledger append-only (UPDATE/DELETE rechazado) · C8 entrega ·
--   C9 reversión compensatoria · C10 roll-up multi-línea · C11 D1=A bulto abierto ·
--   C12 idempotencia/unicidad · C13 forward-guards · C14 authz.
--
-- ⚠️ Requiere 0024/0026/0027 + 0029/0030/0031 + 0032 + 0033 + 0034 + 0035 APLICADAS.
-- =========================================================================

drop table if exists _qa_dispatch_report;
create temp table _qa_dispatch_report (
  seq serial primary key, caso text, chk text, resultado text, detalle text
);

-- Helper de fixture: deja un pedido 'preparado' (1 línea, 1 ítem) y devuelve ids.
-- (Se inlinea en cada caso para mantener el 0-footprint por bloque.)

-- =========================================================================
-- CASO 1 — confirm_dispatch happy path: shipment + estados terminales.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_ship uuid;
  v_sstatus text; v_spub text; v_astatus text; v_lstatus text; v_ostatus text; v_ustatus text;
  v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 1','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 1','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_DISP_C1','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-A', 'Item A', 100, v_pos, 'L-A', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_DISP_C1','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested) values (v_oid,'SKU-A','Item A',60) returning id into v_line;
    perform public.allocate_order(v_oid);
    perform public.confirm_picking_order(v_oid);
    perform public.confirm_packing_order(v_oid);

    select public.confirm_dispatch(v_oid) into v_ship;
    select status::text, public_id into v_sstatus, v_spub from public.shipments where id = v_ship;
    select status into v_astatus from public.stock_allocations where order_item_id = v_line limit 1;
    select status into v_lstatus from public.logistics_order_items where id = v_line;
    select status into v_ostatus from public.logistics_orders where id = v_oid;
    select status into v_ustatus from public.packing_units where order_id = v_oid and status <> 'anulada' limit 1;

    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 1','ejecución','FALLO', v_err);
  else
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values
      ('Caso 1','shipment DSP- creado en despachado',
        case when v_sstatus='despachado' and v_spub like 'DSP-%' then 'OK' else 'FALLO' end,
        format('public_id=%s status=%s', v_spub, v_sstatus)),
      ('Caso 1','alloc despachada · línea despachado · pedido despachado · bulto despachada',
        case when v_astatus='despachada' and v_lstatus='despachado' and v_ostatus='despachado' and v_ustatus='despachada' then 'OK' else 'FALLO' end,
        format('alloc=%s linea=%s pedido=%s bulto=%s', v_astatus, v_lstatus, v_ostatus, v_ustatus));
  end if;
end $$;

-- =========================================================================
-- CASO 2 — EGRESO sobre stock_reserved (NO stock_available).
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_inv uuid;
  b_av numeric; b_rv numeric; a_av numeric; a_rv numeric; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 2','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 2','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine) values ('TEST_QA_DISP_C2','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date) values (v_rec,'SKU-B','Item B',100,v_pos,'L-B',date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_DISP_C2','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested) values (v_oid,'SKU-B','Item B',60) returning id into v_line;
    perform public.allocate_order(v_oid);
    perform public.confirm_picking_order(v_oid);
    perform public.confirm_packing_order(v_oid);
    select inventory_item_id into v_inv from public.stock_allocations where order_item_id=v_line limit 1;

    select stock_available, stock_reserved into b_av, b_rv from public.inventory_items where id=v_inv;
    perform public.confirm_dispatch(v_oid);
    select stock_available, stock_reserved into a_av, a_rv from public.inventory_items where id=v_inv;

    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 2','ejecución','FALLO', v_err);
  else
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values
      ('Caso 2','stock_reserved -=60 · stock_available SIN cambio',
        case when a_rv = b_rv - 60 and a_av = b_av then 'OK' else 'FALLO' end,
        format('avail %s→%s · resv %s→%s', b_av, a_av, b_rv, a_rv));
  end if;
end $$;

-- =========================================================================
-- CASO 3 — FEFO un lote: decremento del lote + 1 asiento egreso.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_inv uuid;
  v_lotq numeric; v_egresos int; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 3','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 3','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine) values ('TEST_QA_DISP_C3','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date) values (v_rec,'SKU-C','Item C',100,v_pos,'L-C1',date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_DISP_C3','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested) values (v_oid,'SKU-C','Item C',60) returning id into v_line;
    perform public.allocate_order(v_oid);
    perform public.confirm_picking_order(v_oid);
    perform public.confirm_packing_order(v_oid);
    select inventory_item_id into v_inv from public.stock_allocations where order_item_id=v_line limit 1;

    perform public.confirm_dispatch(v_oid);
    select quantity into v_lotq from public.inventory_lots where inventory_item_id=v_inv and lot_number='L-C1';
    select count(*) into v_egresos from public.inventory_movements where inventory_item_id=v_inv and movement_type='egreso';

    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 3','ejecución','FALLO', v_err);
  else
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values
      ('Caso 3','lote L-C1 100→40 · 1 asiento egreso',
        case when v_lotq = 40 and v_egresos = 1 then 'OK' else 'FALLO' end,
        format('lote=%s egresos=%s', v_lotq, v_egresos));
  end if;
end $$;

-- =========================================================================
-- CASO 4 — FEFO multi-lote (split): 2 lotes, más próximo a vencer primero.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_inv uuid;
  v_qa numeric; v_qb numeric; v_egresos int; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 4','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 4','setup','SKIP','sin posiciones'); return; end if;

  begin
    -- mismo ítem (cliente+sku+posición), dos lotes con distinto vencimiento.
    insert into public.receptions (client_name, business_unit, status, requires_quarantine) values ('TEST_QA_DISP_C4','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date) values (v_rec,'SKU-D','Item D',40,v_pos,'L-D-LATE', date '2027-12-01');
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date) values (v_rec,'SKU-D','Item D',30,v_pos,'L-D-SOON', date '2026-07-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_DISP_C4','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested) values (v_oid,'SKU-D','Item D',60) returning id into v_line;
    perform public.allocate_order(v_oid);
    perform public.confirm_picking_order(v_oid);
    perform public.confirm_packing_order(v_oid);
    select inventory_item_id into v_inv from public.stock_allocations where order_item_id=v_line limit 1;

    perform public.confirm_dispatch(v_oid);
    -- FEFO: SOON (30, vence antes) se consume entero; LATE pierde 30 (40→10).
    select quantity into v_qb from public.inventory_lots where inventory_item_id=v_inv and lot_number='L-D-SOON';
    select quantity into v_qa from public.inventory_lots where inventory_item_id=v_inv and lot_number='L-D-LATE';
    select count(*) into v_egresos from public.inventory_movements where inventory_item_id=v_inv and movement_type='egreso';

    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 4','ejecución','FALLO', v_err);
  else
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values
      ('Caso 4','FEFO split: SOON 30→0 · LATE 40→10 · 2 asientos egreso',
        case when v_qb = 0 and v_qa = 10 and v_egresos = 2 then 'OK' else 'FALLO' end,
        format('soon=%s late=%s egresos=%s', v_qb, v_qa, v_egresos));
  end if;
end $$;

-- =========================================================================
-- CASO 5 — D3 sin lote: egreso lot null, inventory_lots intacto.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_inv uuid;
  v_lots int; v_egreso_lot text; v_egresos int; b_rv numeric; a_rv numeric; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 5','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 5','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine) values ('TEST_QA_DISP_C5','GENERAL','pendiente',false) returning id into v_rec;
    -- sin lote (GENERAL admite lot_number null) → no se crea inventory_lots.
    insert into public.reception_items (reception_id, sku, description, quantity, position_id) values (v_rec,'SKU-E','Item E',100,v_pos);
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_DISP_C5','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested) values (v_oid,'SKU-E','Item E',60) returning id into v_line;
    perform public.allocate_order(v_oid);
    perform public.confirm_picking_order(v_oid);
    perform public.confirm_packing_order(v_oid);
    select inventory_item_id into v_inv from public.stock_allocations where order_item_id=v_line limit 1;

    select stock_reserved into b_rv from public.inventory_items where id=v_inv;
    perform public.confirm_dispatch(v_oid);
    select stock_reserved into a_rv from public.inventory_items where id=v_inv;
    select count(*) into v_lots from public.inventory_lots where inventory_item_id=v_inv;
    select count(*), max(lot_number) into v_egresos, v_egreso_lot from public.inventory_movements where inventory_item_id=v_inv and movement_type='egreso';

    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 5','ejecución','FALLO', v_err);
  else
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values
      ('Caso 5','sin lote: 0 lotes · egreso lot null · stock_reserved -=60',
        case when v_lots=0 and v_egresos=1 and v_egreso_lot is null and a_rv = b_rv-60 then 'OK' else 'FALLO' end,
        format('lots=%s egresos=%s lot=%s resv %s→%s', v_lots, v_egresos, coalesce(v_egreso_lot,'null'), b_rv, a_rv));
  end if;
end $$;

-- =========================================================================
-- CASO 6 — Guard de consistencia: Σ lotes < cantidad → aborta (sin egreso parcial).
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_inv uuid;
  v_aborted boolean := false; v_movs int; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 6','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 6','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine) values ('TEST_QA_DISP_C6','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date) values (v_rec,'SKU-F','Item F',60,v_pos,'L-F',date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_DISP_C6','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested) values (v_oid,'SKU-F','Item F',60) returning id into v_line;
    perform public.allocate_order(v_oid);
    perform public.confirm_picking_order(v_oid);
    perform public.confirm_packing_order(v_oid);
    select inventory_item_id into v_inv from public.stock_allocations where order_item_id=v_line limit 1;

    -- Introduce incoherencia: vacía el lote (simula dato legacy) sin tocar buckets.
    update public.inventory_lots set quantity = 10 where inventory_item_id=v_inv and lot_number='L-F';

    begin
      perform public.confirm_dispatch(v_oid);
    exception when others then
      if sqlerrm <> '__qa_rollback__' then v_aborted := true; end if;
    end;
    select count(*) into v_movs from public.inventory_movements where inventory_item_id=v_inv and movement_type='egreso';

    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 6','ejecución','FALLO', v_err);
  else
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values
      ('Caso 6','Σ lotes < cantidad → aborta · 0 egresos (sin parcial)',
        case when v_aborted and v_movs = 0 then 'OK' else 'FALLO' end,
        format('aborted=%s egresos=%s', v_aborted, v_movs));
  end if;
end $$;

-- =========================================================================
-- CASO 7 — Ledger append-only: UPDATE y DELETE sobre inventory_movements rechazados.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_mov uuid;
  v_upd_blocked boolean := false; v_del_blocked boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 7','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 7','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine) values ('TEST_QA_DISP_C7','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date) values (v_rec,'SKU-G','Item G',10,v_pos,'L-G',date '2027-01-01');
    perform public.confirm_reception(v_rec);
    select id into v_inv from public.inventory_items where client_name='TEST_QA_DISP_C7' and sku='SKU-G' limit 1;
    select id into v_mov from public.inventory_movements where inventory_item_id=v_inv limit 1;

    begin update public.inventory_movements set notes='x' where id=v_mov; exception when others then if sqlerrm<>'__qa_rollback__' then v_upd_blocked := true; end if; end;
    begin delete from public.inventory_movements where id=v_mov; exception when others then if sqlerrm<>'__qa_rollback__' then v_del_blocked := true; end if; end;

    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 7','ejecución','FALLO', v_err);
  else
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values
      ('Caso 7','ledger inmutable: UPDATE y DELETE rechazados',
        case when v_upd_blocked and v_del_blocked then 'OK' else 'FALLO' end,
        format('update_blocked=%s delete_blocked=%s', v_upd_blocked, v_del_blocked));
  end if;
end $$;

-- =========================================================================
-- CASO 8 — confirm_delivery: shipment/pedido entregado, stock sin cambios.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_inv uuid; v_ship uuid;
  v_sstatus text; v_ostatus text; b_rv numeric; a_rv numeric; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 8','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 8','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine) values ('TEST_QA_DISP_C8','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date) values (v_rec,'SKU-H','Item H',100,v_pos,'L-H',date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_DISP_C8','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested) values (v_oid,'SKU-H','Item H',60) returning id into v_line;
    perform public.allocate_order(v_oid); perform public.confirm_picking_order(v_oid); perform public.confirm_packing_order(v_oid);
    select inventory_item_id into v_inv from public.stock_allocations where order_item_id=v_line limit 1;
    select public.confirm_dispatch(v_oid) into v_ship;
    select stock_reserved into b_rv from public.inventory_items where id=v_inv;

    perform public.confirm_delivery(v_ship, 'Juan Receptor');
    select status::text into v_sstatus from public.shipments where id=v_ship;
    select status into v_ostatus from public.logistics_orders where id=v_oid;
    select stock_reserved into a_rv from public.inventory_items where id=v_inv;

    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 8','ejecución','FALLO', v_err);
  else
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values
      ('Caso 8','entrega: shipment/pedido entregado · stock sin cambios',
        case when v_sstatus='entregado' and v_ostatus='entregado' and a_rv=b_rv then 'OK' else 'FALLO' end,
        format('ship=%s pedido=%s resv %s→%s', v_sstatus, v_ostatus, b_rv, a_rv));
  end if;
end $$;

-- =========================================================================
-- CASO 9 — revert_dispatch: restitución + reingreso compensatorio (neto 0).
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_inv uuid; v_ship uuid;
  b_rv numeric; b_lot numeric; a_rv numeric; a_lot numeric;
  v_astatus text; v_ostatus text; v_ustatus text; v_sstatus text;
  v_egresos int; v_ingresos int; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 9','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 9','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine) values ('TEST_QA_DISP_C9','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date) values (v_rec,'SKU-I','Item I',100,v_pos,'L-I',date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_DISP_C9','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested) values (v_oid,'SKU-I','Item I',60) returning id into v_line;
    perform public.allocate_order(v_oid); perform public.confirm_picking_order(v_oid); perform public.confirm_packing_order(v_oid);
    select inventory_item_id into v_inv from public.stock_allocations where order_item_id=v_line limit 1;
    -- saldos PRE-despacho (referencia para neto 0)
    select stock_reserved into b_rv from public.inventory_items where id=v_inv;
    select quantity into b_lot from public.inventory_lots where inventory_item_id=v_inv and lot_number='L-I';

    select public.confirm_dispatch(v_oid) into v_ship;
    perform public.revert_dispatch(v_ship);

    select stock_reserved into a_rv from public.inventory_items where id=v_inv;
    select quantity into a_lot from public.inventory_lots where inventory_item_id=v_inv and lot_number='L-I';
    select status into v_astatus from public.stock_allocations where order_item_id=v_line limit 1;
    select status into v_ostatus from public.logistics_orders where id=v_oid;
    select status into v_ustatus from public.packing_units where order_id=v_oid and status<>'anulada' limit 1;
    select status::text into v_sstatus from public.shipments where id=v_ship;
    select count(*) filter (where movement_type='egreso'), count(*) filter (where movement_type='ingreso' and reference_type='despacho')
      into v_egresos, v_ingresos from public.inventory_movements where reference_id=v_ship;

    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 9','ejecución','FALLO', v_err);
  else
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values
      ('Caso 9','reversión: stock + lote restituidos (neto 0)',
        case when a_rv=b_rv and a_lot=b_lot then 'OK' else 'FALLO' end,
        format('resv %s→%s lote %s→%s', b_rv, a_rv, b_lot, a_lot)),
      ('Caso 9','estados: alloc empacada · pedido preparado · bulto cerrada · shipment anulado',
        case when v_astatus='empacada' and v_ostatus='preparado' and v_ustatus='cerrada' and v_sstatus='anulado' then 'OK' else 'FALLO' end,
        format('alloc=%s pedido=%s bulto=%s ship=%s', v_astatus, v_ostatus, v_ustatus, v_sstatus)),
      ('Caso 9','ledger: egreso + ingreso compensatorio (sin borrar)',
        case when v_egresos >= 1 and v_ingresos = v_egresos then 'OK' else 'FALLO' end,
        format('egresos=%s ingresos=%s', v_egresos, v_ingresos));
  end if;
end $$;

-- =========================================================================
-- CASO 10 — Roll-up multi-línea: pedido despachado solo si TODAS las líneas despachado.
--   (whole-order atómico: confirm_dispatch despacha todo → todas despachado.)
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_l1 uuid; v_l2 uuid;
  v_d1 text; v_d2 text; v_ostatus text; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 10','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 10','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine) values ('TEST_QA_DISP_C10','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date) values (v_rec,'SKU-J1','Item J1',50,v_pos,'L-J1',date '2027-01-01');
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date) values (v_rec,'SKU-J2','Item J2',50,v_pos,'L-J2',date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_DISP_C10','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested) values (v_oid,'SKU-J1','Item J1',40) returning id into v_l1;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested) values (v_oid,'SKU-J2','Item J2',40) returning id into v_l2;
    perform public.allocate_order(v_oid); perform public.confirm_picking_order(v_oid); perform public.confirm_packing_order(v_oid);

    perform public.confirm_dispatch(v_oid);
    select status into v_d1 from public.logistics_order_items where id=v_l1;
    select status into v_d2 from public.logistics_order_items where id=v_l2;
    select status into v_ostatus from public.logistics_orders where id=v_oid;

    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 10','ejecución','FALLO', v_err);
  else
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values
      ('Caso 10','2 líneas despachado → pedido despachado',
        case when v_d1='despachado' and v_d2='despachado' and v_ostatus='despachado' then 'OK' else 'FALLO' end,
        format('l1=%s l2=%s pedido=%s', v_d1, v_d2, v_ostatus));
  end if;
end $$;

-- =========================================================================
-- CASO 11 — D1=A: despachar con un bulto 'abierta' → rechaza.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_alloc uuid; v_unit uuid;
  v_rejected boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 11','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 11','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine) values ('TEST_QA_DISP_C11','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date) values (v_rec,'SKU-K','Item K',100,v_pos,'L-K',date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_DISP_C11','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested) values (v_oid,'SKU-K','Item K',60) returning id into v_line;
    perform public.allocate_order(v_oid); perform public.confirm_picking_order(v_oid);
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='pickeada' limit 1;
    -- empaca manualmente en un bulto y lo DEJA abierto + cierra otro... acá: 1 bulto abierto.
    select public.create_packing_unit(v_oid, null, null) into v_unit;
    perform public.pack_allocation(v_unit, v_alloc);
    -- pedido queda 'preparado' (línea empacado) pero el bulto está 'abierta'.
    begin
      perform public.confirm_dispatch(v_oid);
    exception when others then
      if sqlerrm <> '__qa_rollback__' then v_rejected := true; end if;
    end;

    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 11','ejecución','FALLO', v_err);
  else
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values
      ('Caso 11','despachar con bulto abierto → rechazado (D1=A)',
        case when v_rejected then 'OK' else 'FALLO' end, format('rejected=%s', v_rejected));
  end if;
end $$;

-- =========================================================================
-- CASO 12 — Idempotencia/unicidad: confirm_dispatch 2× → 2º rechaza.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid;
  v_rejected boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 12','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 12','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine) values ('TEST_QA_DISP_C12','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date) values (v_rec,'SKU-L','Item L',100,v_pos,'L-L',date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_DISP_C12','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested) values (v_oid,'SKU-L','Item L',60) returning id into v_line;
    perform public.allocate_order(v_oid); perform public.confirm_picking_order(v_oid); perform public.confirm_packing_order(v_oid);
    perform public.confirm_dispatch(v_oid);
    begin
      perform public.confirm_dispatch(v_oid);
    exception when others then if sqlerrm <> '__qa_rollback__' then v_rejected := true; end if;
    end;

    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 12','ejecución','FALLO', v_err);
  else
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values
      ('Caso 12','segundo confirm_dispatch → rechazado (unicidad)',
        case when v_rejected then 'OK' else 'FALLO' end, format('rejected=%s', v_rejected));
  end if;
end $$;

-- =========================================================================
-- CASO 13 — Forward-guards: unpack/reopen sobre despachada → rechazan.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_alloc uuid; v_unit uuid;
  v_unpack_blocked boolean := false; v_reopen_blocked boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 13','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 13','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine) values ('TEST_QA_DISP_C13','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date) values (v_rec,'SKU-M','Item M',100,v_pos,'L-M',date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_DISP_C13','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested) values (v_oid,'SKU-M','Item M',60) returning id into v_line;
    perform public.allocate_order(v_oid); perform public.confirm_picking_order(v_oid); perform public.confirm_packing_order(v_oid);
    perform public.confirm_dispatch(v_oid);
    select id into v_alloc from public.stock_allocations where order_item_id=v_line limit 1;
    select id into v_unit from public.packing_units where order_id=v_oid and status='despachada' limit 1;

    begin perform public.unpack_allocation(v_alloc); exception when others then if sqlerrm<>'__qa_rollback__' then v_unpack_blocked := true; end if; end;
    begin perform public.reopen_packing_unit(v_unit); exception when others then if sqlerrm<>'__qa_rollback__' then v_reopen_blocked := true; end if; end;

    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 13','ejecución','FALLO', v_err);
  else
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values
      ('Caso 13','unpack y reopen sobre despachada → rechazados',
        case when v_unpack_blocked and v_reopen_blocked then 'OK' else 'FALLO' end,
        format('unpack_blocked=%s reopen_blocked=%s', v_unpack_blocked, v_reopen_blocked));
  end if;
end $$;

-- =========================================================================
-- CASO 14 — Autorización: sin rol habilitado → confirm_dispatch rechaza.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid;
  v_blocked boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 14','setup','SKIP','sin rol'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 14','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine) values ('TEST_QA_DISP_C14','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date) values (v_rec,'SKU-N','Item N',100,v_pos,'L-N',date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_DISP_C14','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested) values (v_oid,'SKU-N','Item N',60) returning id into v_line;
    perform public.allocate_order(v_oid); perform public.confirm_picking_order(v_oid); perform public.confirm_packing_order(v_oid);

    perform set_config('request.jwt.claims', '', true);
    begin
      perform public.confirm_dispatch(v_oid);
    exception
      when insufficient_privilege then v_blocked := true;
      when others then if sqlerrm <> '__qa_rollback__' then v_blocked := true; end if;
    end;
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);

    raise exception '__qa_rollback__';
  exception when others then if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values ('Caso 14','ejecución','FALLO', v_err);
  else
    insert into _qa_dispatch_report(caso,chk,resultado,detalle) values
      ('Caso 14','confirm_dispatch sin autorización → rechazado',
        case when v_blocked then 'OK' else 'FALLO' end, format('blocked=%s', v_blocked));
  end if;
end $$;

-- =========================================================================
-- REPORTE FINAL — FALLO/SKIP primero, luego OK. Esperado: todo 'OK'.
-- =========================================================================
select seq, caso, chk, resultado, detalle
from _qa_dispatch_report
order by (resultado = 'OK'), seq;
