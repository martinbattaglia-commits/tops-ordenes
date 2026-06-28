/**
 * Tipos del módulo TOPS Órdenes de Compra (OC).
 * Convive con `src/lib/types.ts` (módulo OS). Schema en
 * `supabase/migrations/0008_purchase_orders.sql`.
 */

import type { Depot } from "./types";

export type { Depot } from "./types";

export type PoStatus =
  | "borrador"
  | "pendiente"
  | "firmada"
  | "enviada"
  | "recibida_parcial"
  | "conciliada"
  | "facturada"
  | "anulada";

export type PoEventKind =
  | "created"
  | "updated"
  | "signed"
  | "sent_email"
  | "received"
  | "reconciled"
  | "invoiced"
  | "cancelled"
  | "drive_synced";

export interface Vendor {
  id: string;
  razon: string;
  cuit: string;
  domicilio: string | null;
  telefono: string | null;
  contacto: string | null;
  email: string | null;
  categoria: string | null;
  cond_pago: string;
  tags: string[];
  active: boolean;
  created_at: string;
  /** Inicial visual ("P" para Pallets Sur). */
  avatar?: string;
  // joins de vendor_stats
  oc_count?: number;
  ytd_spend?: number;
  last_oc_at?: string | null;
}

export interface Product {
  id: string;
  sku: string;
  label: string;
  unit: string;
  price: number;
  vendor_id: string | null;
  categoria: string | null;
  active: boolean;
  updated_at: string;
}

export interface POItem {
  id?: string;
  order_id?: string;
  sku: string | null;
  label: string;
  unit: string;
  qty: number;
  price: number;
  subtotal: number;
  pos: number;
}

export interface POEvent {
  id?: number;
  order_id: string;
  ts: string;
  kind: PoEventKind;
  actor: string | null;
  actor_email: string | null;
  ip: string | null;
  meta: Record<string, unknown>;
}

export interface POEmailSend {
  id?: string;
  order_id: string;
  to_email: string;
  tag: string | null;
  status: "queued" | "sent" | "failed" | "opened" | "bounced";
  provider_id: string | null;
  error: string | null;
  sent_at: string;
  opened_at: string | null;
}

export interface PurchaseOrder {
  id: string;
  short_id: number;
  public_id: string; // OC-2026-0348
  date: string;
  depot: Depot;
  destino: string | null;
  entrega: string | null;
  categoria: string | null;
  cond_pago: string;
  status: PoStatus;
  vendor_id: string;
  emisor_name: string;
  emisor_email: string;
  emisor_role: string;
  observ: string | null;
  neto: number;
  iva: number;
  total: number;
  signed_by: string | null;
  signed_at: string | null;
  signature_url: string | null;
  signature_hash: string | null;
  integrity_hash: string | null;
  pdf_url: string | null;
  drive_folder: string | null;
  drive_file_id: string | null;
  factura_id: string | null;           // número de comprobante ARCA (texto libre)
  supplier_invoice_id: string | null;  // FK uuid a supplier_invoices (post-conciliación)
  recibido_por: string | null;
  recibido_at: string | null;
  created_at: string;
  created_by: string | null;
  // joins
  vendor?: Vendor;
  items?: POItem[];
  events?: POEvent[];
  emails?: POEmailSend[];
}

export const PO_STATUS_META: Record<PoStatus, { label: string; cls: string }> = {
  borrador: { label: "Borrador", cls: "badge-muted" },
  pendiente: { label: "Pendiente", cls: "badge-warning" },
  firmada: { label: "Firmada", cls: "badge-success" },
  enviada: { label: "Enviada", cls: "badge-info" },
  recibida_parcial: { label: "Recibida parcial", cls: "badge-warning" },
  conciliada: { label: "Conciliada", cls: "badge-success" },
  facturada: { label: "Facturada", cls: "badge-success" },
  anulada: { label: "Anulada", cls: "badge-danger" },
};

export const PO_EVENT_LABEL: Record<PoEventKind, string> = {
  created: "OC generada",
  updated: "OC actualizada",
  signed: "Firma digital",
  sent_email: "Email enviado",
  received: "Mercadería recibida",
  reconciled: "Conciliada con factura",
  invoiced: "Facturada",
  cancelled: "OC anulada",
  drive_synced: "Sincronizada en Drive",
};
