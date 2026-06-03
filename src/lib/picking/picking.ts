import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { AllocStatus, LogisticsOrderStatus } from "@/lib/pedidos/types";
import type { PhysicalLocation, PickQueueRow, PickRoute, PickStop } from "./types";

/**
 * Capa de datos de Picking (GATE 4A). Lectura de la cola/ruta + wrappers de las
 * RPC transaccionales de 0032. Las mutaciones (reservada↔pickeada) van
 * EXCLUSIVAMENTE por RPC (confirm_picking / confirm_picking_order /
 * unpick_allocation): único camino que cambia stock_allocations.status y el
 * estado de la línea. Picking NO toca stock (ver garantía en 0032). Mismo patrón
 * demo/Supabase que src/lib/wms/* y src/lib/pedidos/*.
 */

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

// ===========================================================================
// Mutaciones — SOLO vía RPC SECURITY DEFINER (0032)
// ===========================================================================

/** Confirma el picking de UNA parada (allocation): reservada → pickeada. */
export async function confirmPicking(allocationId: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase.rpc("confirm_picking", { p_allocation_id: allocationId });
  if (error) throw new Error(`confirmPicking: ${error.message}`);
}

/** Pickea de una el pedido completo: todas las allocations 'reservada'. */
export async function confirmPickingOrder(orderId: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase.rpc("confirm_picking_order", { p_order_id: orderId });
  if (error) throw new Error(`confirmPickingOrder: ${error.message}`);
}

/** Deshace un picking confirmado de UNA parada: pickeada → reservada. */
export async function unpickAllocation(allocationId: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase.rpc("unpick_allocation", { p_allocation_id: allocationId });
  if (error) throw new Error(`unpickAllocation: ${error.message}`);
}

// ===========================================================================
// Helpers de embed (misma cadena física que wms/data.ts · twin.ts)
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

