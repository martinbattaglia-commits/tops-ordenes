-- =========================================================================
-- MINI-GATE 4B.1 · ANULAR PACKING UNIT — Kit de validación con REPORTE EN FILAS.
-- Para el SQL Editor de Supabase. Correr DESPUÉS de aplicar 0034_wms_packing_cancel.sql.
--
-- Misma mecánica que gate4b_packing_validation_report.sql:
--   · Cada caso arma su fixture (confirm_reception → allocate_order →
--     confirm_picking_order → packing) y lo REVIERTE con el sentinel
--     '__qa_rollback__' (0 footprint; no es DELETE → no choca con el ledger).
--   · Las mediciones quedan en variables PL/pgSQL (sobreviven al rollback) y se
--     escriben como FILAS en _qa_cancel_report DESPUÉS del sub-bloque.
--   · Al final, un SELECT muestra caso/check/resultado/detalle.
--
-- Resultado esperado: todas las filas 'OK' (ninguna 'FALLO'). 'SKIP' = faltó
-- rol/posición para montar el caso (no es fallo de la RPC).
--
-- COBERTURA (12 checks del plan, en 8 casos):
--   C1 happy path (status/active/audit) · C2 guard vacío + recovery unpack ·
--   C3 política cerrada + recovery reopen+unpack · C4 terminalidad ·
--   C5 roll-up neutral · C6 cero impacto (NO-STOCK/LEDGER/LOTS/ALLOC/ORDER/items) ·
--   C7 authz · C8 guard despachada (SKIP: requiere Gate 4C).
--
-- ⚠️ Requiere 0024/0026/0027 + 0029/0030/0031 + 0032 + 0033 + 0034 APLICADAS.
-- =========================================================================

drop table if exists _qa_cancel_report;
create temp table _qa_cancel_report (
  seq       serial primary key,
  caso      text,
  chk       text,
  resultado text,
  detalle   text
);

-- =========================================================================
-- CASO 1 — Camino feliz: bulto vacío 'abierta' → anular → 'anulada' + active=false + audit.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_oid uuid; v_unit uuid;
  v_status text; v_active boolean; v_audit int; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_cancel_report(caso,chk,resultado,detalle) values ('Caso 1','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_cancel_report(caso,chk,resultado,detalle) values ('Caso 1','setup','SKIP','sin posiciones'); return; end if;

  begin
    -- pedido directo en 'en_preparacion' (estado requerido por create_packing_unit);
    -- el bulto vacío no necesita stock ni reservas.
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_CANCEL_C1','en_preparacion') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-A', 'Item A', 10);

    select public.create_packing_unit(v_oid, 'Caja vacía', 'caja') into v_unit;
    perform public.anular_packing_unit(v_unit);

    select status::text, active into v_status, v_active from public.packing_units where id = v_unit;
    select count(*) into v_audit from public.audit_log
      where entity='packing_unit' and entity_id=v_unit and action='packing.cancel';

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_cancel_report(caso,chk,resultado,detalle) values ('Caso 1','ejecución','FALLO', v_err);
  else
    insert into _qa_cancel_report(caso,chk,resultado,detalle) values
      ('Caso 1','bulto vacío anulado: status=anulada · active=false',
        case when v_status='anulada' and v_active=false then 'OK' else 'FALLO' end,
        format('status=%s active=%s', v_status, v_active)),
      ('Caso 1','audit_log packing.cancel registrado',
        case when v_audit=1 then 'OK' else 'FALLO' end,
        format('audit_rows=%s', v_audit));
  end if;
end $$;

