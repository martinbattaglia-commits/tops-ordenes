/**
 * opportunities-data.ts — Fuente LOCAL de oportunidades (F2.1-6).
 *
 * Datos de muestra tipados que alimentan la Ficha 360° sin depender de Supabase.
 * ⚠️ DEMO: 3 oportunidades en distintas etapas para ejercitar toda la vista.
 * En F2.1-7 estas funciones se reimplementan leyendo crm_* de Supabase (misma forma).
 */

import type {
  OpportunityFull, Opportunity, Quote, Proposal, Contract, Onboarding, StageEvent,
} from "./crm-types";

// ── OPP-2026-0001 · ANMAT 200 m² · en PROPUESTA (cotización + propuesta enviada) ──
const OPP_1: Opportunity = {
  id: "opp-0001",
  publicId: "OPP-2026-0001",
  empresa: "Laboratorios Andrómaco S.A.",
  cuit: "30-50001234-9",
  contacto: "María Pérez",
  email: "compras@andromaco.test",
  telefono: "+54 11 4000-0001",
  serviceType: "anmat",
  m2: 200,
  deposito: "LUJAN",
  estado: "propuesta",
  probabilidad: 60,
  monto: 16_000_000,
  currency: "ARS",
  ownerName: "Vendedor TOPS",
  expectedClose: "2026-07-15",
  clientifyDealId: "cl-deal-9001",
  capacityFeasible: true,
  assignedSite: "PEDRO_LUJAN_3159",
  assignedUnits: ["Cubículos 2º piso (PA4-PA5)"],
  committedState: "reservado",
  createdAt: "2026-05-20",
};

const QUOTE_1: Quote = {
  id: "cot-0001", publicId: "COT-2026-0001", serviceType: "anmat", tarifarioRef: "MAYO/2026",
  subtotal: 16_000_000, descuentoTotal: 0, iva: 3_360_000, total: 19_360_000, currency: "ARS",
  status: "enviada", createdAt: "2026-05-28",
  items: [
    { concepto: "Depósito ANMAT · 200 m²", categoria: "storage", cantidad: 200, unidad: "m2", precioUnit: 80_000, importe: 16_000_000 },
  ],
};

const PROP_1: Proposal = {
  id: "prop-0001", publicId: "PROP-2026-0001", tipo: "anmat", version: 1, status: "enviada",
  sentAt: "2026-05-30", viewedAt: "2026-06-01", quotePublicId: "COT-2026-0001", createdAt: "2026-05-30",
};

// ── OPP-2026-0002 · Cargas Generales 800 m² · GANADO (contrato firmado + onboarding) ──
const OPP_2: Opportunity = {
  id: "opp-0002",
  publicId: "OPP-2026-0002",
  empresa: "Divanlito S.R.L.",
  cuit: "30-60005678-2",
  contacto: "Jorge Díaz",
  email: "logistica@divanlito.test",
  telefono: "+54 11 4000-0002",
  serviceType: "general",
  m2: 800,
  deposito: "LUJAN",
  estado: "ganado",
  probabilidad: 100,
  monto: 16_000_000,
  currency: "ARS",
  ownerName: "Vendedor TOPS",
  expectedClose: "2026-06-01",
  clientifyDealId: "cl-deal-9002",
  capacityFeasible: true,
  assignedSite: "PEDRO_LUJAN_3159",
  assignedUnits: ["PB8 (806 m² + 248 pos.)"],
  committedState: "comprometido",
  createdAt: "2026-04-10",
};

const QUOTE_2: Quote = {
  id: "cot-0002", publicId: "COT-2026-0002", serviceType: "general", tarifarioRef: "MAYO/2026",
  subtotal: 16_000_000, descuentoTotal: 800_000, iva: 3_192_000, total: 18_392_000, currency: "ARS",
  status: "aceptada", createdAt: "2026-04-20",
  items: [
    { concepto: "Depósito Carga General · 800 m²", categoria: "storage", cantidad: 800, unidad: "m2", precioUnit: 20_000, importe: 16_000_000 },
    { concepto: "Bonificación 1er mes", categoria: "storage", cantidad: 1, unidad: "mes", precioUnit: -800_000, importe: -800_000 },
  ],
};

const PROP_2: Proposal = {
  id: "prop-0002", publicId: "PROP-2026-0002", tipo: "general", version: 2, status: "aceptada",
  sentAt: "2026-04-25", viewedAt: "2026-04-26", quotePublicId: "COT-2026-0002", createdAt: "2026-04-25",
};

const CONTRACT_2: Contract = {
  id: "con-0002", publicId: "CON-2026-0001", version: 1, status: "firmado",
  signedAt: "2026-05-05", signedBy: "Jorge Díaz", validFrom: "2026-06-01", validUntil: "2027-05-31",
  proposalPublicId: "PROP-2026-0002", createdAt: "2026-04-30",
};

