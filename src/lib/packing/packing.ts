import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { AllocStatus, LogisticsOrderStatus } from "@/lib/pedidos/types";
import type {
  PhysicalLocation,
  PackQueueRow,
  PackBoard,
  PackStop,
  PackingStatus,
  PackingUnitRow,
  PackingUnitItem,
} from "./types";

/**
 * Capa de datos de Packing (GATE 4B). Lectura de cola/tablero + wrappers de las
 * RPC transaccionales de 0033. Las mutaciones (crear bulto, empacar, desempacar,
 * cerrar, reabrir) van EXCLUSIVAMENTE por RPC SECURITY DEFINER — único camino
 * que cambia packing_units / packing_unit_items / stock_allocations.status y el
 * estado de línea/pedido. Packing NO toca stock (garantía 0033). Mismo patrón
 * demo/Supabase que src/lib/wms/* · pedidos/* · picking/*.
 */

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

// ===========================================================================
// Mutaciones — SOLO vía RPC SECURITY DEFINER (0033)
// ===========================================================================

/** Abre un bulto para un pedido 'en_preparacion'. Devuelve el id del bulto. */
export async function createPackingUnit(
  orderId: string,
  label?: string | null,
  unitType?: string | null
): Promise<string> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { data, error } = await supabase.rpc("create_packing_unit", {
    p_order_id: orderId,
    p_label: label ?? null,
    p_unit_type: unitType ?? null,
  });
  if (error) throw new Error(`createPackingUnit: ${error.message}`);
  return data as string;
}

/** Empaca una reserva 'pickeada' en un bulto 'abierta'. */
export async function packAllocation(packingUnitId: string, allocationId: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase.rpc("pack_allocation", {
    p_packing_unit_id: packingUnitId,
    p_allocation_id: allocationId,
  });
  if (error) throw new Error(`packAllocation: ${error.message}`);
}

/** Desempaca una reserva: 'empacada' → 'pickeada' (requiere bulto 'abierta'). */
export async function unpackAllocation(allocationId: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase.rpc("unpack_allocation", { p_allocation_id: allocationId });
  if (error) throw new Error(`unpackAllocation: ${error.message}`);
}

/** Sella un bulto: 'abierta' → 'cerrada' (exige ≥1 ítem). */
export async function closePackingUnit(packingUnitId: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase.rpc("close_packing_unit", { p_packing_unit_id: packingUnitId });
  if (error) throw new Error(`closePackingUnit: ${error.message}`);
}

/** Reabre un bulto: 'cerrada' → 'abierta'. */
export async function reopenPackingUnit(packingUnitId: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase.rpc("reopen_packing_unit", { p_packing_unit_id: packingUnitId });
  if (error) throw new Error(`reopenPackingUnit: ${error.message}`);
}

/** Empaca el pedido completo: crea un bulto, empaca todo, lo cierra (→ preparado). */
export async function confirmPackingOrder(orderId: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase.rpc("confirm_packing_order", { p_order_id: orderId });
  if (error) throw new Error(`confirmPackingOrder: ${error.message}`);
}

// ===========================================================================
// Helpers de embed — REUSA la cadena física canónica (wms/data.ts · picking)
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

// Orden de armado: mismo recorrido físico estable que la ruta de picking.
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

const STOP_SELECT = `id, order_item_id, inventory_item_id, lot_number, quantity, status,
  logistics_order_items!inner(order_id, sku, description),
  inventory_items!inner(position_id,
    position:warehouse_positions(code, rack_level, rack_column,
      rack:warehouse_racks(code,
        zone:warehouse_zones(code,
          sector:warehouse_sectors(code,
            floor:warehouse_floors(code, level,
              warehouse:warehouses(code, name)))))))`;

// Shallow: el detalle de cada allocation (sku/lote/ubicación) se resuelve con un
// mapa armado del STOP_SELECT (evita el embed anidado profundo que PostgREST no
// parsea: packing_units → … → warehouses).
const UNIT_SELECT = `id, public_id, status, label, unit_type,
  packing_unit_items(quantity, allocation_id)`;

interface RawStop {
  id: string;
  order_item_id: string;
  inventory_item_id: string;
  lot_number: string | null;
  quantity: number | string | null;
  status: string;
  logistics_order_items?: OrderItemEmbed | OrderItemEmbed[] | null;
  inventory_items?: InvEmbed | InvEmbed[] | null;
}

