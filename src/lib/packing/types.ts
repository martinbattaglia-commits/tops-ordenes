/**
 * Tipos de dominio de Packing (GATE 4B).
 *
 * El packing consolida reservas 'pickeada' en bultos (packing_units) y avanza
 * pickeada→empacada / pickeado→empacado / en_preparacion→preparado (RPC 0033).
 * Esta capa SOLO lee la cola/tablero y envuelve las RPC; NO toca stock.
 *
 * UBICACIÓN FÍSICA CANÓNICA: se REUSA `PhysicalLocation` de Picking (Gate 4A) —
 * misma jerarquía depósito → piso → sector → zona/pasillo → rack → nivel →
 * posición. No se redefine; se importa la entidad canónica ya validada.
 */

import type { LogisticsOrderStatus, AllocStatus } from "@/lib/pedidos/types";
import type { PhysicalLocation } from "@/lib/picking/types";

export type { PhysicalLocation } from "@/lib/picking/types";

/** Estado del bulto (espejo de packing_status_t en 0033). */
export type PackingStatus = "abierta" | "cerrada" | "despachada" | "anulada";

export const PACKING_STATUS_META: Record<PackingStatus, { label: string; color: string }> = {
  abierta: { label: "Abierta", color: "#ea580c" }, // armando
  cerrada: { label: "Cerrada", color: "#0d9488" }, // sellada
  despachada: { label: "Despachada", color: "#7c3aed" }, // Gate 4C
  anulada: { label: "Anulada", color: "#6b7280" },
};

/** Fila de la cola de packing: pedido con líneas pickeadas listas para empacar. */
export interface PackQueueRow {
  order_id: string;
  public_id: string;
  client_name: string;
  status: LogisticsOrderStatus; // 'en_preparacion' | 'preparado'
  priority: number;
  requested_date: string | null;
  line_count: number;
  /** Líneas 'pickeado' aún por empacar. */
  pending_lines: number;
  /** Líneas 'empacado'. */
  packed_lines: number;
  /** Reservas 'pickeada' por empacar (paradas de armado). */
  pending_stops: number;
  /** Bultos 'abierta' del pedido (D2: oculta "Empacar todo" si > 0). */
  open_units: number;
  /** true si el pedido quedó 'preparado' (todo empacado). */
  fully_packed: boolean;
}

/** Una reserva 'pickeada' disponible para empacar (parada de armado). */
export interface PackStop {
  allocation_id: string;
  status: AllocStatus; // 'pickeada'
  order_item_id: string;
  sku: string;
  description: string;
  lot_number: string | null;
  quantity: number;
  inventory_item_id: string;
  location: PhysicalLocation;
}

/** Contenido de un bulto: una reserva ya empacada dentro de la unidad. */
export interface PackingUnitItem {
  allocation_id: string;
  /** Línea del pedido (D1: KPIs por línea en el tablero). */
  order_item_id: string;
  sku: string;
  description: string;
  lot_number: string | null;
  quantity: number;
  location: PhysicalLocation;
}

/** Bulto (packing_unit) con su contenido. */
export interface PackingUnitRow {
  id: string;
  public_id: string; // 'BLT-2026-0001'
  status: PackingStatus;
  label: string | null;
  unit_type: string | null;
  item_count: number;
  total_quantity: number;
  items: PackingUnitItem[];
}

/** Tablero de armado de un pedido: paradas pendientes + bultos. */
export interface PackBoard {
  order_id: string;
  public_id: string;
  client_name: string;
  status: LogisticsOrderStatus;
  priority: number;
  /** Reservas 'pickeada' aún sin empacar, ordenadas por ubicación física. */
  pending_stops: PackStop[];
  /** Bultos del pedido (abierta/cerrada) con su contenido. */
  units: PackingUnitRow[];
}
