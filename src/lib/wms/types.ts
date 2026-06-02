/**
 * Tipos de dominio del WMS (FASE 5 · Sprint 1).
 * Inventario de terceros + KPIs de ocupación contra el Digital Twin.
 */

export type PositionStatus = "disponible" | "reservado" | "ocupado" | "mantenimiento";

export const POSITION_STATUS_META: Record<PositionStatus, { label: string; color: string }> = {
  disponible: { label: "Disponible", color: "#16a34a" }, // verde
  reservado: { label: "Reservado", color: "#d97706" }, // amarillo
  ocupado: { label: "Ocupado", color: "#dc2626" }, // rojo
  mantenimiento: { label: "Mantenimiento", color: "#6b7280" }, // gris
};

export interface WmsKpis {
  /** Suma de stock disponible de todos los ítems activos. */
  stockTotal: number;
  /** Clientes (depositantes) distintos con stock activo. */
  clientesActivos: number;
  /** Posiciones físicas con stock asignado. */
  posicionesOcupadas: number;
  /** Posiciones físicas libres (total − ocupadas). */
  posicionesDisponibles: number;
  /** Total de posiciones del Digital Twin. */
  posicionesTotal: number;
}

export interface InventoryRow {
  id: string;
  sku: string;
  description: string;
  client_name: string;
  stock_available: number;
  stock_reserved: number;
  /** Lote representativo (primero del ítem); null si no tiene lotes. */
  lot_number: string | null;
  /** Vencimiento más próximo entre los lotes del ítem. */
  expiration_date: string | null;
  /** Cantidad de lotes asociados al ítem. */
  lot_count: number;
  position_id: string | null;
  /** Ruta física legible: 'PEDRO_LUJAN_3159·P1·D7·MC·A·C01'. */
  position_full_code: string | null;
}
