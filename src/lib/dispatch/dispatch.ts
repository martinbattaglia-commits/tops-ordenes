import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { LogisticsOrderStatus } from "@/lib/pedidos/types";
import type {
  PhysicalLocation,
  DispatchQueueRow,
  DispatchPanel,
  DispatchUnit,
  DispatchItem,
  ShipmentRow,
  ShipmentStatus,
} from "./types";

/**
 * Capa de datos de Despacho + Entrega (GATE 4C). Lectura de cola/panel + wrappers
 * de las RPC transaccionales de 0035. Las mutaciones (despachar, entregar, revertir)
 * van EXCLUSIVAMENTE por RPC SECURITY DEFINER — único camino que toca stock
 * (stock_reserved / inventory_lots), el ledger (inventory_movements) y los estados.
 * Mismo patrón demo/Supabase que picking/* · packing/*.
 */

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

// ===========================================================================
// Mutaciones — SOLO vía RPC SECURITY DEFINER (0035)
// ===========================================================================

/** Despacha un pedido 'preparado': EGRESO real + crea shipment. Devuelve su id. */
export async function confirmDispatch(orderId: string): Promise<string> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { data, error } = await supabase.rpc("confirm_dispatch", { p_order_id: orderId });
  if (error) throw new Error(`confirmDispatch: ${error.message}`);
  return data as string;
}

/** Marca un despacho como entregado. Sin impacto de stock. */
export async function confirmDelivery(shipmentId: string, receivedBy?: string | null): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase.rpc("confirm_delivery", {
    p_shipment_id: shipmentId,
    p_received_by: receivedBy ?? null,
  });
  if (error) throw new Error(`confirmDelivery: ${error.message}`);
}

/** Revierte un despacho no entregado: reingreso compensatorio + restitución de estados. */
export async function revertDispatch(shipmentId: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase.rpc("revert_dispatch", { p_shipment_id: shipmentId });
  if (error) throw new Error(`revertDispatch: ${error.message}`);
}

// ===========================================================================
// Helpers de embed — REUSA la cadena física canónica (igual que packing)
// ===========================================================================

function one<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null;
  return Array.isArray(x) ? (x[0] ?? null) : x;
}

interface WhEmbed { code?: string | null; name?: string | null }
interface FloorEmbed { code?: string | null; level?: number | null; warehouse?: WhEmbed | WhEmbed[] | null }
interface SectorEmbed { code?: string | null; floor?: FloorEmbed | FloorEmbed[] | null }
interface ZoneEmbed { code?: string | null; sector?: SectorEmbed | SectorEmbed[] | null }
interface RackEmbed { code?: string | null; zone?: ZoneEmbed | ZoneEmbed[] | null }
interface PosEmbed {
  code?: string | null;
  rack_level?: number | null;
  rack_column?: number | null;
  rack?: RackEmbed | RackEmbed[] | null;
}
interface InvEmbed { position_id?: string | null; position?: PosEmbed | PosEmbed[] | null }
interface OrderItemEmbed { order_id?: string; sku?: string | null; description?: string | null }

function buildLocation(positionId: string | null, pos: PosEmbed | null): PhysicalLocation {
  const rack = one(pos?.rack);
  const zone = one(rack?.zone);
  const sector = one(zone?.sector);
  const floor = one(sector?.floor);
  const wh = one(floor?.warehouse);
  const parts = [wh?.code, floor?.code, sector?.code, zone?.code, rack?.code, pos?.code].filter(Boolean);
  return {
    warehouse_code: wh?.code ?? null,
    warehouse_name: wh?.name ?? null,
    floor_code: floor?.code ?? null,
    floor_level: floor?.level ?? null,
    sector_code: sector?.code ?? null,
    zone_code: zone?.code ?? null,
    rack_code: rack?.code ?? null,
    rack_level: pos?.rack_level ?? null,
    rack_column: pos?.rack_column ?? null,
    position_code: pos?.code ?? null,
    position_id: positionId,
    full_code: parts.length ? parts.join("·") : null,
  };
}

function cmpStr(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a.localeCompare(b);
}
function cmpNum(a: number | null, b: number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}
function cmpLocation(la: PhysicalLocation, lb: PhysicalLocation): number {
  return (
    cmpStr(la.warehouse_code, lb.warehouse_code) ||
    cmpNum(la.floor_level, lb.floor_level) ||
    cmpStr(la.sector_code, lb.sector_code) ||
    cmpStr(la.zone_code, lb.zone_code) ||
    cmpStr(la.rack_code, lb.rack_code) ||
    cmpNum(la.rack_level, lb.rack_level) ||
    cmpStr(la.position_code, lb.position_code)
  );
}

