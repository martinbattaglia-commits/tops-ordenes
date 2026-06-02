import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { PositionStatus } from "./types";

/**
 * Lectura del Digital Twin (FASE 7).
 *
 * Sprint 1: estructura warehouses → floors → sectors → positions (cubículos).
 * Sprint 2: el estado mostrado se **deriva del inventario** (sin escrituras):
 *   - 'mantenimiento' (estado físico/manual) siempre gana.
 *   - si la posición tiene stock (inventory_items.position_id) → 'ocupado'.
 *   - si no → el estado guardado ('disponible' | 'reservado').
 * Así `warehouse_positions.status` queda como estado físico/manual y la
 * ocupación es una verdad derivada en tiempo de lectura — una sola fuente
 * (el inventario) decide qué está ocupado.
 */

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

export interface TwinPosition {
  id: string;
  code: string;
  /** 'A' = fila izquierda · 'B' = fila derecha (croquis cubículos). */
  rack_code: string | null;
  /** Estado EFECTIVO (derivado del inventario). */
  status: PositionStatus;
  /** Estado físico/manual del campo `warehouse_positions.status`. */
  stored_status: PositionStatus;
  /** Ocupa físicamente: (disponible + reservado) > 0. */
  occupied: boolean;
  /** Stock disponible en la posición. */
  stock_available: number;
  /** Stock reservado en la posición (ocupa físicamente). */
  stock_reserved: number;
}
export interface TwinSector {
  id: string;
  code: string;
  name: string;
  sector_type: string;
  surface_m2: number | null;
  positions: TwinPosition[];
}
export interface TwinFloor {
  id: string;
  code: string;
  name: string;
  level: number | null;
  sectors: TwinSector[];
}
export interface TwinWarehouse {
  id: string;
  code: string;
  name: string;
  warehouse_type: string;
  surface_m2: number | null;
  floors: TwinFloor[];
}

// ------------------------------------------------------------------
// Derivación de estado efectivo (Sprint 2)
// ------------------------------------------------------------------

function deriveStatus(stored: PositionStatus, occupied: boolean): PositionStatus {
  if (stored === "mantenimiento") return "mantenimiento";
  if (occupied) return "ocupado";
  return stored;
}

function buildPosition(
  id: string,
  code: string,
  rack_code: string | null,
  stored: PositionStatus,
  available: number,
  reserved: number
): TwinPosition {
  // Ocupación física = disponible + reservado (el reservado ocupa el cubículo).
  const occupied = available + reserved > 0;
  return {
    id,
    code,
    rack_code,
    stored_status: stored,
    stock_available: available,
    stock_reserved: reserved,
    occupied,
    status: deriveStatus(stored, occupied),
  };
}

// ------------------------------------------------------------------
// Mock (demo mode)
// ------------------------------------------------------------------

function mockCubiculos(
  prefix: string,
  specs: Array<{ stored?: PositionStatus; available?: number; reserved?: number }>
): TwinPosition[] {
  return Array.from({ length: 12 }, (_, i) => {
    const n = i + 1;
    const spec = specs[i] ?? {};
    return buildPosition(
      `${prefix}-c${String(n).padStart(2, "0")}`,
      `C${String(n).padStart(2, "0")}`,
      n <= 6 ? "A" : "B",
      spec.stored ?? "disponible",
      spec.available ?? 0,
      spec.reserved ?? 0
    );
  });
}

const MOCK_TWIN: TwinWarehouse[] = [
  {
    id: "wh-magaldi", code: "MAGALDI_1765", name: "Sede Central — Agustín Magaldi 1765",
    warehouse_type: "mixed", surface_m2: 6893.87,
    floors: [
      {
        id: "mg-pb", code: "PB", name: "Planta Baja", level: 0,
        sectors: [
          { id: "mg-s1", code: "S1", name: "Sector 1", sector_type: "almacenamiento", surface_m2: 564.68, positions: [] },
          { id: "mg-s2", code: "S2", name: "Sector 2", sector_type: "almacenamiento", surface_m2: 786.02, positions: [] },
          { id: "mg-s3", code: "S3", name: "Sector 3", sector_type: "almacenamiento", surface_m2: 793.30, positions: [] },
          { id: "mg-s4", code: "S4", name: "Sector 4", sector_type: "almacenamiento", surface_m2: 306.31, positions: [] },
          { id: "mg-s5", code: "S5", name: "Sector 5", sector_type: "almacenamiento", surface_m2: 990.27, positions: [] },
        ],
      },
      { id: "mg-ep", code: "EP", name: "Entrepiso", level: 1, sectors: [] },
      { id: "mg-pa", code: "PA", name: "Planta Alta", level: 2, sectors: [] },
    ],
  },
  {
    id: "wh-lujan", code: "PEDRO_LUJAN_3159", name: "Sede Anexa — Pedro de Luján 3159",
    warehouse_type: "anmat", surface_m2: null,
    floors: [
      { id: "lj-pb", code: "PB", name: "Planta Baja", level: 0, sectors: [] },
      {
        id: "lj-p1", code: "P1", name: "Planta 1° Piso", level: 1,
        sectors: [{
          id: "lj-d7", code: "D7", name: "Depósito 7 · Montacargas", sector_type: "almacenamiento", surface_m2: 189.47,
          positions: mockCubiculos("p1", [
            { available: 1240 }, { available: 80 }, {}, { stored: "reservado" }, { reserved: 500 }, { stored: "mantenimiento" },
            {}, { available: 540 }, {}, {}, { stored: "reservado" }, {},
          ]),
        }],
      },
      {
        id: "lj-p2", code: "P2", name: "Planta 2° Piso", level: 2,
        sectors: [{
          id: "lj-d6", code: "D6", name: "Depósito 6 · Montacargas", sector_type: "almacenamiento", surface_m2: 350.78,
          positions: mockCubiculos("p2", []),
        }],
      },
    ],
  },
];

