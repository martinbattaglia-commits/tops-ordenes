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
  /** Clasificacion que la RPC usa para resolver el precio sin confiar en UI. */
  pricing_kind?: "catalog" | "transport" | "urgent" | "manual" | "bonification";
  /** Motivo obligatorio para importes manuales/bonificaciones. */
  pricing_reason?: string;
  /** Modificadores de transporte que la RPC vuelve a calcular. */
  second_trip_discount?: boolean;
  surcharge?: "none" | "17_19" | "19_21" | "21_plus";
  /** Tokens de consentimiento económico que la RPC compara con su resolución. */
  tariff_rate_id?: string;
  client_rate_id?: string | null;
}

/**
 * Calcula el line-item para un servicio del catálogo con cantidad dada.
 * Aplica mínimos automáticamente.
 */
export function computeServiceLine(
  service: ServiceCatalogItem,
  qtyRequested: number,
  currency: "ARS" | "USD" = "ARS",
): LineItem {
  if (!Number.isFinite(qtyRequested) || qtyRequested <= 0) {
    throw new Error("Cantidad de servicio inválida");
  }
  const rate = service.rate;
  if (!service.active || rate == null || !Number.isFinite(rate) || rate <= 0 || service.requires_quote) {
    throw new Error("El servicio requiere una tarifa aprobada");
  }
  const qReq = qtyRequested;
  const minQty = service.min_qty ?? 0;
  const qEff = Math.max(qReq, minQty);

  const raw = qEff * rate;
  const minBilling = service.min_billing ?? 0;
  const subtotal = roundMoney(Math.max(raw, minBilling));

  const qtyBumped = qEff > qReq;
  const billBumped = minBilling > 0 && raw < minBilling;
  const min_applied = qtyBumped || billBumped;

  let min_reason: string | undefined;
  if (qtyBumped && billBumped) {
    min_reason = `Aplicado mínimo de ${minQty} ${service.unit} y subtotal mínimo de ${fmtMoney(minBilling, currency)}.`;
  } else if (qtyBumped) {
    min_reason = `Aplicado mínimo de ${minQty} ${service.unit} (pediste ${qReq}).`;
  } else if (billBumped) {
    min_reason = `Aplicado subtotal mínimo de ${fmtMoney(minBilling, currency)}.`;
  }

  return {
    key: `svc:${service.slug}`,
    label: service.label,
    qty_requested: qReq,
    qty_effective: qEff,
    rate,
    unit: service.unit,
    subtotal,
    min_applied,
    min_reason,
    service_slug: service.slug,
    category: service.category,
    pricing_kind: "catalog",
    tariff_rate_id: service.tariff_rate_id,
    client_rate_id: service.client_rate_id ?? null,
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
  /** Mínimos congelados de la misma tarifa DB que provee `zone.price`. */
  minQty?: number;
  minBilling?: number;
}

/**
 * Calcula el line-item de transporte para un vehículo + zona + viajes.
 * Aplica reglas operativas del tarifario febrero 2026.
 */
export function computeTransportLine(input: TransportLineInput): LineItem {
  const {
    vehicle,
    zone,
    trips,
    secondTripDiscount,
    surcharge = "none",
    minQty = 0,
    minBilling = 0,
  } = input;
  if (!Number.isInteger(trips) || trips <= 0 || !Number.isInteger(minQty) || minQty < 0) {
    throw new Error("Cantidad o mínimo de viajes inválido");
  }
  const tripsCount = trips;
  const effectiveTrips = Math.max(tripsCount, minQty);

  if (zone.price == null) {
    throw new Error("El transporte requiere una tarifa aprobada");
  }

  let subtotal = zone.price * effectiveTrips;

  // Regla: 2do viaje al 50%
  if (secondTripDiscount && effectiveTrips >= 2) {
    const fullPrice = zone.price;
    const discountedTrips = effectiveTrips - 1;
    subtotal = fullPrice + discountedTrips * (fullPrice * 0.5);
  }

  subtotal = Math.max(subtotal, minBilling);

  // Recargos por horario (camión)
  const surchargePct =
    surcharge === "17_19" ? 0.25 : surcharge === "19_21" ? 0.5 : surcharge === "21_plus" ? 1.0 : 0;
  if (surchargePct > 0) {
    subtotal = subtotal * (1 + surchargePct);
  }

  const reasons: string[] = [];
  if (effectiveTrips > tripsCount) {
    reasons.push(`Aplicado mínimo de ${effectiveTrips} viajes.`);
  }
  if (secondTripDiscount && effectiveTrips >= 2) {
    reasons.push("Aplicado descuento 50% en viajes adicionales.");
  }
  if (surchargePct > 0) {
    reasons.push(`Recargo fuera de horario +${Math.round(surchargePct * 100)}%.`);
  }

  const transportLabel = zone.label.startsWith(vehicle.label)
    ? zone.label
    : `${vehicle.label} · ${zone.label}`;

  return {
    key: `trip:${vehicle.slug}:${zone.zone}`,
    label: transportLabel,
    qty_requested: tripsCount,
    qty_effective: effectiveTrips,
    rate: zone.price,
    unit: "viaje",
    subtotal: roundMoney(subtotal),
    min_applied: reasons.length > 0,
    min_reason: reasons.join(" "),
    vehicle_slug: vehicle.slug,
    service_slug: `transporte:${vehicle.slug}:${zone.zone}`,
    category: "transporte",
    pricing_kind: "transport",
    second_trip_discount: Boolean(secondTripDiscount),
    surcharge,
  };
}

/** Suma los subtotales de una lista de líneas. */
export function sumLines(lines: LineItem[]): number {
  return roundMoney(lines.reduce((acc, l) => acc + l.subtotal, 0));
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Aproximación visual rápida del IVA al 21% (la facturación real corre por sistema contable). */
export function ivaEstimate(net: number, rate = 0.21): number {
  return Math.round(net * rate);
}

function fmtMoney(n: number, currency: "ARS" | "USD"): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}
