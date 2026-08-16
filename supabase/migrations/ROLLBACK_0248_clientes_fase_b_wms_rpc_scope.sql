-- Inversa de 0248: restaura nombres, defaults y grants de los RPC históricos.

drop function if exists public.confirm_reception(uuid);
drop function if exists public.release_quarantine(uuid);
drop function if exists public.confirm_movement(uuid,public.movement_type_t,uuid,numeric,text,text,public.movement_reference_t,uuid);
drop function if exists public.confirm_picking(uuid);
drop function if exists public.confirm_picking_order(uuid);
drop function if exists public.unpick_allocation(uuid);
drop function if exists public.create_packing_unit(uuid,text,text);
drop function if exists public.pack_allocation(uuid,uuid);
drop function if exists public.unpack_allocation(uuid);
drop function if exists public.close_packing_unit(uuid);
drop function if exists public.reopen_packing_unit(uuid);
drop function if exists public.confirm_packing_order(uuid);
drop function if exists public.confirm_dispatch(uuid);
drop function if exists public.confirm_delivery(uuid,text);
drop function if exists public.revert_dispatch(uuid);

alter function public.confirm_reception_unscoped_0248(uuid) rename to confirm_reception;
alter function public.release_quarantine_unscoped_0248(uuid) rename to release_quarantine;
alter function public.confirm_movement_unscoped_0248(uuid,public.movement_type_t,uuid,numeric,text,text,public.movement_reference_t,uuid) rename to confirm_movement;
alter function public.confirm_picking_unscoped_0248(uuid) rename to confirm_picking;
alter function public.confirm_picking_order_unscoped_0248(uuid) rename to confirm_picking_order;
alter function public.unpick_allocation_unscoped_0248(uuid) rename to unpick_allocation;
alter function public.create_packing_unit_unscoped_0248(uuid,text,text) rename to create_packing_unit;
alter function public.pack_allocation_unscoped_0248(uuid,uuid) rename to pack_allocation;
alter function public.unpack_allocation_unscoped_0248(uuid) rename to unpack_allocation;
alter function public.close_packing_unit_unscoped_0248(uuid) rename to close_packing_unit;
alter function public.reopen_packing_unit_unscoped_0248(uuid) rename to reopen_packing_unit;
alter function public.confirm_packing_order_unscoped_0248(uuid) rename to confirm_packing_order;
alter function public.confirm_dispatch_unscoped_0248(uuid) rename to confirm_dispatch;
alter function public.confirm_delivery_unscoped_0248(uuid,text) rename to confirm_delivery;
alter function public.revert_dispatch_unscoped_0248(uuid) rename to revert_dispatch;

grant execute on function public.confirm_reception(uuid), public.release_quarantine(uuid), public.confirm_movement(uuid,public.movement_type_t,uuid,numeric,text,text,public.movement_reference_t,uuid), public.confirm_picking(uuid), public.confirm_picking_order(uuid), public.unpick_allocation(uuid), public.create_packing_unit(uuid,text,text), public.pack_allocation(uuid,uuid), public.unpack_allocation(uuid), public.close_packing_unit(uuid), public.reopen_packing_unit(uuid), public.confirm_packing_order(uuid), public.confirm_dispatch(uuid), public.confirm_delivery(uuid,text), public.revert_dispatch(uuid) to public,authenticated;

drop function if exists public.nexus_wms_end_scope();
drop function if exists public.nexus_wms_begin_scope(boolean);
-- H-1 · la tabla de concesión y nexus_wms_scope_active() se crean en 0246,
-- porque current_role() las consume: su reversa vive en ROLLBACK_0246.
drop function if exists public.nexus_wms_inventory_item_allowed(uuid);
drop function if exists public.nexus_wms_shipment_allowed(uuid);
drop function if exists public.nexus_wms_packing_unit_allowed(uuid);
drop function if exists public.nexus_wms_allocation_allowed(uuid);
drop function if exists public.nexus_wms_order_allowed(uuid);
drop function if exists public.nexus_wms_reception_allowed(uuid);

notify pgrst, 'reload schema';
