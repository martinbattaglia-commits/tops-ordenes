import type { ServiceUnit } from "@/lib/types";

/** Metadatos visuales deliberadamente libres de tarifas para el bundle cliente. */
export const SERVICE_CATEGORIES = [
  { key: "personal", label: "Personal", icon: "user" },
  { key: "especial", label: "Servicios especiales", icon: "forklift" },
  { key: "carga", label: "Carga y preparación", icon: "package" },
  { key: "desconsolidado", label: "Desconsolidado", icon: "package" },
  { key: "almacenamiento", label: "Almacenamiento", icon: "building" },
  { key: "coworking", label: "Oficinas y coworking", icon: "building" },
  { key: "otros", label: "Otros servicios", icon: "bill" },
] as const;

export const TRANSPORT_RULES = [
  "Precios expresados por viaje completo (no por hora).",
  "Segundo viaje al 50% del valor original.",
  "Reparto hasta 4 clientes. Si supera, queda sujeto a cotización.",
  "Recargos fuera de horario se registran en el snapshot firmado.",
] as const;

export function unitLabel(unit: ServiceUnit | string): string {
  return ({
    hs: "hora",
    km: "km",
    pal: "pallet",
    mes: "mes",
    un: "unidad",
    m2: "m²",
    m3: "m³",
    tn: "tonelada",
    viaje: "viaje",
  } as Record<string, string>)[unit] ?? unit;
}
