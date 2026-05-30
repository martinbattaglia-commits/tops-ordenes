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
  status: "open" | "won" | "lost" | "other";
  statusLabel: string;
  ownerName: string | null;
  expectedClose: string | null;
  actualClose: string | null;
  createdAt: string;
  modifiedAt: string;
  tags: string[];
  source: string | null;
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

const STATUS_MAP: Record<number, UiDeal["status"]> = {
  1: "open",
  2: "won",
  3: "other",
  4: "lost",
};

function extractIdFromUrl(url: string | null | undefined): number | null {
  if (!url) return null;
  const m = url.match(/\/(\d+)\/?$/);
  return m ? parseInt(m[1], 10) : null;
}

export function mapContact(c: ClientifyContact): UiContact {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || "—";
  return {
    id: c.id,
    name,
    email: c.emails?.[0]?.email ?? null,
    phone: c.phones?.[0]?.phone ?? null,
    status: c.status,
    ownerName: c.owner_name,
    companyUrl: c.company,
    taxId: c.taxpayer_identification_number || null,
    tags: c.tags ?? [],
    channel: c.channel,
    pictureUrl: c.picture_url,
    href: `https://app.clientify.com/contacts/contact_detail.html?id=${c.id}`,
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
    probability: d.probability,
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
