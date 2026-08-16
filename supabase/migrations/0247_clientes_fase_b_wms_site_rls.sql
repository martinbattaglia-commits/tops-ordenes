-- CLIENTES FASE B · sede WMS autoritativa y RLS por recurso.

alter table public.receptions add column if not exists warehouse_id uuid references public.warehouses(id);
alter table public.logistics_orders add column if not exists warehouse_id uuid references public.warehouses(id);
create index if not exists receptions_warehouse_idx on public.receptions(warehouse_id);
create index if not exists logistics_orders_warehouse_idx on public.logistics_orders(warehouse_id);

-- Sólo se proyectan filas con una única sede demostrable; ambiguo/sin ubicación
-- queda NULL y por lo tanto invisible para un encargado.
with resolved as (
  select ri.reception_id, min(w.id::text)::uuid as warehouse_id
  from public.reception_items ri
  join public.warehouse_positions wp on wp.id = ri.position_id
  join public.warehouse_racks wr on wr.id = wp.rack_id
  join public.warehouse_zones wz on wz.id = wr.zone_id
  join public.warehouse_sectors ws on ws.id = wz.sector_id
  join public.warehouse_floors wf on wf.id = ws.floor_id
  join public.warehouses w on w.id = wf.warehouse_id
  group by ri.reception_id
  having count(distinct w.id) = 1
)
update public.receptions r set warehouse_id = resolved.warehouse_id
from resolved where r.id = resolved.reception_id and r.warehouse_id is null;

with resolved as (
  select loi.order_id, min(w.id::text)::uuid as warehouse_id
  from public.logistics_order_items loi
  join public.stock_allocations sa on sa.order_item_id = loi.id
  join public.inventory_items ii on ii.id = sa.inventory_item_id
  join public.warehouse_positions wp on wp.id = ii.position_id
  join public.warehouse_racks wr on wr.id = wp.rack_id
  join public.warehouse_zones wz on wz.id = wr.zone_id
  join public.warehouse_sectors ws on ws.id = wz.sector_id
  join public.warehouse_floors wf on wf.id = ws.floor_id
  join public.warehouses w on w.id = wf.warehouse_id
  group by loi.order_id
  having count(distinct w.id) = 1
)
update public.logistics_orders o set warehouse_id = resolved.warehouse_id
from resolved where o.id = resolved.order_id and o.warehouse_id is null;

create or replace function public.nexus_wms_position_warehouse(p_position_id uuid)
returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when public.nexus_is_depot_manager_principal()
      then case when public.nexus_depot_manager_valid() is not distinct from true
        and w.id = (select s.warehouse_id from public.nexus_depot_manager_scope() s)
        then w.id end
    else w.id
  end
  from public.warehouse_positions wp
  join public.warehouse_racks wr on wr.id = wp.rack_id
  join public.warehouse_zones wz on wz.id = wr.zone_id
  join public.warehouse_sectors ws on ws.id = wz.sector_id
  join public.warehouse_floors wf on wf.id = ws.floor_id
  join public.warehouses w on w.id = wf.warehouse_id
  where wp.id = p_position_id;
$$;

