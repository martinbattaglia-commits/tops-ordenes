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

// ── WMS Sprint 2: Recepciones y Movimientos ────────────────────────────────

export type BusinessUnit = "ANMAT" | "GENERAL" | "CORPORATE";

export type ReceptionStatus =
  | "borrador"
  | "pendiente"
  | "en_recepcion"
  | "cuarentena"
  | "recibida"
  | "anulada";

export type ReceptionItemStatus = "pendiente" | "recibido" | "cuarentena";

export type MovementType = "ingreso" | "traslado" | "egreso" | "ajuste";

export type MovementReference = "recepcion" | "movimiento" | "ajuste" | "despacho";

export const RECEPTION_STATUS_META: Record<ReceptionStatus, { label: string; color: string }> = {
  borrador: { label: "Borrador", color: "#6b7280" },
  pendiente: { label: "Pendiente", color: "#d97706" },
  en_recepcion: { label: "En recepción", color: "#2563eb" },
  cuarentena: { label: "Cuarentena", color: "#7c3aed" },
  recibida: { label: "Recibida", color: "#16a34a" },
  anulada: { label: "Anulada", color: "#dc2626" },
};

export interface ReceptionRow {
  id: string;
  public_id: string;
  client_name: string;
  business_unit: BusinessUnit;
  status: ReceptionStatus;
  numero_oc: string | null;
  numero_remito: string | null;
  transportista: string | null;
  patente: string | null;
  chofer: string | null;
  /** Decisión operativa: ingresa a cuarentena (stock_reserved) al confirmar. */
  requires_quarantine: boolean;
  received_at: string | null;
  created_at: string;
  /** Total de líneas. */
  item_count: number;
  /** Líneas ya recibidas (para derivar "parcial"). */
  received_count: number;
}

export interface PositionOption {
  id: string;
  full_code: string;
  status: PositionStatus;
}

export interface MovementRow {
  id: string;
  movement_type: MovementType;
  sku: string | null;
  quantity: number;
  before_quantity: number;
  after_quantity: number;
  from_full_code: string | null;
  to_full_code: string | null;
  reason: string | null;
  notes: string | null;
  reference_type: MovementReference | null;
  created_at: string;
}

// ── WMS FASE 9A: Lotes y Vencimientos ──────────────────────────────────────
// Base canónica de LECTURA reutilizable. Pensada para que las fases futuras
// (Pedidos · stock_allocations · Picking · Packing · Despachos) consuman la
// MISMA forma y el MISMO orden FEFO sin refactor posterior. Sin escrituras.

/** Estado simple para la pantalla de Lotes. */
export type LotEstado = "activo" | "vencido";

/** Semáforo ANMAT por días restantes hasta el vencimiento. */
export type ExpiryStatus = "vencido" | "rojo" | "naranja" | "amarillo" | "verde";

/** Umbrales del semáforo (en días). Overridables por query param ANMAT. */
export interface ExpiryThresholds {
  rojo: number; // 0..<rojo        → rojo (crítico)
  naranja: number; // rojo..<naranja  → naranja (próximo)
  amarillo: number; // naranja..<=amarillo → amarillo; > amarillo → verde
}

export const EXPIRY_THRESHOLDS: ExpiryThresholds = { rojo: 30, naranja: 90, amarillo: 180 };

export const EXPIRY_STATUS_META: Record<
  ExpiryStatus,
  { label: string; color: string; rango: string }
> = {
  vencido: { label: "Vencido", color: "#374151", rango: "vencido" },
  rojo: { label: "Crítico", color: "#dc2626", rango: "< 30 días" },
  naranja: { label: "Próximo", color: "#ea580c", rango: "30–90 días" },
  amarillo: { label: "A vigilar", color: "#d97706", rango: "90–180 días" },
  verde: { label: "Vigente", color: "#16a34a", rango: "> 180 días" },
};

/**
 * Fila canónica: 1 por lote, joineada a su inventory_item + posición física.
 * Incluye position_id + position_full_code para integración con el Digital Twin
 * y la futura visualización gráfica de depósitos.
 */
export interface LotInventoryRow {
  // Identidad (reuso futuro: FEFO allocate, picking por lote)
  inventory_item_id: string;
  lot_id: string;
  // Descriptivos
  client_name: string;
  sku: string;
  description: string;
  lot_number: string;
  expiration_date: string | null;
  quantity: number;
  // Ubicación física (Digital Twin)
  position_id: string | null;
  position_full_code: string | null;
  // Derivados
  days_left: number | null;
  estado: LotEstado;
  expiry_status: ExpiryStatus | null;
}

export interface ExpiryKpis {
  /** Lotes en el scope actual (tras filtros). */
  totalLotes: number;
  /** No vencidos dentro de la ventana de vigilancia (rojo+naranja+amarillo). */
  proximosAVencer: number;
  /** Lotes ya vencidos. */
  vencidos: number;
  /** Clientes distintos con ≥1 lote vencido o próximo a vencer. */
  clientesAfectados: number;
  /** Σ quantity de lotes vencidos o próximos a vencer. */
  unidadesComprometidas: number;
}

/**
 * Días desde `today` hasta `expiration` (negativo = vencido). null si sin venc.
 * `today` (YYYY-MM-DD, UTC del día) se inyecta desde el server → función PURA.
 */
export function computeDaysLeft(expiration: string | null, today: string): number | null {
  if (!expiration) return null;
  const exp = Date.parse(`${expiration.slice(0, 10)}T00:00:00Z`);
  const now = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(exp) || Number.isNaN(now)) return null;
  return Math.round((exp - now) / 86_400_000);
}

/** Mapea días restantes → estado del semáforo. null si el lote no tiene venc. */
export function computeExpiryStatus(
  daysLeft: number | null,
  t: ExpiryThresholds = EXPIRY_THRESHOLDS
): ExpiryStatus | null {
  if (daysLeft == null) return null;
  if (daysLeft < 0) return "vencido";
  if (daysLeft < t.rojo) return "rojo";
  if (daysLeft < t.naranja) return "naranja";
  if (daysLeft <= t.amarillo) return "amarillo";
  return "verde";
}
