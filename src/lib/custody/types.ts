/**
 * Tipos de dominio de la Cadena de Custodia (GATE 5 · capa de aplicación).
 *
 * Espeja los contratos de las RPC SECURITY DEFINER de 0036–0039. Esta capa SOLO
 * envuelve RPC (mutaciones) y lecturas tipadas; NO escribe SQL inline ni accede
 * directo a Storage (los binarios se sirven SIEMPRE vía emit_custody_signed_url).
 */

/** Etapa de la cadena (espejo de custody_stage_t, 0036). */
export type CustodyStage = "packing" | "despacho" | "transporte" | "entrega" | "pod";

/** Tipo de evento (espejo de custody_event_type_t, 0036). */
export type CustodyEventType =
  | "foto_packing"
  | "cargado"
  | "en_transito"
  | "foto_entrega"
  | "firmado"
  | "pod";

/** Tipo de evidencia (espejo de evidence_kind_t, 0036). */
export type EvidenceKind = "foto" | "firma" | "documento";

/** Buckets privados de Storage (0037). */
export type CustodyBucket = "custody-evidence" | "custody-pii" | "custody-pod";

export const STAGE_META: Record<CustodyStage, { label: string; color: string }> = {
  packing: { label: "Packing", color: "#ea580c" },
  despacho: { label: "Despacho", color: "#7c3aed" },
  transporte: { label: "Transporte", color: "#2563eb" },
  entrega: { label: "Entrega", color: "#0d9488" },
  pod: { label: "POD", color: "#16a34a" },
};

export const EVENT_TYPE_META: Record<CustodyEventType, { label: string }> = {
  foto_packing: { label: "Foto de packing" },
  cargado: { label: "Cargado al vehículo" },
  en_transito: { label: "En tránsito" },
  foto_entrega: { label: "Foto de entrega" },
  firmado: { label: "Firmado por receptor" },
  pod: { label: "POD generado" },
};

export const EVIDENCE_KIND_META: Record<EvidenceKind, { label: string; icon: string }> = {
  foto: { label: "Foto", icon: "eye" },
  firma: { label: "Firma", icon: "pen" },
  documento: { label: "Documento", icon: "file-pdf" },
};

/** Referencia de evidencia en el timeline (metadatos; binario vía signed URL). */
export interface CustodyEvidenceRef {
  evidence_id: string;
  kind: EvidenceKind;
  bucket: CustodyBucket;
  sha256: string;
  redacted: boolean;
}

export interface CustodyGeo {
  lat: number;
  lng: number;
  source: string | null;
}

/** Nodo de evento del timeline (get_custody_timeline). */
export interface CustodyTimelineEvent {
  type: "event";
  event_id: string;
  public_id: string; // 'CUST-...'
  stage: CustodyStage;
  event_type: CustodyEventType;
  actor_id: string | null;
  occurred_at: string;
  geo: CustodyGeo | null;
  notes: string | null;
  evidences: CustodyEvidenceRef[];
}

/** Nodo de POD del timeline. */
export interface CustodyTimelinePod {
  type: "pod";
  pod_id: string;
  public_id: string; // 'POD-...'
  signed_at: string | null;
  receiver_name: string | null;
  has_document: boolean;
  signature_evidence_id: string | null;
}

export type CustodyTimelineNode = CustodyTimelineEvent | CustodyTimelinePod;

export interface CustodyTimeline {
  scope: "packing_unit" | "shipment";
  entity_id: string;
  nodes: CustodyTimelineNode[];
}

/** Resultado de get_custody_by_token (QR · SIN PII). */
export interface CustodyTokenResult {
  scope: "packing_unit" | "shipment";
  public_id: string; // BLT- / DSP-
  status: string;
  pod_present: boolean;
  events: { stage: CustodyStage; event_type: CustodyEventType; occurred_at: string }[];
}

/** Resumen ejecutivo (get_shipment_custody_summary). */
export interface ShipmentCustodySummary {
  shipment_id: string;
  events: number;
  evidences: number;
  pod_present: boolean;
  chain_valid: boolean;
  chain_events_checked: number;
  last_activity: string | null;
}

/** Resultado de verify_custody_chain. */
export interface VerifyChainResult {
  valid: boolean;
  events_checked: number;
  first_error: { public_id?: string; chain_seq?: number; reason?: string } | null;
}

/** Grant de emit_custody_signed_url (la app firma el URL con esto). */
export interface SignedUrlGrant {
  evidence_id: string;
  bucket: CustodyBucket;
  path: string;
  kind: EvidenceKind;
  reason: string | null;
  issued_by: string | null;
  issued_at: string;
}

/** Resultado de attach_custody_evidence. */
export interface AttachResult {
  event_id: string;
  event_public_id: string;
  evidence_id: string;
}

/** Input de captura de evidencia (la app sube el archivo y pasa bucket/path/sha256). */
export interface AttachEvidenceInput {
  packingUnitId?: string | null;
  shipmentId?: string | null;
  stage: CustodyStage;
  eventType: CustodyEventType;
  kind: EvidenceKind;
  bucket: CustodyBucket;
  storagePath: string;
  sha256: string;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  notes?: string | null;
}

/** Input de evento sin archivo. */
export interface RegisterEventInput {
  packingUnitId?: string | null;
  shipmentId?: string | null;
  stage: CustodyStage;
  eventType: CustodyEventType;
  geoLat?: number | null;
  geoLng?: number | null;
  geoSource?: string | null;
  notes?: string | null;
}

/** Input de generación de POD. */
export interface GeneratePodInput {
  shipmentId: string;
  receiverName: string;
  receiverDocument?: string | null;
  observations?: string | null;
  signatureEvidenceId?: string | null;
  podStoragePath?: string | null;
}

/** Fila de evento para el dashboard (lectura de lista). */
export interface CustodyEventRow {
  id: string;
  public_id: string;
  stage: CustodyStage;
  event_type: CustodyEventType;
  scope: "packing_unit" | "shipment";
  entity_id: string;
  occurred_at: string;
  has_evidence: boolean;
}

/** Fila de POD para el dashboard. */
export interface DeliveryPodRow {
  id: string;
  public_id: string;
  shipment_id: string;
  shipment_public_id: string | null;
  receiver_name: string;
  signed_at: string | null;
  has_signature: boolean;
}

/** Detalle de POD para la POD Surface. */
export interface DeliveryPodDetail extends DeliveryPodRow {
  receiver_document: string | null;
  observations: string | null;
  signature_evidence_id: string | null;
  pod_storage_path: string | null;
}
