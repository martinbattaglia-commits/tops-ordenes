-- Inversa de 0247: restaura policies y esquema WMS previos.

drop trigger if exists trg_nexus_reception_header_site_guard on public.receptions;
drop trigger if exists trg_nexus_logistics_header_site_guard on public.logistics_orders;
drop trigger if exists trg_nexus_reception_site_guard on public.reception_items;
drop trigger if exists trg_nexus_allocation_site_guard on public.stock_allocations;
drop function if exists public.nexus_reception_header_site_guard();
drop function if exists public.nexus_logistics_header_site_guard();
drop function if exists public.nexus_reception_site_guard();
drop function if exists public.nexus_allocation_site_guard();

drop policy if exists "warehouses read" on public.warehouses;
create policy "warehouses read" on public.warehouses for select using (auth.role()='authenticated');
drop policy if exists "warehouse_floors read" on public.warehouse_floors;
create policy "warehouse_floors read" on public.warehouse_floors for select using (auth.role()='authenticated');
drop policy if exists "warehouse_sectors read" on public.warehouse_sectors;
create policy "warehouse_sectors read" on public.warehouse_sectors for select using (auth.role()='authenticated');
drop policy if exists "warehouse_zones read" on public.warehouse_zones;
create policy "warehouse_zones read" on public.warehouse_zones for select using (auth.role()='authenticated');
drop policy if exists "warehouse_racks read" on public.warehouse_racks;
create policy "warehouse_racks read" on public.warehouse_racks for select using (auth.role()='authenticated');
drop policy if exists "warehouse_positions read" on public.warehouse_positions;
create policy "warehouse_positions read" on public.warehouse_positions for select using (auth.role()='authenticated');

drop policy if exists "warehouses write" on public.warehouses;
create policy "warehouses write" on public.warehouses for all
using (public.current_role() in ('admin','operaciones','supervisor'))
with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "warehouse_floors write" on public.warehouse_floors;
create policy "warehouse_floors write" on public.warehouse_floors for all
using (public.current_role() in ('admin','operaciones','supervisor'))
with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "warehouse_sectors write" on public.warehouse_sectors;
create policy "warehouse_sectors write" on public.warehouse_sectors for all
using (public.current_role() in ('admin','operaciones','supervisor'))
with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "warehouse_zones write" on public.warehouse_zones;
create policy "warehouse_zones write" on public.warehouse_zones for all
using (public.current_role() in ('admin','operaciones','supervisor'))
with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "warehouse_racks write" on public.warehouse_racks;
create policy "warehouse_racks write" on public.warehouse_racks for all
using (public.current_role() in ('admin','operaciones','supervisor'))
with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "warehouse_positions write" on public.warehouse_positions;
create policy "warehouse_positions write" on public.warehouse_positions for all
using (public.current_role() in ('admin','operaciones','supervisor'))
with check (public.current_role() in ('admin','operaciones','supervisor'));

drop policy if exists "inventory_items read" on public.inventory_items;
create policy "inventory_items read" on public.inventory_items for select using (auth.role()='authenticated');
drop policy if exists "inventory_lots read" on public.inventory_lots;
create policy "inventory_lots read" on public.inventory_lots for select using (auth.role()='authenticated');
drop policy if exists "inventory_movements read" on public.inventory_movements;
create policy "inventory_movements read" on public.inventory_movements for select using (auth.role()='authenticated');
drop policy if exists "inventory_bu_anomalies read" on public.inventory_bu_anomalies;
create policy "inventory_bu_anomalies read" on public.inventory_bu_anomalies for select using (auth.role()='authenticated');

drop policy if exists "receptions read" on public.receptions;
create policy "receptions read" on public.receptions for select using (auth.role()='authenticated');
drop policy if exists "receptions insert" on public.receptions;
create policy "receptions insert" on public.receptions for insert
with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "receptions update" on public.receptions;
create policy "receptions update" on public.receptions for update
using (public.current_role() in ('admin','operaciones','supervisor'))
with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "reception_items read" on public.reception_items;
create policy "reception_items read" on public.reception_items for select using (auth.role()='authenticated');
drop policy if exists "reception_items insert" on public.reception_items;
create policy "reception_items insert" on public.reception_items for insert
with check (public.current_role() in ('admin','operaciones','supervisor'));
drop policy if exists "reception_items update" on public.reception_items;
create policy "reception_items update" on public.reception_items for update
using (public.current_role() in ('admin','operaciones','supervisor'))
with check (public.current_role() in ('admin','operaciones','supervisor'));

drop policy if exists "logistics_orders read" on public.logistics_orders;
create policy "logistics_orders read" on public.logistics_orders for select using (auth.role()='authenticated');
drop policy if exists "logistics_order_items read" on public.logistics_order_items;
create policy "logistics_order_items read" on public.logistics_order_items for select using (auth.role()='authenticated');
drop policy if exists "stock_allocations read" on public.stock_allocations;
create policy "stock_allocations read" on public.stock_allocations for select using (auth.role()='authenticated');
drop policy if exists "packing_units read" on public.packing_units;
create policy "packing_units read" on public.packing_units for select using (auth.role()='authenticated');
drop policy if exists "packing_unit_items read" on public.packing_unit_items;
create policy "packing_unit_items read" on public.packing_unit_items for select using (auth.role()='authenticated');
drop policy if exists "shipments read" on public.shipments;
create policy "shipments read" on public.shipments for select using (auth.role()='authenticated');

drop function if exists public.nexus_wms_edit_allowed(uuid);
drop function if exists public.nexus_wms_row_allowed(uuid);
drop function if exists public.nexus_wms_position_warehouse(uuid);
drop index if exists public.receptions_warehouse_idx;
drop index if exists public.logistics_orders_warehouse_idx;
alter table public.receptions drop column if exists warehouse_id;
alter table public.logistics_orders drop column if exists warehouse_id;

notify pgrst, 'reload schema';
