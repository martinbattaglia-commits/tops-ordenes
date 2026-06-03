import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type {
  OrderRow,
  OrderItemRow,
  OrderDetail,
  LogisticsOrderStatus,
  OrderItemStatus,
  NewOrderInput,
  NewOrderItemInput,
} from "./types";

/**
 * CRUD de Pedidos Logísticos (FASE 9B). El alta de cabecera/líneas son inserts
 * directos (logistics_orders / logistics_order_items siguen escribibles por rol).
 * La RESERVA de stock va EXCLUSIVAMENTE por RPC (ver allocations.ts) — acá NO se
 * toca stock. Mismo patrón demo/Supabase que src/lib/wms/*.
 */

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

const MOCK_ORDERS: OrderRow[] = [
  {
    id: "ped-1", public_id: "PED-2026-0001", client_name: "Lab. Andrómaco",
    customer_ref: "OC-CLI-8841", status: "en_preparacion", priority: 0,
    requested_date: "2026-06-05", notes: null, created_at: "2026-06-02T09:00:00Z",
    item_count: 2, reserved_count: 1,
  },
  {
    id: "ped-2", public_id: "PED-2026-0002", client_name: "Farma Sur",
    customer_ref: null, status: "pendiente", priority: 0,
    requested_date: null, notes: null, created_at: "2026-06-02T10:30:00Z",
    item_count: 1, reserved_count: 0,
  },
];

interface RawItem { status: string; quantity_requested: number | string | null }
interface RawOrder {
  id: string; public_id: string; client_name: string; customer_ref: string | null;
  status: string; priority: number | null; requested_date: string | null;
  notes: string | null; created_at: string;
  logistics_order_items?: RawItem[] | null;
}

export async function listOrders(): Promise<OrderRow[]> {
  if (isMock()) return MOCK_ORDERS;

  const supabase = createClient();
  if (!supabase) return MOCK_ORDERS;

  const { data, error } = await supabase
    .from("logistics_orders")
    .select(
      `id, public_id, client_name, customer_ref, status, priority, requested_date,
       notes, created_at, logistics_order_items(status, quantity_requested)`
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listOrders: ${error.message}`);

  return ((data ?? []) as unknown as RawOrder[]).map((o): OrderRow => {
    const items = Array.isArray(o.logistics_order_items) ? o.logistics_order_items : [];
    return {
      id: o.id,
      public_id: o.public_id,
      client_name: o.client_name,
      customer_ref: o.customer_ref ?? null,
      status: o.status as LogisticsOrderStatus,
      priority: o.priority ?? 0,
      requested_date: o.requested_date ?? null,
      notes: o.notes ?? null,
      created_at: o.created_at,
      item_count: items.length,
      reserved_count: items.filter((i) => i.status === "reservado").length,
    };
  });
}

const MOCK_ITEMS: Record<string, OrderItemRow[]> = {
  "ped-1": [
    {
      id: "it-1", order_id: "ped-1", sku: "AMX-500", description: "Amoxicilina 500mg x100",
      quantity_requested: 100, lot_constraint: null, status: "reservado",
      created_at: "2026-06-02T09:00:00Z", quantity_allocated: 100,
    },
    {
      id: "it-2", order_id: "ped-1", sku: "VIT-C", description: "Vitamina C 1g",
      quantity_requested: 50, lot_constraint: null, status: "reservado_parcial",
      created_at: "2026-06-02T09:00:05Z", quantity_allocated: 20,
    },
  ],
};

export async function getOrder(id: string): Promise<OrderDetail | null> {
  if (isMock()) {
    const order = MOCK_ORDERS.find((o) => o.id === id);
    return order ? { order, items: MOCK_ITEMS[id] ?? [] } : null;
  }

  const supabase = createClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("logistics_orders")
    .select(
      `id, public_id, client_name, customer_ref, status, priority, requested_date, notes, created_at,
       logistics_order_items(id, order_id, sku, description, quantity_requested, lot_constraint, status, created_at,
         stock_allocations(quantity, status))`
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getOrder: ${error.message}`);
  if (!data) return null;

  interface RawItemFull {
    id: string; order_id: string; sku: string; description: string;
    quantity_requested: number | string | null; lot_constraint: string | null;
    status: string; created_at: string;
    stock_allocations?: { quantity: number | string | null; status: string }[] | null;
  }
  interface RawOrderFull {
    id: string; public_id: string; client_name: string; customer_ref: string | null;
    status: string; priority: number | null; requested_date: string | null;
    notes: string | null; created_at: string;
    logistics_order_items?: RawItemFull[] | null;
  }
  const raw = data as unknown as RawOrderFull;
  const rawItems = Array.isArray(raw.logistics_order_items) ? raw.logistics_order_items : [];

  const items: OrderItemRow[] = rawItems.map((it) => {
    const allocs = Array.isArray(it.stock_allocations) ? it.stock_allocations : [];
    const quantity_allocated = allocs
      .filter((a) => a.status === "reservada")
      .reduce((s, a) => s + Number(a.quantity ?? 0), 0);
    return {
      id: it.id,
      order_id: it.order_id,
      sku: it.sku,
      description: it.description,
      quantity_requested: Number(it.quantity_requested ?? 0),
      lot_constraint: it.lot_constraint ?? null,
      status: it.status as OrderItemStatus,
      created_at: it.created_at,
      quantity_allocated,
    };
  });

  const order: OrderRow = {
    id: raw.id,
    public_id: raw.public_id,
    client_name: raw.client_name,
    customer_ref: raw.customer_ref ?? null,
    status: raw.status as LogisticsOrderStatus,
    priority: raw.priority ?? 0,
    requested_date: raw.requested_date ?? null,
    notes: raw.notes ?? null,
    created_at: raw.created_at,
    item_count: items.length,
    reserved_count: items.filter((i) => i.status === "reservado").length,
  };
  return { order, items };
}