function buildLocation(positionId: string | null, pos: PosEmbed | null): PhysicalLocation {
  const rack = one(pos?.rack);
  const zone = one(rack?.zone);
  const sector = one(zone?.sector);
  const floor = one(sector?.floor);
  const wh = one(floor?.warehouse);
  const parts = [wh?.code, floor?.code, sector?.code, zone?.code, rack?.code, pos?.code].filter(
    Boolean
  );
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

function toStop(a: RawAlloc): PickStop {
  const oi = one(a.logistics_order_items);
  const inv = one(a.inventory_items);
  const pos = one(inv?.position);
  return {
    allocation_id: a.id,
    status: a.status as AllocStatus,
    order_item_id: a.order_item_id,
    sku: oi?.sku ?? "",
    description: oi?.description ?? "",
    lot_number: a.lot_number ?? null,
    quantity: Number(a.quantity ?? 0),
    inventory_item_id: a.inventory_item_id,
    location: buildLocation(inv?.position_id ?? null, pos),
  };
}

// Orden de ruta: recorrido físico estable (sede → piso → sector → pasillo →
// rack → nivel → posición). Nulls al final para no romper el recorrido.
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
function byLocation(a: PickStop, b: PickStop): number {
  const la = a.location;
  const lb = b.location;
  return (
    cmpStr(la.warehouse_code, lb.warehouse_code) ||
    cmpNum(la.floor_level, lb.floor_level) ||
    cmpStr(la.sector_code, lb.sector_code) ||
    cmpStr(la.zone_code, lb.zone_code) ||
    cmpStr(la.rack_code, lb.rack_code) ||
    cmpNum(la.rack_level, lb.rack_level) ||
    cmpStr(la.position_code, lb.position_code) ||
    cmpStr(a.sku, b.sku)
  );
}

const ALLOC_SELECT = `id, order_item_id, inventory_item_id, lot_number, quantity, status,
  logistics_order_items!inner(order_id, sku, description),
  inventory_items!inner(position_id,
    position:warehouse_positions(code, rack_level, rack_column,
      rack:warehouse_racks(code,
        zone:warehouse_zones(code,
          sector:warehouse_sectors(code,
            floor:warehouse_floors(code, level,
              warehouse:warehouses(code, name)))))))`;

// ===========================================================================
// Mocks (demo mode)
// ===========================================================================

const MOCK_QUEUE: PickQueueRow[] = [
  {
    order_id: "ped-1", public_id: "PED-2026-0001", client_name: "Lab. Andrómaco",
    status: "en_preparacion", priority: 0, requested_date: "2026-06-05",
    line_count: 2, pending_stops: 2, picked_stops: 0, total_stops: 2, fully_picked: false,
  },
];

const MOCK_ROUTES: Record<string, PickRoute> = {
  "ped-1": {
    order_id: "ped-1", public_id: "PED-2026-0001", client_name: "Lab. Andrómaco",
    status: "en_preparacion", priority: 0,
    stops: [
      {
        allocation_id: "al-1", status: "reservada", order_item_id: "it-1",
        sku: "AMX-500", description: "Amoxicilina 500mg", lot_number: "L-2026-0042", quantity: 100,
        inventory_item_id: "inv-amx",
        location: {
          warehouse_code: "PEDRO_LUJAN_3159", warehouse_name: "Sede Anexa — Pedro de Luján 3159",
          floor_code: "P1", floor_level: 1, sector_code: "D7", zone_code: "MC",
          rack_code: "A", rack_level: 1, rack_column: 1, position_code: "C01",
          position_id: "mock-c01", full_code: "PEDRO_LUJAN_3159·P1·D7·MC·A·C01",
        },
      },
      {
        allocation_id: "al-2", status: "reservada", order_item_id: "it-2",
        sku: "VIT-C", description: "Vitamina C 1g", lot_number: "L-2025-7781", quantity: 20,
        inventory_item_id: "inv-vit",
        location: {
          warehouse_code: "PEDRO_LUJAN_3159", warehouse_name: "Sede Anexa — Pedro de Luján 3159",
          floor_code: "P2", floor_level: 2, sector_code: "D6", zone_code: "MC",
          rack_code: "B", rack_level: 1, rack_column: 7, position_code: "C07",
          position_id: "mock-c07", full_code: "PEDRO_LUJAN_3159·P2·D6·MC·B·C07",
        },
      },
    ],
  },
};

// ===========================================================================
// Lecturas
// ===========================================================================

interface RawQueueAlloc { id: string; status: string }
interface RawQueueItem { id: string; status: string; stock_allocations?: RawQueueAlloc[] | null }
interface RawQueueOrder {
  id: string;
  public_id: string;
  client_name: string;
  status: string;
  priority: number | null;
  requested_date: string | null;
  logistics_order_items?: RawQueueItem[] | null;
}

/**
 * Cola de picking: pedidos 'en_preparacion' con al menos una parada viva
 * (reservada o pickeada). Ordenados por prioridad desc y fecha solicitada asc.
 */
export async function listPickQueue(): Promise<PickQueueRow[]> {
  if (isMock()) return MOCK_QUEUE;

  const supabase = createClient();
  if (!supabase) return MOCK_QUEUE;

  const { data, error } = await supabase
    .from("logistics_orders")
    .select(
      `id, public_id, client_name, status, priority, requested_date,
       logistics_order_items(id, status, stock_allocations(id, status))`
    )
    .eq("status", "en_preparacion")
    .order("priority", { ascending: false })
    .order("requested_date", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`listPickQueue: ${error.message}`);

  return ((data ?? []) as unknown as RawQueueOrder[])
    .map((o): PickQueueRow => {
      const items = o.logistics_order_items ?? [];
      let pending = 0;
      let picked = 0;
      for (const it of items) {
        for (const al of it.stock_allocations ?? []) {
          if (al.status === "reservada") pending += 1;
          else if (al.status === "pickeada") picked += 1;
        }
      }
      const total = pending + picked;
      return {
        order_id: o.id,
        public_id: o.public_id,
        client_name: o.client_name,
        status: o.status as LogisticsOrderStatus,
        priority: o.priority ?? 0,
        requested_date: o.requested_date ?? null,
        line_count: items.length,
        pending_stops: pending,
        picked_stops: picked,
        total_stops: total,
        fully_picked: total > 0 && pending === 0,
      };
    })
    .filter((r) => r.total_stops > 0);
}

/**
 * Ruta de picking de un pedido: sus reservas vivas (reservada/pickeada) con la
 * ubicación física completa, ordenadas para el recorrido del operario.
 * Devuelve null si el pedido no existe.
 */
export async function listPickRoute(orderId: string): Promise<PickRoute | null> {
  if (isMock()) return MOCK_ROUTES[orderId] ?? null;

  const supabase = createClient();
  if (!supabase) return null;

  const { data: ord, error: oErr } = await supabase
    .from("logistics_orders")
    .select("id, public_id, client_name, status, priority")
    .eq("id", orderId)
    .maybeSingle();
  if (oErr) throw new Error(`listPickRoute.order: ${oErr.message}`);
  if (!ord) return null;

  const { data, error } = await supabase
    .from("stock_allocations")
    .select(ALLOC_SELECT)
    .eq("logistics_order_items.order_id", orderId)
    .in("status", ["reservada", "pickeada"]);
  if (error) throw new Error(`listPickRoute.stops: ${error.message}`);

  const stops = ((data ?? []) as unknown as RawAlloc[]).map(toStop).sort(byLocation);

  const o = ord as unknown as {
    id: string; public_id: string; client_name: string; status: string; priority: number | null;
  };
  return {
    order_id: o.id,
    public_id: o.public_id,
    client_name: o.client_name,
    status: o.status as LogisticsOrderStatus,
    priority: o.priority ?? 0,
    stops,
  };
}