function toStop(a: RawStop): PackStop {
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

interface RawPUI { quantity?: number | string | null; allocation_id?: string }
interface RawUnit {
  id: string;
  public_id: string;
  status: string;
  label: string | null;
  unit_type: string | null;
  packing_unit_items?: RawPUI[] | null;
}

// El contenido se resuelve contra `allocMap` (allocation_id → datos+ubicación,
// armado del STOP_SELECT). La cantidad se toma de packing_unit_items (forward-
// compat con packing parcial; en 4B = cantidad de la allocation).
function toUnit(u: RawUnit, allocMap: Map<string, PackStop>): PackingUnitRow {
  const items = (u.packing_unit_items ?? [])
    .map((pi): PackingUnitItem | null => {
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
    .filter((x): x is PackingUnitItem => x !== null);
  items.sort((a, b) => cmpLocation(a.location, b.location) || cmpStr(a.sku, b.sku));
  return {
    id: u.id,
    public_id: u.public_id,
    status: u.status as PackingStatus,
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

const MOCK_LOC: PhysicalLocation = {
  warehouse_code: "PEDRO_LUJAN_3159", warehouse_name: "Sede Anexa — Pedro de Luján 3159",
  floor_code: "P1", floor_level: 1, sector_code: "D7", zone_code: "MC",
  rack_code: "A", rack_level: 1, rack_column: 1, position_code: "C01",
  position_id: "mock-c01", full_code: "PEDRO_LUJAN_3159·P1·D7·MC·A·C01",
};

const MOCK_QUEUE: PackQueueRow[] = [
  {
    order_id: "ped-1", public_id: "PED-2026-0001", client_name: "Lab. Andrómaco",
    status: "en_preparacion", priority: 0, requested_date: "2026-06-05",
    line_count: 2, pending_lines: 2, packed_lines: 0, pending_stops: 2, open_units: 0, fully_packed: false,
  },
];

const MOCK_BOARDS: Record<string, PackBoard> = {
  "ped-1": {
    order_id: "ped-1", public_id: "PED-2026-0001", client_name: "Lab. Andrómaco",
    status: "en_preparacion", priority: 0,
    pending_stops: [
      {
        allocation_id: "al-1", status: "pickeada", order_item_id: "it-1",
        sku: "AMX-500", description: "Amoxicilina 500mg", lot_number: "L-2026-0042",
        quantity: 100, inventory_item_id: "inv-amx", location: MOCK_LOC,
      },
    ],
    units: [],
  },
};

// ===========================================================================
// Lecturas
// ===========================================================================

interface RawQAlloc { id: string; status: string }
interface RawQItem { id: string; status: string; stock_allocations?: RawQAlloc[] | null }
interface RawQUnit { status: string }
interface RawQOrder {
  id: string;
  public_id: string;
  client_name: string;
  status: string;
  priority: number | null;
  requested_date: string | null;
  logistics_order_items?: RawQItem[] | null;
  packing_units?: RawQUnit[] | null;
}

/**
 * Cola de packing: pedidos 'en_preparacion'/'preparado' con reservas pickeadas
 * por empacar o líneas ya empacadas. Orden prioridad desc, fecha asc.
 */
export async function listPackQueue(): Promise<PackQueueRow[]> {
  if (isMock()) return MOCK_QUEUE;

  const supabase = createClient();
  if (!supabase) return MOCK_QUEUE;

  const { data, error } = await supabase
    .from("logistics_orders")
    .select(
      `id, public_id, client_name, status, priority, requested_date,
       logistics_order_items(id, status, stock_allocations(id, status)),
       packing_units(status)`
    )
    .in("status", ["en_preparacion", "preparado"])
    .order("priority", { ascending: false })
    .order("requested_date", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`listPackQueue: ${error.message}`);

  return ((data ?? []) as unknown as RawQOrder[])
    .map((o): PackQueueRow => {
      const items = o.logistics_order_items ?? [];
      let pendingStops = 0;
      let pendingLines = 0;
      let packedLines = 0;
      for (const it of items) {
        if (it.status === "pickeado") pendingLines += 1;
        else if (it.status === "empacado") packedLines += 1;
        for (const al of it.stock_allocations ?? []) {
          if (al.status === "pickeada") pendingStops += 1;
        }
      }
      const openUnits = (o.packing_units ?? []).filter((u) => u.status === "abierta").length;
      return {
        order_id: o.id,
        public_id: o.public_id,
        client_name: o.client_name,
        status: o.status as LogisticsOrderStatus,
        priority: o.priority ?? 0,
        requested_date: o.requested_date ?? null,
        line_count: items.length,
        pending_lines: pendingLines,
        packed_lines: packedLines,
        pending_stops: pendingStops,
        open_units: openUnits,
        fully_packed: o.status === "preparado",
      };
    })
    .filter((r) => r.pending_stops > 0 || r.packed_lines > 0);
}

/**
 * Tablero de armado de un pedido: reservas pickeadas por empacar (ordenadas por
 * ubicación física) + los bultos del pedido con su contenido. null si no existe.
 */
export async function listPackBoard(orderId: string): Promise<PackBoard | null> {
  if (isMock()) return MOCK_BOARDS[orderId] ?? null;

  const supabase = createClient();
  if (!supabase) return null;

  const { data: ord, error: oErr } = await supabase
    .from("logistics_orders")
    .select("id, public_id, client_name, status, priority")
    .eq("id", orderId)
    .maybeSingle();
  if (oErr) throw new Error(`listPackBoard.order: ${oErr.message}`);
  if (!ord) return null;

  // Allocations en juego (pickeada = por empacar · empacada = ya en bultos), con
  // ubicación física. Se usa para las paradas y como mapa para el contenido.
  const { data: sd, error: sErr } = await supabase
    .from("stock_allocations")
    .select(STOP_SELECT)
    .eq("logistics_order_items.order_id", orderId)
    .in("status", ["pickeada", "empacada"]);
  if (sErr) throw new Error(`listPackBoard.stops: ${sErr.message}`);
  const allocs = ((sd ?? []) as unknown as RawStop[]).map(toStop);
  const allocMap = new Map<string, PackStop>(allocs.map((a) => [a.allocation_id, a]));
  const pending_stops = allocs
    .filter((a) => a.status === "pickeada")
    .sort((a, b) => cmpLocation(a.location, b.location) || cmpStr(a.sku, b.sku));

  const { data: ud, error: uErr } = await supabase
    .from("packing_units")
    .select(UNIT_SELECT)
    .eq("order_id", orderId)
    .neq("status", "anulada")
    .order("public_id", { ascending: true });
  if (uErr) throw new Error(`listPackBoard.units: ${uErr.message}`);
  const units = ((ud ?? []) as unknown as RawUnit[]).map((u) => toUnit(u, allocMap));

  const o = ord as unknown as {
    id: string; public_id: string; client_name: string; status: string; priority: number | null;
  };
  return {
    order_id: o.id,
    public_id: o.public_id,
    client_name: o.client_name,
    status: o.status as LogisticsOrderStatus,
    priority: o.priority ?? 0,
    pending_stops,
    units,
  };
}
