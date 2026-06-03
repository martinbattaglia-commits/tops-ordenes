/**
 * Tipos de dominio de Pedidos Logísticos (FASE 9B).
 * Cabecera + líneas + reservas (stock_allocations). El stock se reserva vía RPC
 * (allocate_order / release_allocation / cancel_order). Espejo de los enums de
 * 0030_logistics_orders.sql.
 */

export type LogisticsOrderStatus =
  | "borrador"
  | "pendiente"
  | "en_preparacion"
  | "preparado"
  | "despachado"
  | "entregado"
  | "cancelado";

export type OrderItemStatus =
  | "pendiente"
  | "reservado"
  | "reservado_parcial"
  | "pickeado"
  | "empacado"
  | "despachado"
  | "cancelado";

export type AllocStatus = "reservada" | "pickeada" | "empacada" | "despachada" | "liberada";

export const ORDER_STATUS_META: Record<LogisticsOrderStatus, { label: string; color: string }> = {
  borrador: { label: "Borrador", color: "#6b7280" },
  pendiente: { label: "Pendiente", color: "#d97706" },
  en_preparacion: { label: "En preparación", color: "#2563eb" },
  preparado: { label: "Preparado", color: "#0d9488" },
  despachado: { label: "Despachado", color: "#7c3aed" },
  entregado: { label: "Entregado", color: "#16a34a" },
  cancelado: { label: "Cancelado", color: "#dc2626" },
};

export const ORDER_ITEM_STATUS_META: Record<OrderItemStatus, { label: string; color: string }> = {
  pendiente: { label: "Pendiente", color: "#d97706" },
  reservado: { label: "Reservado", color: "#16a34a" },
  reservado_parcial: { label: "Reservado parcial", color: "#ea580c" },
  pickeado: { label: "Pickeado", color: "#2563eb" },
  empacado: { label: "Empacado", color: "#0d9488" },
  despachado: { label: "Despachado", color: "#7c3aed" },
  cancelado: { label: "Cancelado", color: "#dc2626" },
};

export interface OrderRow {
  id: string;
  public_id: string;
  client_name: string;
  customer_ref: string | null;
  status: LogisticsOrderStatus;
  priority: number;
  requested_date: string | null;
  notes: string | null;
  created_at: string;
  /** Total de líneas. */
  item_count: number;
  /** Líneas con reserva total. */
  reserved_count: number;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  sku: string;
  description: string;
  quantity_requested: number;
  lot_constraint: string | null;
  status: OrderItemStatus;
  created_at: string;
  /** Σ de reservas activas de la línea (derivado). */
  quantity_allocated: number;
}

export interface AllocationRow {
  id: string;
  order_item_id: string;
  inventory_item_id: string;
  lot_number: string | null;
  quantity: number;
  status: AllocStatus;
  reserved_at: string;
  released_at: string | null;
}

export interface OrderDetail {
  order: OrderRow;
  items: OrderItemRow[];
}

export interface NewOrderInput {
  client_name: string;
  customer_ref?: string | null;
  priority?: number;
  requested_date?: string | null;
  notes?: string | null;
}

export interface NewOrderItemInput {
  order_id: string;
  sku: string;
  description: string;
  quantity_requested: number;
  lot_constraint?: string | null;
}