create or replace function public.nexus_wms_row_allowed(p_warehouse_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when public.nexus_is_depot_manager_principal() then coalesce(
      public.nexus_depot_manager_valid() is not distinct from true
      and p_warehouse_id is not null
      and p_warehouse_id = (select s.warehouse_id from public.nexus_depot_manager_scope() s),
      false
    )
    else true
  end;
$$;

create or replace function public.nexus_wms_edit_allowed(p_warehouse_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    public.nexus_is_depot_manager_principal()
    and public.has_permission('wms.edit') is not distinct from true
    and public.nexus_wms_row_allowed(p_warehouse_id) is not distinct from true,
    false
  );
$$;

revoke all on function public.nexus_wms_position_warehouse(uuid) from public, anon;
revoke all on function public.nexus_wms_row_allowed(uuid) from public, anon;
revoke all on function public.nexus_wms_edit_allowed(uuid) from public, anon;
grant execute on function public.nexus_wms_position_warehouse(uuid) to authenticated, service_role;
grant execute on function public.nexus_wms_row_allowed(uuid) to authenticated, service_role;
grant execute on function public.nexus_wms_edit_allowed(uuid) to authenticated, service_role;

-- Una cabecera no puede cambiar de sede después de adquirir hijos. Evita que
-- un UPDATE del payload vuelva visibles recepciones/despachos de otra nave.
create or replace function public.nexus_reception_header_site_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.warehouse_id is distinct from old.warehouse_id then
    if new.warehouse_id is null
       or (public.nexus_is_depot_manager_principal()
           and public.nexus_wms_edit_allowed(new.warehouse_id) is distinct from true)
       or exists (
         select 1 from public.reception_items ri
         where ri.reception_id=old.id
           and public.nexus_wms_position_warehouse(ri.position_id) is distinct from new.warehouse_id
       ) then
      raise exception 'sede WMS no autorizada' using errcode='insufficient_privilege';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_nexus_reception_header_site_guard on public.receptions;
create trigger trg_nexus_reception_header_site_guard
before update of warehouse_id on public.receptions
for each row execute function public.nexus_reception_header_site_guard();

create or replace function public.nexus_logistics_header_site_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.warehouse_id is distinct from old.warehouse_id then
    if new.warehouse_id is null
       or (public.nexus_is_depot_manager_principal()
           and public.nexus_wms_edit_allowed(new.warehouse_id) is distinct from true)
       or exists (
         select 1
         from public.logistics_order_items oi
         join public.stock_allocations sa on sa.order_item_id=oi.id
         join public.inventory_items ii on ii.id=sa.inventory_item_id
         where oi.order_id=old.id
           and public.nexus_wms_position_warehouse(ii.position_id) is distinct from new.warehouse_id
       ) then
      raise exception 'sede WMS no autorizada' using errcode='insufficient_privilege';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_nexus_logistics_header_site_guard on public.logistics_orders;
create trigger trg_nexus_logistics_header_site_guard
before update of warehouse_id on public.logistics_orders
for each row execute function public.nexus_logistics_header_site_guard();

-- Integridad de sede: payloads con posición ajena no pueden cambiar la cabecera.
create or replace function public.nexus_reception_site_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_header uuid; v_position uuid;
begin
  select r.warehouse_id into v_header from public.receptions r where r.id = new.reception_id;
  v_position := public.nexus_wms_position_warehouse(new.position_id);
  if v_header is null or v_position is null or v_header is distinct from v_position then
    raise exception 'sede WMS no autorizada' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_nexus_reception_site_guard on public.reception_items;
create trigger trg_nexus_reception_site_guard
before insert or update of reception_id, position_id on public.reception_items
for each row execute function public.nexus_reception_site_guard();

create or replace function public.nexus_allocation_site_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_order_wh uuid; v_item_wh uuid;
begin
  select o.warehouse_id into v_order_wh
  from public.logistics_orders o
  join public.logistics_order_items oi on oi.order_id = o.id
  where oi.id = new.order_item_id;
  select public.nexus_wms_position_warehouse(ii.position_id) into v_item_wh
  from public.inventory_items ii where ii.id = new.inventory_item_id;
  if v_order_wh is null or v_item_wh is null or v_order_wh is distinct from v_item_wh then
    raise exception 'sede WMS no autorizada' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_nexus_allocation_site_guard on public.stock_allocations;
create trigger trg_nexus_allocation_site_guard
before insert or update of order_item_id, inventory_item_id on public.stock_allocations
for each row execute function public.nexus_allocation_site_guard();

-- Jerarquía física.
drop policy if exists "warehouses read" on public.warehouses;
create policy "warehouses read" on public.warehouses for select using (
  auth.role() = 'authenticated' and public.nexus_wms_row_allowed(id)
);
drop policy if exists "warehouse_floors read" on public.warehouse_floors;
create policy "warehouse_floors read" on public.warehouse_floors for select using (
  auth.role() = 'authenticated' and public.nexus_wms_row_allowed(warehouse_id)
);
drop policy if exists "warehouse_sectors read" on public.warehouse_sectors;
create policy "warehouse_sectors read" on public.warehouse_sectors for select using (
  auth.role() = 'authenticated' and public.nexus_wms_row_allowed((select f.warehouse_id from public.warehouse_floors f where f.id = floor_id))
);
drop policy if exists "warehouse_zones read" on public.warehouse_zones;
create policy "warehouse_zones read" on public.warehouse_zones for select using (
  auth.role() = 'authenticated' and public.nexus_wms_row_allowed((select f.warehouse_id from public.warehouse_sectors s join public.warehouse_floors f on f.id=s.floor_id where s.id=sector_id))
);
drop policy if exists "warehouse_racks read" on public.warehouse_racks;
create policy "warehouse_racks read" on public.warehouse_racks for select using (
  auth.role() = 'authenticated' and public.nexus_wms_row_allowed((select f.warehouse_id from public.warehouse_zones z join public.warehouse_sectors s on s.id=z.sector_id join public.warehouse_floors f on f.id=s.floor_id where z.id=zone_id))
);
drop policy if exists "warehouse_positions read" on public.warehouse_positions;
create policy "warehouse_positions read" on public.warehouse_positions for select using (
  auth.role() = 'authenticated' and public.nexus_wms_row_allowed(public.nexus_wms_position_warehouse(id))
);

-- Las policies de escritura física preservan el legado para usuarios estándar
-- y agregan una rama exacta, acotada por sede, para encargados.
drop policy if exists "warehouses write" on public.warehouses;
create policy "warehouses write" on public.warehouses for all
using (public.current_role() in ('admin','operaciones','supervisor') or public.nexus_wms_edit_allowed(id))
with check (public.current_role() in ('admin','operaciones','supervisor') or public.nexus_wms_edit_allowed(id));
drop policy if exists "warehouse_floors write" on public.warehouse_floors;
create policy "warehouse_floors write" on public.warehouse_floors for all
using (public.current_role() in ('admin','operaciones','supervisor') or public.nexus_wms_edit_allowed(warehouse_id))
with check (public.current_role() in ('admin','operaciones','supervisor') or public.nexus_wms_edit_allowed(warehouse_id));
drop policy if exists "warehouse_sectors write" on public.warehouse_sectors;
create policy "warehouse_sectors write" on public.warehouse_sectors for all
using (public.current_role() in ('admin','operaciones','supervisor') or public.nexus_wms_edit_allowed((select f.warehouse_id from public.warehouse_floors f where f.id=floor_id)))
with check (public.current_role() in ('admin','operaciones','supervisor') or public.nexus_wms_edit_allowed((select f.warehouse_id from public.warehouse_floors f where f.id=floor_id)));
drop policy if exists "warehouse_zones write" on public.warehouse_zones;
create policy "warehouse_zones write" on public.warehouse_zones for all
using (public.current_role() in ('admin','operaciones','supervisor') or public.nexus_wms_edit_allowed((select f.warehouse_id from public.warehouse_sectors s join public.warehouse_floors f on f.id=s.floor_id where s.id=sector_id)))
with check (public.current_role() in ('admin','operaciones','supervisor') or public.nexus_wms_edit_allowed((select f.warehouse_id from public.warehouse_sectors s join public.warehouse_floors f on f.id=s.floor_id where s.id=sector_id)));
drop policy if exists "warehouse_racks write" on public.warehouse_racks;
create policy "warehouse_racks write" on public.warehouse_racks for all
using (public.current_role() in ('admin','operaciones','supervisor') or public.nexus_wms_edit_allowed((select f.warehouse_id from public.warehouse_zones z join public.warehouse_sectors s on s.id=z.sector_id join public.warehouse_floors f on f.id=s.floor_id where z.id=zone_id)))
with check (public.current_role() in ('admin','operaciones','supervisor') or public.nexus_wms_edit_allowed((select f.warehouse_id from public.warehouse_zones z join public.warehouse_sectors s on s.id=z.sector_id join public.warehouse_floors f on f.id=s.floor_id where z.id=zone_id)));
drop policy if exists "warehouse_positions write" on public.warehouse_positions;
create policy "warehouse_positions write" on public.warehouse_positions for all
using (public.current_role() in ('admin','operaciones','supervisor') or public.nexus_wms_edit_allowed(public.nexus_wms_position_warehouse(id)))
with check (public.current_role() in ('admin','operaciones','supervisor') or public.nexus_wms_edit_allowed(public.nexus_wms_position_warehouse(id)));

-- Inventario, recepciones y fulfillment: toda lectura pasa por la sede.
drop policy if exists "inventory_items read" on public.inventory_items;
create policy "inventory_items read" on public.inventory_items for select using (
  auth.role()='authenticated' and public.nexus_wms_row_allowed(public.nexus_wms_position_warehouse(position_id))
);
drop policy if exists "inventory_lots read" on public.inventory_lots;
create policy "inventory_lots read" on public.inventory_lots for select using (
  auth.role()='authenticated' and public.nexus_wms_row_allowed((select public.nexus_wms_position_warehouse(ii.position_id) from public.inventory_items ii where ii.id=inventory_item_id))
);
drop policy if exists "inventory_movements read" on public.inventory_movements;
create policy "inventory_movements read" on public.inventory_movements for select using (
  auth.role()='authenticated'
  and public.nexus_wms_row_allowed((select public.nexus_wms_position_warehouse(ii.position_id) from public.inventory_items ii where ii.id=inventory_item_id))
  and (from_position_id is null or public.nexus_wms_row_allowed(public.nexus_wms_position_warehouse(from_position_id)))
  and (to_position_id is null or public.nexus_wms_row_allowed(public.nexus_wms_position_warehouse(to_position_id)))
);
drop policy if exists "inventory_bu_anomalies read" on public.inventory_bu_anomalies;
create policy "inventory_bu_anomalies read" on public.inventory_bu_anomalies for select using (
  auth.role()='authenticated' and public.nexus_wms_row_allowed((select public.nexus_wms_position_warehouse(ii.position_id) from public.inventory_items ii where ii.id=inventory_item_id))
);

drop policy if exists "receptions read" on public.receptions;
create policy "receptions read" on public.receptions for select using (
  auth.role()='authenticated' and public.nexus_wms_row_allowed(warehouse_id)
);
drop policy if exists "receptions insert" on public.receptions;
create policy "receptions insert" on public.receptions for insert with check (
  public.current_role() in ('admin','operaciones','supervisor') or public.nexus_wms_edit_allowed(warehouse_id)
);
drop policy if exists "receptions update" on public.receptions;
create policy "receptions update" on public.receptions for update
using (public.current_role() in ('admin','operaciones','supervisor') or public.nexus_wms_edit_allowed(warehouse_id))
with check (public.current_role() in ('admin','operaciones','supervisor') or public.nexus_wms_edit_allowed(warehouse_id));
drop policy if exists "reception_items read" on public.reception_items;
create policy "reception_items read" on public.reception_items for select using (
  auth.role()='authenticated' and public.nexus_wms_row_allowed((select r.warehouse_id from public.receptions r where r.id=reception_id))
);
drop policy if exists "reception_items insert" on public.reception_items;
create policy "reception_items insert" on public.reception_items for insert with check (
  public.current_role() in ('admin','operaciones','supervisor') or public.nexus_wms_edit_allowed((select r.warehouse_id from public.receptions r where r.id=reception_id))
);
drop policy if exists "reception_items update" on public.reception_items;
create policy "reception_items update" on public.reception_items for update
using (public.current_role() in ('admin','operaciones','supervisor') or public.nexus_wms_edit_allowed((select r.warehouse_id from public.receptions r where r.id=reception_id)))
with check (public.current_role() in ('admin','operaciones','supervisor') or public.nexus_wms_edit_allowed((select r.warehouse_id from public.receptions r where r.id=reception_id)));

drop policy if exists "logistics_orders read" on public.logistics_orders;
create policy "logistics_orders read" on public.logistics_orders for select using (
  auth.role()='authenticated' and public.nexus_wms_row_allowed(warehouse_id)
);
drop policy if exists "logistics_order_items read" on public.logistics_order_items;
create policy "logistics_order_items read" on public.logistics_order_items for select using (
  auth.role()='authenticated' and public.nexus_wms_row_allowed((select o.warehouse_id from public.logistics_orders o where o.id=order_id))
);
drop policy if exists "stock_allocations read" on public.stock_allocations;
create policy "stock_allocations read" on public.stock_allocations for select using (
  auth.role()='authenticated' and public.nexus_wms_row_allowed((select o.warehouse_id from public.logistics_order_items oi join public.logistics_orders o on o.id=oi.order_id where oi.id=order_item_id))
);
drop policy if exists "packing_units read" on public.packing_units;
create policy "packing_units read" on public.packing_units for select using (
  auth.role()='authenticated' and public.nexus_wms_row_allowed((select o.warehouse_id from public.logistics_orders o where o.id=order_id))
);
drop policy if exists "packing_unit_items read" on public.packing_unit_items;
create policy "packing_unit_items read" on public.packing_unit_items for select using (
  auth.role()='authenticated' and public.nexus_wms_row_allowed((select o.warehouse_id from public.packing_units pu join public.logistics_orders o on o.id=pu.order_id where pu.id=packing_unit_id))
);
drop policy if exists "shipments read" on public.shipments;
create policy "shipments read" on public.shipments for select using (
  auth.role()='authenticated' and public.nexus_wms_row_allowed((select o.warehouse_id from public.logistics_orders o where o.id=order_id))
);

notify pgrst, 'reload schema';
