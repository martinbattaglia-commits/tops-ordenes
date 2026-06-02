import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import {
  computeDaysLeft,
  computeExpiryStatus,
  EXPIRY_THRESHOLDS,
  type ExpiryThresholds,
  type ExpiryKpis,
  type LotInventoryRow,
} from "./types";

/**
 * Lotes y Vencimientos (WMS FASE 9A) — capa de LECTURA. Mismo patrón que
 * `src/lib/wms/data.ts`: producción = Supabase, demo = mock en memoria.
 *
 * `getLotInventory` es la base canónica: 1 fila por lote, joineada a su
 * inventory_item + posición física, ORDENADA FEFO (vencimiento ascendente).
 * `listLots` / `listExpiries` / `getExpiryKpis` son wrappers finos sobre ella.
 * NO escribe stock; no toca recepciones/movimientos/RPC.
 */

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

/** Día actual (YYYY-MM-DD, UTC) resuelto en el server → se inyecta a las puras. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface LotFilters {
  cliente?: string | null;
  sku?: string | null;
  lote?: string | null;
}

// ------------------------------------------------------------------
// Embeds PostgREST (to-one que puede venir objeto o array) → full_code
// ------------------------------------------------------------------
interface WhEmbed { code?: string | null }
interface FloorEmbed { code?: string | null; warehouse?: WhEmbed | WhEmbed[] | null }
interface SectorEmbed { code?: string | null; floor?: FloorEmbed | FloorEmbed[] | null }
interface ZoneEmbed { code?: string | null; sector?: SectorEmbed | SectorEmbed[] | null }
interface RackEmbed { code?: string | null; zone?: ZoneEmbed | ZoneEmbed[] | null }
interface PosEmbed { code?: string | null; rack?: RackEmbed | RackEmbed[] | null }

function one<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null;
  return Array.isArray(x) ? (x[0] ?? null) : x;
}

function buildFullCode(pos: PosEmbed | null): string | null {
  if (!pos) return null;
  const rack = one(pos.rack);
  const zone = one(rack?.zone);
  const sector = one(zone?.sector);
  const floor = one(sector?.floor);
  const wh = one(floor?.warehouse);
  const parts = [wh?.code, floor?.code, sector?.code, zone?.code, rack?.code, pos.code].filter(
    Boolean
  );
  return parts.length ? parts.join("·") : null;
}

// ------------------------------------------------------------------
// Forma cruda (común a Supabase y mock) → fila canónica derivada
// ------------------------------------------------------------------
interface RawLot {
  lot_id: string;
  lot_number: string;
  expiration_date: string | null;
  quantity: number | string | null;
  inventory_item_id: string;
  sku: string;
  description: string;
  client_name: string;
  position_id: string | null;
  position?: PosEmbed | null;
}

function toRow(raw: RawLot, today: string, t: ExpiryThresholds): LotInventoryRow {
  const days = computeDaysLeft(raw.expiration_date, today);
  return {
    inventory_item_id: raw.inventory_item_id,
    lot_id: raw.lot_id,
    client_name: raw.client_name ?? "",
    sku: raw.sku ?? "",
    description: raw.description ?? "",
    lot_number: raw.lot_number ?? "",
    expiration_date: raw.expiration_date ?? null,
    quantity: Number(raw.quantity ?? 0),
    position_id: raw.position_id ?? null,
    position_full_code: buildFullCode(raw.position ?? null),
    days_left: days,
    estado: days != null && days < 0 ? "vencido" : "activo",
    expiry_status: computeExpiryStatus(days, t),
  };
}

// ------------------------------------------------------------------
// Mock (demo mode) — fechas relativas se derivan contra `today` en runtime
// ------------------------------------------------------------------
const MOCK_RAW: RawLot[] = [
  {
    lot_id: "lot-1", lot_number: "L-2025-7781", expiration_date: "2026-05-20", quantity: 40,
    inventory_item_id: "inv-3", sku: "VIT-C", description: "Vitamina C 1g", client_name: "Lab. Andrómaco",
    position_id: "mock-c03", position: { code: "C03", rack: { code: "A", zone: { code: "MC", sector: { code: "D7", floor: { code: "P1", warehouse: { code: "PEDRO_LUJAN_3159" } } } } } },
  },
  {
    lot_id: "lot-2", lot_number: "L-2026-1120", expiration_date: "2026-06-25", quantity: 300,
    inventory_item_id: "inv-4", sku: "DIP-500", description: "Dipirona 500mg", client_name: "Farma Sur",
    position_id: "mock-c11", position: { code: "C11", rack: { code: "B", zone: { code: "MC", sector: { code: "S2", floor: { code: "PB", warehouse: { code: "MAGALDI_1765" } } } } } },
  },
  {
    lot_id: "lot-3", lot_number: "L-2026-0091", expiration_date: "2026-08-10", quantity: 860,
    inventory_item_id: "inv-2", sku: "IBU-400", description: "Ibuprofeno 400mg", client_name: "Farma Sur",
    position_id: "mock-c07", position: { code: "C07", rack: { code: "B", zone: { code: "MC", sector: { code: "D6", floor: { code: "P2", warehouse: { code: "PEDRO_LUJAN_3159" } } } } } },
  },
  {
    lot_id: "lot-4", lot_number: "L-2026-2210", expiration_date: "2026-11-30", quantity: 500,
    inventory_item_id: "inv-1", sku: "AMX-500", description: "Amoxicilina 500mg", client_name: "Farma Sur",
    position_id: "mock-c04", position: { code: "C04", rack: { code: "A", zone: { code: "MC", sector: { code: "S1", floor: { code: "PB", warehouse: { code: "MAGALDI_1765" } } } } } },
  },
  {
    lot_id: "lot-5", lot_number: "L-2026-0042", expiration_date: "2027-03-31", quantity: 1240,
    inventory_item_id: "inv-1", sku: "AMX-500", description: "Amoxicilina 500mg", client_name: "Lab. Andrómaco",
    position_id: "mock-c01", position: { code: "C01", rack: { code: "A", zone: { code: "MC", sector: { code: "S1", floor: { code: "PB", warehouse: { code: "MAGALDI_1765" } } } } } },
  },
  {
    lot_id: "lot-6", lot_number: "L-S/V", expiration_date: null, quantity: 120,
    inventory_item_id: "inv-5", sku: "GEL-OH", description: "Alcohol en gel 250ml", client_name: "Lab. Andrómaco",
    position_id: null, position: null,
  },
];

// ------------------------------------------------------------------
// Base canónica
// ------------------------------------------------------------------
function matches(r: LotInventoryRow, f?: LotFilters): boolean {
  if (!f) return true;
  const inc = (hay: string, needle?: string | null) =>
    !needle || hay.toLowerCase().includes(needle.toLowerCase());
  return (
    inc(r.client_name, f.cliente) && inc(r.sku, f.sku) && inc(r.lot_number, f.lote)
  );
}

export async function getLotInventory(opts?: {
  filters?: LotFilters;
  thresholds?: ExpiryThresholds;
  today?: string;
}): Promise<LotInventoryRow[]> {
  const t = opts?.thresholds ?? EXPIRY_THRESHOLDS;
  const today = opts?.today ?? todayIso();

  let rawRows: RawLot[];

  if (isMock()) {
    rawRows = MOCK_RAW;
  } else {
    const supabase = createClient();
    if (!supabase) {
      rawRows = MOCK_RAW;
    } else {
      const { data, error } = await supabase
        .from("inventory_lots")
        .select(
          `id, lot_number, expiration_date, quantity, active, inventory_item_id,
           item:inventory_items!inner(
             sku, description, client_name, position_id, active,
             position:warehouse_positions(
               code,
               rack:warehouse_racks(code,
                 zone:warehouse_zones(code,
                   sector:warehouse_sectors(code,
                     floor:warehouse_floors(code,
                       warehouse:warehouses(code))))))
           )`
        )
        .eq("active", true)
        .order("expiration_date", { ascending: true, nullsFirst: false });
      if (error) throw new Error(`getLotInventory: ${error.message}`);

      interface RawDb {
        id: string;
        lot_number: string | null;
        expiration_date: string | null;
        quantity: number | string | null;
        inventory_item_id: string;
        item?: {
          sku?: string | null;
          description?: string | null;
          client_name?: string | null;
          position_id?: string | null;
          active?: boolean | null;
          position?: PosEmbed | PosEmbed[] | null;
        } | Array<{
          sku?: string | null; description?: string | null; client_name?: string | null;
          position_id?: string | null; active?: boolean | null; position?: PosEmbed | PosEmbed[] | null;
        }> | null;
      }

      rawRows = ((data ?? []) as unknown as RawDb[])
        .map((d): RawLot | null => {
          const item = one(d.item);
          if (!item || item.active === false) return null; // solo ítems activos
          return {
            lot_id: String(d.id),
            lot_number: d.lot_number ?? "",
            expiration_date: d.expiration_date ?? null,
            quantity: d.quantity ?? 0,
            inventory_item_id: String(d.inventory_item_id),
            sku: item.sku ?? "",
            description: item.description ?? "",
            client_name: item.client_name ?? "",
            position_id: item.position_id ?? null,
            position: one(item.position),
          };
        })
        .filter((r): r is RawLot => r !== null);
    }
  }

  // Derivar + filtrar. Orden FEFO: lotes con vencimiento asc primero, sin venc al final.
  const rows = rawRows.map((r) => toRow(r, today, t)).filter((r) => matches(r, opts?.filters));
  rows.sort((a, b) => {
    if (a.expiration_date && b.expiration_date) return a.expiration_date < b.expiration_date ? -1 : a.expiration_date > b.expiration_date ? 1 : 0;
    if (a.expiration_date) return -1;
    if (b.expiration_date) return 1;
    return 0;
  });
  return rows;
}

/** Todos los lotes (con y sin vencimiento) — pantalla Lotes. */
export async function listLots(filters?: LotFilters): Promise<LotInventoryRow[]> {
  return getLotInventory({ filters });
}

