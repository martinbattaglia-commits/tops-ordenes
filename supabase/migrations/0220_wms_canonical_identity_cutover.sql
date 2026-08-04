-- =========================================================================
-- 0220_wms_canonical_identity_cutover.sql — P3-N1B · Etapa 3.1 (corte).
--
-- CORTE a identidad canónica: unicidad por (client_id, sku, position_id),
-- confirm_reception y allocate_order dejan de decidir por igualdad de
-- client_name (N-11 / ADR-P3-14 · WMS-ALLOC-001).
--
-- 🔴 MIGRACIÓN CON GATES FAIL-CLOSED. Se ABORTA ENTERA (una transacción) si
--    el perfilado in-situ no demuestra cobertura del 100 %:
--      G-1 inventory_items sin client_id        = 0
--      G-2 receptions sin client_id             = 0
--      G-3 logistics_orders sin client_id       = 0
--      G-4 identidades canónicas duplicadas     = 0
--      G-5 índice canónico exacto o barrera legacy presente para crearlo
--    La RESOLUCIÓN de identidad (asignar client_id) es un proceso
--    administrativo previo, con validación humana; esta migración NO infiere
--    NADA desde client_name y NO corrige datos: sólo verifica y corta.
--
-- ⚠️ PRECONDICIONES DE SECUENCIA (ADR-P3-14 regla 2 y 5 — sin estados mixtos):
--    1. 0219 aplicada.
--    2. Resolución administrativa de client_id COMPLETA (100 %).
--    3. La interfaz interna ya escribe client_id en recepciones y pedidos
--       nuevos (selector contra public.clients + escape «cliente no listado»,
--       ADR-P3-13) — expediente de aplicación APARTE; NO existe aún.
--    Mientras 2 y 3 no estén, esta migración NO DEBE aplicarse: sus gates la
--    rechazarán (2) o el corte bloquearía la operación nueva (3).
--
-- Tras el corte:
--   · inventory_items.client_id pasa a NOT NULL (habilitado por G-1: la
--     obligatoriedad recién tras demostrar cero filas sin resolver,
--     ADR-P3-13); receptions/logistics_orders CONSERVAN la nulabilidad (las
--     escribe la aplicación; el enforcement vive en el embudo RPC).
--   · unicidad canónica (client_id, sku, position_id) NULLS NOT DISTINCT:
--     cierra el defecto M-1 documentado por T-A0-02 (duplicados con posición
--     NULL). Se retira la unicidad legacy por client_name: dos clientes
--     distintos PUEDEN compartir nombre; un renombre ya no corrompe identidad.
--   · client_name QUEDA como dato descriptivo (ADR-P3-13). FEFO INTACTO.
--   · Pedido con business_unit declarada: sólo asigna stock de ESA línea; el
--     stock sin clasificar (NULL) NO es elegible para un pedido restringido
--     (asignarlo afirmaría una clasificación que nadie hizo). Pedido sin
--     restricción (NULL): elegibilidad legacy, sin inventar dato.
--
-- Idempotente. Aplica Martín A MANO (G3), EN UNA SOLA TRANSACCIÓN.
-- ⚠️ Requiere 0219. NO requiere PostGIS.
-- =========================================================================

-- ---- GATES fail-closed (una excepción aborta TODO el archivo) ------------
do $$
declare
  v_n bigint;
begin
  select count(*) into v_n from public.inventory_items where client_id is null;
  if v_n > 0 then
    raise exception '[P3-N1B GATE G-1] % fila(s) de inventory_items sin client_id: cobertura incompleta. La migración NO se aplica. Resolver la identidad por proceso administrativo validado y reintentar. PROHIBIDO inferir desde client_name.', v_n;
  end if;

  select count(*) into v_n from public.receptions where client_id is null;
  if v_n > 0 then
    raise exception '[P3-N1B GATE G-2] % recepción(es) sin client_id: cobertura incompleta. La migración NO se aplica.', v_n;
  end if;

  select count(*) into v_n from public.logistics_orders where client_id is null;
  if v_n > 0 then
    raise exception '[P3-N1B GATE G-3] % pedido(s) sin client_id: cobertura incompleta. La migración NO se aplica.', v_n;
  end if;

  -- GROUP BY iguala NULLs ⇒ coherente con NULLS NOT DISTINCT del índice.
  select count(*) into v_n from (
    select 1 from public.inventory_items
    group by client_id, sku, position_id
    having count(*) > 1
  ) d;
  if v_n > 0 then
    raise exception '[P3-N1B GATE G-4] % identidad(es) canónica(s) duplicada(s) (client_id, sku, position_id; posición NULL cuenta como igual). Consolidar administrativamente antes del corte: esta migración NO fusiona filas.', v_n;
  end if;
