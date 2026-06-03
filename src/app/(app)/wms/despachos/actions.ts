"use server";

import { revalidatePath } from "next/cache";
import { confirmDispatch, confirmDelivery, revertDispatch } from "@/lib/dispatch/dispatch";

/**
 * Server Actions de Despacho + Entrega (GATE 4C). Cada una envuelve una RPC
 * SECURITY DEFINER de 0035 y revalida las rutas afectadas con revalidatePath().
 *
 * NO usamos router.refresh() (carrera ?_rsc → 503, criterio de 4A/4B).
 * A DIFERENCIA de Packing, el DESPACHO SÍ TOCA STOCK (stock_reserved-- +
 * inventory_lots-- + ledger), por lo que TAMBIÉN revalidamos inventario/lotes/
 * vencimientos además de packing y pedidos.
 */

type Result = { ok: true; id?: string } | { ok: false; error: string };

function fail(e: unknown): Result {
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

function revalidate(orderId: string): void {
  revalidatePath("/wms/despachos");
  revalidatePath(`/wms/despachos/${orderId}`);
  revalidatePath("/wms/packing");
  revalidatePath(`/wms/packing/${orderId}`);
  revalidatePath(`/pedidos/${orderId}`);
  revalidatePath("/pedidos");
  // El despacho mueve stock: refrescar las vistas de inventario.
  revalidatePath("/wms/inventario");
  revalidatePath("/wms/lotes");
  revalidatePath("/wms/vencimientos");
}

/** Despacha un pedido preparado (EGRESO irreversible). Devuelve el shipment id. */
export async function confirmDispatchAction(orderId: string): Promise<Result> {
  try {
    const id = await confirmDispatch(orderId);
    revalidate(orderId);
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

/** Marca un despacho como entregado. */
export async function confirmDeliveryAction(
  shipmentId: string,
  orderId: string,
  receivedBy?: string | null
): Promise<Result> {
  try {
    await confirmDelivery(shipmentId, receivedBy ?? null);
    revalidate(orderId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Revierte un despacho no entregado (reingreso compensatorio). */
export async function revertDispatchAction(shipmentId: string, orderId: string): Promise<Result> {
  try {
    await revertDispatch(shipmentId);
    revalidate(orderId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
