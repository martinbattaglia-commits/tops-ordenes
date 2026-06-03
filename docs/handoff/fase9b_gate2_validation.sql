-- =========================================================================
-- FASE 9B · GATE 2 — Kit de validación del motor de reservas FEFO.
-- Para el SQL Editor de Supabase. Correr DESPUÉS de aplicar 0031.
--
-- Cada caso es un bloque DO $$..$$ autocontenido que:
--   · auto-descubre un profiles.id con rol habilitado y simula el JWT
--     (set_config request.jwt.claims) → current_role() resuelve para las RPC.
--   · arma stock real vía confirm_reception, ejecuta la RPC, verifica con
--     raise notice, y REVIERTE todo con el sentinel '__qa_rollback__'
--     (cero footprint; el rollback no es DELETE → no choca con el ledger).
-- Resultado esperado: solo líneas "OK ...", ninguna "FALLO ...".
-- =========================================================================

-- =========================================================================
-- CASO 1 — Reserva total + NO escribe inventory_movements.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_oid uuid; v_line uuid;
  v_avail numeric; v_resv numeric; v_st text; v_allocs int; v_mov0 int; v_mov1 int;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then raise notice 'SKIP Caso 1: sin rol habilitado'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;

  begin
    -- setup: recepción → stock 100
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PED_C1','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-A', 'Item A', 100, v_pos, 'L-A', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    select id into v_inv from public.inventory_items where client_name='TEST_QA_PED_C1' and sku='SKU-A' limit 1;

    -- pedido 60
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PED_C1','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-A', 'Item A', 60) returning id into v_line;

    select count(*) into v_mov0 from public.inventory_movements;
    perform public.allocate_order(v_oid);
    select count(*) into v_mov1 from public.inventory_movements;

    select stock_available, stock_reserved into v_avail, v_resv from public.inventory_items where id=v_inv;
    select status into v_st from public.logistics_order_items where id=v_line;
    select count(*) into v_allocs from public.stock_allocations where order_item_id=v_line and status='reservada';

    if v_st='reservado' and v_avail=40 and v_resv=60 and v_allocs=1 then
      raise notice 'OK Caso 1a: línea reservado, avail=40 reserved=60, 1 allocation';
    else
      raise notice 'FALLO Caso 1a: st=% avail=% resv=% allocs=%', v_st, v_avail, v_resv, v_allocs;
    end if;
    if v_mov1 = v_mov0 then
      raise notice 'OK Caso 1b: allocate NO escribió inventory_movements (% = %)', v_mov1, v_mov0;
    else
      raise notice 'FALLO Caso 1b: allocate escribió movimientos (% -> %)', v_mov0, v_mov1;
    end if;
    if (select status from public.logistics_orders where id=v_oid) = 'en_preparacion' then
      raise notice 'OK Caso 1c: cabecera en_preparacion';
    else raise notice 'FALLO Caso 1c: cabecera no pasó a en_preparacion'; end if;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm='__qa_rollback__' then raise notice 'Caso 1: revertido (0 footprint).';
    else raise; end if;
  end;
end $$;

