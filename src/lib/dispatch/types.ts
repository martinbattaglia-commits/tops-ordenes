/**
 * Tipos de dominio de Despacho + Entrega (GATE 4C).
 *
 * El despacho egresa la mercadería empacada (stock_reserved-- + inventory_lots--
 * FEFO + ledger 'egreso'), avanza empacada→despachada / empacado→despachado /
 * preparado→despachado, y la entrega despachado→entregado (RPC de 0035). Esta
 * capa SOLO lee la cola/panel y envuelve las RPC; las mutaciones van EXCLUSIVAMENTE
 * por RPC SECURITY DEFINER (único camino que toca stock/ledger/estados).
 *
 * UBICACIÓN FÍSICA CANÓNICA: se REUSA `PhysicalLocation` de Picking (Gate 4A),
 * igual que Packing. No se redefine.
 */

import type { LogisticsOrderStatus } from "@/lib/pedidos/types";
import type { PhysicalLocation } from "@/lib/picking/types";

export type { PhysicalLocation } from "@/lib/picking/types";

/** Estado del despacho (espejo de shipment_status_t en 0035). */
export type ShipmentStatus = "despachado" | "entregado" | "anulado";

export const SHIPMENT_STATUS_META: Record<ShipmentStatus, { label: string; color: string }> = {
  despachado: { label: "Despachado", color: "#7c3aed" }, // en tránsito
  entregado: { label: "Entregado", color: "#16a34a" }, // terminal feliz
  anulado: { label: "Anulado", color: "#6b7280" }, // reversión
};

/** Resumen del shipment vigente de un pedido. */
export interface ShipmentRow {
  id: string;
  public_id: string; // 'DSP-2026-0001'
  status: ShipmentStatus;
  carrier: string | null;
  vehicle_ref: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  received_by_name: string | null;
}

/** Fila de la cola de despacho: pedido listo para egresar o ya en tránsito. */
export interface DispatchQueueRow {
  order_id: string;
  public_id: string;
  client_name: string;
  status: LogisticsOrderStatus; // 'preparado' | 'despachado' | 'entregado'
  priority: number;
  requested_date: string | null;
  /** Bultos del pedido (no anulados). */
  total_units: number;
  /** Bultos 'cerrada' (listos para egresar). */
  closed_units: number;
  /** Bultos 'abierta' (bloquean el despacho — D1=A). */
  open_units: number;
  /** true si el pedido puede despacharse (preparado + sin bultos abiertos + ≥1 cerrado). */
  ready: boolean;
  /** Shipment vigente (si ya despachado/entregado). */
  shipment: ShipmentRow | null;
}

/** Un ítem dentro de un bulto a despachar (con su lote previsto y ubicación). */
export interface DispatchItem {
  allocation_id: string;
  order_item_id: string;
  sku: string;
  description: string;
  lot_number: string | null; // lote representativo de la reserva (FEFO real se resuelve al egresar)
  quantity: number;
  location: PhysicalLocation;
}

/** Bulto (packing_unit) con su contenido, en el panel de despacho. */
export interface DispatchUnit {
  id: string;
  public_id: string; // 'BLT-2026-0001'
  status: string; // packing_status: 'cerrada' | 'despachada' | ...
  label: string | null;
  unit_type: string | null;
  item_count: number;
  total_quantity: number;
  items: DispatchItem[];
}

/** Panel de despacho de un pedido: bultos + contenido + shipment vigente. */
export interface DispatchPanel {
  order_id: string;
  public_id: string;
  client_name: string;
  status: LogisticsOrderStatus;
  priority: number;
  shipment: ShipmentRow | null;
  units: DispatchUnit[];
  /** true si todos los bultos no anulados están 'cerrada' (despachable). */
  all_closed: boolean;
  /** Bultos 'abierta' (bloquean despacho). */
  open_units: number;
}