-- =========================================================================
-- CASO 2 — Guard de VACÍO: anular bulto con contenido RECHAZA; tras unpack, OK.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_alloc uuid; v_unit uuid;
  v_rejected boolean := false; v_after_unpack text := null; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_cancel_report(caso,chk,resultado,detalle) values ('Caso 2','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_cancel_report(caso,chk,resultado,detalle) values ('Caso 2','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_CANCEL_C2','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-B', 'Item B', 100, v_pos, 'L-B', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_CANCEL_C2','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-B', 'Item B', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    perform public.confirm_picking_order(v_oid);
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='pickeada' limit 1;

    select public.create_packing_unit(v_oid, null, null) into v_unit;
    perform public.pack_allocation(v_unit, v_alloc);

    -- bulto con 1 ítem → anular debe RECHAZAR
    begin
      perform public.anular_packing_unit(v_unit);
    exception when others then
      if sqlerrm <> '__qa_rollback__' then v_rejected := true; end if;
    end;

    -- vaciar y reintentar → debe anular OK
    perform public.unpack_allocation(v_alloc);
    perform public.anular_packing_unit(v_unit);
    select status::text into v_after_unpack from public.packing_units where id = v_unit;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_cancel_report(caso,chk,resultado,detalle) values ('Caso 2','ejecución','FALLO', v_err);
  else
    insert into _qa_cancel_report(caso,chk,resultado,detalle) values
      ('Caso 2','anular bulto CON contenido → rechazado',
        case when v_rejected then 'OK' else 'FALLO' end,
        format('rejected=%s', v_rejected)),
      ('Caso 2','tras unpack (vacío) → anula OK',
        case when v_after_unpack='anulada' then 'OK' else 'FALLO' end,
        format('status=%s', v_after_unpack));
  end if;
end $$;

-- =========================================================================
-- CASO 3 — Política 'cerrada': anular cerrada RECHAZA; vía reopen→unpack→anular OK.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_alloc uuid; v_unit uuid;
  v_rej_closed boolean := false; v_final text := null; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_cancel_report(caso,chk,resultado,detalle) values ('Caso 3','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_cancel_report(caso,chk,resultado,detalle) values ('Caso 3','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_CANCEL_C3','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-C', 'Item C', 100, v_pos, 'L-C', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_CANCEL_C3','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-C', 'Item C', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    perform public.confirm_picking_order(v_oid);
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='pickeada' limit 1;

    select public.create_packing_unit(v_oid, null, null) into v_unit;
    perform public.pack_allocation(v_unit, v_alloc);
    perform public.close_packing_unit(v_unit);     -- → 'cerrada'

    -- anular cerrada → RECHAZA ('no está abierto')
    begin
      perform public.anular_packing_unit(v_unit);
    exception when others then
      if sqlerrm <> '__qa_rollback__' then v_rej_closed := true; end if;
    end;

    -- vía correcta: reopen → unpack → anular
    perform public.reopen_packing_unit(v_unit);    -- → 'abierta'
    perform public.unpack_allocation(v_alloc);     -- bulto vacío
    perform public.anular_packing_unit(v_unit);
    select status::text into v_final from public.packing_units where id = v_unit;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_cancel_report(caso,chk,resultado,detalle) values ('Caso 3','ejecución','FALLO', v_err);
  else
    insert into _qa_cancel_report(caso,chk,resultado,detalle) values
      ('Caso 3','anular bulto CERRADA → rechazado',
        case when v_rej_closed then 'OK' else 'FALLO' end,
        format('rejected=%s', v_rej_closed)),
      ('Caso 3','vía reopen→unpack→anular → anulada',
        case when v_final='anulada' then 'OK' else 'FALLO' end,
        format('status=%s', v_final));
  end if;
end $$;

-- =========================================================================
-- CASO 4 — Terminalidad: anular un bulto ya 'anulada' → RECHAZA.
-- =========================================================================
do $$
declare
  v_uid uuid; v_oid uuid; v_unit uuid; v_rejected boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_cancel_report(caso,chk,resultado,detalle) values ('Caso 4','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);

  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_CANCEL_C4','en_preparacion') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested) values (v_oid, 'SKU-D', 'Item D', 10);
    select public.create_packing_unit(v_oid, null, null) into v_unit;
    perform public.anular_packing_unit(v_unit);            -- 1ª vez OK

    begin
      perform public.anular_packing_unit(v_unit);          -- 2ª vez → RECHAZA
    exception when others then
      if sqlerrm <> '__qa_rollback__' then v_rejected := true; end if;
    end;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_cancel_report(caso,chk,resultado,detalle) values ('Caso 4','ejecución','FALLO', v_err);
  else
    insert into _qa_cancel_report(caso,chk,resultado,detalle) values
      ('Caso 4','anular un bulto ya anulado → rechazado (terminal)',
        case when v_rejected then 'OK' else 'FALLO' end,
        format('rejected=%s', v_rejected));
  end if;
end $$;

-- =========================================================================
-- CASO 5 — Roll-up NEUTRAL: anular bulto vacío NO cambia línea ni pedido.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_unit uuid;
  v_lstatus text; v_ostatus text; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_cancel_report(caso,chk,resultado,detalle) values ('Caso 5','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_cancel_report(caso,chk,resultado,detalle) values ('Caso 5','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_CANCEL_C5','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-E', 'Item E', 100, v_pos, 'L-E', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_CANCEL_C5','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-E', 'Item E', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    perform public.confirm_picking_order(v_oid);            -- línea 'pickeado', pedido 'en_preparacion'

    -- crear un bulto vacío adicional y anularlo: la línea/pedido NO deben moverse
    select public.create_packing_unit(v_oid, 'Vacío extra', null) into v_unit;
    perform public.anular_packing_unit(v_unit);

    select status into v_lstatus from public.logistics_order_items where id = v_line;
    select status into v_ostatus from public.logistics_orders where id = v_oid;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_cancel_report(caso,chk,resultado,detalle) values ('Caso 5','ejecución','FALLO', v_err);
  else
    insert into _qa_cancel_report(caso,chk,resultado,detalle) values
      ('Caso 5','línea sigue pickeado · pedido sigue en_preparacion (roll-up neutral)',
        case when v_lstatus='pickeado' and v_ostatus='en_preparacion' then 'OK' else 'FALLO' end,
        format('linea=%s pedido=%s', v_lstatus, v_ostatus));
  end if;
end $$;

-- =========================================================================
-- CASO 6 — CERO IMPACTO: NO-STOCK · NO-LEDGER · NO-LOTS · NO-ALLOCATION · NO-ORDER · items intacta.
--   Mide before/after alrededor de crear+anular un bulto vacío con una reserva pickeada presente.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_oid uuid; v_line uuid; v_inv uuid; v_unit uuid;
  b_avail numeric; b_resv numeric; a_avail numeric; a_resv numeric;
  b_mov int; a_mov int; b_lots numeric; a_lots numeric;
  b_alloc int; a_alloc int; b_alloc_pick int; a_alloc_pick int;
  b_ostatus text; a_ostatus text; b_pui int; a_pui int;
  v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_cancel_report(caso,chk,resultado,detalle) values ('Caso 6','setup','SKIP','sin rol habilitado'); return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;
  if v_pos is null then insert into _qa_cancel_report(caso,chk,resultado,detalle) values ('Caso 6','setup','SKIP','sin posiciones'); return; end if;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_CANCEL_C6','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-F', 'Item F', 100, v_pos, 'L-F', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_CANCEL_C6','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-F', 'Item F', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    perform public.confirm_picking_order(v_oid);
    select inventory_item_id into v_inv from public.stock_allocations where order_item_id=v_line limit 1;

    -- SNAPSHOT before
    select stock_available, stock_reserved into b_avail, b_resv from public.inventory_items where id=v_inv;
    select count(*) into b_mov from public.inventory_movements;
    select coalesce(sum(quantity),0) into b_lots from public.inventory_lots where inventory_item_id=v_inv;
    select count(*) into b_alloc from public.stock_allocations where order_item_id=v_line;
    select count(*) into b_alloc_pick from public.stock_allocations where order_item_id=v_line and status='pickeada';
    select status into b_ostatus from public.logistics_orders where id=v_oid;
    select count(*) into b_pui from public.packing_unit_items;

    -- ACCIÓN: crear bulto vacío + anular
    select public.create_packing_unit(v_oid, null, null) into v_unit;
    perform public.anular_packing_unit(v_unit);

    -- SNAPSHOT after
    select stock_available, stock_reserved into a_avail, a_resv from public.inventory_items where id=v_inv;
    select count(*) into a_mov from public.inventory_movements;
    select coalesce(sum(quantity),0) into a_lots from public.inventory_lots where inventory_item_id=v_inv;
    select count(*) into a_alloc from public.stock_allocations where order_item_id=v_line;
    select count(*) into a_alloc_pick from public.stock_allocations where order_item_id=v_line and status='pickeada';
    select status into a_ostatus from public.logistics_orders where id=v_oid;
    select count(*) into a_pui from public.packing_unit_items;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_cancel_report(caso,chk,resultado,detalle) values ('Caso 6','ejecución','FALLO', v_err);
  else
    insert into _qa_cancel_report(caso,chk,resultado,detalle) values
      ('Caso 6','NO-STOCK: stock_available/reserved sin cambios',
        case when a_avail=b_avail and a_resv=b_resv then 'OK' else 'FALLO' end,
        format('avail %s→%s · resv %s→%s', b_avail, a_avail, b_resv, a_resv)),
      ('Caso 6','NO-LEDGER: count(inventory_movements) sin crecer',
        case when a_mov=b_mov then 'OK' else 'FALLO' end,
        format('mov %s→%s', b_mov, a_mov)),
      ('Caso 6','NO-LOTS: Σ inventory_lots.quantity intacto',
        case when a_lots=b_lots then 'OK' else 'FALLO' end,
        format('lots %s→%s', b_lots, a_lots)),
      ('Caso 6','NO-ALLOCATION: stock_allocations (conteo + pickeada) sin cambios',
        case when a_alloc=b_alloc and a_alloc_pick=b_alloc_pick then 'OK' else 'FALLO' end,
        format('alloc %s→%s · pickeada %s→%s', b_alloc, a_alloc, b_alloc_pick, a_alloc_pick)),
      ('Caso 6','NO-ORDER: estado del pedido sin cambios',
        case when a_ostatus=b_ostatus then 'OK' else 'FALLO' end,
        format('pedido %s→%s', b_ostatus, a_ostatus)),
      ('Caso 6','packing_unit_items intacta (0 filas afectadas)',
        case when a_pui=b_pui then 'OK' else 'FALLO' end,
        format('pui %s→%s', b_pui, a_pui));
  end if;
end $$;

-- =========================================================================
-- CASO 7 — Autorización: JWT sin rol habilitado → anular RECHAZA (insufficient_privilege).
-- =========================================================================
do $$
declare
  v_uid uuid; v_oid uuid; v_unit uuid; v_blocked boolean := false; v_err text := null;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then insert into _qa_cancel_report(caso,chk,resultado,detalle) values ('Caso 7','setup','SKIP','sin rol habilitado'); return; end if;

  begin
    -- setup con rol válido
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_CANCEL_C7','en_preparacion') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested) values (v_oid, 'SKU-G', 'Item G', 10);
    select public.create_packing_unit(v_oid, null, null) into v_unit;

    -- ahora SIN claims (current_role() null) → debe rechazar
    perform set_config('request.jwt.claims', '', true);
    begin
      perform public.anular_packing_unit(v_unit);
    exception
      when insufficient_privilege then v_blocked := true;
      when others then if sqlerrm <> '__qa_rollback__' then v_blocked := true; end if;
    end;

    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm <> '__qa_rollback__' then v_err := sqlerrm; end if;
  end;

  if v_err is not null then
    insert into _qa_cancel_report(caso,chk,resultado,detalle) values ('Caso 7','ejecución','FALLO', v_err);
  else
    insert into _qa_cancel_report(caso,chk,resultado,detalle) values
      ('Caso 7','anular sin autorización → rechazado',
        case when v_blocked then 'OK' else 'FALLO' end,
        format('blocked=%s', v_blocked));
  end if;
end $$;

-- =========================================================================
-- CASO 8 — Guard 'despachada': SKIP — no hay vía legítima a 'despachada' sin Gate 4C.
--   Se cubre por inspección de código (0034) y se valida en el E2E conjunto con 0035.
-- =========================================================================
insert into _qa_cancel_report(caso,chk,resultado,detalle) values
  ('Caso 8','guard despachada→anulada bloqueado',
   'SKIP','requiere Gate 4C (0035) para producir un bulto despachada; cubierto por inspección de 0034');

-- =========================================================================
-- REPORTE FINAL — FALLO/SKIP primero, luego OK. Esperado: todo 'OK' (+ Caso 8 SKIP).
-- =========================================================================
select seq, caso, chk, resultado, detalle
from _qa_cancel_report
order by (resultado = 'OK'), seq;