-- =========================================================================
-- CASO 2 — FEFO: reserva primero el ítem cuyo lote vence antes.
-- =========================================================================
do $$
declare
  v_uid uuid; v_p1 uuid; v_p2 uuid; v_recA uuid; v_recB uuid;
  v_inv_late uuid; v_inv_early uuid; v_oid uuid; v_line uuid;
  v_alloc_inv uuid; v_alloc_lot text;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then raise notice 'SKIP Caso 2: sin rol habilitado'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_p1 from public.warehouse_positions limit 1;
  select id into v_p2 from public.warehouse_positions where id <> v_p1 limit 1;
  if v_p2 is null then raise notice 'SKIP Caso 2: hacen falta 2 posiciones distintas'; return; end if;

  begin
    -- ítem LATE (pos1, vence 2027-12-31)
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PED_C2','GENERAL','pendiente',false) returning id into v_recA;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_recA, 'SKU-F', 'Item F', 50, v_p1, 'LOT-LATE', date '2027-12-31');
    perform public.confirm_reception(v_recA);
    -- ítem EARLY (pos2, vence 2026-07-01)
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PED_C2','GENERAL','pendiente',false) returning id into v_recB;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_recB, 'SKU-F', 'Item F', 50, v_p2, 'LOT-EARLY', date '2026-07-01');
    perform public.confirm_reception(v_recB);

    select id into v_inv_late  from public.inventory_items where client_name='TEST_QA_PED_C2' and sku='SKU-F' and position_id=v_p1;
    select id into v_inv_early from public.inventory_items where client_name='TEST_QA_PED_C2' and sku='SKU-F' and position_id=v_p2;

    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PED_C2','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-F', 'Item F', 30) returning id into v_line;

    perform public.allocate_order(v_oid);

    select inventory_item_id, lot_number into v_alloc_inv, v_alloc_lot
      from public.stock_allocations where order_item_id=v_line and status='reservada' limit 1;

    if v_alloc_inv = v_inv_early and v_alloc_lot = 'LOT-EARLY' then
      raise notice 'OK Caso 2: FEFO reservó del ítem EARLY (lote %)', v_alloc_lot;
    else
      raise notice 'FALLO Caso 2: reservó inv=% lote=% (esperado EARLY)', v_alloc_inv, v_alloc_lot;
    end if;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm='__qa_rollback__' then raise notice 'Caso 2: revertido (0 footprint).';
    else raise; end if;
  end;
end $$;

-- =========================================================================
-- CASO 3 — Reserva parcial: pedido > stock → reservado_parcial.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_oid uuid; v_line uuid;
  v_avail numeric; v_resv numeric; v_st text; v_resterm numeric;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then raise notice 'SKIP Caso 3: sin rol habilitado'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PED_C3','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-P', 'Item P', 40, v_pos, 'L-P', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    select id into v_inv from public.inventory_items where client_name='TEST_QA_PED_C3' and sku='SKU-P' limit 1;

    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PED_C3','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-P', 'Item P', 100) returning id into v_line;

    perform public.allocate_order(v_oid);

    select stock_available, stock_reserved into v_avail, v_resv from public.inventory_items where id=v_inv;
    select status into v_st from public.logistics_order_items where id=v_line;
    select coalesce(sum(quantity),0) into v_resterm from public.stock_allocations where order_item_id=v_line and status='reservada';

    if v_st='reservado_parcial' and v_avail=0 and v_resv=40 and v_resterm=40 then
      raise notice 'OK Caso 3: reservado_parcial (reservó 40 de 100), avail=0 reserved=40';
    else
      raise notice 'FALLO Caso 3: st=% avail=% resv=% reservado=%', v_st, v_avail, v_resv, v_resterm;
    end if;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm='__qa_rollback__' then raise notice 'Caso 3: revertido (0 footprint).';
    else raise; end if;
  end;
end $$;

-- =========================================================================
-- CASO 4 — Idempotencia: re-allocate no duplica.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_oid uuid; v_line uuid;
  v_resv numeric; v_allocs int;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then raise notice 'SKIP Caso 4: sin rol habilitado'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PED_C4','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-I', 'Item I', 100, v_pos, 'L-I', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    select id into v_inv from public.inventory_items where client_name='TEST_QA_PED_C4' and sku='SKU-I' limit 1;

    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PED_C4','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-I', 'Item I', 60) returning id into v_line;

    perform public.allocate_order(v_oid);   -- reserva 60
    perform public.allocate_order(v_oid);   -- re-ejecuta → no debe duplicar

    select stock_reserved into v_resv from public.inventory_items where id=v_inv;
    select count(*) into v_allocs from public.stock_allocations where order_item_id=v_line and status='reservada';

    if v_resv=60 and v_allocs=1 then
      raise notice 'OK Caso 4: idempotente (reserved=60, 1 allocation tras 2 corridas)';
    else
      raise notice 'FALLO Caso 4: reserved=% allocations=% (esperado 60 / 1)', v_resv, v_allocs;
    end if;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm='__qa_rollback__' then raise notice 'Caso 4: revertido (0 footprint).';
    else raise; end if;
  end;