end $$;

-- ---- Corte de unicidad e integridad --------------------------------------
-- G-5 NO confía en IF NOT EXISTS por nombre. Si el objeto canónico ya existe,
-- valida su definición completa en catálogo. Si no existe, exige todavía la
-- barrera legacy antes de crearlo y vuelve a validar el resultado. Así, un
-- índice impostor o un orden peligroso abortan antes de retirar la barrera.
do $$
declare
  v_index_oid oid;
  v_relkind "char";
  v_exact boolean := false;
  v_definition text;
begin
  select c.oid, c.relkind
    into v_index_oid, v_relkind
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'inventory_items_canonical_identity_uk';

  if v_index_oid is not null then
    select
      c.relkind = 'i'
      and tn.nspname = 'public'
      and t.relname = 'inventory_items'
      and am.amname = 'btree'
      and i.indisunique
      and i.indisvalid
      and i.indisready
      and i.indislive
      and i.indimmediate
      and i.indnullsnotdistinct
      and not i.indisprimary
      and not i.indisexclusion
      and i.indpred is null
      and i.indexprs is null
      and i.indnkeyatts = 3
      and i.indnatts = 3
      and coalesce((
        select array_agg(a.attname::text order by k.ord)
          from unnest(i.indkey::smallint[]) with ordinality as k(attnum, ord)
          left join pg_catalog.pg_attribute a
            on a.attrelid = i.indrelid and a.attnum = k.attnum
          where k.ord <= i.indnkeyatts
      ), array[]::text[]) = array['client_id', 'sku', 'position_id']::text[],
      case when c.relkind = 'i' then pg_catalog.pg_get_indexdef(c.oid)
           else format('objeto relkind=%s', c.relkind) end
      into v_exact, v_definition
      from pg_catalog.pg_class c
      left join pg_catalog.pg_index i on i.indexrelid = c.oid
      left join pg_catalog.pg_class t on t.oid = i.indrelid
      left join pg_catalog.pg_namespace tn on tn.oid = t.relnamespace
      left join pg_catalog.pg_am am on am.oid = c.relam
      where c.oid = v_index_oid;

    if not coalesce(v_exact, false) then
      raise exception '[P3-N1B GATE G-5] existe public.inventory_items_canonical_identity_uk pero no es el índice canónico exacto, único, válido, ready, btree, NULLS NOT DISTINCT, sin predicado/expresiones/INCLUDE y con claves ordenadas (client_id, sku, position_id). Definición observada: %',
        coalesce(v_definition, format('objeto relkind=%s', v_relkind));
    end if;
  else
    if to_regclass('public.inventory_items_identity_uk') is null then
      raise exception '[P3-N1B GATE G-5] faltan simultáneamente el índice canónico y la barrera legacy public.inventory_items_identity_uk. Se aborta antes de modificar la unicidad.';
    end if;

    create unique index inventory_items_canonical_identity_uk
      on public.inventory_items (client_id, sku, position_id) nulls not distinct;
  end if;

  -- Poscondición independiente: también detecta una creación mutada.
  select exists (
    select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_index i on i.indexrelid = c.oid
      join pg_catalog.pg_class t on t.oid = i.indrelid
      join pg_catalog.pg_namespace tn on tn.oid = t.relnamespace
      join pg_catalog.pg_am am on am.oid = c.relam
      where n.nspname = 'public'
        and c.relname = 'inventory_items_canonical_identity_uk'
        and c.relkind = 'i'
        and tn.nspname = 'public'
        and t.relname = 'inventory_items'
        and am.amname = 'btree'
        and i.indisunique
        and i.indisvalid
        and i.indisready
        and i.indislive
        and i.indimmediate
        and i.indnullsnotdistinct
        and not i.indisprimary
        and not i.indisexclusion
        and i.indpred is null
        and i.indexprs is null
        and i.indnkeyatts = 3
        and i.indnatts = 3
        and coalesce((
          select array_agg(a.attname::text order by k.ord)
            from unnest(i.indkey::smallint[]) with ordinality as k(attnum, ord)
            left join pg_catalog.pg_attribute a
              on a.attrelid = i.indrelid and a.attnum = k.attnum
            where k.ord <= i.indnkeyatts
        ), array[]::text[]) = array['client_id', 'sku', 'position_id']::text[]
  ) into v_exact;

  if not v_exact then
    raise exception '[P3-N1B GATE G-5] la unicidad canónica exacta no quedó garantizada; la barrera legacy se conserva y la migración se aborta.';
  end if;