/** Solo lotes con vencimiento — pantalla Vencimientos (control ANMAT). */
export async function listExpiries(
  filters?: LotFilters,
  thresholds?: ExpiryThresholds
): Promise<LotInventoryRow[]> {
  const rows = await getLotInventory({ filters, thresholds });
  return rows.filter((r) => r.expiration_date != null);
}

/** KPIs derivados de un conjunto de filas (no hace IO). */
export function getExpiryKpis(rows: LotInventoryRow[]): ExpiryKpis {
  const atRisk = (s: LotInventoryRow["expiry_status"]) =>
    s === "rojo" || s === "naranja" || s === "amarillo";
  const comprometido = (s: LotInventoryRow["expiry_status"]) => s === "vencido" || atRisk(s);

  const vencidos = rows.filter((r) => r.expiry_status === "vencido").length;
  const proximos = rows.filter((r) => atRisk(r.expiry_status)).length;
  const unidadesComprometidas = rows
    .filter((r) => comprometido(r.expiry_status))
    .reduce((s, r) => s + r.quantity, 0);
  const clientesAfectados = new Set(
    rows.filter((r) => comprometido(r.expiry_status)).map((r) => r.client_name)
  ).size;

  return {
    totalLotes: rows.length,
    proximosAVencer: proximos,
    vencidos,
    clientesAfectados,
    unidadesComprometidas,
  };
}