end $$;

-- =========================================================================
-- CASO 5 — Liberación: release_allocation revierte buckets.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_oid uuid; v_line uuid; v_alloc uuid;
  v_avail numeric; v_resv numeric; v_st text; v_astatus text; v_rel timestamptz;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then raise notice 'SKIP Caso 5: sin rol habilitado'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PED_C5','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-R', 'Item R', 100, v_pos, 'L-R', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    select id into v_inv from public.inventory_items where client_name='TEST_QA_PED_C5' and sku='SKU-R' limit 1;

    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PED_C5','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-R', 'Item R', 60) returning id into v_line;
    perform public.allocate_order(v_oid);
    select id into v_alloc from public.stock_allocations where order_item_id=v_line and status='reservada' limit 1;

    perform public.release_allocation(v_alloc);

    select stock_available, stock_reserved into v_avail, v_resv from public.inventory_items where id=v_inv;
    select status into v_st from public.logistics_order_items where id=v_line;
    select status, released_at into v_astatus, v_rel from public.stock_allocations where id=v_alloc;

    if v_avail=100 and v_resv=0 and v_astatus='liberada' and v_rel is not null and v_st='pendiente' then
      raise notice 'OK Caso 5: liberada (avail=100 reserved=0, released_at set, línea pendiente)';
    else
      raise notice 'FALLO Caso 5: avail=% resv=% alloc=% rel=% línea=%', v_avail, v_resv, v_astatus, v_rel, v_st;
    end if;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm='__qa_rollback__' then raise notice 'Caso 5: revertido (0 footprint).';
    else raise; end if;
  end;
end $$;

-- =========================================================================
-- CASO 6 — Cancelación: cancel_order libera todo y marca cancelado.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_oid uuid; v_line uuid;
  v_avail numeric; v_resv numeric; v_ost text; v_lst text; v_active int;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then raise notice 'SKIP Caso 6: sin rol habilitado'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PED_C6','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-C', 'Item C', 100, v_pos, 'L-C', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    select id into v_inv from public.inventory_items where client_name='TEST_QA_PED_C6' and sku='SKU-C' limit 1;

    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PED_C6','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-C', 'Item C', 60) returning id into v_line;
    perform public.allocate_order(v_oid);

    perform public.cancel_order(v_oid);

    select stock_available, stock_reserved into v_avail, v_resv from public.inventory_items where id=v_inv;
    select status into v_ost from public.logistics_orders where id=v_oid;
    select status into v_lst from public.logistics_order_items where id=v_line;
    select count(*) into v_active from public.stock_allocations where order_item_id=v_line and status='reservada';

    if v_avail=100 and v_resv=0 and v_ost='cancelado' and v_lst='cancelado' and v_active=0 then
      raise notice 'OK Caso 6: cancelado, stock liberado (avail=100 reserved=0), 0 reservas activas';
    else
      raise notice 'FALLO Caso 6: avail=% resv=% pedido=% línea=% activas=%', v_avail, v_resv, v_ost, v_lst, v_active;
    end if;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm='__qa_rollback__' then raise notice 'Caso 6: revertido (0 footprint).';
    else raise; end if;
  end;
end $$;