end $$;

-- Obligatoriedad habilitada por G-1 (cero filas sin resolver), después de
-- comprobar la unicidad canónica exacta.
alter table public.inventory_items alter column client_id set not null;

-- La unicidad por nombre ERA la identidad legacy; mantenerla impediría que
-- dos clientes distintos compartan nombre y reintroduciría el nombre como
-- identidad. Se retira SÓLO DESPUÉS de validar por catálogo la canónica.
drop index if exists public.inventory_items_identity_uk;

-- =========================================================================
-- confirm_reception v2 — find-or-create por IDENTIDAD CANÓNICA.
-- Cambios respecto de 0027 (el resto es idéntico, cuarentena/lotes/ledger):
--   · fail-closed: recepción sin client_id NO se confirma;
--   · el match del ítem es (client_id, sku, position_id), no client_name;
--   · el ítem nuevo hereda client_id + client_name (descriptivo) de la
--     cabecera. El business_unit del ítem lo proyecta el trigger de 0219 al
--     escribirse reception_items.inventory_item_id — acá no se toca.
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

  -- P3-N1B fail-closed: sin identidad canónica NO se materializa inventario.
  if v_rec.client_id is null then
    raise exception 'recepción % sin identidad canónica de cliente (client_id): resolver antes de confirmar', v_rec.public_id;
  end if;

  v_quar := v_rec.requires_quarantine;   -- cuarentena = decisión operativa explícita

  for v_item in
    select * from public.reception_items
    where reception_id = p_reception_id and status = 'pendiente'
    order by created_at
  loop
    -- find-or-create inventory_item por IDENTIDAD CANÓNICA (cliente, sku, posición)
    select id into v_inv_id from public.inventory_items
      where client_id = v_rec.client_id and sku = v_item.sku
        and position_id is not distinct from v_item.position_id
      for update;
    if v_inv_id is null then
      insert into public.inventory_items
        (sku, description, client_name, client_id, position_id, stock_available, stock_reserved, active, created_by)
        values (v_item.sku, v_item.description, v_rec.client_name, v_rec.client_id, v_item.position_id, 0, 0, true, auth.uid())
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
-- allocate_order v2 — reserva FEFO por IDENTIDAD CANÓNICA + business_unit.
-- Cambios respecto de 0031 (el resto es idéntico: FEFO, parcial, idempotente,
-- estados, casts del hotfix 42804):
--   · fail-closed: pedido sin client_id NO reserva;
--   · candidatos por ii.client_id = v_order.client_id (NUNCA client_name);
--   · pedido con business_unit declarada → sólo stock de esa línea; el stock
--     sin clasificar (NULL) NO es elegible para un pedido restringido;
--   · la reserva registra la business_unit del ítem al momento de reservar.
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

  -- P3-N1B fail-closed: sin identidad canónica NO se reserva stock.
  if v_order.client_id is null then
    raise exception 'pedido % sin identidad canónica de cliente (client_id): resolver antes de reservar', v_order.public_id;
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

    -- Candidatos del (CLIENTE CANÓNICO, sku) ordenados FEFO y LOCKEADOS
    -- (orden consistente → sin deadlock y sin overselling concurrente).
    -- BU: `ii.business_unit = v_order.business_unit` es deliberadamente
    -- estricto — un ítem con BU NULL (sin clasificar) NO satisface la
    -- igualdad y queda EXCLUIDO de un pedido restringido: asignarlo sería
    -- afirmar una clasificación que nadie hizo (ADR-P3-06/11).
    for v_cand in
      select ii.id as inv_id,
             ii.stock_available as avail,
             ii.business_unit as bu,
             (select min(il.expiration_date) from public.inventory_lots il
                where il.inventory_item_id = ii.id and il.active) as fefo_date
      from public.inventory_items ii
      where ii.client_id = v_order.client_id
        and ii.sku = v_line.sku
        and ii.active
        and ii.stock_available > 0
        and (v_order.business_unit is null or ii.business_unit = v_order.business_unit)
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
        (order_item_id, inventory_item_id, lot_number, quantity, status, business_unit, reserved_at, created_by)
      values
        (v_line.id, v_cand.inv_id, v_fefo_lot, v_q, 'reservada'::alloc_status_t, v_cand.bu, now(), auth.uid());

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

-- CREATE OR REPLACE conserva los grants vigentes de 0027/0031 (authenticated).

notify pgrst, 'reload schema';
