/**
 * Constantes corporativas — Logística TOPS / Verotin S.A.
 * Single source of truth para footers, PDF, emails, headers.
 */

import { DIRECTOR, GERENCIA } from "./orgchart";

/** Iniciales a partir de nombre y apellido (primeras dos palabras). */
function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/**
 * Emisor/firmante y administración se DERIVAN del organigrama institucional
 * (`orgchart.ts`, fuente entregada por la Presidencia) para que exista una
 * sola fuente de verdad de quién firma los comprobantes. No hardcodear acá:
 * cualquier cambio de cargo/persona se hace en `orgchart.ts` y se propaga.
 */
const ADMIN_NODE =
  GERENCIA.find((n) => n.rbac?.slug === "admin") ?? GERENCIA[GERENCIA.length - 1];

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
    name: DIRECTOR.name,
    role: DIRECTOR.title,
    email: DIRECTOR.email ?? "",
    initials: initialsOf(DIRECTOR.name),
  },
  admin: {
    name: ADMIN_NODE.name,
    role: ADMIN_NODE.detail ?? ADMIN_NODE.title,
    email: ADMIN_NODE.email ?? "",
    initials: initialsOf(ADMIN_NODE.name),
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
  /** Dominio primario del Google Workspace corporativo (scopea los enlaces a `/a/<dominio>/`). */
  googleWorkspaceDomain: "logisticatops.com",
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