-- =========================================================================
-- CASO 7 — Invariante cuarentena: stock en cuarentena NO es reservable.
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_oid uuid; v_line uuid;
  v_avail numeric; v_resv numeric; v_st text; v_allocs int;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then raise notice 'SKIP Caso 7: sin rol habilitado'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;

  begin
    -- recepción EN CUARENTENA → stock va a stock_reserved (sin allocation)
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PED_C7','GENERAL','pendiente',true) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-Q', 'Item Q', 100, v_pos, 'L-Q', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    select id into v_inv from public.inventory_items where client_name='TEST_QA_PED_C7' and sku='SKU-Q' limit 1;

    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PED_C7','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-Q', 'Item Q', 50) returning id into v_line;

    perform public.allocate_order(v_oid);

    select stock_available, stock_reserved into v_avail, v_resv from public.inventory_items where id=v_inv;
    select status into v_st from public.logistics_order_items where id=v_line;
    select count(*) into v_allocs from public.stock_allocations where order_item_id=v_line and status='reservada';

    if v_avail=0 and v_resv=100 and v_st='pendiente' and v_allocs=0 then
      raise notice 'OK Caso 7: cuarentena intacta (reserved=100), línea pendiente, 0 allocations';
    else
      raise notice 'FALLO Caso 7: avail=% resv=% línea=% allocs=% (cuarentena fue tocada?)', v_avail, v_resv, v_st, v_allocs;
    end if;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm='__qa_rollback__' then raise notice 'Caso 7: revertido (0 footprint).';
    else raise; end if;
  end;
end $$;

-- =========================================================================
-- CASO 8 — Autorización: sin rol habilitado → insufficient_privilege.
-- =========================================================================
do $$
declare v_uid uuid; v_oid uuid;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then raise notice 'SKIP Caso 8: sin rol habilitado para el setup'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);

  begin
    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PED_C8','pendiente') returning id into v_oid;

    -- limpiar el JWT → current_role() = null → debe rechazar
    perform set_config('request.jwt.claims', '', true);
    begin
      perform public.allocate_order(v_oid);
      raise notice 'FALLO Caso 8: allocate_order NO rechazó sin autorización';
    exception
      when insufficient_privilege then
        raise notice 'OK Caso 8: allocate_order rechazado (insufficient_privilege)';
    end;

    -- restaurar JWT para revertir limpio
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm='__qa_rollback__' then raise notice 'Caso 8: revertido (0 footprint).';
    else raise; end if;
  end;
end $$;

-- =========================================================================
-- CASO 9 — Invariante final: stock_reserved(ítem) == Σ allocations 'reservada'
--          (para ítem sin cuarentena).
-- =========================================================================
do $$
declare
  v_uid uuid; v_pos uuid; v_rec uuid; v_inv uuid; v_oid uuid; v_line uuid;
  v_resv numeric; v_sum numeric;
begin
  select id into v_uid from public.profiles where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then raise notice 'SKIP Caso 9: sin rol habilitado'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
      values ('TEST_QA_PED_C9','GENERAL','pendiente',false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id, lot_number, expiration_date)
      values (v_rec, 'SKU-INV', 'Item INV', 100, v_pos, 'L-INV', date '2027-01-01');
    perform public.confirm_reception(v_rec);
    select id into v_inv from public.inventory_items where client_name='TEST_QA_PED_C9' and sku='SKU-INV' limit 1;

    insert into public.logistics_orders (client_name, status) values ('TEST_QA_PED_C9','pendiente') returning id into v_oid;
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-INV', 'Item INV', 70) returning id into v_line;
    perform public.allocate_order(v_oid);

    select stock_reserved into v_resv from public.inventory_items where id=v_inv;
    select coalesce(sum(quantity),0) into v_sum from public.stock_allocations
      where inventory_item_id=v_inv and status='reservada';

    if v_resv = v_sum then
      raise notice 'OK Caso 9: invariante OK (stock_reserved=% == Σ allocations=%)', v_resv, v_sum;
    else
      raise notice 'FALLO Caso 9: stock_reserved=% != Σ allocations=%', v_resv, v_sum;
    end if;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm='__qa_rollback__' then raise notice 'Caso 9: revertido (0 footprint).';
    else raise; end if;
  end;
end $$;

-- =========================================================================
-- Verificación de 0 footprint (READ-ONLY):
--   select count(*) from public.logistics_orders where client_name like 'TEST_QA_PED_%'; -- 0
--   select count(*) from public.inventory_items   where client_name like 'TEST_QA_PED_%'; -- 0
-- =========================================================================