// ── Alta de cabecera y líneas (inserts directos — NO tocan stock) ─────────

export async function createOrder(input: NewOrderInput): Promise<string> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { data, error } = await supabase
    .from("logistics_orders")
    .insert({
      client_name: input.client_name,
      customer_ref: input.customer_ref ?? null,
      priority: input.priority ?? 0,
      requested_date: input.requested_date ?? null,
      notes: input.notes ?? null,
      status: "borrador",
    })
    .select("id")
    .single();
  if (error) throw new Error(`createOrder: ${error.message}`);
  return (data as { id: string }).id;
}

export async function addOrderItem(item: NewOrderItemInput): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase.from("logistics_order_items").insert({
    order_id: item.order_id,
    sku: item.sku,
    description: item.description,
    quantity_requested: item.quantity_requested,
    lot_constraint: item.lot_constraint ?? null,
    status: "pendiente",
  });
  if (error) throw new Error(`addOrderItem: ${error.message}`);
}

/** borrador → pendiente (pedido cargado, listo para reservar). */
export async function submitOrder(id: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase
    .from("logistics_orders")
    .update({ status: "pendiente" })
    .eq("id", id)
    .eq("status", "borrador");
  if (error) throw new Error(`submitOrder: ${error.message}`);
}

// ── Edición de borrador (UPDATE/DELETE directos — solo mientras status='borrador') ──
// Sin SQL ni tablas nuevas: writes permitidos por las RLS de 0030. La guarda de
// estado 'borrador' la aplica el .eq(...) y la UI (solo muestra edición en borrador).

export interface UpdateOrderInput {
  client_name?: string;
  customer_ref?: string | null;
  priority?: number;
  requested_date?: string | null;
  notes?: string | null;
}

export async function updateOrder(id: string, patch: UpdateOrderInput): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase
    .from("logistics_orders")
    .update(patch)
    .eq("id", id)
    .eq("status", "borrador");
  if (error) throw new Error(`updateOrder: ${error.message}`);
}

export interface UpdateOrderItemInput {
  sku?: string;
  description?: string;
  quantity_requested?: number;
  lot_constraint?: string | null;
}

export async function updateOrderItem(itemId: string, patch: UpdateOrderItemInput): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase
    .from("logistics_order_items")
    .update(patch)
    .eq("id", itemId)
    .eq("status", "pendiente"); // líneas aún no reservadas
  if (error) throw new Error(`updateOrderItem: ${error.message}`);
}

export async function deleteOrderItem(itemId: string): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase
    .from("logistics_order_items")
    .delete()
    .eq("id", itemId)
    .eq("status", "pendiente");
  if (error) throw new Error(`deleteOrderItem: ${error.message}`);
}
