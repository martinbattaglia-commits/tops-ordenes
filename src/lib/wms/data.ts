import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { WmsKpis, InventoryRow, PositionOption, PositionStatus } from "./types";

/**
 * Data accessors del WMS (FASE 5 · Sprint 1). Mismo patrón que
 * `src/lib/erp/data.ts`: producción = Supabase, demo = mock en memoria.
 * Si las tablas (0020 físico / 0024 inventario) aún no están aplicadas, los
 * accessors lanzan y la página degrada con <ModuleUnavailable/>.
 */

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

// ------------------------------------------------------------------
// Mock (demo mode)
// ------------------------------------------------------------------

const MOCK_INVENTORY: InventoryRow[] = [
  {
    id: "inv-1", sku: "AMX-500", description: "Amoxicilina 500mg x100", client_name: "Lab. Andrómaco",
    stock_available: 1240, stock_reserved: 120,
    lot_number: "L-2026-0042", expiration_date: "2027-03-31", lot_count: 1,
    position_id: "mock-c01", position_full_code: "PEDRO_LUJAN_3159·P1·D7·MC·A·C01",
  },
  {
    id: "inv-2", sku: "IBU-400", description: "Ibuprofeno 400mg x50", client_name: "Farma Sur",
    stock_available: 860, stock_reserved: 0,
    lot_number: "L-2026-0091", expiration_date: "2026-09-15", lot_count: 2,
    position_id: "mock-c07", position_full_code: "PEDRO_LUJAN_3159·P2·D6·MC·B·C07",
  },
  {
    id: "inv-3", sku: "GEL-OH", description: "Alcohol en gel 250ml", client_name: "Lab. Andrómaco",
    stock_available: 3200, stock_reserved: 400,
    lot_number: null, expiration_date: null, lot_count: 0,
    position_id: null, position_full_code: null,
  },
];

const MOCK_KPIS: WmsKpis = {
  stockTotal: 5300,
  clientesActivos: 2,
  posicionesOcupadas: 2,
  posicionesDisponibles: 22,
  posicionesTotal: 24,
};

// ------------------------------------------------------------------
// KPIs del dashboard
// ------------------------------------------------------------------

export async function getWmsDashboard(): Promise<WmsKpis> {
  if (isMock()) return MOCK_KPIS;

  const supabase = createClient();
  if (!supabase) return MOCK_KPIS;

  const { count: posTotal, error: pErr } = await supabase
    .from("warehouse_positions")
    .select("id", { count: "exact", head: true });
  if (pErr) throw new Error(`getWmsDashboard.positions: ${pErr.message}`);

  const { data: items, error: iErr } = await supabase
    .from("inventory_items")
    .select("stock_available, stock_reserved, client_name, position_id, active");
  if (iErr) throw new Error(`getWmsDashboard.items: ${iErr.message}`);

  const active = (items ?? []).filter((r) => r.active);
  const stockTotal = active.reduce((s, r) => s + Number(r.stock_available ?? 0), 0);
  const clientesActivos = new Set(active.map((r) => r.client_name)).size;
  // Regla unificada Dashboard ↔ Digital Twin: ocupada = (disponible + reservado) > 0.
  const posicionesOcupadas = new Set(
    active
      .filter(
        (r) =>
          r.position_id &&
          Number(r.stock_available ?? 0) + Number(r.stock_reserved ?? 0) > 0
      )
      .map((r) => r.position_id)
  ).size;
  const posicionesTotal = posTotal ?? 0;

  return {
    stockTotal,
    clientesActivos,
    posicionesOcupadas,
    posicionesDisponibles: Math.max(0, posicionesTotal - posicionesOcupadas),
    posicionesTotal,
  };
}

// ------------------------------------------------------------------
// Inventario
// ------------------------------------------------------------------

