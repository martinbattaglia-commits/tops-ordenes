-- =========================================================================
-- FASE 9B · GATE 1 — Script de validación (SQL Editor de Supabase)
-- Verifica el ESQUEMA de 0029 + 0030. Solo lectura + un insert de prueba que
-- se REVIERTE (sentinel '__qa_rollback__'). No deja datos permanentes.
-- Correr DESPUÉS de aplicar 0029 (commiteada) y 0030.
-- =========================================================================

-- ---- A) Catálogo (READ-ONLY) --------------------------------------------

-- A1. El enum 'pedidos' debe existir en permission_module_t
select 'A1 enum pedidos' as check,
       'pedidos' = any (enum_range(null::public.permission_module_t)::text[]) as ok;

-- A2. Las 3 tablas deben existir
select 'A2 tablas' as check, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('logistics_orders','logistics_order_items','stock_allocations')
order by table_name;   -- esperado: 3 filas

-- A3. RLS habilitada en las 3 tablas
select 'A3 rls' as check, relname, relrowsecurity
from pg_class
where relname in ('logistics_orders','logistics_order_items','stock_allocations')
order by relname;       -- relrowsecurity = true en las 3

-- A4. Permisos RBAC del módulo 'pedidos' sembrados (esperado: 3)
select 'A4 permissions' as check, slug, action, label
from public.permissions where module = 'pedidos' order by slug;

-- A5. role_permissions de 'pedidos' por rol
select 'A5 role_permissions' as check, r.slug as role, count(*) as permisos
from public.role_permissions rp
join public.roles r on r.id = rp.role_id
join public.permissions p on p.id = rp.permission_id
where p.module = 'pedidos'
group by r.slug order by r.slug;
-- esperado: director_ops 3 · admin 2 · operaciones 2 · compliance 1
-- (supervisor aparece con 2 SOLO si el rol existe en public.roles; hoy no está
--  sembrado → no figura. El acceso de supervisor está cubierto por las RLS.)

-- A6. Columnas de trazabilidad nuevas en stock_allocations
select 'A6 trazabilidad' as check, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'stock_allocations'
  and column_name in ('reserved_at','released_at')
order by column_name;
-- esperado: reserved_at (not null, default now()) · released_at (nullable, sin default)

-- ---- B) Insert de prueba (transaccional, se REVIERTE) --------------------
do $$
declare
  v_oid  uuid;
  v_pub  text;
  v_inv  uuid;
  v_item uuid;
  v_alloc int;
begin
  begin  -- subtransacción reversible
    -- B1. Cabecera → trigger de public_id
    insert into public.logistics_orders (client_name, status)
      values ('TEST_QA_PED', 'pendiente')
      returning id, public_id into v_oid, v_pub;
    if v_pub ~ '^PED-\d{4}-\d{4}$' then
      raise notice 'OK B1: pedido creado, public_id=% (formato correcto)', v_pub;
    else
      raise notice 'FALLO B1: public_id con formato inesperado: %', v_pub;
    end if;

    -- B2. Dos líneas
    insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
      values (v_oid, 'SKU-QA-1', 'Item línea 1', 100),
             (v_oid, 'SKU-QA-2', 'Item línea 2', 50);
    raise notice 'OK B2: % líneas insertadas', (select count(*) from public.logistics_order_items where order_id = v_oid);

    -- B3. Reserva contra un inventory_item real (FK) — si hay inventario
    select id into v_inv from public.inventory_items limit 1;
    select id into v_item from public.logistics_order_items where order_id = v_oid order by created_at limit 1;
    if v_inv is null then
      raise notice 'SKIP B3: no hay inventory_items en DEV para probar la FK de stock_allocations';
    else
      insert into public.stock_allocations (order_item_id, inventory_item_id, lot_number, quantity)
        values (v_item, v_inv, 'L-QA', 10);
      select count(*) into v_alloc from public.stock_allocations where order_item_id = v_item;
      raise notice 'OK B3: stock_allocations creada (FK inventory_item OK), % fila(s)', v_alloc;
    end if;

    -- B4. CHECK quantity_requested > 0 debe bloquear
    begin
      insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
        values (v_oid, 'SKU-BAD', 'cantidad 0', 0);
      raise notice 'FALLO B4: el CHECK quantity_requested>0 NO bloqueó';
    exception when check_violation then
      raise notice 'OK B4: CHECK quantity_requested>0 bloqueó (sqlstate %)', sqlstate;
    end;

    -- B5. CHECK quantity > 0 en stock_allocations (si hay inventario)
    if v_inv is not null then
      begin
        insert into public.stock_allocations (order_item_id, inventory_item_id, quantity)
          values (v_item, v_inv, 0);
        raise notice 'FALLO B5: el CHECK quantity>0 (allocation) NO bloqueó';
      exception when check_violation then
        raise notice 'OK B5: CHECK quantity>0 (allocation) bloqueó (sqlstate %)', sqlstate;
      end;
    end if;

    raise exception '__qa_rollback__';
  exception when others then
    if sqlerrm = '__qa_rollback__' then
      raise notice 'Gate 1: datos de prueba revertidos (0 footprint).';
    else
      raise;  -- error inesperado → propagar
    end if;
  end;
end $$;

-- ---- C) Verificación de 0 footprint (READ-ONLY) -------------------------
select 'C footprint' as check,
       (select count(*) from public.logistics_orders where client_name like 'TEST_QA_%') as pedidos_test; -- esperado: 0
