/**
 * opportunities-mapper.ts — F2.1-7 · mapeo PURO fila DB (snake_case) → tipos TS.
 *
 * Sin dependencias de Supabase ni de alias: solo `./crm-types`. Reutilizable por
 * el accesor Supabase (`opportunities-supabase.ts`) y por la evidencia contra
 * staging. Garantiza que la UI ve la MISMA forma venga de local o de la base.
 */

import type {
  Opportunity, OpportunityFull, Quote, Proposal, Contract, Onboarding, StageEvent,
  CrmService, CrmStage, CommittedState, QuoteStatus, ProposalType, ProposalStatus,
  ContractStatus, OnboardingStatus, OnboardingTaskType, OnboardingTaskStatus,
} from "./crm-types";
import { isClientifyApiUrl } from "./opportunity-title";

const num = (x: unknown): number | null => (x == null ? null : Number(x));
const numOr0 = (x: unknown): number => Number(x ?? 0);
const str = (x: unknown): string | null => (x == null ? null : String(x));
/** Texto sólo si NO es una URL técnica de Clientify (anti-URL en el título). */
const safeStr = (x: unknown): string | null => {
  const s = str(x);
  return s && !isClientifyApiUrl(s) ? s : null;
};

// ── Formas crudas de la base (snake_case, como devuelve PostgREST/pg) ──────────

export interface RawQuoteItem {
  concepto: string; categoria: string | null; cantidad: number | string;
  unidad: string; precio_unit: number | string; importe: number | string; orden?: number;
}
export interface RawQuote {
  id: string; public_id: string | null; service_type: string; tarifario_ref: string | null;
  subtotal: number | string; descuento_total: number | string; iva: number | string;
  total: number | string; currency: string; status: string; created_at: string;
  crm_quote_items?: RawQuoteItem[] | null;
}
export interface RawProposal {
  id: string; public_id: string | null; tipo: string; version: number; status: string;
  sent_at: string | null; viewed_at: string | null; quote_id: string | null; created_at: string;
}
export interface RawContract {
  id: string; public_id: string | null; version: number; status: string;
  signed_at: string | null; signed_by: string | null; valid_from: string | null;
  valid_until: string | null; proposal_id: string | null; created_at: string;
}
export interface RawOnboardingTask {
  tipo: string; titulo: string; status: string; assignee_id: string | null;
  due_date: string | null; document_id: string | null; orden?: number;
}
export interface RawOnboarding {
  id: string; public_id: string | null; status: string; progress_pct: number;
  started_at: string | null; completed_at: string | null;
  crm_onboarding_tasks?: RawOnboardingTask[] | null;
}
export interface RawStage {
  from_stage: string | null; to_stage: string; changed_by: string | null;
  changed_at: string; note: string | null;
}
export interface RawOpportunity {
  id: string; public_id: string | null; cuit: string | null; contacto: string | null;
  email: string | null; telefono: string | null; service_type: string; m2: number | string | null;
  deposito: string | null; estado: string; probabilidad: number; monto: number | string | null;
  currency: string; owner_id: string | null; owner_name?: string | null;
  company_name?: string | null; clientify_deal_name?: string | null;
  clientify_pipeline?: string | null; clientify_modified?: string | null;
  expected_close: string | null; clientify_deal_id: string | null;
  capacity_feasible: boolean | null; assigned_site: string | null; assigned_units: unknown;
  committed_state: string; created_at: string;
  clients?: { razon: string } | { razon: string }[] | null;
}
export interface RawOpportunityFull extends RawOpportunity {
  crm_quotes?: RawQuote[] | null;
  crm_proposals?: RawProposal[] | null;
  crm_contracts?: RawContract[] | null;
  crm_onboarding?: RawOnboarding[] | null;
  crm_stage_history?: RawStage[] | null;
}

// ── Mapeo ─────────────────────────────────────────────────────────────────────

function razonOf(c: RawOpportunity["clients"]): string | null {
  if (!c) return null;
  const o = Array.isArray(c) ? c[0] : c;
  return o?.razon ?? null;
}

