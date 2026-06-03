import { createClient, createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type {
  AttachEvidenceInput,
  AttachResult,
  CustodyEventRow,
  CustodyTimeline,
  CustodyTokenResult,
  DeliveryPodDetail,
  DeliveryPodRow,
  GeneratePodInput,
  RegisterEventInput,
  ShipmentCustodySummary,
  SignedUrlGrant,
  VerifyChainResult,
  CustodyEventType,
  CustodyStage,
} from "./types";

/**
 * Capa de datos de la Cadena de Custodia (GATE 5). Envuelve EXCLUSIVAMENTE las
 * RPC SECURITY DEFINER de 0036–0039 y lecturas tipadas vía PostGREST. Las
 * mutaciones (attach/register/redact/pod) van solo por RPC. Los binarios de
 * Storage se sirven SIEMPRE por emit_custody_signed_url (auditado). Sin SQL inline.
 */

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

// ===========================================================================
// Mutaciones — SOLO vía RPC SECURITY DEFINER
// ===========================================================================

/** Crea evento + evidencia (la app ya subió el archivo y pasa bucket/path/sha256). */
export async function attachCustodyEvidence(input: AttachEvidenceInput): Promise<AttachResult> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { data, error } = await supabase.rpc("attach_custody_evidence", {
    p_packing_unit_id: input.packingUnitId ?? null,
    p_shipment_id: input.shipmentId ?? null,
    p_stage: input.stage,
    p_event_type: input.eventType,
    p_kind: input.kind,
    p_bucket: input.bucket,
    p_storage_path: input.storagePath,
    p_sha256: input.sha256,
    p_file_name: input.fileName ?? null,
    p_mime_type: input.mimeType ?? null,
    p_size_bytes: input.sizeBytes ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throw new Error(`attachCustodyEvidence: ${error.message}`);
  return data as AttachResult;
}

/** Registra un evento sin archivo (cargado / en_transito / etc.). Devuelve event_id. */
export async function registerCustodyEvent(input: RegisterEventInput): Promise<string> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { data, error } = await supabase.rpc("register_custody_event", {
    p_packing_unit_id: input.packingUnitId ?? null,
    p_shipment_id: input.shipmentId ?? null,
    p_stage: input.stage,
    p_event_type: input.eventType,
    p_geo_lat: input.geoLat ?? null,
    p_geo_lng: input.geoLng ?? null,
    p_geo_source: input.geoSource ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throw new Error(`registerCustodyEvent: ${error.message}`);
  return data as string;
}

/** Verifica la integridad de la cadena de una entidad. */
export async function verifyCustodyChain(
  packingUnitId: string | null,
  shipmentId: string | null
): Promise<VerifyChainResult> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { data, error } = await supabase.rpc("verify_custody_chain", {
    p_packing_unit_id: packingUnitId,
    p_shipment_id: shipmentId,
  });
  if (error) throw new Error(`verifyCustodyChain: ${error.message}`);
  return data as VerifyChainResult;
}

/** Redacta (erasure de PII) una evidencia. No borra la fila. */
export async function redactCustodyEvidence(evidenceId: string, reason?: string | null): Promise<void> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { error } = await supabase.rpc("redact_custody_evidence", {
    p_evidence_id: evidenceId,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(`redactCustodyEvidence: ${error.message}`);
}

/** Genera el POD de un shipment. */
export async function generateDeliveryPod(input: GeneratePodInput): Promise<{ pod_id: string; public_id: string }> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { data, error } = await supabase.rpc("generate_delivery_pod", {
    p_shipment_id: input.shipmentId,
    p_receiver_name: input.receiverName,
    p_receiver_document: input.receiverDocument ?? null,
    p_observations: input.observations ?? null,
    p_signature_evidence_id: input.signatureEvidenceId ?? null,
    p_pod_storage_path: input.podStoragePath ?? null,
  });
  if (error) throw new Error(`generateDeliveryPod: ${error.message}`);
  return data as { pod_id: string; public_id: string };
}

// ===========================================================================
// Signed URL — emit (auditado) + firma (Supabase SDK). Único camino al binario.
// ===========================================================================

/** Emite el grant (autoriza + audita la lectura). La firma del URL la hace la app. */
export async function emitCustodySignedUrl(evidenceId: string, reason?: string | null): Promise<SignedUrlGrant> {
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { data, error } = await supabase.rpc("emit_custody_signed_url", {
    p_evidence_id: evidenceId,
    p_reason: reason ?? null,
    p_ip: null,
  });
  if (error) throw new Error(`emitCustodySignedUrl: ${error.message}`);
  return data as SignedUrlGrant;
}

/** Emite el grant (auditado) y firma el signed URL (service-role). TTL corto. */
export async function getEvidenceSignedUrl(evidenceId: string, reason?: string | null): Promise<string> {
  const grant = await emitCustodySignedUrl(evidenceId, reason);
  const admin = createAdminClient() ?? createClient();
  if (!admin) throw new Error("Supabase no configurado");
  const { data, error } = await admin.storage.from(grant.bucket).createSignedUrl(grant.path, 300);
  if (error) throw new Error(`signedUrl: ${error.message}`);
  return data.signedUrl;
}

// ===========================================================================
// Lecturas estructuradas (RPC) + mocks demo
// ===========================================================================

const MOCK_TIMELINE: CustodyTimeline = {
  scope: "shipment",
  entity_id: "ship-demo",
  nodes: [
    {
      type: "event", event_id: "ev-1", public_id: "CUST-2026-0001", stage: "packing",
      event_type: "foto_packing", actor_id: null, occurred_at: "2026-06-03T10:00:00Z",
      geo: null, notes: null,
      evidences: [{ evidence_id: "evi-1", kind: "foto", bucket: "custody-evidence", sha256: "abc", redacted: false }],
    },
    {
      type: "event", event_id: "ev-2", public_id: "CUST-2026-0002", stage: "despacho",
      event_type: "cargado", actor_id: null, occurred_at: "2026-06-03T12:00:00Z",
      geo: { lat: -34.6037, lng: -58.3816, source: "device" }, notes: "Cargado al camión",
      evidences: [],
    },
    {
      type: "pod", pod_id: "pod-1", public_id: "POD-2026-0001", signed_at: "2026-06-03T16:00:00Z",
      receiver_name: "Juan Receptor", has_document: true, signature_evidence_id: "evi-firma",
    },
  ],
};

export async function getCustodyTimeline(
  packingUnitId: string | null,
  shipmentId: string | null
): Promise<CustodyTimeline> {
  if (isMock()) return MOCK_TIMELINE;
  const supabase = createClient();
  if (!supabase) return MOCK_TIMELINE;
  const { data, error } = await supabase.rpc("get_custody_timeline", {
    p_packing_unit_id: packingUnitId,
    p_shipment_id: shipmentId,
  });
  if (error) throw new Error(`getCustodyTimeline: ${error.message}`);
  return data as CustodyTimeline;
}

export async function getCustodyByToken(token: string): Promise<CustodyTokenResult | null> {
  if (isMock()) {
    return {
      scope: "shipment", public_id: "DSP-2026-0001", status: "entregado", pod_present: true,
      events: [{ stage: "packing", event_type: "foto_packing", occurred_at: "2026-06-03T10:00:00Z" }],
    };
  }
  const supabase = createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_custody_by_token", { p_token: token });
  if (error) {
    if (error.message?.includes("no resuelto") || error.code === "P0002") return null;
    throw new Error(`getCustodyByToken: ${error.message}`);
  }
  return data as CustodyTokenResult;
}

export async function getShipmentCustodySummary(shipmentId: string): Promise<ShipmentCustodySummary> {
  if (isMock()) {
    return { shipment_id: shipmentId, events: 3, evidences: 2, pod_present: true, chain_valid: true, chain_events_checked: 3, last_activity: "2026-06-03T16:00:00Z" };
  }
  const supabase = createClient();
  if (!supabase) throw new Error("Supabase no configurado");
  const { data, error } = await supabase.rpc("get_shipment_custody_summary", { p_shipment_id: shipmentId });
  if (error) throw new Error(`getShipmentCustodySummary: ${error.message}`);
  return data as ShipmentCustodySummary;
}

// ===========================================================================
// Lecturas de lista (dashboard) — PostGREST (RLS lectura authenticated)
// ===========================================================================

interface RawEvent {
  id: string; public_id: string; stage: string; event_type: string;
  packing_unit_id: string | null; shipment_id: string | null; occurred_at: string;
  custody_evidence?: { id: string }[] | null;
}

const MOCK_EVENTS: CustodyEventRow[] = [
  { id: "ev-1", public_id: "CUST-2026-0002", stage: "despacho", event_type: "cargado", scope: "shipment", entity_id: "ship-demo", occurred_at: "2026-06-03T12:00:00Z", has_evidence: false },
  { id: "ev-2", public_id: "CUST-2026-0001", stage: "packing", event_type: "foto_packing", scope: "packing_unit", entity_id: "bulto-demo", occurred_at: "2026-06-03T10:00:00Z", has_evidence: true },
];

export async function listRecentCustodyEvents(limit = 50): Promise<CustodyEventRow[]> {
  if (isMock()) return MOCK_EVENTS;
  const supabase = createClient();
  if (!supabase) return MOCK_EVENTS;
  const { data, error } = await supabase
    .from("custody_events")
    .select("id, public_id, stage, event_type, packing_unit_id, shipment_id, occurred_at, custody_evidence(id)")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listRecentCustodyEvents: ${error.message}`);
  return ((data ?? []) as unknown as RawEvent[]).map((e): CustodyEventRow => ({
    id: e.id,
    public_id: e.public_id,
    stage: e.stage as CustodyStage,
    event_type: e.event_type as CustodyEventType,
    scope: e.packing_unit_id ? "packing_unit" : "shipment",
    entity_id: (e.packing_unit_id ?? e.shipment_id) as string,
    occurred_at: e.occurred_at,
    has_evidence: (e.custody_evidence?.length ?? 0) > 0,
  }));
}

interface RawPod {
  id: string; public_id: string; shipment_id: string; receiver_name: string;
  signed_at: string | null; signature_evidence_id: string | null; receiver_document: string | null;
  observations: string | null; pod_storage_path: string | null;
  shipments?: { public_id: string } | { public_id: string }[] | null;
}

function shipPub(s: RawPod["shipments"]): string | null {
  if (!s) return null;
  return Array.isArray(s) ? (s[0]?.public_id ?? null) : s.public_id;
}

const MOCK_PODS: DeliveryPodRow[] = [
  { id: "pod-1", public_id: "POD-2026-0001", shipment_id: "ship-demo", shipment_public_id: "DSP-2026-0001", receiver_name: "Juan Receptor", signed_at: "2026-06-03T16:00:00Z", has_signature: true },
];

export async function listRecentPods(limit = 50): Promise<DeliveryPodRow[]> {
  if (isMock()) return MOCK_PODS;
  const supabase = createClient();
  if (!supabase) return MOCK_PODS;
  const { data, error } = await supabase
    .from("delivery_pods")
    .select("id, public_id, shipment_id, receiver_name, signed_at, signature_evidence_id, shipments(public_id)")
    .order("signed_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listRecentPods: ${error.message}`);
  return ((data ?? []) as unknown as RawPod[]).map((p): DeliveryPodRow => ({
    id: p.id, public_id: p.public_id, shipment_id: p.shipment_id,
    shipment_public_id: shipPub(p.shipments), receiver_name: p.receiver_name,
    signed_at: p.signed_at, has_signature: p.signature_evidence_id != null,
  }));
}

export async function getDeliveryPodByShipment(shipmentId: string): Promise<DeliveryPodDetail | null> {
  if (isMock()) {
    return { id: "pod-1", public_id: "POD-2026-0001", shipment_id: shipmentId, shipment_public_id: "DSP-2026-0001", receiver_name: "Juan Receptor", signed_at: "2026-06-03T16:00:00Z", has_signature: true, receiver_document: "30.123.456", observations: "Entrega conforme", signature_evidence_id: "evi-firma", pod_storage_path: null };
  }
  const supabase = createClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("delivery_pods")
    .select("id, public_id, shipment_id, receiver_name, receiver_document, observations, signature_evidence_id, pod_storage_path, signed_at, shipments(public_id)")
    .eq("shipment_id", shipmentId)
    .maybeSingle();
  if (error) throw new Error(`getDeliveryPodByShipment: ${error.message}`);
  if (!data) return null;
  const p = data as unknown as RawPod;
  return {
    id: p.id, public_id: p.public_id, shipment_id: p.shipment_id, shipment_public_id: shipPub(p.shipments),
    receiver_name: p.receiver_name, receiver_document: p.receiver_document, observations: p.observations,
    signature_evidence_id: p.signature_evidence_id, pod_storage_path: p.pod_storage_path,
    signed_at: p.signed_at, has_signature: p.signature_evidence_id != null,
  };
}

/** custody_token de un shipment (para generar el QR del despacho). */
export async function getShipmentToken(shipmentId: string): Promise<string | null> {
  if (isMock()) return "tok-demo-shipment";
  const supabase = createClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("shipments")
    .select("custody_token")
    .eq("id", shipmentId)
    .maybeSingle();
  if (error) throw new Error(`getShipmentToken: ${error.message}`);
  return (data as { custody_token: string } | null)?.custody_token ?? null;
}

export type { CustodyStage, CustodyEventType };
