import type { ClientifyContact, ClientifyDeal, ClientifyPipeline } from "./types";

/**
 * Mappers entre tipos de Clientify y los tipos UI internos.
 * El objetivo: que las pages no hablen Clientify directamente — siempre
 * pasen por este mapper para que un cambio futuro de CRM no impacte la UI.
 */

export interface UiContact {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  ownerName: string | null;
  companyUrl: string | null;
  companyName: string | null; // razón social de la empresa vinculada
  companyHref: string | null; // deeplink a la ficha de empresa en Clientify
  taxId: string | null;
  tags: string[];
  channel: string;
  pictureUrl: string | null;
  href: string; // URL pública del contacto en Clientify (deeplink)
}

export interface UiDeal {
  id: number;
  title: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  companyName: string | null;
  amount: number;
  currency: string;
  stage: string;
  stageId: number | null;
  pipeline: string;
  pipelineId: number | null;
  probability: number;
  probabilityLabel: string;
  status: "open" | "expired" | "won" | "lost" | "other";
  statusLabel: string;
  ownerName: string | null;
  expectedClose: string | null;
  actualClose: string | null;
  createdAt: string;
  modifiedAt: string;
  tags: string[];
  source: string | null;
  deal_source: string | null;
  lossReason: string | null; // campo nativo de Clientify, solo en GET /deals/{id}/
  href: string;
}

export interface UiStage {
  id: number;
  name: string;
  pipelineId: number;
  pipelineName: string;
  position: number;
  probability: number;
}

export interface UiPipeline {
  id: number;
  name: string;
  isDefault: boolean;
  stages: UiStage[];
}

// Clientify status reales (verificado contra status_desc en vivo · CRM-C3):
//   1=Open, 2=Expired, 3=Won, 4=Lost. (El mapeo previo 2→won/3→other era incorrecto.)
const STATUS_MAP: Record<number, UiDeal["status"]> = {
  1: "open",
  2: "expired",
  3: "won",
  4: "lost",
};

function extractIdFromUrl(url: string | null | undefined): number | null {
  if (!url) return null;
  const m = url.match(/\/(\d+)\/?$/);
  return m ? parseInt(m[1], 10) : null;
}

export function mapContact(c: ClientifyContact): UiContact {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || "—";
  const companyId = extractIdFromUrl(c.company);
  return {
    id: c.id,
    name,
    email: c.emails?.[0]?.email ?? null,
    phone: c.phones?.[0]?.phone ?? null,
    status: c.status,
    ownerName: c.owner_name,
    companyUrl: c.company,
    companyName: c.company_name?.trim() || null,
    companyHref: companyId
      ? `https://new.clientify.com/contacts/companies/details/${companyId}`
      : null,
    taxId: c.taxpayer_identification_number || null,
    tags: c.tags ?? [],
    channel: c.channel,
    pictureUrl: c.picture_url,
    href: `https://new.clientify.com/contacts/details/${c.id}`,
  };
}

export function mapDeal(d: ClientifyDeal): UiDeal {
  const amount = parseFloat(d.amount ?? "0") || 0;
  return {
    id: d.id,
    title: d.name,
    contactName: d.contact_name,
    contactEmail: d.contact_email,
    contactPhone: d.contact_phone,
    companyName: d.company_name,
    amount,
    currency: d.currency || "ARS",
    stage: d.pipeline_stage_desc,
    stageId: extractIdFromUrl(d.pipeline_stage),
    pipeline: d.pipeline_desc,
    pipelineId: extractIdFromUrl(d.pipeline),
    probability: d.probability * 10, // Clientify uses 0-10 scale; multiply to get 0-100
    probabilityLabel: d.probability_desc,
    status: STATUS_MAP[d.status] ?? "other",
    statusLabel: d.status_desc,
    ownerName: d.owner_name,
    expectedClose: d.expected_closed_date,
    actualClose: d.actual_closed_date,
    createdAt: d.created,
    modifiedAt: d.modified,
    tags: d.tags ?? [],
    source: d.deal_source,
    deal_source: d.deal_source ?? null,
    lossReason: d.lost_reason ?? null,
    href: `https://new.clientify.com/sales/deals/details/${d.id}`,
  };
}

export function mapPipeline(p: ClientifyPipeline): UiPipeline {
  return {
    id: p.id,
    name: p.name,
    isDefault: p.is_default || p.user_default,
    stages: (p.stages ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      pipelineId: p.id,
      pipelineName: p.name,
      position: s.position,
      probability: s.probability,
    })),
  };
}
