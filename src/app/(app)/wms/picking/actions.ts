"use server";

import { revalidatePath } from "next/cache";
import {
  confirmPicking,
  confirmPickingOrder,
  unpickAllocation,
} from "@/lib/picking/picking";

/**
 * Server Actions de Picking (GATE 4A). Cada una envuelve una RPC SECURITY
 * DEFINER de 0032 y revalida las rutas afectadas con revalidatePath().
 *
 * NO usamos router.refresh(): su GET ?_rsc corría en carrera con la
 * revalidación y devolvía 503 (mismo criterio que /pedidos). NO se revalida
 * /wms/inventario: picking NO toca stock.
 */

type Result = { ok: true } | { ok: false; error: string };

function fail(e: unknown): Result {
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

function revalidate(orderId: string): void {
  revalidatePath("/wms/picking");
  revalidatePath(`/wms/picking/${orderId}`);
  // El estado de líneas/pedido cambia → reflejarlo también en Pedidos.
  revalidatePath(`/pedidos/${orderId}`);
  revalidatePath("/pedidos");
}

/** Confirma el picking de UNA parada: reservada → pickeada. */
export async function confirmPickingAction(
  allocationId: string,
  orderId: string
): Promise<Result> {
  try {
    await confirmPicking(allocationId);
    revalidate(orderId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Pickea el pedido completo: todas las paradas 'reservada'. */
export async function confirmPickingOrderAction(orderId: string): Promise<Result> {
  try {
    await confirmPickingOrder(orderId);
    revalidate(orderId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Deshace el picking de UNA parada: pickeada → reservada. */
export async function unpickAllocationAction(
  allocationId: string,
  orderId: string
): Promise<Result> {
  try {
    await unpickAllocation(allocationId);
    revalidate(orderId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
