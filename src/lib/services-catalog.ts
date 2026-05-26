import type { ServiceCatalogItem, ServiceUnit } from "./types";

/**
 * Catálogo de servicios operativos (excluyendo transporte por viaje — eso
 * vive en pricing/vehicles.ts).
 *
 * Fuente: PDFs oficiales TARIFARIO TOPS ENERO 2026 + LISTADO DE PRECIOS
 * ENERO 2026 + TARIFARIO TRANSPORTE FEBRERO 2026.
 *
 * Convenciones:
 *  - `rate` siempre neto sin IVA.
 *  - `min_qty`: cantidad mínima a facturar aunque el usuario pida menos.
 *  - `min_billing`: subtotal mínimo en ARS para el servicio (sobrescribe qty*rate).
 *  - `category`: agrupador visual en el wizard.
 *  - `observ`: nota que aparece como tooltip / badge en la UI.
 *
 * IMPORTANTE — no incluido por requerimiento explícito del negocio:
 *   - Almacenaje diario por m³/Tn
 *   - Facturación mensual base $630.000 de warehousing
 *   - Servicios de depósito mensual
 * Esta orden de servicio NO factura almacenaje.
 */
export const SERVICES_CATALOG: ServiceCatalogItem[] = [
  // ---- Personal -------------------------------------------------------------
  {
    id: "s-peon",
    slug: "peon",
    label: "Peón por hora",
    category: "personal",
    unit: "hs",
    rate: 30_000,
    min_qty: 4,
    observ: "Mínimo 4 hs por contratación.",
    icon: "user",
    active: true,
  },

  // ---- Servicios especiales / autoelevadores --------------------------------
  {
    id: "s-autoelevador-unas",
    slug: "autoelevador-unas",
    label: "Autoelevador con uñas",
    category: "especial",
    unit: "hs",
    rate: 79_000,
    min_qty: 2,
    observ: "Mínimo 2 hs por servicio.",
    icon: "forklift",
    active: true,
  },
  {
    id: "s-autoelevador-clamp",
    slug: "autoelevador-clamp",
    label: "Autoelevador con clamp",
    category: "especial",
    unit: "hs",
    rate: 90_000,
    min_qty: 2,
    observ: "Para bobinas / rollos. Mínimo 2 hs.",
    icon: "forklift",
    active: true,
  },
  {
    id: "s-palletizado-enfilmado",
    slug: "palletizado-enfilmado",
    label: "Palletizado y enfilmado",
    category: "especial",
    unit: "un",
    rate: 28_000,
    observ: "Precio por unidad armada y filmada.",
    icon: "package",
    active: true,
  },
  {
    id: "s-enfilmado",
    slug: "enfilmado",
    label: "Enfilmado solo",
    category: "especial",
    unit: "un",
    rate: 16_000,
    observ: "Precio por unidad enfilmada.",
    icon: "package",
    active: true,
  },

  // ---- Carga / descarga / picking ------------------------------------------
  {
    id: "s-picking",
    slug: "picking",
    label: "Picking (preparación de pedidos)",
    category: "carga",
    unit: "m3",
    rate: 8_000,
    min_billing: 43_000,
    observ: "Por m³ o Tn. Facturación mínima $43.000 por pedido.",
    icon: "package",
    active: true,
  },
  {
    id: "s-carga-palletizada",
    slug: "carga-palletizada",
    label: "Carga palletizada a camión",
    category: "carga",
    unit: "m3",
    rate: 8_000,
    min_billing: 43_000,
    observ: "Por m³ o Tn. Facturación mínima $43.000.",
    icon: "package",
    active: true,
  },
  {
    id: "s-carga-suelta",
    slug: "carga-suelta",
    label: "Carga suelta a camión",
    category: "carga",
    unit: "m3",
    rate: 9_000,
    min_billing: 71_000,
    observ: "Por m³ o Tn. Facturación mínima $71.000.",
    icon: "package",
    active: true,
  },

  // ---- Desconsolidado -------------------------------------------------------
  {
    id: "s-desconso-20-pal",
    slug: "desconso-20-pal",
    label: "Desconsolidado 20\" palletizado",
    category: "desconsolidado",
    unit: "un",
    rate: 390_000,
    observ: "Contenedor 20\" o chasis hasta 30 m³.",
    icon: "package",
    active: true,
  },
  {
    id: "s-desconso-40-pal",
    slug: "desconso-40-pal",
    label: "Desconsolidado 40\" palletizado",
    category: "desconsolidado",
    unit: "un",
    rate: 450_000,
    observ: "Contenedor 40\" o semi 31–60 m³.",
    icon: "package",
    active: true,
  },
  {
    id: "s-desconso-40hc-pal",
    slug: "desconso-40hc-pal",
    label: "Desconsolidado 40\" HC palletizado",
    category: "desconsolidado",
    unit: "un",
    rate: 520_000,
    observ: "Contenedor 40\" HC o furgón 61–80 m³.",
    icon: "package",
    active: true,
  },
  {
    id: "s-desconso-20-trasbordo",
    slug: "desconso-20-trasbordo",
    label: "Desconsolidado y trasbordo 20\"",
    category: "desconsolidado",
    unit: "un",
    rate: 480_000,
    icon: "package",
    active: true,
  },
  {
    id: "s-desconso-40-trasbordo",
    slug: "desconso-40-trasbordo",
    label: "Desconsolidado y trasbordo 40\"",
    category: "desconsolidado",
    unit: "un",
    rate: 650_000,
    icon: "package",
    active: true,
  },
  {
    id: "s-desconso-chasis-20m3",
    slug: "desconso-chasis-20m3",
    label: "Desconsolidado chasis (hasta 20 m³)",
    category: "desconsolidado",
    unit: "un",
    rate: 137_000,
    observ: "Chasis chico palletizado.",
    icon: "package",
    active: true,
  },

  // ---- Administrativos ------------------------------------------------------
  {
    id: "s-admin-in",
    slug: "admin-in",
    label: "Gastos administrativos · Entrada",
    category: "admin",
    unit: "un",
    rate: 45_000,
    observ: "Carga al sistema WMS al ingresar mercadería.",
    icon: "package",
    active: true,
  },
  {
    id: "s-admin-out",
    slug: "admin-out",
    label: "Gastos administrativos · Salida",
    category: "admin",
    unit: "un",
    rate: 32_000,
    observ: "Carga al sistema WMS al egresar mercadería.",
    icon: "package",
    active: true,
  },
];

export const SERVICE_CATEGORIES = [
  { key: "personal", label: "Personal", icon: "user" },
  { key: "especial", label: "Servicios especiales", icon: "forklift" },
  { key: "carga", label: "Carga, descarga, picking", icon: "package" },
  { key: "desconsolidado", label: "Desconsolidado", icon: "package" },
  { key: "admin", label: "Administrativos", icon: "bill" },
] as const;

export function getService(slug: string): ServiceCatalogItem | undefined {
  return SERVICES_CATALOG.find((s) => s.slug === slug);
}

export function servicesByCategory(category: string): ServiceCatalogItem[] {
  return SERVICES_CATALOG.filter((s) => s.category === category && s.active);
}

/** Etiqueta human-readable de la unidad para mostrar en UI. */
export function unitLabel(unit: ServiceUnit | string): string {
  const map: Record<string, string> = {
    hs: "hs",
    km: "km",
    pal: "pal",
    mes: "mes",
    un: "un",
    m3: "m³",
  };
  return map[unit] ?? unit;
}
