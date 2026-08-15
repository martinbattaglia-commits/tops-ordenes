/**
 * Tipos del dominio TOPS Órdenes de Servicio (OS) — módulo legacy.
 * Alineados con el schema Supabase de `supabase/migrations` 0001-0007.
 *
 * Para tipos del módulo Órdenes de Compra (OC), ver `src/lib/types-po.ts`.
 */

export type Depot = "MAGALDI" | "LUJAN";

export type OrderStatus =
  | "BORRADOR"
  | "PENDIENTE_FIRMA"
  | "EN_CURSO"
  | "FIRMADA"
  | "FACTURADA"
  | "CANCELADA"
  | "OBSERVADA";

export type ServiceUnit = "hs" | "km" | "pal" | "mes" | "un" | "m3" | "m2" | "viaje";

/** Categorías visuales del wizard de servicios. */
export type ServiceCategory =
  | "personal"
  | "especial"
  | "carga"
  | "desconsolidado"
  | "admin"
  | "almacenamiento"
  | "coworking"
  | "transporte";

export type UserRole = "admin" | "operaciones" | "supervisor" | "cliente";

export interface Client {
  id: string;
  razon: string;
  cuit: string;
  domicilio: string | null;
  telefono: string | null;
  contacto: string | null;
  email: string | null;
  tags: string[];
  nombre_comercial?: string | null;
  codigo?: string | null;
  observaciones?: string | null;
  created_at: string;
  // Campos fiscales/operativos (migs 0004/0011) — opcionales en TS (no en todos los mocks).
  condicion_iva?: import("./invoicing/types").CondicionIva | null;
  tipo_doc?: number | null;
  localidad?: string | null;
  deposito_asignado?: Depot | null;
  activo?: boolean | null;
  updated_at?: string | null;
  updated_by?: string | null;
  /** Imputación contable por defecto (código de chart_of_accounts, mig 0121). */
  cuenta_contable?: string | null;
}

export interface ServiceCatalogItem {
  id: string;
  slug: string;
  label: string;
  unit: ServiceUnit;
  /** `null` es A COTIZAR. Cero nunca representa una tarifa. */
  rate: number | null;
  min_qty?: number;
  min_billing?: number;
  /** `true` significa que no hay tarifa general: requiere precio particular. */
  requires_quote?: boolean;
  /** Identidad de la tarifa versionada que se congelara al emitir. */
  tariff_rate_id?: string;
  tariff_version_id?: string;
  client_rate_id?: string | null;
  observ?: string;
  category?: ServiceCategory | string;
  icon?: string | null;
  active: boolean;
}

export interface Operator {
  id: string;
  full_name: string;
  role: string;
  avatar: string | null;
  depot: Depot | null;
}

export interface OrderService {
  id?: string;
  service_slug: string;
  label: string;
  qty: number;
  unit: ServiceUnit;
  rate: number;
  subtotal: number;
  currency_snapshot?: "ARS" | "USD";
  tariff_rate_id?: string | null;
  client_rate_id?: string | null;
  price_source?: "legacy" | "general_tariff" | "client_rate" | "derived" | "manual" | "bonification";
  pricing_reason?: string | null;
  pricing_formula_snapshot?: {
    kind: "legacy" | "catalog_v1" | "transport_v1" | "derived_v1" | "manual_v1" | "bonification_v1";
    second_trip_discount?: boolean;
    surcharge_pct?: number;
    basis?: string;
  };
  min_qty_snapshot?: number;
  min_billing_snapshot?: number;
  qty_requested?: number;
  qty_effective?: number;
  rate_snapshot?: number;
  subtotal_requested?: number;
  qty_provided?: number | null;
  subtotal_provided?: number | null;
  qty_billed?: number | null;
  subtotal_billed?: number | null;
  pricing_snapshot_at?: string;
  line_sequence?: number;
}

export interface Order {
  id: string;
  public_id: string;
  short_id: number;
  date: string;
  depot: Depot;
  status: OrderStatus;
  client_id: string;
  operator_id: string | null;
  h_start: string | null;
  h_end: string | null;
  hours: number;
  pallets: number;
  units: number;
  km: number;
  observ: string | null;
  total: number;
  pricing_currency?: "ARS" | "USD";
  tariff_version_id?: string | null;
  pricing_snapshot_at?: string;
  issued_total?: number;
  provided_total?: number | null;
  billed_total?: number | null;
  signed_by: string | null;
  signed_doc: string | null;
  signed_at: string | null;
  signature_url: string | null;
  signature_hash: string | null;
  pdf_url: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  ip: string | null;
  created_at: string;
  created_by: string | null;
  client?: Client;
  operator?: Operator;
  services?: OrderService[];
  service_order_events?: ServiceOrderEvent[];
  service_order_billing_adjustments?: ServiceOrderBillingAdjustment[];
}

export interface ServiceOrderEvent {
  id: number;
  order_id: string;
  order_service_id: string | null;
  event_kind: "issued" | "fulfillment_recorded" | "billing_adjusted";
  reason: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface ServiceOrderBillingAdjustment {
  id: number;
  order_id: string;
  order_service_id: string;
  prior_qty: number | null;
  prior_amount: number | null;
  billed_qty: number;
  billed_amount: number;
  delta_amount: number;
  reason: string;
  authorized_by: string;
  created_at: string;
}

export interface NotificationItem {
  id: string;
  kind: "signed" | "new" | "observed" | "info" | "warn";
  title: string;
  message: string;
  created_at: string;
  read: boolean;
}

export const STATUS_META: Record<OrderStatus, { label: string; cls: string }> = {
  BORRADOR: { label: "Borrador", cls: "badge-muted" },
  PENDIENTE_FIRMA: { label: "Pend. firma", cls: "badge-warning" },
  EN_CURSO: { label: "En curso", cls: "badge-info" },
  FIRMADA: { label: "Firmada", cls: "badge-success" },
  FACTURADA: { label: "Facturada", cls: "badge-success" },
  OBSERVADA: { label: "Observada", cls: "badge-danger" },
  CANCELADA: { label: "Cancelada", cls: "badge-muted" },
};

export const DEPOT_META: Record<
  Depot,
  { label: string; address: string; tag: string; capabilities: string[] }
> = {
  // Sede central — opera ANMAT + cargas generales + oficinas.
  MAGALDI: {
    label: "Magaldi",
    address: "Agustín Magaldi 1765 · CABA",
    tag: "ANMAT · General",
    capabilities: ["ANMAT", "Cargas generales", "Oficinas"],
  },
  // Sede anexa Pedro de Luján 3159 (Pcia. de Buenos Aires) — ANMAT + cargas
  // generales, SIN oficinas.
  LUJAN: {
    label: "Luján",
    address: "Pedro de Luján 3159 · BsAs",
    tag: "ANMAT · General",
    capabilities: ["ANMAT", "Cargas generales"],
  },
};
