// Nexus Link · dominio puro de conversaciones contextuales (RC1.3). Sin I/O.

import { CONNECT_ENTITY_TYPES, type ConnectEntityType } from "../types";

export function isConnectEntityType(v: string | null | undefined): v is ConnectEntityType {
  return typeof v === "string" && (CONNECT_ENTITY_TYPES as readonly string[]).includes(v);
}

/** compliance_items usa PK text; el resto uuid. */
export function usesTextPk(entityType: ConnectEntityType): boolean {
  return entityType === "compliance_items";
}

/** Ruta del detalle ERP de la entidad (cross-nav conversación → entidad). Best-effort por módulo. */
export function erpEntityHref(entityType: ConnectEntityType, entityId: string): string {
  switch (entityType) {
    case "orders": return `/orders/${entityId}`;
    case "clients": return `/clients/${entityId}`;
    case "purchase_orders": return `/compras/ordenes/${entityId}`;
    case "supplier_invoices": return `/compras/facturas`;
    case "customer_invoices": return `/billing`;
    case "vendors": return `/compras/proveedores`;
    case "fleet_vehicles": return `/operaciones/tracking`;
    case "warehouses": return `/wms`;
    case "crm_leads": return `/comercial/contactos`;
    case "crm_opportunities": return `/comercial/oportunidades`;
    case "crm_contracts": return `/comercial/contratos`;
    case "contracts": return `/comercial/contratos`;
    case "prospeccion_prospects": return `/comercial/prospeccion`;
    case "compliance_items": return `/anmat`;
    default: return "#";
  }
}

/** Ruta del deep-link de la conversación contextual de la entidad. */
export function contextualConversationHref(entityType: ConnectEntityType, entityId: string): string {
  return `/connect/e/${entityType}/${encodeURIComponent(entityId)}`;
}
