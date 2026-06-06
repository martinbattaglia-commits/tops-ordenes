/**
 * crm-types.ts — Tipos locales del dominio CRM Comercial (F2.1-6).
 *
 * Espejan las tablas crm_* (migraciones 0041–0046) en forma TS. La Ficha 360°
 * consume estos tipos. Hoy se sirven desde datos locales de muestra
 * (`opportunities-data.ts`); en F2.1-7 se reemplaza la fuente por Supabase
 * sin cambiar la UI (misma forma).
 */

export type CrmService = "anmat" | "general" | "oficinas";

// ── Leads (F2.2 · bandeja) ──────────────────────────────────────────────────
export type LeadStatus = "nuevo" | "contactado" | "calificado" | "descartado" | "promovido";

export interface CrmLead {
  id: string;
  publicId: string | null;        // LEAD-YYYY-NNNN
  clientifyId: string | null;
  source: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  cuit: string | null;
  companyName: string | null;
  status: LeadStatus;
  ownerId: string | null;
  ownerName: string | null;       // resuelto vía profiles_public
  tags: string[];
  posibleDuplicado: boolean;      // derivado de tags
  opportunityId: string | null;   // si ya fue promovido
  createdAt: string;
}

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  nuevo: "Nuevo",
  contactado: "Contactado",
  calificado: "Calificado",
  descartado: "Descartado",
  promovido: "Promovido",
};

export const LEAD_STATUS_COLOR: Record<LeadStatus, string> = {
  nuevo: "#2563eb",
  contactado: "#0891b2",
  calificado: "#16a34a",
  descartado: "#94a3b8",
  promovido: "#7c3aed",
};

export type CrmStage =
  | "nuevo_lead" | "contactado" | "calificado" | "visita"
  | "propuesta" | "negociacion" | "ganado" | "perdido";
export type CommittedState = "none" | "reservado" | "comprometido" | "ocupado";

export type QuoteStatus = "borrador" | "enviada" | "aceptada" | "rechazada" | "vencida";
export type ProposalType = "anmat" | "general";
export type ProposalStatus = "borrador" | "enviada" | "aceptada" | "rechazada";
export type ContractStatus = "borrador" | "enviado" | "firmado" | "vigente" | "vencido" | "rescindido";
export type OnboardingStatus = "pendiente" | "en_curso" | "bloqueado" | "completado";
export type OnboardingTaskType = "rne" | "croquis" | "plancheta" | "accesos" | "documentacion";
export type OnboardingTaskStatus = "pendiente" | "en_curso" | "completado" | "na";

export interface Opportunity {
  id: string;
  publicId: string;            // OPP-YYYY-NNNN
  empresa: string;             // razón social / cuenta
  cuit: string | null;
  contacto: string | null;
  email: string | null;
  telefono: string | null;
  serviceType: CrmService;
  m2: number | null;
  deposito: string | null;     // MAGALDI / LUJAN (sugerido)
  estado: CrmStage;
  probabilidad: number;        // 0..100
  monto: number | null;
  currency: string;
  ownerName: string;
  expectedClose: string | null; // ISO date
  clientifyDealId: string | null;
  // Integración capacidad (F2.1-4)
  capacityFeasible: boolean | null;
  assignedSite: string | null; // PEDRO_LUJAN_3159 | MAGALDI_1765
  assignedUnits: string[] | null;
  committedState: CommittedState;
  createdAt: string;
}

export interface QuoteItem {
  concepto: string;
  categoria: string;
  cantidad: number;
  unidad: string;
  precioUnit: number;
  importe: number;
}

export interface Quote {
  id: string;
  publicId: string;            // COT-YYYY-NNNN
  serviceType: CrmService;
  tarifarioRef: string;
  subtotal: number;
  descuentoTotal: number;
  iva: number;
  total: number;
  currency: string;
  status: QuoteStatus;
  items: QuoteItem[];
  createdAt: string;
}

export interface Proposal {
  id: string;
  publicId: string;            // PROP-YYYY-NNNN
  tipo: ProposalType;
  version: number;
  status: ProposalStatus;
  sentAt: string | null;
  viewedAt: string | null;
  quotePublicId: string | null;
  createdAt: string;
}

export interface Contract {
  id: string;
  publicId: string;            // CON-YYYY-NNNN
  version: number;
  status: ContractStatus;
  signedAt: string | null;
  signedBy: string | null;
  validFrom: string | null;
  validUntil: string | null;
  proposalPublicId: string | null;
  createdAt: string;
}

export interface OnboardingTask {
  tipo: OnboardingTaskType;
  titulo: string;
  status: OnboardingTaskStatus;
  assignee: string | null;
  dueDate: string | null;
  hasDocument: boolean;
}

export interface Onboarding {
  id: string;
  publicId: string;            // ONB-YYYY-NNNN
  status: OnboardingStatus;
  progressPct: number;
  startedAt: string | null;
  completedAt: string | null;
  tasks: OnboardingTask[];
}

export interface StageEvent {
  fromStage: CrmStage | null;
  toStage: CrmStage;
  changedBy: string;
  changedAt: string;
  note: string | null;
}

/** Oportunidad + todo lo que cuelga de ella (lo que muestra la Ficha 360°). */
export interface OpportunityFull {
  opportunity: Opportunity;
  quotes: Quote[];
  proposals: Proposal[];
  contract: Contract | null;
  onboarding: Onboarding | null;
  history: StageEvent[];
}

// ── Metadatos de presentación ───────────────────────────────────────────────

export const STAGE_ORDER: CrmStage[] = [
  "nuevo_lead", "contactado", "calificado", "visita",
  "propuesta", "negociacion", "ganado", "perdido",
];

export const STAGE_LABEL: Record<CrmStage, string> = {
  nuevo_lead: "Nuevo Lead",
  contactado: "Contactado",
  calificado: "Calificado",
  visita: "Visita",
  propuesta: "Propuesta",
  negociacion: "Negociación",
  ganado: "Ganado",
  perdido: "Perdido",
};

export const SERVICE_LABEL: Record<CrmService, string> = {
  anmat: "ANMAT",
  general: "Cargas Generales",
  oficinas: "Oficinas",
};

export const COMMITTED_LABEL: Record<CommittedState, string> = {
  none: "Sin compromiso",
  reservado: "Reservado",
  comprometido: "Comprometido",
  ocupado: "Ocupado",
};

/** Color por estado de etapa (semáforo del pipeline). */
export const STAGE_COLOR: Record<CrmStage, string> = {
  nuevo_lead: "#94a3b8",
  contactado: "#64748b",
  calificado: "#2563eb",
  visita: "#7c3aed",
  propuesta: "#ea580c",
  negociacion: "#d97706",
  ganado: "#16a34a",
  perdido: "#dc2626",
};
