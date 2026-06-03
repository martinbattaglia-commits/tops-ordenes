-- =========================================================================
-- WMS Sprint 2 — KIT DE VALIDACIÓN, Casos 2 a 6
-- Generado 2026-06-02. Para correr en el SQL Editor de Supabase (proyecto
-- arsksytgdnzukbmfgkju). NO modifica esquema. NO deja datos permanentes.
--
-- CÓMO LEER LOS RESULTADOS
--   Cada caso es un bloque DO $$ … $$ que emite líneas con `raise notice`.
--   Mirá el panel de mensajes / "Notices" del SQL Editor. Cada aserción
--   imprime  "OK ..."  (esperado)  o  "FALLO ..."  (regresión a investigar).
--
-- POR QUÉ NO ENSUCIA LA DB (regla de higiene de DEV)
--   El trabajo real de cada caso ocurre dentro de una SUBTRANSACCIÓN que se
--   revierte con un sentinel ('__qa_rollback__' que se atrapa). El rollback
--   NO es un DELETE, así que tampoco choca con el trigger de inmutabilidad
--   del ledger (Caso 6). Las NOTICE no son transaccionales → sobreviven al
--   rollback y se ven igual. Resultado: 0 filas nuevas en receptions,
--   reception_items, inventory_items, inventory_lots ni inventory_movements.
--
-- AUTORIZACIÓN DE LAS RPC
--   confirm_reception / release_quarantine / confirm_movement exigen
--   current_role() ∈ (admin, operaciones, supervisor). En el SQL Editor no hay
--   JWT → auth.uid() es null → current_role() null → 'no autorizado'. Por eso
--   cada bloque AUTO-DESCUBRE un profiles.id con rol habilitado y simula el
--   JWT con set_config('request.jwt.claims', …). Si no hay ninguno, el caso
--   imprime SKIP y te dice que asignes un rol.
--
-- ORDEN: correr de a un caso, verificar las NOTICE, y recién pasar al siguiente.
-- =========================================================================


-- =========================================================================
-- STEP 0 — Diagnóstico previo (READ-ONLY, informativo). Corré esto primero.
-- =========================================================================
select 'usuarios con rol habilitado para RPC' as info;
select id, role
from public.profiles
where role in ('admin','operaciones','supervisor')
order by created_at
limit 10;

select 'posiciones de depósito disponibles (se usan 2 para el traslado)' as info;
select id from public.warehouse_positions limit 5;


-- =========================================================================
-- CASO 2 — ANMAT: el CHECK reception_items_anmat_lot_chk bloquea líneas
--          ANMAT sin lote+vencimiento, y acepta las que sí lo traen.
--          (No usa RPC → no necesita JWT; corre como postgres y el CHECK
--           dispara igual.)
-- =========================================================================
do $$
declare
  v_rec uuid;
begin
  begin  -- subtransacción reversible
    insert into public.receptions (client_name, business_unit, status)
    values ('TEST_QA_ANMAT', 'ANMAT', 'pendiente')
    returning id into v_rec;

    -- 2a) ANMAT SIN lote/vencimiento → debe ser RECHAZADO por el CHECK (23514)
    begin
      insert into public.reception_items (reception_id, sku, description, quantity)
      values (v_rec, 'SKU-ANMAT-A', 'ANMAT sin lote (debe fallar)', 10);
      raise notice 'FALLO Caso 2a: el CHECK ANMAT NO bloqueó una línea sin lote';
    exception
      when check_violation then
        raise notice 'OK Caso 2a: línea ANMAT sin lote RECHAZADA (sqlstate %)', sqlstate;
    end;

    -- 2b) ANMAT CON lote + vencimiento → debe ACEPTARSE
    begin
      insert into public.reception_items
        (reception_id, sku, description, quantity, lot_number, expiration_date)
      values (v_rec, 'SKU-ANMAT-B', 'ANMAT con lote (debe pasar)', 10, 'L-QA-001', date '2027-01-01');
      raise notice 'OK Caso 2b: línea ANMAT con lote+vencimiento ACEPTADA';
    exception
      when others then
        raise notice 'FALLO Caso 2b: línea ANMAT con lote fue rechazada (%)', sqlerrm;
    end;

    raise exception '__qa_rollback__';
  exception
    when others then
      if sqlerrm = '__qa_rollback__' then
        raise notice 'Caso 2: datos de prueba revertidos (0 footprint).';
      else
        raise;  -- error inesperado → propagar
      end if;
  end;
