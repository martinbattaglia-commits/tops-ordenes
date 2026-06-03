"use server";

import { revalidatePath } from "next/cache";
import {
  createPackingUnit,
  packAllocation,
  unpackAllocation,
  closePackingUnit,
  reopenPackingUnit,
  confirmPackingOrder,
} from "@/lib/packing/packing";

/**
 * Server Actions de Packing (GATE 4B). Cada una envuelve una RPC SECURITY
 * DEFINER de 0033 y revalida las rutas afectadas con revalidatePath().
 *
 * NO usamos router.refresh() (carrera ?_rsc → 503, criterio de 4A). NO se
 * revalida /wms/inventario: packing NO toca stock. Sí se revalida picking,
 * porque packing consume reservas 'pickeada' (cambia su cola/ruta).
 */

type Result = { ok: true; id?: string } | { ok: false; error: string };

function fail(e: unknown): Result {
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

function revalidate(orderId: string): void {
  revalidatePath("/wms/packing");
  revalidatePath(`/wms/packing/${orderId}`);
  revalidatePath("/wms/picking");
  revalidatePath(`/wms/picking/${orderId}`);
  revalidatePath(`/pedidos/${orderId}`);
  revalidatePath("/pedidos");
}

/** Abre un bulto. Devuelve su id para encadenar el empaque. */
export async function createPackingUnitAction(
  orderId: string,
  label?: string | null
): Promise<Result> {
  try {
    const id = await createPackingUnit(orderId, label ?? null, null);
    revalidate(orderId);
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function packAllocationAction(
  packingUnitId: string,
  allocationId: string,
  orderId: string
): Promise<Result> {
  try {
    await packAllocation(packingUnitId, allocationId);
    revalidate(orderId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function unpackAllocationAction(allocationId: string, orderId: string): Promise<Result> {
  try {
    await unpackAllocation(allocationId);
    revalidate(orderId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function closePackingUnitAction(packingUnitId: string, orderId: string): Promise<Result> {
  try {
    await closePackingUnit(packingUnitId);
    revalidate(orderId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function reopenPackingUnitAction(packingUnitId: string, orderId: string): Promise<Result> {
  try {
    await reopenPackingUnit(packingUnitId);
    revalidate(orderId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function confirmPackingOrderAction(orderId: string): Promise<Result> {
  try {
    await confirmPackingOrder(orderId);
    revalidate(orderId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
