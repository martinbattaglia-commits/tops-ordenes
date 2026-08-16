-- CLIENTES FASE B · wrappers de RPC WMS con sede verificada.
-- Los cuerpos históricos quedan privados; sólo los wrappers recuperan
-- temporalmente current_role()='operaciones' después de validar el recurso.

create or replace function public.nexus_wms_reception_allowed(p_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select coalesce((select public.nexus_wms_row_allowed(r.warehouse_id) from public.receptions r where r.id=p_id), false) $$;
create or replace function public.nexus_wms_order_allowed(p_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select coalesce((select public.nexus_wms_row_allowed(o.warehouse_id) from public.logistics_orders o where o.id=p_id), false) $$;
create or replace function public.nexus_wms_allocation_allowed(p_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$
  select coalesce((select public.nexus_wms_row_allowed(o.warehouse_id)
    from public.stock_allocations a join public.logistics_order_items oi on oi.id=a.order_item_id
    join public.logistics_orders o on o.id=oi.order_id where a.id=p_id), false)
$$;
create or replace function public.nexus_wms_packing_unit_allowed(p_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select coalesce((select public.nexus_wms_row_allowed(o.warehouse_id) from public.packing_units pu join public.logistics_orders o on o.id=pu.order_id where pu.id=p_id), false) $$;
create or replace function public.nexus_wms_shipment_allowed(p_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select coalesce((select public.nexus_wms_row_allowed(o.warehouse_id) from public.shipments s join public.logistics_orders o on o.id=s.order_id where s.id=p_id), false) $$;
create or replace function public.nexus_wms_inventory_item_allowed(p_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select coalesce((select public.nexus_wms_row_allowed(public.nexus_wms_position_warehouse(ii.position_id)) from public.inventory_items ii where ii.id=p_id), false) $$;

-- H-1 · la tabla de concesión y nexus_wms_scope_active() se crean en 0246,
-- porque current_role() los consume y PostgreSQL valida el cuerpo de una
-- funcion SQL al crearla.
create or replace function public.nexus_wms_begin_scope(p_allowed boolean)
returns void language plpgsql security definer set search_path=public,pg_temp
as $$
begin
  if public.nexus_is_depot_manager_principal() then
    if p_allowed is distinct from true
       or public.has_permission('wms.edit') is distinct from true
       or public.nexus_depot_manager_valid() is distinct from true then
      raise exception 'no autorizado' using errcode='insufficient_privilege';
    end if;
    insert into public.nexus_wms_scope_grants (xid8_txn, granted_to)
    values (pg_current_xact_id()::text, auth.uid())
    on conflict (xid8_txn) do update set granted_to = excluded.granted_to;
  end if;
end;
$$;
create or replace function public.nexus_wms_end_scope()
returns void language plpgsql security definer set search_path=public,pg_temp
as $$
begin
  if public.nexus_is_depot_manager_principal() then
    delete from public.nexus_wms_scope_grants
     where xid8_txn = pg_current_xact_id_if_assigned()::text;
  end if;
end;
$$;

revoke all on function public.nexus_wms_reception_allowed(uuid) from public,anon,authenticated;
revoke all on function public.nexus_wms_order_allowed(uuid) from public,anon,authenticated;
revoke all on function public.nexus_wms_allocation_allowed(uuid) from public,anon,authenticated;
revoke all on function public.nexus_wms_packing_unit_allowed(uuid) from public,anon,authenticated;
revoke all on function public.nexus_wms_shipment_allowed(uuid) from public,anon,authenticated;
revoke all on function public.nexus_wms_inventory_item_allowed(uuid) from public,anon,authenticated;
revoke all on function public.nexus_wms_begin_scope(boolean) from public,anon,authenticated;
revoke all on function public.nexus_wms_end_scope() from public,anon,authenticated;

alter function public.confirm_reception(uuid) rename to confirm_reception_unscoped_0248;
alter function public.release_quarantine(uuid) rename to release_quarantine_unscoped_0248;
alter function public.confirm_movement(uuid,public.movement_type_t,uuid,numeric,text,text,public.movement_reference_t,uuid) rename to confirm_movement_unscoped_0248;
alter function public.confirm_picking(uuid) rename to confirm_picking_unscoped_0248;
alter function public.confirm_picking_order(uuid) rename to confirm_picking_order_unscoped_0248;
alter function public.unpick_allocation(uuid) rename to unpick_allocation_unscoped_0248;
alter function public.create_packing_unit(uuid,text,text) rename to create_packing_unit_unscoped_0248;
alter function public.pack_allocation(uuid,uuid) rename to pack_allocation_unscoped_0248;
alter function public.unpack_allocation(uuid) rename to unpack_allocation_unscoped_0248;
alter function public.close_packing_unit(uuid) rename to close_packing_unit_unscoped_0248;
alter function public.reopen_packing_unit(uuid) rename to reopen_packing_unit_unscoped_0248;
alter function public.confirm_packing_order(uuid) rename to confirm_packing_order_unscoped_0248;
alter function public.confirm_dispatch(uuid) rename to confirm_dispatch_unscoped_0248;
alter function public.confirm_delivery(uuid,text) rename to confirm_delivery_unscoped_0248;
alter function public.revert_dispatch(uuid) rename to revert_dispatch_unscoped_0248;

revoke all on function public.confirm_reception_unscoped_0248(uuid) from public,anon,authenticated;
revoke all on function public.release_quarantine_unscoped_0248(uuid) from public,anon,authenticated;
revoke all on function public.confirm_movement_unscoped_0248(uuid,public.movement_type_t,uuid,numeric,text,text,public.movement_reference_t,uuid) from public,anon,authenticated;
revoke all on function public.confirm_picking_unscoped_0248(uuid) from public,anon,authenticated;
revoke all on function public.confirm_picking_order_unscoped_0248(uuid) from public,anon,authenticated;
revoke all on function public.unpick_allocation_unscoped_0248(uuid) from public,anon,authenticated;
revoke all on function public.create_packing_unit_unscoped_0248(uuid,text,text) from public,anon,authenticated;
revoke all on function public.pack_allocation_unscoped_0248(uuid,uuid) from public,anon,authenticated;
revoke all on function public.unpack_allocation_unscoped_0248(uuid) from public,anon,authenticated;
revoke all on function public.close_packing_unit_unscoped_0248(uuid) from public,anon,authenticated;
revoke all on function public.reopen_packing_unit_unscoped_0248(uuid) from public,anon,authenticated;
revoke all on function public.confirm_packing_order_unscoped_0248(uuid) from public,anon,authenticated;
revoke all on function public.confirm_dispatch_unscoped_0248(uuid) from public,anon,authenticated;
revoke all on function public.confirm_delivery_unscoped_0248(uuid,text) from public,anon,authenticated;
revoke all on function public.revert_dispatch_unscoped_0248(uuid) from public,anon,authenticated;

create function public.confirm_reception(p_reception_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public.nexus_wms_begin_scope(public.nexus_wms_reception_allowed(p_reception_id)); perform public.confirm_reception_unscoped_0248(p_reception_id); perform public.nexus_wms_end_scope(); end $$;
create function public.release_quarantine(p_reception_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public.nexus_wms_begin_scope(public.nexus_wms_reception_allowed(p_reception_id)); perform public.release_quarantine_unscoped_0248(p_reception_id); perform public.nexus_wms_end_scope(); end $$;
create function public.confirm_movement(
  p_inventory_item_id uuid, p_movement_type public.movement_type_t,
  p_to_position_id uuid default null, p_quantity numeric default null,
  p_reason text default null, p_notes text default null,
  p_reference_type public.movement_reference_t default null, p_reference_id uuid default null
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.nexus_wms_begin_scope(
    public.nexus_wms_inventory_item_allowed(p_inventory_item_id)
    and (p_to_position_id is null or public.nexus_wms_row_allowed(public.nexus_wms_position_warehouse(p_to_position_id)))
  );
  perform public.confirm_movement_unscoped_0248(p_inventory_item_id,p_movement_type,p_to_position_id,p_quantity,p_reason,p_notes,p_reference_type,p_reference_id);
  perform public.nexus_wms_end_scope();
end $$;
create function public.confirm_picking(p_allocation_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_wms_begin_scope(public.nexus_wms_allocation_allowed(p_allocation_id)); perform public.confirm_picking_unscoped_0248(p_allocation_id); perform public.nexus_wms_end_scope(); end $$;
create function public.confirm_picking_order(p_order_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_wms_begin_scope(public.nexus_wms_order_allowed(p_order_id)); perform public.confirm_picking_order_unscoped_0248(p_order_id); perform public.nexus_wms_end_scope(); end $$;
create function public.unpick_allocation(p_allocation_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_wms_begin_scope(public.nexus_wms_allocation_allowed(p_allocation_id)); perform public.unpick_allocation_unscoped_0248(p_allocation_id); perform public.nexus_wms_end_scope(); end $$;
create function public.create_packing_unit(p_order_id uuid,p_label text default null,p_unit_type text default null) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$ declare v_id uuid; begin perform public.nexus_wms_begin_scope(public.nexus_wms_order_allowed(p_order_id)); v_id:=public.create_packing_unit_unscoped_0248(p_order_id,p_label,p_unit_type); perform public.nexus_wms_end_scope(); return v_id; end $$;
create function public.pack_allocation(p_packing_unit_id uuid,p_allocation_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_wms_begin_scope(public.nexus_wms_packing_unit_allowed(p_packing_unit_id) and public.nexus_wms_allocation_allowed(p_allocation_id)); perform public.pack_allocation_unscoped_0248(p_packing_unit_id,p_allocation_id); perform public.nexus_wms_end_scope(); end $$;
create function public.unpack_allocation(p_allocation_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_wms_begin_scope(public.nexus_wms_allocation_allowed(p_allocation_id)); perform public.unpack_allocation_unscoped_0248(p_allocation_id); perform public.nexus_wms_end_scope(); end $$;
create function public.close_packing_unit(p_packing_unit_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_wms_begin_scope(public.nexus_wms_packing_unit_allowed(p_packing_unit_id)); perform public.close_packing_unit_unscoped_0248(p_packing_unit_id); perform public.nexus_wms_end_scope(); end $$;
create function public.reopen_packing_unit(p_packing_unit_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_wms_begin_scope(public.nexus_wms_packing_unit_allowed(p_packing_unit_id)); perform public.reopen_packing_unit_unscoped_0248(p_packing_unit_id); perform public.nexus_wms_end_scope(); end $$;
create function public.confirm_packing_order(p_order_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_wms_begin_scope(public.nexus_wms_order_allowed(p_order_id)); perform public.confirm_packing_order_unscoped_0248(p_order_id); perform public.nexus_wms_end_scope(); end $$;
create function public.confirm_dispatch(p_order_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$ declare v_id uuid; begin perform public.nexus_wms_begin_scope(public.nexus_wms_order_allowed(p_order_id)); v_id:=public.confirm_dispatch_unscoped_0248(p_order_id); perform public.nexus_wms_end_scope(); return v_id; end $$;
create function public.confirm_delivery(p_shipment_id uuid,p_received_by text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_wms_begin_scope(public.nexus_wms_shipment_allowed(p_shipment_id)); perform public.confirm_delivery_unscoped_0248(p_shipment_id,p_received_by); perform public.nexus_wms_end_scope(); end $$;
create function public.revert_dispatch(p_shipment_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ begin perform public.nexus_wms_begin_scope(public.nexus_wms_shipment_allowed(p_shipment_id)); perform public.revert_dispatch_unscoped_0248(p_shipment_id); perform public.nexus_wms_end_scope(); end $$;

revoke all on function public.confirm_reception(uuid) from public,anon;
revoke all on function public.release_quarantine(uuid) from public,anon;
revoke all on function public.confirm_movement(uuid,public.movement_type_t,uuid,numeric,text,text,public.movement_reference_t,uuid) from public,anon;
revoke all on function public.confirm_picking(uuid) from public,anon;
revoke all on function public.confirm_picking_order(uuid) from public,anon;
revoke all on function public.unpick_allocation(uuid) from public,anon;
revoke all on function public.create_packing_unit(uuid,text,text) from public,anon;
revoke all on function public.pack_allocation(uuid,uuid) from public,anon;
revoke all on function public.unpack_allocation(uuid) from public,anon;
revoke all on function public.close_packing_unit(uuid) from public,anon;
revoke all on function public.reopen_packing_unit(uuid) from public,anon;
revoke all on function public.confirm_packing_order(uuid) from public,anon;
revoke all on function public.confirm_dispatch(uuid) from public,anon;
revoke all on function public.confirm_delivery(uuid,text) from public,anon;
revoke all on function public.revert_dispatch(uuid) from public,anon;
grant execute on function public.confirm_reception(uuid), public.release_quarantine(uuid), public.confirm_movement(uuid,public.movement_type_t,uuid,numeric,text,text,public.movement_reference_t,uuid), public.confirm_picking(uuid), public.confirm_picking_order(uuid), public.unpick_allocation(uuid), public.create_packing_unit(uuid,text,text), public.pack_allocation(uuid,uuid), public.unpack_allocation(uuid), public.close_packing_unit(uuid), public.reopen_packing_unit(uuid), public.confirm_packing_order(uuid), public.confirm_dispatch(uuid), public.confirm_delivery(uuid,text), public.revert_dispatch(uuid) to authenticated;

notify pgrst, 'reload schema';
