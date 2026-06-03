import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { AllocationRow, AllocStatus } from "./types";

/**
 * Reservas de stock (FASE 9B). Las mutaciones van EXCLUSIVAMENTE por las RPC
 * transaccionales de 0031 (allocate_order / release_allocation / cancel_order),
 * único camino que toca stock_available/stock_reserved y stock_allocations.
 * `listAllocations` lee el ledger de reservas.
 */

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

/**
 * Reserva FEFO (parcial habilitada) de todas las líneas pendientes/parciales del
 * pedido. Idempotente. Solo desde estados 'pendiente'/'en_preparacion'.
 */
export async function allocateOrder(orderId: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase.rpc("allocate_order", { p_order_id: orderId });
  if (error) throw new Error(`allocateOrder: ${error.message}`);
}

/** Libera una reserva puntual: stock_reserved → stock_available. */
export async function releaseAllocation(allocationId: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase.rpc("release_allocation", { p_allocation_id: allocationId });
  if (error) throw new Error(`releaseAllocation: ${error.message}`);
}

/** Cancela el pedido y libera todas sus reservas activas. */
export async function cancelOrder(orderId: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase.rpc("cancel_order", { p_order_id: orderId });
  if (error) throw new Error(`cancelOrder: ${error.message}`);
}

interface RawAllocation {
  id: string;
  order_item_id: string;
  inventory_item_id: string;
  lot_number: string | null;
  quantity: number | string | null;
  status: string;
  reserved_at: string;
  released_at: string | null;
}

const MOCK_ALLOCATIONS: Record<string, AllocationRow[]> = {
  "ped-1": [
    {
      id: "al-1", order_item_id: "it-1", inventory_item_id: "inv-amx", lot_number: "L-2026-0042",
      quantity: 100, status: "reservada", reserved_at: "2026-06-02T09:05:00Z", released_at: null,
    },
    {
      id: "al-2", order_item_id: "it-2", inventory_item_id: "inv-vit", lot_number: "L-2025-7781",
      quantity: 20, status: "reservada", reserved_at: "2026-06-02T09:06:00Z", released_at: null,
    },
  ],
};

/** Lee las reservas de un pedido (join por sus líneas). */
export async function listAllocations(orderId: string): Promise<AllocationRow[]> {
  if (isMock()) return MOCK_ALLOCATIONS[orderId] ?? [];

  const supabase = createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("stock_allocations")
    .select(
      `id, order_item_id, inventory_item_id, lot_number, quantity, status, reserved_at, released_at,
       logistics_order_items!inner(order_id)`
    )
    .eq("logistics_order_items.order_id", orderId)
    .order("reserved_at", { ascending: true });
  if (error) throw new Error(`listAllocations: ${error.message}`);

  return ((data ?? []) as unknown as RawAllocation[]).map((a): AllocationRow => ({
    id: a.id,
    order_item_id: a.order_item_id,
    inventory_item_id: a.inventory_item_id,
    lot_number: a.lot_number ?? null,
    quantity: Number(a.quantity ?? 0),
    status: a.status as AllocStatus,
    reserved_at: a.reserved_at,
    released_at: a.released_at ?? null,
  }));
}