// ------------------------------------------------------------------
// Embeds PostgREST
// ------------------------------------------------------------------

interface RawSector { id: string; code: string; name: string; sector_type: string; surface_m2: number | null }
interface RawFloor { id: string; code: string; name: string; level: number | null; sectors: RawSector[] | null }
interface RawWh {
  id: string; code: string; name: string; warehouse_type: string; surface_m2: number | null;
  floors: RawFloor[] | null;
}
interface RawPosZone { sector_id?: string | null }
interface RawPosRack { code?: string | null; zone?: RawPosZone | RawPosZone[] | null }
interface RawPos { id: string; code: string; status: PositionStatus; rack?: RawPosRack | RawPosRack[] | null }
interface RawInvOcc {
  position_id: string | null;
  stock_available: number | string | null;
  stock_reserved: number | string | null;
  active: boolean;
}

function one<T>(x: T | T[] | null | undefined): T | null {
  if (x == null) return null;
  return Array.isArray(x) ? (x[0] ?? null) : x;
}

export async function getTwin(): Promise<TwinWarehouse[]> {
  if (isMock()) return MOCK_TWIN;

  const supabase = createClient();
  if (!supabase) return MOCK_TWIN;

  const { data: whs, error: wErr } = await supabase
    .from("warehouses")
    .select(
      `id, code, name, warehouse_type, surface_m2,
       floors:warehouse_floors(id, code, name, level,
         sectors:warehouse_sectors(id, code, name, sector_type, surface_m2))`
    )
    .order("code", { ascending: true });
  if (wErr) throw new Error(`getTwin.warehouses: ${wErr.message}`);

  const { data: posData, error: pErr } = await supabase
    .from("warehouse_positions")
    .select(`id, code, status, rack:warehouse_racks(code, zone:warehouse_zones(sector_id))`)
    .order("code", { ascending: true });
  if (pErr) throw new Error(`getTwin.positions: ${pErr.message}`);

  // Overlay de ocupación (Sprint 2): stock por posición desde el inventario.
  // Opcional: si inventory_items (0024) no está aplicado, el twin sigue
  // mostrando el estado físico guardado sin derivar (no rompe).
  const occByPos = new Map<string, { available: number; reserved: number }>();
  const { data: invData, error: iErr } = await supabase
    .from("inventory_items")
    .select("position_id, stock_available, stock_reserved, active")
    .not("position_id", "is", null);
  if (!iErr) {
    for (const r of (invData ?? []) as unknown as RawInvOcc[]) {
      if (!r.active || !r.position_id) continue;
      const cur = occByPos.get(r.position_id) ?? { available: 0, reserved: 0 };
      cur.available += Number(r.stock_available ?? 0);
      cur.reserved += Number(r.stock_reserved ?? 0);
      occByPos.set(r.position_id, cur);
    }
  }

  // Agrupar posiciones por sector_id, derivando el estado efectivo.
  const bySector = new Map<string, TwinPosition[]>();
  for (const p of (posData ?? []) as unknown as RawPos[]) {
    const rack = one(p.rack);
    const zone = one(rack?.zone);
    const sid = zone?.sector_id ?? null;
    if (!sid) continue;
    const arr = bySector.get(sid) ?? [];
    const occ = occByPos.get(p.id) ?? { available: 0, reserved: 0 };
    arr.push(buildPosition(p.id, p.code, rack?.code ?? null, p.status, occ.available, occ.reserved));
    bySector.set(sid, arr);
  }

  const numAsc = (a: number | null, b: number | null) => (a ?? 0) - (b ?? 0);
  const codeAsc = (a: string, b: string) => a.localeCompare(b);

  return ((whs ?? []) as unknown as RawWh[]).map((w) => ({
    id: w.id, code: w.code, name: w.name, warehouse_type: w.warehouse_type, surface_m2: w.surface_m2,
    floors: [...(w.floors ?? [])]
      .sort((a, b) => numAsc(a.level, b.level))
      .map((f) => ({
        id: f.id, code: f.code, name: f.name, level: f.level,
        sectors: [...(f.sectors ?? [])]
          .sort((a, b) => codeAsc(a.code, b.code))
          .map((s) => ({
            id: s.id, code: s.code, name: s.name, sector_type: s.sector_type, surface_m2: s.surface_m2,
            positions: (bySector.get(s.id) ?? []).sort((a, b) => codeAsc(a.code, b.code)),
          })),
      })),
  }));
}
