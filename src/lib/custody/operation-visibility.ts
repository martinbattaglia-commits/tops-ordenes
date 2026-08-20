import "server-only";

import { createAdminClient, createClient } from "@/lib/supabase/server";
import { custodyQrDataUrl, custodyTokenUrl } from "@/lib/custody/qr";
import { parseCanonicalUuid } from "@/lib/custody/canonical-contract";

/**
 * Identidad N2 visible en una pantalla operativa.
 *
 * El token opaco nunca se expone como campo: sólo viaja dentro de la URL/QR
 * que la propia aplicación debe mostrar. Nivel 1 se filtra en el servidor y
 * por eso no puede recibir un badge, un CINT o un QR que no le corresponda.
 */
export interface CustodyOperationalUnit {
  physicalUnitId: string;
  unitPublicId: string;
  inventoryItemId: string;
  custodyLevel: 2;
  caseId: string | null;
  casePublicId: string | null;
  caseState: string | null;
  qrDataUrl: string | null;
  qrUrl: string | null;
}

export interface AllocationCustodyVisibility {
  status: "available" | "unavailable";
  byAllocation: Record<string, CustodyOperationalUnit[]>;
}

export interface InventoryCustodyVisibility {
  status: "available" | "unavailable";
  byInventoryItem: Record<string, CustodyOperationalUnit[]>;
}

interface RawUnit {
  id: string;
  public_id: string;
  inventory_item_id: string;
  custody_level: number | string | null;
}

interface RawCase {
  id: string;
  public_id: string;
  physical_unit_id: string;
  state: string;
}