// Formas de los embeds anidados que devuelve PostgREST (to-one).
interface WhEmbed { code?: string | null }
interface FloorEmbed { code?: string | null; warehouse?: WhEmbed | WhEmbed[] | null }
interface SectorEmbed { code?: string | null; floor?: FloorEmbed | FloorEmbed[] | null }
interface ZoneEmbed { code?: string | null; sector?: SectorEmbed | SectorEmbed[] | null }
interface RackEmbed { code?: string | null; zone?: ZoneEmbed | ZoneEmbed[] | null }
interface PosEmbed { code?: string | null; rack?: RackEmbed | RackEmbed[] | null }
interface LotEmbed { lot_number?: string | null; expiration_date?: string | null }

interface RawInventoryRow {
  id: string;
  sku: string;
  description: string;
  client_name: string;
  stock_available: number | string | null;
  stock_reserved: number | string | null;
  position_id: string | null;
  lots?: LotEmbed | LotEmbed[] | null;
  position?: PosEmbed | PosEmbed[] | null;
}

/** Normaliza un embed PostgREST que puede venir como objeto o array. */
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

export async function listInventory(): Promise<InventoryRow[]> {
  if (isMock()) return MOCK_INVENTORY;

  const supabase = createClient();
  if (!supabase) return MOCK_INVENTORY;

  const { data, error } = await supabase
    .from("inventory_items")
    .select(
      `id, sku, description, client_name, stock_available, stock_reserved, position_id,
       lots:inventory_lots(lot_number, expiration_date),
       position:warehouse_positions(
         code,
         rack:warehouse_racks(code,
           zone:warehouse_zones(code,
             sector:warehouse_sectors(code,
               floor:warehouse_floors(code,
                 warehouse:warehouses(code)))))
       )`
    )
    .eq("active", true)
    .order("sku", { ascending: true });
  if (error) throw new Error(`listInventory: ${error.message}`);

  const rows = (data ?? []) as unknown as RawInventoryRow[];
  return rows.map((row): InventoryRow => {
    const lots: LotEmbed[] = Array.isArray(row.lots) ? row.lots : row.lots ? [row.lots] : [];
    const expirations = lots
      .map((l) => l.expiration_date)
      .filter((d): d is string => !!d)
      .sort();
    const pos = one(row.position);
    return {
      id: String(row.id),
      sku: row.sku ?? "",
      description: row.description ?? "",
      client_name: row.client_name ?? "",
      stock_available: Number(row.stock_available ?? 0),
      stock_reserved: Number(row.stock_reserved ?? 0),
      lot_number: lots[0]?.lot_number ?? null,
      expiration_date: expirations[0] ?? null,
      lot_count: lots.length,
      position_id: row.position_id ?? null,
      position_full_code: buildFullCode(pos),
    };
  });
}

// ------------------------------------------------------------------
// Opciones de posición (dropdown de destino — full_code legible)
// ------------------------------------------------------------------

const MOCK_POSITION_OPTIONS: PositionOption[] = [
  { id: "mock-c01", full_code: "PEDRO_LUJAN_3159·P1·D7·MC·A·C01", status: "ocupado" },
  { id: "mock-c02", full_code: "PEDRO_LUJAN_3159·P1·D7·MC·A·C02", status: "disponible" },
  { id: "mock-c03", full_code: "PEDRO_LUJAN_3159·P1·D7·MC·A·C03", status: "disponible" },
];

interface RawPositionOption {
  id: string;
  status: PositionStatus;
  code?: string | null;
  rack?: RackEmbed | RackEmbed[] | null;
}

export async function listPositionOptions(): Promise<PositionOption[]> {
  if (isMock()) return MOCK_POSITION_OPTIONS;

  const supabase = createClient();
  if (!supabase) return MOCK_POSITION_OPTIONS;

  const { data, error } = await supabase
    .from("warehouse_positions")
    .select(
      `id, status, code,
       rack:warehouse_racks(code,
         zone:warehouse_zones(code,
           sector:warehouse_sectors(code,
             floor:warehouse_floors(code,
               warehouse:warehouses(code)))))`
    )
    .eq("active", true)
    .order("code", { ascending: true });
  if (error) throw new Error(`listPositionOptions: ${error.message}`);

  return ((data ?? []) as unknown as RawPositionOption[]).map((p): PositionOption => ({
    id: String(p.id),
    full_code: buildFullCode(p) ?? String(p.code ?? p.id),
    status: p.status,
  }));
}