// Contenido a despachar: reservas empacada/despachada del pedido, con ubicación
// física. Se usa como mapa allocation_id → datos+ubicación (igual que packing).
const ALLOC_SELECT = `id, order_item_id, inventory_item_id, lot_number, quantity, status,
  logistics_order_items!inner(order_id, sku, description),
  inventory_items!inner(position_id,
    position:warehouse_positions(code, rack_level, rack_column,
      rack:warehouse_racks(code,
        zone:warehouse_zones(code,
          sector:warehouse_sectors(code,
            floor:warehouse_floors(code, level,
              warehouse:warehouses(code, name)))))))`;

// Shallow: el detalle de cada bulto se resuelve con el mapa de allocations
// (evita el embed anidado profundo que PostgREST no parsea).
const UNIT_SELECT = `id, public_id, status, label, unit_type, shipment_id,
  packing_unit_items(quantity, allocation_id)`;

const SHIPMENT_SELECT = `id, public_id, status, carrier, vehicle_ref, dispatched_at, delivered_at, received_by_name`;

interface RawAlloc {
  id: string;
  order_item_id: string;
  inventory_item_id: string;
  lot_number: string | null;
  quantity: number | string | null;
  status: string;
  logistics_order_items?: OrderItemEmbed | OrderItemEmbed[] | null;
  inventory_items?: InvEmbed | InvEmbed[] | null;
}

interface AllocData {
  allocation_id: string;
  order_item_id: string;
  sku: string;
  description: string;
  lot_number: string | null;
  quantity: number;
  location: PhysicalLocation;
}

function toAllocData(a: RawAlloc): AllocData {
  const oi = one(a.logistics_order_items);
  const inv = one(a.inventory_items);
  const pos = one(inv?.position);
  return {
    allocation_id: a.id,
    order_item_id: a.order_item_id,
    sku: oi?.sku ?? "",
    description: oi?.description ?? "",
    lot_number: a.lot_number ?? null,
    quantity: Number(a.quantity ?? 0),
    location: buildLocation(inv?.position_id ?? null, pos),
  };
}

interface RawPUI { quantity?: number | string | null; allocation_id?: string }
interface RawUnit {
  id: string;
  public_id: string;
  status: string;
  label: string | null;
  unit_type: string | null;
  shipment_id: string | null;
  packing_unit_items?: RawPUI[] | null;
}
interface RawShipment {
  id: string;
  public_id: string;
  status: string;
  carrier: string | null;
  vehicle_ref: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  received_by_name: string | null;
}

function toShipment(s: RawShipment | null): ShipmentRow | null {
  if (!s) return null;
  return {
    id: s.id,
    public_id: s.public_id,
    status: s.status as ShipmentStatus,
    carrier: s.carrier ?? null,
    vehicle_ref: s.vehicle_ref ?? null,
    dispatched_at: s.dispatched_at ?? null,
    delivered_at: s.delivered_at ?? null,
    received_by_name: s.received_by_name ?? null,
  };
}

function toUnit(u: RawUnit, allocMap: Map<string, AllocData>): DispatchUnit {
  const items = (u.packing_unit_items ?? [])
    .map((pi): DispatchItem | null => {
      const a = pi.allocation_id ? allocMap.get(pi.allocation_id) : null;
      if (!a) return null;
      return {
        allocation_id: a.allocation_id,
        order_item_id: a.order_item_id,
        sku: a.sku,
        description: a.description,
        lot_number: a.lot_number,
        quantity: Number(pi.quantity ?? 0),
        location: a.location,
      };
    })
    .filter((x): x is DispatchItem => x !== null);
  items.sort((a, b) => cmpLocation(a.location, b.location) || cmpStr(a.sku, b.sku));
  return {
    id: u.id,
    public_id: u.public_id,
    status: u.status,
    label: u.label ?? null,
    unit_type: u.unit_type ?? null,
    item_count: items.length,
    total_quantity: items.reduce((s, i) => s + i.quantity, 0),
    items,
  };
}

// ===========================================================================
// Mocks (demo mode)
// ===========================================================================

const MOCK_QUEUE: DispatchQueueRow[] = [
  {
    order_id: "ped-1", public_id: "PED-2026-0001", client_name: "Lab. Andrómaco",
    status: "preparado", priority: 0, requested_date: "2026-06-05",
    total_units: 1, closed_units: 1, open_units: 0, ready: true, shipment: null,
  },
];

// ===========================================================================
// Lecturas
// ===========================================================================

interface RawQUnit { status: string }
interface RawQOrder {
  id: string;
  public_id: string;
  client_name: string;
  status: string;
  priority: number | null;
  requested_date: string | null;
  packing_units?: RawQUnit[] | null;
  shipments?: RawShipment[] | null;
}