const ONB_2: Onboarding = {
  id: "onb-0002", publicId: "ONB-2026-0001", status: "en_curso", progressPct: 60,
  startedAt: "2026-05-06", completedAt: null,
  tasks: [
    { tipo: "documentacion", titulo: "Documentación contractual y fiscal", status: "completado", assignee: "Comercial", dueDate: "2026-05-10", hasDocument: true },
    { tipo: "croquis", titulo: "Croquis / layout asignado (PB8)", status: "completado", assignee: "Operaciones", dueDate: "2026-05-12", hasDocument: true },
    { tipo: "accesos", titulo: "Alta de accesos (portal + usuarios)", status: "en_curso", assignee: "Admin", dueDate: "2026-05-20", hasDocument: false },
    { tipo: "rne", titulo: "RNE (no aplica · Cargas Generales)", status: "na", assignee: null, dueDate: null, hasDocument: false },
    { tipo: "plancheta", titulo: "Plancheta (no aplica · Cargas Generales)", status: "na", assignee: null, dueDate: null, hasDocument: false },
  ],
};

// ── OPP-2026-0003 · ANMAT 600 m² · CALIFICADO (capacidad ajustada, sin cotización) ──
const OPP_3: Opportunity = {
  id: "opp-0003",
  publicId: "OPP-2026-0003",
  empresa: "Farma Sur S.A.",
  cuit: "30-70009012-5",
  contacto: "Lucía Gómez",
  email: "operaciones@farmasur.test",
  telefono: "+54 11 4000-0003",
  serviceType: "anmat",
  m2: 600,
  deposito: null,
  estado: "calificado",
  probabilidad: 20,
  monto: 48_000_000,
  currency: "ARS",
  ownerName: "Vendedor TOPS",
  expectedClose: "2026-08-30",
  clientifyDealId: "cl-deal-9003",
  capacityFeasible: false, // 600 m² ANMAT no entran en una sola sede
  assignedSite: null,
  assignedUnits: null,
  committedState: "none",
  createdAt: "2026-06-02",
};

// ── Historial por oportunidad ─────────────────────────────────────────────────
const HIST_1: StageEvent[] = [
  { fromStage: null, toStage: "nuevo_lead", changedBy: "Clientify", changedAt: "2026-05-18", note: "Lead de Google Ads" },
  { fromStage: "nuevo_lead", toStage: "contactado", changedBy: "SDR", changedAt: "2026-05-19", note: null },
  { fromStage: "contactado", toStage: "calificado", changedBy: "Vendedor TOPS", changedAt: "2026-05-20", note: "ANMAT 200 m²" },
  { fromStage: "calificado", toStage: "visita", changedBy: "Vendedor TOPS", changedAt: "2026-05-24", note: "Visita a Luján" },
  { fromStage: "visita", toStage: "propuesta", changedBy: "Vendedor TOPS", changedAt: "2026-05-30", note: "Propuesta enviada" },
];
const HIST_2: StageEvent[] = [
  { fromStage: null, toStage: "nuevo_lead", changedBy: "Clientify", changedAt: "2026-04-08", note: null },
  { fromStage: "nuevo_lead", toStage: "calificado", changedBy: "Vendedor TOPS", changedAt: "2026-04-10", note: null },
  { fromStage: "calificado", toStage: "propuesta", changedBy: "Vendedor TOPS", changedAt: "2026-04-25", note: null },
  { fromStage: "propuesta", toStage: "negociacion", changedBy: "Vendedor TOPS", changedAt: "2026-04-28", note: "Descuento 1er mes" },
  { fromStage: "negociacion", toStage: "ganado", changedBy: "Vendedor TOPS", changedAt: "2026-05-05", note: "Contrato firmado" },
];
const HIST_3: StageEvent[] = [
  { fromStage: null, toStage: "nuevo_lead", changedBy: "Clientify", changedAt: "2026-06-01", note: "Lead web" },
  { fromStage: "nuevo_lead", toStage: "contactado", changedBy: "SDR", changedAt: "2026-06-01", note: null },
  { fromStage: "contactado", toStage: "calificado", changedBy: "Vendedor TOPS", changedAt: "2026-06-02", note: "ANMAT 600 m² — capacidad a evaluar" },
];

const DATA: Record<string, OpportunityFull> = {
  "opp-0001": { opportunity: OPP_1, quotes: [QUOTE_1], proposals: [PROP_1], contract: null, onboarding: null, history: HIST_1 },
  "opp-0002": { opportunity: OPP_2, quotes: [QUOTE_2], proposals: [PROP_2], contract: CONTRACT_2, onboarding: ONB_2, history: HIST_2 },
  "opp-0003": { opportunity: OPP_3, quotes: [], proposals: [], contract: null, onboarding: null, history: HIST_3 },
};

// ── Accesores (hoy local; F2.1-7 → Supabase) ──────────────────────────────────

export function listOpportunities(): Opportunity[] {
  return Object.values(DATA).map((d) => d.opportunity);
}

export function getOpportunityFull(id: string): OpportunityFull | null {
  return DATA[id] ?? null;
}

/** Resuelve por publicId (para deep-links tipo OPP-2026-0001). */
export function getOpportunityIdByPublicId(publicId: string): string | null {
  const found = Object.values(DATA).find((d) => d.opportunity.publicId === publicId);
  return found?.opportunity.id ?? null;
}
