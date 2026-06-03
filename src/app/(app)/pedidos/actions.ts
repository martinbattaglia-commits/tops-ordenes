"use server";

import { revalidatePath } from "next/cache";
import {
  createOrder,
  addOrderItem,
  submitOrder,
  updateOrder,
  updateOrderItem,
  deleteOrderItem,
  type UpdateOrderInput,
  type UpdateOrderItemInput,
} from "@/lib/pedidos/orders";
import type { NewOrderInput } from "@/lib/pedidos/types";
import { allocateOrder, releaseAllocation, cancelOrder } from "@/lib/pedidos/allocations";

type Result = { ok: true; id?: string } | { ok: false; error: string };

function fail(e: unknown): Result {
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

export interface OrderItemPayload {
  sku: string;
  description: string;
  quantity_requested: number;
  lot_constraint?: string | null;
}

export interface CreateOrderPayload {
  header: NewOrderInput;
  items: OrderItemPayload[];
}

/** Crea cabecera + líneas. Queda en 'borrador' (NO se envía). Devuelve el id. */
export async function createOrderFull(payload: CreateOrderPayload): Promise<Result> {
  try {
    const id = await createOrder(payload.header);
    for (const it of payload.items) {
      await addOrderItem({ order_id: id, ...it });
    }
    revalidatePath("/pedidos");
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function submitOrderAction(id: string): Promise<Result> {
  try {
    await submitOrder(id);
    revalidatePath("/pedidos");
    revalidatePath(`/pedidos/${id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function allocateOrderAction(id: string): Promise<Result> {
  try {
    await allocateOrder(id);
    revalidatePath("/pedidos");
    revalidatePath(`/pedidos/${id}`);
    revalidatePath("/wms/inventario");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function releaseAllocationAction(allocationId: string, orderId: string): Promise<Result> {
  try {
    await releaseAllocation(allocationId);
    revalidatePath(`/pedidos/${orderId}`);
    revalidatePath("/wms/inventario");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelOrderAction(id: string): Promise<Result> {
  try {
    await cancelOrder(id);
    revalidatePath("/pedidos");
    revalidatePath(`/pedidos/${id}`);
    revalidatePath("/wms/inventario");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ── Edición de borrador ───────────────────────────────────────────────────

export async function updateOrderAction(id: string, patch: UpdateOrderInput): Promise<Result> {
  try {
    await updateOrder(id, patch);
    revalidatePath(`/pedidos/${id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function addOrderItemAction(orderId: string, item: OrderItemPayload): Promise<Result> {
  try {
    await addOrderItem({ order_id: orderId, ...item });
    revalidatePath(`/pedidos/${orderId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function updateOrderItemAction(
  itemId: string,
  orderId: string,
  patch: UpdateOrderItemInput
): Promise<Result> {
  try {
    await updateOrderItem(itemId, patch);
    revalidatePath(`/pedidos/${orderId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteOrderItemAction(itemId: string, orderId: string): Promise<Result> {
  try {
    await deleteOrderItem(itemId);
    revalidatePath(`/pedidos/${orderId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