end $$;


-- =========================================================================
-- CASO 3 — Cuarentena: requires_quarantine=true ⇒ stock va a stock_reserved
--          y cabecera→cuarentena; release_quarantine ⇒ reserved→available,
--          cabecera→recibida, movimiento 'ajuste'.
-- =========================================================================
do $$
declare
  v_uid  uuid;
  v_rec  uuid;
  v_pos  uuid;
  v_inv  uuid;
  v_avail numeric;
  v_resv  numeric;
  v_status text;
  v_mov_ing int;
  v_mov_adj int;
begin
  select id into v_uid from public.profiles
   where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then
    raise notice 'SKIP Caso 3: no hay profiles.role ∈ (admin,operaciones,supervisor). Asigná uno y reintentá.';
    return;
  end if;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;

  begin  -- subtransacción reversible
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
    values ('TEST_QA_CUAR', 'GENERAL', 'pendiente', true)
    returning id into v_rec;

    insert into public.reception_items (reception_id, sku, description, quantity, position_id)
    values (v_rec, 'SKU-QA-CUAR', 'Item cuarentena', 50, v_pos);

    -- Confirmar (entra a cuarentena)
    perform public.confirm_reception(v_rec);

    select status into v_status from public.receptions where id = v_rec;
    select inventory_item_id into v_inv from public.reception_items where reception_id = v_rec limit 1;
    select stock_available, stock_reserved into v_avail, v_resv from public.inventory_items where id = v_inv;
    select count(*) into v_mov_ing from public.inventory_movements
      where reference_type='recepcion' and reference_id=v_rec and movement_type='ingreso';

    raise notice 'Caso 3 confirmar → cabecera=% | available=% reserved=% | mov ingreso=%',
                 v_status, v_avail, v_resv, v_mov_ing;
    if v_status='cuarentena' and v_resv=50 and v_avail=0 and v_mov_ing=1 then
      raise notice 'OK Caso 3a: stock a RESERVED, cabecera en cuarentena, movimiento ingreso registrado';
    else
      raise notice 'FALLO Caso 3a: estado inesperado tras confirmar en cuarentena';
    end if;

    -- Liberar cuarentena
    perform public.release_quarantine(v_rec);

    select status into v_status from public.receptions where id = v_rec;
    select stock_available, stock_reserved into v_avail, v_resv from public.inventory_items where id = v_inv;
    select count(*) into v_mov_adj from public.inventory_movements
      where reference_type='recepcion' and reference_id=v_rec and movement_type='ajuste';

    raise notice 'Caso 3 liberar → cabecera=% | available=% reserved=% | mov ajuste=%',
                 v_status, v_avail, v_resv, v_mov_adj;
    if v_status='recibida' and v_avail=50 and v_resv=0 and v_mov_adj=1 then
      raise notice 'OK Caso 3b: reserved→available, cabecera recibida, movimiento ajuste registrado';
    else
      raise notice 'FALLO Caso 3b: estado inesperado tras liberar cuarentena';
    end if;

    raise exception '__qa_rollback__';
  exception
    when others then
      if sqlerrm = '__qa_rollback__' then
        raise notice 'Caso 3: datos de prueba revertidos (0 footprint).';
      else
        raise;
      end if;
  end;
end $$;


-- =========================================================================
-- CASO 4 — Movimientos (confirm_movement): traslado / ajuste / egreso, y
--          el rechazo de 'ingreso' por esta vía. Sin UI (solo RPC).
-- =========================================================================
do $$
declare
  v_uid  uuid;
  v_rec  uuid;
  v_pos1 uuid;
  v_pos2 uuid;
  v_inv  uuid;
  v_total0 numeric;
  v_total  numeric;
  v_posnow uuid;