/**
 * Cola de despacho: pedidos 'preparado' (listos para egresar) y 'despachado'
 * (en tránsito, listos para entregar). Orden prioridad desc, fecha asc.
 */
export async function listDispatchQueue(): Promise<DispatchQueueRow[]> {
  if (isMock()) return MOCK_QUEUE;

  const supabase = createClient();
  if (!supabase) return MOCK_QUEUE;

  const { data, error } = await supabase
    .from("logistics_orders")
    .select(
      `id, public_id, client_name, status, priority, requested_date,
       packing_units(status),
       shipments(${SHIPMENT_SELECT})`
    )
    .in("status", ["preparado", "despachado"])
    .order("priority", { ascending: false })
    .order("requested_date", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`listDispatchQueue: ${error.message}`);

  return ((data ?? []) as unknown as RawQOrder[]).map((o): DispatchQueueRow => {
    const units = (o.packing_units ?? []).filter((u) => u.status !== "anulada");
    const closed = units.filter((u) => u.status === "cerrada").length;
    const open = units.filter((u) => u.status === "abierta").length;
    const vigente = (o.shipments ?? []).find((s) => s.status !== "anulado") ?? null;
    return {
      order_id: o.id,
      public_id: o.public_id,
      client_name: o.client_name,
      status: o.status as LogisticsOrderStatus,
      priority: o.priority ?? 0,
      requested_date: o.requested_date ?? null,
      total_units: units.length,
      closed_units: closed,
      open_units: open,
      ready: o.status === "preparado" && open === 0 && closed > 0,
      shipment: toShipment(vigente),
    };
  });
}

/**
 * Panel de despacho de un pedido: bultos + contenido (lote previsto + ubicación)
 * + shipment vigente. null si el pedido no existe.
 */
export async function listDispatchPanel(orderId: string): Promise<DispatchPanel | null> {
  if (isMock()) {
    const q = MOCK_QUEUE.find((o) => o.order_id === orderId);
    if (!q) return null;
    return {
      order_id: q.order_id, public_id: q.public_id, client_name: q.client_name,
      status: q.status, priority: q.priority, shipment: q.shipment, units: [],
      all_closed: true, open_units: 0,
    };
  }

  const supabase = createClient();
  if (!supabase) return null;

  const { data: ord, error: oErr } = await supabase
    .from("logistics_orders")
    .select("id, public_id, client_name, status, priority")
    .eq("id", orderId)
    .maybeSingle();
  if (oErr) throw new Error(`listDispatchPanel.order: ${oErr.message}`);
  if (!ord) return null;

  // Allocations empacada/despachada del pedido (mapa para el contenido de bultos).
  const { data: sd, error: sErr } = await supabase
    .from("stock_allocations")
    .select(ALLOC_SELECT)
    .eq("logistics_order_items.order_id", orderId)
    .in("status", ["empacada", "despachada"]);
  if (sErr) throw new Error(`listDispatchPanel.allocs: ${sErr.message}`);
  const allocMap = new Map<string, AllocData>(
    ((sd ?? []) as unknown as RawAlloc[]).map((a) => {
      const d = toAllocData(a);
      return [d.allocation_id, d];
    })
  );

  const { data: ud, error: uErr } = await supabase
    .from("packing_units")
    .select(UNIT_SELECT)
    .eq("order_id", orderId)
    .neq("status", "anulada")
    .order("public_id", { ascending: true });
  if (uErr) throw new Error(`listDispatchPanel.units: ${uErr.message}`);
  const units = ((ud ?? []) as unknown as RawUnit[]).map((u) => toUnit(u, allocMap));

  const { data: shp, error: shErr } = await supabase
    .from("shipments")
    .select(SHIPMENT_SELECT)
    .eq("order_id", orderId)
    .neq("status", "anulado")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (shErr) throw new Error(`listDispatchPanel.shipment: ${shErr.message}`);

  const rawUnits = (ud ?? []) as unknown as RawUnit[];
  const openUnits = rawUnits.filter((u) => u.status === "abierta").length;
  const allClosed = rawUnits.length > 0 && rawUnits.every((u) => u.status !== "abierta");

  const o = ord as unknown as {
    id: string; public_id: string; client_name: string; status: string; priority: number | null;
  };
  return {
    order_id: o.id,
    public_id: o.public_id,
    client_name: o.client_name,
    status: o.status as LogisticsOrderStatus,
    priority: o.priority ?? 0,
    shipment: toShipment((shp as unknown as RawShipment) ?? null),
    units,
    all_closed: allClosed,
    open_units: openUnits,
  };
}
