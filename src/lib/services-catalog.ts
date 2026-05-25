import type { ServiceCatalogItem } from "./types";

/**
 * Catálogo base de servicios. En producción esto sale de la tabla
 * `services_catalog` de Supabase, pero lo dejamos también como fallback
 * cuando la DB no está disponible o en demo mode.
 *
 * Tarifas en ARS netas (sin IVA), actualizadas mayo 2026.
 */
export const SERVICES_CATALOG: ServiceCatalogItem[] = [
  { id: "s1", slug: "autoelevador", label: "Autoelevador con uñas", unit: "hs", rate: 12500, icon: "forklift", active: true },
  { id: "s2", slug: "transporte", label: "Transporte AMBA", unit: "km", rate: 850, icon: "truck", active: true },
  { id: "s3", slug: "semi", label: "Semi (camión grande)", unit: "hs", rate: 18200, icon: "truck", active: true },
  { id: "s4", slug: "chasis", label: "Chasis", unit: "hs", rate: 14600, icon: "truck", active: true },
  { id: "s5", slug: "peon", label: "Peón por hora", unit: "hs", rate: 6800, icon: "user", active: true },
  { id: "s6", slug: "picking", label: "Picking", unit: "pal", rate: 1450, icon: "package", active: true },
  { id: "s7", slug: "desconsolidado", label: "Desconsolidado", unit: "hs", rate: 19400, icon: "package", active: true },
  { id: "s8", slug: "carga", label: "Carga", unit: "pal", rate: 980, icon: "package", active: true },
  { id: "s9", slug: "descarga", label: "Descarga", unit: "pal", rate: 980, icon: "package", active: true },
  { id: "s10", slug: "distribucion", label: "Distribución", unit: "km", rate: 920, icon: "truck", active: true },
  { id: "s11", slug: "anmat", label: "Servicios ANMAT", unit: "hs", rate: 16800, icon: "package", active: true },
  { id: "s12", slug: "operaciones-especiales", label: "Operaciones especiales", unit: "hs", rate: 22500, icon: "bolt", active: true },
  { id: "s13", slug: "otros", label: "Otros servicios logísticos", unit: "un", rate: 0, icon: "package", active: true },
];

export function getService(slug: string): ServiceCatalogItem | undefined {
  return SERVICES_CATALOG.find((s) => s.slug === slug);
}