begin
  select id into v_uid from public.profiles
   where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then
    raise notice 'SKIP Caso 4: no hay rol habilitado.'; return;
  end if;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  select id into v_pos1 from public.warehouse_positions limit 1;
  select id into v_pos2 from public.warehouse_positions where id <> v_pos1 limit 1;

  begin
    -- Setup: crear stock vía recepción normal (no cuarentena)
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
    values ('TEST_QA_MOV', 'GENERAL', 'pendiente', false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id)
    values (v_rec, 'SKU-QA-MOV', 'Item movimientos', 100, v_pos1);
    perform public.confirm_reception(v_rec);
    select inventory_item_id into v_inv from public.reception_items where reception_id = v_rec limit 1;
    select stock_available + stock_reserved into v_total0 from public.inventory_items where id = v_inv;
    raise notice 'Caso 4 setup → inventory_item=% total=%', v_inv, v_total0;

    -- 4a) TRASLADO: cambia position_id, total constante
    if v_pos2 is null then
      raise notice 'SKIP Caso 4a (traslado): hace falta una 2da posición distinta.';
    else
      perform public.confirm_movement(v_inv, 'traslado'::public.movement_type_t, v_pos2,
                                       null, 'QA traslado', null, null, null);
      select position_id, stock_available + stock_reserved into v_posnow, v_total
        from public.inventory_items where id = v_inv;
      if v_posnow = v_pos2 and v_total = v_total0 then
        raise notice 'OK Caso 4a: traslado movió posición (% ) y conservó total (%)', v_posnow, v_total;
      else
        raise notice 'FALLO Caso 4a: pos=% total=% (esperado pos=% total=%)', v_posnow, v_total, v_pos2, v_total0;
      end if;
    end if;

    -- 4b) AJUSTE: delta -10 → total baja 10
    perform public.confirm_movement(v_inv, 'ajuste'::public.movement_type_t, null,
                                     -10, 'QA ajuste', null, null, null);
    select stock_available + stock_reserved into v_total from public.inventory_items where id = v_inv;
    if v_total = v_total0 - 10 then
      raise notice 'OK Caso 4b: ajuste -10 aplicado (total=%)', v_total;
    else
      raise notice 'FALLO Caso 4b: total=% (esperado %)', v_total, v_total0 - 10;
    end if;

    -- 4c) EGRESO: salida 20 → total baja 20 más
    perform public.confirm_movement(v_inv, 'egreso'::public.movement_type_t, null,
                                     20, 'QA egreso', null, null, null);
    select stock_available + stock_reserved into v_total from public.inventory_items where id = v_inv;
    if v_total = v_total0 - 30 then
      raise notice 'OK Caso 4c: egreso 20 aplicado (total=%)', v_total;
    else
      raise notice 'FALLO Caso 4c: total=% (esperado %)', v_total, v_total0 - 30;
    end if;

    -- 4d) INGRESO por confirm_movement → debe ser RECHAZADO
    begin
      perform public.confirm_movement(v_inv, 'ingreso'::public.movement_type_t, null,
                                       5, 'QA ingreso ilegal', null, null, null);
      raise notice 'FALLO Caso 4d: confirm_movement aceptó un ingreso (debía rechazarlo)';
    exception
      when others then
        raise notice 'OK Caso 4d: ingreso vía confirm_movement RECHAZADO (%)', sqlerrm;
    end;

    raise exception '__qa_rollback__';
  exception
    when others then
      if sqlerrm = '__qa_rollback__' then
        raise notice 'Caso 4: datos de prueba revertidos (0 footprint).';
      else
        raise;
      end if;
  end;
end $$;


-- =========================================================================
-- CASO 5 — Idempotencia / guarda de estado: re-confirmar una recepción ya
--          'recibida' NO duplica stock (la RPC rechaza por estado).
-- =========================================================================
do $$
declare
  v_uid  uuid;
  v_rec  uuid;
  v_pos  uuid;
  v_inv  uuid;
  v_total_1 numeric;
  v_total_2 numeric;
  v_mov_count int;
