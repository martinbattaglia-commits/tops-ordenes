/**
 * Constantes corporativas — Logística TOPS / Verotin S.A.
 * Single source of truth para footers, PDF, emails, headers.
 */

export const ORG = {
  legalName: "Verotin S.A.",
  brand: "Logística TOPS",
  since: 1985,
  cuit: "33-60489698-9",
  iva: "Responsable Inscripto",
  address: "Agustín Magaldi 1765 (C1286AFM) — CABA · Argentina",
  phone: "(011) 4302-3944 / 3541 / 9710",
  website: "www.logisticatops.com",
  emitter: {
    name: "José Luis Battaglia",
    role: "Director de Operaciones",
    email: "joseluis@logisticatops.com",
    initials: "JL",
  },
  admin: {
    name: "Ruth Cardozo",
    role: "Administración · Verotin S.A.",
    email: "ruth@logisticatops.com",
    initials: "RC",
  },
  depots: [
    {
      id: "MAGALDI",
      label: "Magaldi",
      address: "Agustín Magaldi 1765 · CABA",
      tag: "ANMAT",
      anmat: true,
    },
    {
      id: "LUJAN",
      label: "Pedro de Luján",
      address: "Pedro de Luján 3159 · CABA",
      tag: "Distribución",
      anmat: false,
    },
  ] as const,
  driveRoot: "Órdenes de Compra 2026",
} as const;

/**
 * Identidad del producto: la plataforma corporativa interna.
 * Distinto de la marca comercial — esta es la plataforma operativa
 * (ERP / Operating System) que vive bajo `ordenes.logisticatops.com`.
 */
export const PRODUCT = {
  name: "TOPS NEXUS",
  tagline: "Logistics Operating System",
  shortTagline: "Operating System",
  shortName: "NEXUS",
  version: "2026.05",
  edition: "Enterprise",
  /** Atajos por dominio para footer / metadata. */
  pillars: [
    "Cockpit ejecutivo",
    "Compras a proveedores",
    "Servicios a clientes",
    "ANMAT compliance",
    "Centro de monitoreo CCTV",
    "Centro documental",
  ] as const,
} as const;

export const POSITIVE_CATEGORIES = [
  "Insumos depósito",
  "Combustible",
  "Repuestos",
  "IT / Tecnología",
  "ANMAT / Limpieza",
  "ANMAT / Trazabilidad",
  "Estructura",
  "Oficina",
  "Servicios",
  "Seguridad",
  "Mantenimiento",
  "Transporte",
] as const;

export const COND_PAGO_OPTIONS = [
  "Contado",
  "Anticipado",
  "15 días",
  "30 días",
  "45 días",
  "60 días",
  "90 días",
] as const;

export type DepotId = (typeof ORG.depots)[number]["id"];
