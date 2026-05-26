/**
 * Catálogo de vehículos de transporte y tabla de tarifas por zona.
 *
 * Fuente: TARIFARIO TRANSPORTE FEBRERO 2026 — Logística TOPS.
 * Los precios están expresados POR VIAJE, no por hora.
 * Reglas de negocio adicionales (recargos, segundo viaje 50%, etc.) viven
 * en pricing/calculator.ts.
 *
 * IMPORTANTE: NO incluye tarifas de almacenaje. Las órdenes de servicio
 * cubren exclusivamente: transporte, distribución, carga/descarga,
 * servicios especiales, autoelevadores, peones, fletes y conexos.
 */

export type VehicleZoneKey = "CABA" | "40KM" | "60KM" | "80KM" | "100KM" | "MAS_100";

export interface VehicleZonePricing {
  zone: VehicleZoneKey;
  label: string;
  /** km máximo de la zona. null = sin tope (>100km, a cotizar). */
  km_max: number | null;
  /** Precio por viaje en ARS netos. null = a cotizar (caso especial). */
  price: number | null;
}

export interface VehicleSpec {
  slug: string;
  label: string;
  brand: string;
  model: string;
  /** Capacidad máxima en pallets europeos. */
  capacity_pallets: number;
  /** Icon name para la UI. */
  icon: "truck" | "package" | "forklift";
  /** Tabla de tarifas por zona (todas las zonas siempre presentes, aunque sea con price=null). */
  zones: VehicleZonePricing[];
}

const STANDARD_ZONES = (prices: Array<number | null>): VehicleZonePricing[] => [
  { zone: "CABA", label: "CABA → CABA", km_max: 0, price: prices[0] },
  { zone: "40KM", label: "Hasta 40 km", km_max: 40, price: prices[1] },
  { zone: "60KM", label: "Hasta 60 km", km_max: 60, price: prices[2] },
  { zone: "80KM", label: "Hasta 80 km", km_max: 80, price: prices[3] },
  { zone: "100KM", label: "Hasta 100 km", km_max: 100, price: prices[4] },
  { zone: "MAS_100", label: "+100 km (a cotizar)", km_max: null, price: null },
];

export const VEHICLES: VehicleSpec[] = [
  {
    slug: "qubo",
    label: "Qubo",
    brand: "Fiat",
    model: "Qubo",
    capacity_pallets: 1,
    icon: "truck",
    zones: STANDARD_ZONES([203_000, 223_000, 243_000, 264_000, 286_000]),
  },
  {
    slug: "chasis-710",
    label: "Chasis 710",
    brand: "Mercedes-Benz",
    model: "710",
    capacity_pallets: 8,
    icon: "truck",
    zones: STANDARD_ZONES([325_000, 353_000, 394_000, 420_000, 448_000]),
  },
  {
    slug: "balancin-1720",
    label: "Balancín 1720",
    brand: "Mercedes-Benz",
    model: "1720",
    capacity_pallets: 12,
    icon: "truck",
    zones: STANDARD_ZONES([436_000, 476_000, 524_000, 544_000, 612_000]),
  },
  {
    slug: "semi",
    label: "Semi",
    brand: "Semirremolque",
    model: "—",
    capacity_pallets: 22,
    icon: "truck",
    zones: STANDARD_ZONES([null, null, null, null, null]),
  },
];

export function getVehicle(slug: string): VehicleSpec | undefined {
  return VEHICLES.find((v) => v.slug === slug);
}

/**
 * Sugiere el vehículo más chico que puede transportar la cantidad de pallets indicada.
 * Devuelve undefined si no hay ninguno (caso teórico — siempre hay SEMI).
 */
export function suggestVehicleByPallets(pallets: number): VehicleSpec | undefined {
  return VEHICLES.find((v) => v.capacity_pallets >= pallets);
}

/** Devuelve la zona seleccionada de un vehículo. */
export function getVehicleZone(
  vehicleSlug: string,
  zone: VehicleZoneKey
): VehicleZonePricing | undefined {
  return getVehicle(vehicleSlug)?.zones.find((z) => z.zone === zone);
}

/** Reglas operativas del tarifario que conviene mostrar al usuario. */
export const TRANSPORT_RULES = [
  "Precios expresados por viaje completo (no por hora).",
  "Segundo viaje al 50% del valor original.",
  "Reparto hasta 4 clientes. Si supera, queda sujeto a cotización.",
  "Recargo fuera de horario (camión): 17–19 hs +25%, 19–21 hs +50%, después de 21 hs +100%.",
  "Recargo hora extra (peón): 17–19 hs +50%, después de 19 hs +100%.",
  "Peajes se cotizan aparte cuando aplican.",
  "Los valores NO incluyen IVA.",
] as const;
