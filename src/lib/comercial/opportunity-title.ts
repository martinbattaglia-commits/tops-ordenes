/**
 * opportunity-title.ts — título comercial legible de una oportunidad.
 *
 * Causa raíz del bug: cuando una oportunidad no tiene cuenta linkeada (`clients.razon`),
 * el mapper cae a `company_name`, que en algunos deals de Clientify viene poblado con
 * una URL técnica de la API (p. ej. `https://api.clientify.net/v1/companies/16216611/`).
 * Esa URL NO debe mostrarse nunca como título.
 *
 * Este módulo centraliza:
 *  - `isClientifyApiUrl(value)` — detecta URLs/endpoints técnicos de Clientify.
 *  - `opportunityDisplayTitle(o)` — título con la cadena de fallback comercial.
 *
 * No toca sync, backfill, Clientify API, crm_units, reservas, contratos ni mapas.
 */
import type { Opportunity, CrmService } from "./crm-types";

const SERVICE_TITLE: Record<CrmService, string> = {
  anmat: "Depósito ANMAT",
  general: "Almacenaje · Cargas Generales",
  oficinas: "Oficinas Corporativas",
};

/**
 * `true` si el valor es una URL/endpoint técnico de la API de Clientify y por lo
 * tanto NO debe usarse como título visible.
 */
export function isClientifyApiUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return (
    v.startsWith("https://api.clientify.net/") ||
    v.includes("/v1/companies/") ||
    v.includes("/v1/contacts/") ||
    v.includes("/v1/deals/")
  );
}

/** Devuelve el candidato si es un texto legible; null si está vacío, es "—" o es una URL técnica. */
function clean(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t || t === "—" || isClientifyApiUrl(t)) return null;
  return t;
}

/** Título derivado del servicio (último fallback comercial). */
export function serviceTitle(serviceType: CrmService): string {
  return SERVICE_TITLE[serviceType] ?? "Oportunidad";
}

/**
 * Título comercial a mostrar en cards, tabla y ficha. Orden de prioridad:
 *  1. Nombre real de la oportunidad de Clientify (`dealName`)
 *  2. Nombre de empresa (`empresa` = razón social / company_name, ya saneado)
 *  3. Espejo de company_name (`companyName`, saneado)
 *  4. Nombre de contacto
 *  5. Servicio derivado (nunca una URL técnica)
 */
export function opportunityDisplayTitle(o: Opportunity): string {
  return (
    clean(o.dealName) ??
    clean(o.empresa) ??
    clean(o.companyName) ??
    clean(o.contacto) ??
    serviceTitle(o.serviceType)
  );
}