export function mapOpportunity(r: RawOpportunity): Opportunity {
  // Empresa: cliente linkeado → company_name (Clientify, saneado anti-URL) → contacto → "—".
  // safeStr descarta URLs técnicas de Clientify para que jamás se filtren como título.
  const empresa = razonOf(r.clients) ?? safeStr(r.company_name) ?? r.contacto ?? "—";
  return {
    id: r.id,
    publicId: r.public_id ?? r.id,
    empresa,
    cuit: r.cuit,
    contacto: r.contacto,
    email: r.email,
    telefono: r.telefono,
    serviceType: r.service_type as CrmService,
    m2: num(r.m2),
    deposito: r.deposito,
    estado: r.estado as CrmStage,
    probabilidad: r.probabilidad,
    monto: num(r.monto),
    currency: r.currency ?? "ARS",
    ownerName: r.owner_name ?? "—",
    companyName: safeStr(r.company_name),
    dealName: safeStr(r.clientify_deal_name),
    pipeline: str(r.clientify_pipeline),
    lastActivityAt: r.clientify_modified ?? r.created_at,
    expectedClose: r.expected_close,
    clientifyDealId: r.clientify_deal_id,
    capacityFeasible: r.capacity_feasible,
    assignedSite: r.assigned_site,
    assignedUnits: Array.isArray(r.assigned_units) ? (r.assigned_units as unknown[]).map(String) : null,
    committedState: r.committed_state as CommittedState,
    createdAt: r.created_at,
  };
}

function mapQuote(q: RawQuote): Quote {
  return {
    id: q.id,
    publicId: q.public_id ?? q.id,
    serviceType: q.service_type as CrmService,
    tarifarioRef: q.tarifario_ref ?? "—",
    subtotal: numOr0(q.subtotal),
    descuentoTotal: numOr0(q.descuento_total),
    iva: numOr0(q.iva),
    total: numOr0(q.total),
    currency: q.currency ?? "ARS",
    status: q.status as QuoteStatus,
    createdAt: q.created_at,
    items: (q.crm_quote_items ?? [])
      .slice()
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      .map((it) => ({
        concepto: it.concepto,
        categoria: it.categoria ?? "",
        cantidad: numOr0(it.cantidad),
        unidad: it.unidad,
        precioUnit: numOr0(it.precio_unit),
        importe: numOr0(it.importe),
      })),
  };
}

export function mapOpportunityFull(r: RawOpportunityFull): OpportunityFull {
  const quotes = (r.crm_quotes ?? []).map(mapQuote);
  const quoteIdToPub = new Map(quotes.map((q) => [q.id, q.publicId]));
  const rawProps = r.crm_proposals ?? [];
  const propIdToPub = new Map(rawProps.map((p) => [p.id, p.public_id ?? p.id]));

  const proposals: Proposal[] = rawProps.map((p) => ({
    id: p.id,
    publicId: p.public_id ?? p.id,
    tipo: p.tipo as ProposalType,
    version: p.version,
    status: p.status as ProposalStatus,
    sentAt: p.sent_at,
    viewedAt: p.viewed_at,
    quotePublicId: p.quote_id ? quoteIdToPub.get(p.quote_id) ?? null : null,
    createdAt: p.created_at,
  }));

  // contrato: el de mayor versión (último)
  const rawContracts = (r.crm_contracts ?? []).slice().sort((a, b) => b.version - a.version);
  const rc = rawContracts[0];
  const contract: Contract | null = rc
    ? {
        id: rc.id,
        publicId: rc.public_id ?? rc.id,
        version: rc.version,
        status: rc.status as ContractStatus,
        signedAt: rc.signed_at,
        signedBy: rc.signed_by,
        validFrom: rc.valid_from,
        validUntil: rc.valid_until,
        proposalPublicId: rc.proposal_id ? propIdToPub.get(rc.proposal_id) ?? null : null,
        createdAt: rc.created_at,
      }
    : null;

  const ro = (r.crm_onboarding ?? [])[0];
  const onboarding: Onboarding | null = ro
    ? {
        id: ro.id,
        publicId: ro.public_id ?? ro.id,
        status: ro.status as OnboardingStatus,
        progressPct: ro.progress_pct,
        startedAt: ro.started_at,
        completedAt: ro.completed_at,
        tasks: (ro.crm_onboarding_tasks ?? [])
          .slice()
          .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
          .map((t) => ({
            tipo: t.tipo as OnboardingTaskType,
            titulo: t.titulo,
            status: t.status as OnboardingTaskStatus,
            assignee: str(t.assignee_id),
            dueDate: t.due_date,
            hasDocument: t.document_id != null,
          })),
      }
    : null;

  const history: StageEvent[] = (r.crm_stage_history ?? [])
    .slice()
    .sort((a, b) => a.changed_at.localeCompare(b.changed_at))
    .map((h) => ({
      fromStage: (h.from_stage as CrmStage) ?? null,
      toStage: h.to_stage as CrmStage,
      changedBy: str(h.changed_by) ?? "—",
      changedAt: h.changed_at,
      note: h.note,
    }));

  return { opportunity: mapOpportunity(r), quotes, proposals, contract, onboarding, history };
}