begin
  select id into v_uid from public.profiles
   where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then
    raise notice 'SKIP Caso 5: no hay rol habilitado.'; return;
  end if;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
    values ('TEST_QA_IDEM', 'GENERAL', 'pendiente', false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id)
    values (v_rec, 'SKU-QA-IDEM', 'Item idempotencia', 70, v_pos);

    -- 1ª confirmación → recibida, stock=70
    perform public.confirm_reception(v_rec);
    select inventory_item_id into v_inv from public.reception_items where reception_id = v_rec limit 1;
    select stock_available + stock_reserved into v_total_1 from public.inventory_items where id = v_inv;
    raise notice 'Caso 5: 1ª confirmación → total=%', v_total_1;

    -- 2ª confirmación → debe RECHAZARSE (estado 'recibida' no es confirmable)
    begin
      perform public.confirm_reception(v_rec);
      raise notice 'FALLO Caso 5: la 2ª confirmación NO fue rechazada (riesgo de doble stock)';
    exception
      when others then
        raise notice 'OK Caso 5a: 2ª confirmación RECHAZADA por guarda de estado (%)', sqlerrm;
    end;

    -- Verificar que el stock y la cantidad de movimientos NO cambiaron
    select stock_available + stock_reserved into v_total_2 from public.inventory_items where id = v_inv;
    select count(*) into v_mov_count from public.inventory_movements
      where reference_type='recepcion' and reference_id=v_rec and movement_type='ingreso';
    if v_total_2 = v_total_1 and v_mov_count = 1 then
      raise notice 'OK Caso 5b: stock estable (%=%) y un solo movimiento ingreso (%)', v_total_2, v_total_1, v_mov_count;
    else
      raise notice 'FALLO Caso 5b: total=% (era %), movimientos ingreso=% (esperado 1)', v_total_2, v_total_1, v_mov_count;
    end if;

    raise exception '__qa_rollback__';
  exception
    when others then
      if sqlerrm = '__qa_rollback__' then
        raise notice 'Caso 5: datos de prueba revertidos (0 footprint).';
      else
        raise;
      end if;
  end;
end $$;


-- =========================================================================
-- CASO 6 — Ledger inmutable: UPDATE y DELETE sobre inventory_movements deben
--          fallar por el trigger prevent_inventory_movement_mutation
--          (restrict_violation), incluso para roles con privilegios.
--          Se crea un movimiento real (vía confirm_reception) y se intenta
--          mutarlo; todo dentro de la subtransacción reversible.
-- =========================================================================
do $$
declare
  v_uid uuid;
  v_rec uuid;
  v_pos uuid;
  v_mov uuid;
begin
  select id into v_uid from public.profiles
   where role in ('admin','operaciones','supervisor') order by created_at limit 1;
  if v_uid is null then
    raise notice 'SKIP Caso 6: no hay rol habilitado (hace falta para crear el movimiento de prueba).'; return;
  end if;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  select id into v_pos from public.warehouse_positions limit 1;

  begin
    insert into public.receptions (client_name, business_unit, status, requires_quarantine)
    values ('TEST_QA_LEDGER', 'GENERAL', 'pendiente', false) returning id into v_rec;
    insert into public.reception_items (reception_id, sku, description, quantity, position_id)
    values (v_rec, 'SKU-QA-LEDGER', 'Item ledger', 30, v_pos);
    perform public.confirm_reception(v_rec);

    select id into v_mov from public.inventory_movements
      where reference_type='recepcion' and reference_id=v_rec limit 1;
    raise notice 'Caso 6 setup → movimiento de prueba=%', v_mov;

    -- 6a) UPDATE → debe fallar
    begin
      update public.inventory_movements set quantity = quantity + 1 where id = v_mov;
      raise notice 'FALLO Caso 6a: UPDATE sobre el ledger NO fue bloqueado';
    exception
      when others then
        raise notice 'OK Caso 6a: UPDATE al ledger BLOQUEADO (% / %)', sqlstate, sqlerrm;
    end;

    -- 6b) DELETE → debe fallar
    begin
      delete from public.inventory_movements where id = v_mov;
      raise notice 'FALLO Caso 6b: DELETE sobre el ledger NO fue bloqueado';
    exception
      when others then
        raise notice 'OK Caso 6b: DELETE al ledger BLOQUEADO (% / %)', sqlstate, sqlerrm;
    end;

    raise exception '__qa_rollback__';
  exception
    when others then
      if sqlerrm = '__qa_rollback__' then
        raise notice 'Caso 6: datos de prueba revertidos (0 footprint).';
      else
        raise;
      end if;
  end;
end $$;

-- =========================================================================
-- FIN DEL KIT. Resultado esperado: todas las líneas "OK ..." y ninguna
-- "FALLO ...". Verificación de 0 footprint (opcional, READ-ONLY):
--   select count(*) from public.receptions       where client_name like 'TEST_QA_%'; -- 0
--   select count(*) from public.inventory_items   where client_name like 'TEST_QA_%'; -- 0
-- =========================================================================
