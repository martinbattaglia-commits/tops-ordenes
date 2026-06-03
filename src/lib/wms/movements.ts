import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { MovementRow, MovementType, MovementReference } from "./types";

/**
 * Servicios de Movimientos (WMS Sprint 2). La confirmación va EXCLUSIVAMENTE por
 * la RPC transaccional `confirm_movement` (único camino que toca stock —
 * regla 2). `listMovements` lee el ledger inmutable.
 */

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

const MOCK_MOVEMENTS: MovementRow[] = [
  {
    id: "mov-1", movement_type: "ingreso", sku: "AMX-500", quantity: 1240,
    before_quantity: 0, after_quantity: 1240, from_full_code: null,
    to_full_code: "PEDRO_LUJAN_3159·P1·D7·MC·A·C01", reason: "Recepción REC-2026-0001",
    notes: null, reference_type: "recepcion", created_at: "2026-06-01T10:00:00Z",
  },
  {
    id: "mov-2", movement_type: "traslado", sku: "AMX-500", quantity: 1240,
    before_quantity: 1240, after_quantity: 1240,
    from_full_code: "PEDRO_LUJAN_3159·P1·D7·MC·A·C01",
    to_full_code: "PEDRO_LUJAN_3159·P1·D7·MC·A·C03", reason: "Reubicación",
    notes: "Consolidación de stock", reference_type: "movimiento",
    created_at: "2026-06-02T11:30:00Z",
  },
];

// ── Confirmación (RPC transaccional) ───────────────────────────────────────

export interface NewMovementInput {
  inventory_item_id: string;
  movement_type: MovementType;
  to_position_id?: string | null;
  quantity?: number | null;
  reason?: string | null;
  notes?: string | null;
  reference_type?: MovementReference | null;
  reference_id?: string | null;
}

export async function confirmMovement(input: NewMovementInput): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase.rpc("confirm_movement", {
    p_inventory_item_id: input.inventory_item_id,
    p_movement_type: input.movement_type,
    p_to_position_id: input.to_position_id ?? null,
    p_quantity: input.quantity ?? null,
    p_reason: input.reason ?? null,
    p_notes: input.notes ?? null,
    p_reference_type: input.reference_type ?? null,
    p_reference_id: input.reference_id ?? null,
  });
  if (error) throw new Error(`confirmMovement: ${error.message}`);
}

// ── Lectura del ledger ─────────────────────────────────────────────────────

interface WhEmbed { code?: string | null }
interface FloorEmbed { code?: string | null; warehouse?: WhEmbed | WhEmbed[] | null }
interface SectorEmbed { code?: string | null; floor?: FloorEmbed | FloorEmbed[] | null }
interface ZoneEmbed { code?: string | null; sector?: SectorEmbed | SectorEmbed[] | null }
interface RackEmbed { code?: string | null; zone?: ZoneEmbed | ZoneEmbed[] | null }
interface PosEmbed { code?: string | null; rack?: RackEmbed | RackEmbed[] | null }
interface ItemEmbed { sku?: string | null }

interface RawMovement {
  id: string;
  movement_type: string;
  quantity: number | string | null;
  before_quantity: number | string | null;
  after_quantity: number | string | null;
  reason: string | null;
  notes: string | null;
  reference_type: string | null;
  created_at: string;
  item?: ItemEmbed | ItemEmbed[] | null;
  from_position?: PosEmbed | PosEmbed[] | null;
  to_position?: PosEmbed | PosEmbed[] | null;
}

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

const POS_CHAIN =
  `code, rack:warehouse_racks(code, zone:warehouse_zones(code, ` +
  `sector:warehouse_sectors(code, floor:warehouse_floors(code, warehouse:warehouses(code)))))`;

export async function listMovements(): Promise<MovementRow[]> {
  if (isMock()) return MOCK_MOVEMENTS;

  const supabase = createClient();
  if (!supabase) return MOCK_MOVEMENTS;

  const { data, error } = await supabase
    .from("inventory_movements")
    .select(
      `id, movement_type, quantity, before_quantity, after_quantity, reason, notes,
       reference_type, created_at,
       item:inventory_items(sku),
       from_position:warehouse_positions!inventory_movements_from_position_id_fkey(${POS_CHAIN}),
       to_position:warehouse_positions!inventory_movements_to_position_id_fkey(${POS_CHAIN})`
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`listMovements: ${error.message}`);

  return ((data ?? []) as unknown as RawMovement[]).map((m): MovementRow => {
    const item = one(m.item);
    return {
      id: m.id,
      movement_type: m.movement_type as MovementType,
      sku: item?.sku ?? null,
      quantity: Number(m.quantity ?? 0),
      before_quantity: Number(m.before_quantity ?? 0),
      after_quantity: Number(m.after_quantity ?? 0),
      from_full_code: buildFullCode(one(m.from_position)),
      to_full_code: buildFullCode(one(m.to_position)),
      reason: m.reason ?? null,
      notes: m.notes ?? null,
      reference_type: (m.reference_type as MovementReference) ?? null,
      created_at: m.created_at,
    };
  });
}