function ids(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function unavailableAllocation(): AllocationCustodyVisibility {
  return { status: "unavailable", byAllocation: {} };
}

function unavailableInventory(): InventoryCustodyVisibility {
  return { status: "unavailable", byInventoryItem: {} };
}

function caseMap(rows: readonly RawCase[]): Map<string, RawCase> | null {
  const out = new Map<string, RawCase>();
  for (const row of rows) {
    // Una unidad física sólo puede tener un caso productivo. Una respuesta
    // ambigua no se normaliza eligiendo uno: se marca como no verificable.
    if (out.has(row.physical_unit_id)) return null;
    out.set(row.physical_unit_id, row);
  }
  return out;
}

function projectUnit(row: RawUnit, cases: ReadonlyMap<string, RawCase>): CustodyOperationalUnit {
  const integrityCase = cases.get(row.id) ?? null;
  return {
    physicalUnitId: row.id,
    unitPublicId: row.public_id,
    inventoryItemId: row.inventory_item_id,
    custodyLevel: 2,
    caseId: integrityCase?.id ?? null,
    casePublicId: integrityCase?.public_id ?? null,
    caseState: integrityCase?.state ?? null,
    qrDataUrl: null,
    qrUrl: null,
  };
}

/**
 * Obtiene el QR canónico ya asignado por la base. Nunca crea ni sustituye un
 * token: si la RPC no puede resolverlo, devuelve null y la UI no inventa QR.
 */
export async function getCanonicalPhysicalUnitQr(
  physicalUnitId: string,
): Promise<{ dataUrl: string; url: string } | null> {
  try {
    const unitId = parseCanonicalUuid(physicalUnitId);
    if (!unitId) return null;
    const session = createClient();
    if (!session) return null;
    const { data, error } = await session.rpc("get_custody_physical_token", {
      p_physical_unit_id: unitId,
    });
    const token = typeof data === "string" ? parseCanonicalUuid(data) : null;
    if (error || !token) return null;
    return {
      dataUrl: await custodyQrDataUrl(token),
      url: custodyTokenUrl(token),
    };
  } catch {
    return null;
  }
}

/**
 * Allocation -> CPU/CINT, para Picking y Packing.
 *
 * Contención de autorización:
 *  1. allocations visibles por sesión/RLS;
 *  2. puente leído con admin, acotado exactamente a esas allocations;
 *  3. unidades y casos releídos por sesión/RLS.
 *
 * El helper es informativo: no agrega gates a picking/packing. Ante una lectura
 * incompleta devuelve `unavailable` sin rotular mercadería N1 como N2.
 */
export async function getAllocationCustodyVisibility(
  allocationIds: readonly string[],
): Promise<AllocationCustodyVisibility> {
  const requested = ids(allocationIds);
  if (requested.length === 0) return { status: "available", byAllocation: {} };

  try {
    const session = createClient();
    const admin = createAdminClient();
    if (!session || !admin) return unavailableAllocation();

    const { data: visibleRows, error: visibleError } = await session
      .from("stock_allocations")
      .select("id")
      .in("id", requested);
    if (visibleError) return unavailableAllocation();
    const visible = ids(((visibleRows ?? []) as Array<{ id: string }>).map((row) => row.id));
    if (visible.length === 0) return { status: "available", byAllocation: {} };

    const { data: bridgeRows, error: bridgeError } = await admin
      .from("custody_allocation_physical_units")
      .select("allocation_id, physical_unit_id")
      .in("allocation_id", visible);
    if (bridgeError) return unavailableAllocation();
    const bridge = (bridgeRows ?? []) as Array<{ allocation_id: string; physical_unit_id: string }>;
    if (bridge.length === 0) return { status: "available", byAllocation: {} };

    const unitIds = ids(bridge.map((row) => row.physical_unit_id));
    const { data: unitRows, error: unitError } = await session
      .from("custody_physical_units")
      .select("id, public_id, inventory_item_id, custody_level")
      .in("id", unitIds)
      .order("public_id", { ascending: true });
    if (unitError) return unavailableAllocation();
    const units = (unitRows ?? []) as RawUnit[];

    // El admin vio una identidad que la sesión no puede volver a autorizar.
    // No se filtra silenciosamente: toda la proyección queda no verificable.
    if (new Set(units.map((row) => row.id)).size !== unitIds.length) {
      return unavailableAllocation();
    }
    if (units.some((row) => ![1, 2].includes(Number(row.custody_level)))) {
      return unavailableAllocation();
    }

    const n2 = units.filter((row) => Number(row.custody_level) === 2);
    const n2Ids = n2.map((row) => row.id);
    let cases = new Map<string, RawCase>();
    if (n2Ids.length > 0) {
      const { data: caseRows, error: caseError } = await session
        .from("custody_integrity_cases")
        .select("id, public_id, physical_unit_id, state")
        .in("physical_unit_id", n2Ids);
      if (caseError) return unavailableAllocation();
      const mapped = caseMap((caseRows ?? []) as RawCase[]);
      if (!mapped) return unavailableAllocation();
      cases = mapped;
    }

    const byId = new Map(n2.map((row) => [row.id, projectUnit(row, cases)]));
    const byAllocation: Record<string, CustodyOperationalUnit[]> = {};
    for (const allocationId of visible) byAllocation[allocationId] = [];
    for (const row of bridge) {
      if (!byAllocation[row.allocation_id]) continue;
      const unit = byId.get(row.physical_unit_id);
      if (unit && !byAllocation[row.allocation_id].some((item) => item.physicalUnitId === unit.physicalUnitId)) {
        byAllocation[row.allocation_id].push(unit);
      }
    }
    return { status: "available", byAllocation };
  } catch {
    return unavailableAllocation();
  }
}

/** Inventory item -> CPU/CINT/QR N2, siempre por sesión/RLS. */
export async function getInventoryCustodyVisibility(
  inventoryItemIds: readonly string[],
): Promise<InventoryCustodyVisibility> {
  const requested = ids(inventoryItemIds);
  if (requested.length === 0) return { status: "available", byInventoryItem: {} };

  try {
    const session = createClient();
    if (!session) return unavailableInventory();

    const { data: visibleRows, error: visibleError } = await session
      .from("inventory_items")
      .select("id")
      .in("id", requested);
    if (visibleError) return unavailableInventory();
    const visible = ids(((visibleRows ?? []) as Array<{ id: string }>).map((row) => row.id));
    if (visible.length === 0) return { status: "available", byInventoryItem: {} };

    const { data: unitRows, error: unitError } = await session
      .from("custody_physical_units")
      .select("id, public_id, inventory_item_id, custody_level")
      .in("inventory_item_id", visible)
      .order("public_id", { ascending: true });
    if (unitError) return unavailableInventory();
    const units = (unitRows ?? []) as RawUnit[];
    if (units.some((row) => ![1, 2].includes(Number(row.custody_level)))) {
      return unavailableInventory();
    }
    const n2 = units.filter((row) => Number(row.custody_level) === 2);

    let cases = new Map<string, RawCase>();
    if (n2.length > 0) {
      const { data: caseRows, error: caseError } = await session
        .from("custody_integrity_cases")
        .select("id, public_id, physical_unit_id, state")
        .in("physical_unit_id", n2.map((row) => row.id));
      if (caseError) return unavailableInventory();
      const mapped = caseMap((caseRows ?? []) as RawCase[]);
      if (!mapped) return unavailableInventory();
      cases = mapped;
    }

    const byInventoryItem: Record<string, CustodyOperationalUnit[]> = {};
    for (const inventoryItemId of visible) byInventoryItem[inventoryItemId] = [];

    for (const row of n2) {
      byInventoryItem[row.inventory_item_id]?.push(projectUnit(row, cases));
    }

    for (const units of Object.values(byInventoryItem)) {
      units.sort((a, b) => a.unitPublicId.localeCompare(b.unitPublicId));
    }
    return { status: "available", byInventoryItem };
  } catch {
    return unavailableInventory();
  }
}
