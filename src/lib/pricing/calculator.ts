/**
 * Calculadora de Precio Inteligente.
 *
 * Aplica:
 *  - Mínimos de cantidad (qty efectiva = max(qty, min_qty)).
 *  - Mínimos de facturación (subtotal efectivo = max(qty*rate, min_billing)).
 *  - Reglas de transporte (segundo viaje 50%, recargo horario opcional).
 *
 * Salida estructurada para que la UI muestre desglose profesional con
 * indicadores de "mínimo aplicado".
 */

import type { ServiceCatalogItem } from "../types";
import type { VehicleSpec, VehicleZonePricing } from "./vehicles";

export interface LineItem {
  /** Para identificación visual y submit. */
  key: string;
  /** Label que ve el usuario. */
  label: string;
  /** Cantidad pedida originalmente. */
  qty_requested: number;
  /** Cantidad efectiva después de aplicar min_qty. */
  qty_effective: number;
  /** Tarifa unitaria. */
  rate: number;
  /** Unidad legible (hs, m³, un, viaje, etc.). */
  unit: string;
  /** Subtotal final aplicando todas las reglas. */
  subtotal: number;
  /** True si se aplicó algún mínimo (qty o billing). */
  min_applied: boolean;
  /** Mensaje del mínimo aplicado para mostrar al usuario. */
  min_reason?: string;
  /** Slug original del servicio en catálogo (si aplica). */
  service_slug?: string;
  /** Slug del vehículo (si es un viaje de transporte). */
  vehicle_slug?: string;
  /** Categoría visual. */
  category?: string;
}

/**
 * Calcula el line-item para un servicio del catálogo con cantidad dada.
 * Aplica mínimos automáticamente.
 */
export function computeServiceLine(
  service: ServiceCatalogItem,
  qtyRequested: number
): LineItem {
  const qReq = Number.isFinite(qtyRequested) && qtyRequested > 0 ? qtyRequested : 1;
  const minQty = service.min_qty ?? 0;
  const qEff = Math.max(qReq, minQty);

  const raw = qEff * service.rate;
  const minBilling = service.min_billing ?? 0;
  const subtotal = Math.max(raw, minBilling);

  const qtyBumped = qEff > qReq;
  const billBumped = minBilling > 0 && raw < minBilling;
  const min_applied = qtyBumped || billBumped;

  let min_reason: string | undefined;
  if (qtyBumped && billBumped) {
    min_reason = `Aplicado mínimo de ${minQty} ${service.unit} y subtotal mínimo de ${fmtARS(minBilling)}.`;
  } else if (qtyBumped) {
    min_reason = `Aplicado mínimo de ${minQty} ${service.unit} (pediste ${qReq}).`;
  } else if (billBumped) {
    min_reason = `Aplicado subtotal mínimo de ${fmtARS(minBilling)}.`;
  }

  return {
    key: `svc:${service.slug}`,
    label: service.label,
    qty_requested: qReq,
    qty_effective: qEff,
    rate: service.rate,
    unit: service.unit,
    subtotal,
    min_applied,
    min_reason,
    service_slug: service.slug,
    category: service.category,
  };
}

export interface TransportLineInput {
  vehicle: VehicleSpec;
  zone: VehicleZonePricing;
  /** Cantidad de viajes (1 normal, 2 si tiene retorno con descuento). */
  trips: number;
  /** True si se aplica el descuento de "segundo viaje al 50%". */
  secondTripDiscount?: boolean;
  /** True si el viaje se hace fuera de horario y requiere recargo. */
  surcharge?: "none" | "17_19" | "19_21" | "21_plus";
}

/**
 * Calcula el line-item de transporte para un vehículo + zona + viajes.
 * Aplica reglas operativas del tarifario febrero 2026.
 */
export function computeTransportLine(input: TransportLineInput): LineItem {
  const { vehicle, zone, trips, secondTripDiscount, surcharge = "none" } = input;
  const tripsCount = Math.max(1, Math.floor(trips || 1));

  if (zone.price == null) {
    // A cotizar — devolvemos line con subtotal 0 y mensaje claro.
    return {
      key: `trip:${vehicle.slug}:${zone.zone}`,
      label: `${vehicle.label} · ${zone.label}`,
      qty_requested: tripsCount,
      qty_effective: tripsCount,
      rate: 0,
      unit: "viaje",
      subtotal: 0,
      min_applied: false,
      min_reason: "Tarifa a cotizar — coordinar con comercial.",
      vehicle_slug: vehicle.slug,
      category: "transporte",
    };
  }

  let subtotal = zone.price * tripsCount;

  // Regla: 2do viaje al 50%
  if (secondTripDiscount && tripsCount >= 2) {
    const fullPrice = zone.price;
    const discountedTrips = tripsCount - 1;
    subtotal = fullPrice + discountedTrips * (fullPrice * 0.5);
  }

  // Recargos por horario (camión)
  const surchargePct =
    surcharge === "17_19" ? 0.25 : surcharge === "19_21" ? 0.5 : surcharge === "21_plus" ? 1.0 : 0;
  if (surchargePct > 0) {
    subtotal = subtotal * (1 + surchargePct);
  }

  const reasons: string[] = [];
  if (secondTripDiscount && tripsCount >= 2) {
    reasons.push("Aplicado descuento 50% en viajes adicionales.");
  }
  if (surchargePct > 0) {
    reasons.push(`Recargo fuera de horario +${Math.round(surchargePct * 100)}%.`);
  }

  return {
    key: `trip:${vehicle.slug}:${zone.zone}`,
    label: `${vehicle.label} · ${zone.label}`,
    qty_requested: tripsCount,
    qty_effective: tripsCount,
    rate: zone.price,
    unit: "viaje",
    subtotal: Math.round(subtotal),
    min_applied: reasons.length > 0,
    min_reason: reasons.join(" "),
    vehicle_slug: vehicle.slug,
    category: "transporte",
  };
}

/** Suma los subtotales de una lista de líneas. */
export function sumLines(lines: LineItem[]): number {
  return lines.reduce((acc, l) => acc + l.subtotal, 0);
}

/** Aproximación visual rápida del IVA al 21% (la facturación real corre por sistema contable). */
export function ivaEstimate(net: number, rate = 0.21): number {
  return Math.round(net * rate);
}

function fmtARS(n: number): string {
  return "$ " + Math.round(n).toLocaleString("es-AR");
}
