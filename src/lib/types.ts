/**
 * Tipos del dominio TOPS Órdenes.
 * Alineados con el schema Supabase de `supabase/migrations`.
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

export type ServiceUnit = "hs" | "km" | "pal" | "mes" | "un" | "m3" | "viaje";

/** Categorías visuales del wizard de servicios. */
export type ServiceCategory =
  | "personal"
  | "especial"
  | "carga"
  | "desconsolidado"
  | "admin"
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
  created_at: string;
}

export interface ServiceCatalogItem {
  id: string;
  slug: string;
  label: string;
  unit: ServiceUnit;
  rate: number;
  /** Cantidad mínima a facturar aunque el cliente pida menos. */
  min_qty?: number;
  /** Subtotal mínimo en ARS. Si qty*rate cae debajo de esto, se factura este monto. */
  min_billing?: number;
  /** Observación visible como tooltip / badge. */
  observ?: string;
  /** Categoría visual del wizard. Si está undefined va en "Otros". */
  category?: ServiceCategory;
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
}

export interface Order {
  id: string;
  public_id: string; // OS-201567
  short_id: number;
  date: string; // ISO
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
  // joins
  client?: Client;
  operator?: Operator;
  services?: OrderService[];
}

export interface NotificationItem {
  id: string;
  kind: "signed" | "new" | "observed" | "info";
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

export const DEPOT_META: Record<Depot, { label: string; address: string; tag: string }> = {
  MAGALDI: {
    label: "Magaldi",
    address: "Agustín Magaldi 1765 · CABA",
    tag: "ANMAT",
  },
  LUJAN: {
    label: "Luján",
    address: "Ruta 8 km 67.5 · BsAs",
    tag: "General",
  },
};
