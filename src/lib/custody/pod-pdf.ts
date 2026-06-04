import "server-only";
import { createHash, randomUUID } from "crypto";
import { renderToBuffer } from "@react-pdf/renderer";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import {
  attachCustodyEvidence,
  getCustodyTimeline,
  getDeliveryPodByShipment,
  getShipmentCustodySummary,
  getShipmentToken,
} from "@/lib/custody/custody";
import { custodyQrDataUrl } from "@/lib/custody/qr";
import { PodPdfDocument, type PodPdfData, type PodPdfPhoto } from "@/lib/custody/PodPdfDocument";
import { EVENT_TYPE_META, type CustodyEvidenceRef, type CustodyTimelineEvent } from "@/lib/custody/types";

/**
 * Orquestación del POD-PDF server-side (GATE 5.3 · B4). Reutiliza el patrón de
 * Compras/Pedidos (@react-pdf/renderer + renderToBuffer + upload a Storage):
 *
 *   1. Lee POD + timeline + resumen de cadena (RPC 0039/0036).
 *   2. Embebe firma + fotos (descarga service-role; render a data URL).
 *   3. Render del PDF a Buffer.
 *   4. Sube a bucket custody-pod (service-role).
 *   5. Registra el PDF como custody_evidence (kind=documento, stage/event 'pod')
 *      vía attach_custody_evidence → sha256 en la hash-chain + audit 'custody.attach'.
 *   6. Actualiza delivery_pods.pod_storage_path (service-role; sin trigger de
 *      inmutabilidad en delivery_pods).
 *
 * La DESCARGA del PDF por el usuario va por emit_custody_signed_url (auditado),
 * resuelto desde la evidencia documento (ver getPodPdfEvidenceId).
 *
 * ADDITIVE: no toca 0036–0039. Decisión: el PDF SÍ entra a la hash-chain como
 * evidencia 'pod' (refuerza integridad); la RPC generate_delivery_pod sigue sin
 * insertar el evento (0039 §16) — el evento lo crea esta capa al adjuntar el PDF.
 */

const POD_BUCKET = "custody-pod";
const MAX_EMBED_PHOTOS = 6;
const EMBEDDABLE = new Set(["image/png", "image/jpeg", "image/jpg"]);

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

/** Descarga un binario de Storage (service-role) y lo devuelve como data URL si es imagen embebible. */
async function toDataUrl(
  admin: ReturnType<typeof createAdminClient>,
  bucket: string,
  path: string
): Promise<string | null> {
  if (!admin) return null;
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) return null;
  const mime = data.type || "application/octet-stream";
  if (!EMBEDDABLE.has(mime.toLowerCase())) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  return `data:${mime};base64,${buf.toString("base64")}`;
}

interface EvidenceRowMeta {
  id: string;
  storage_bucket: string;
  storage_path: string;
  redacted: boolean;
}

/** Resuelve (service-role) bucket/path de un set de evidencias por id. */
async function resolveEvidencePaths(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[]
): Promise<Map<string, EvidenceRowMeta>> {
  const map = new Map<string, EvidenceRowMeta>();
  if (!admin || ids.length === 0) return map;
  const { data, error } = await admin
    .from("custody_evidence")
    .select("id, storage_bucket, storage_path, redacted")
    .in("id", ids);
  if (error || !data) return map;
  for (const r of data as EvidenceRowMeta[]) map.set(r.id, r);
  return map;
}

/**
 * Genera (o regenera) el POD-PDF de un shipment y deja delivery_pods.pod_storage_path
 * apuntando al binario en custody-pod. Idempotente con force=false (si ya hay path, no
 * reconstruye). Devuelve el path generado o el existente; null si no aplica (mock/sin POD).
 */
export async function generateAndStorePodPdf(
  shipmentId: string,
  opts: { force?: boolean } = {}
): Promise<{ path: string; evidenceId: string | null; regenerated: boolean } | null> {
  if (isMock()) return null;

  const pod = await getDeliveryPodByShipment(shipmentId);
  if (!pod) return null;
  if (pod.pod_storage_path && !opts.force) {
    return { path: pod.pod_storage_path, evidenceId: null, regenerated: false };
  }

  const admin = createAdminClient();
  if (!admin) throw new Error("Storage no configurado (falta SUPABASE_SERVICE_ROLE_KEY)");

  const [timeline, summary, token] = await Promise.all([
    getCustodyTimeline(null, shipmentId),
    getShipmentCustodySummary(shipmentId).catch(() => null),
    getShipmentToken(shipmentId).catch(() => null),
  ]);

  const eventNodes = timeline.nodes.filter(
    (n): n is CustodyTimelineEvent => n.type === "event"
  );

  // Evidencias a embeber: firma del POD + hasta N fotos del timeline.
  const photoRefs: { ref: CustodyEvidenceRef; caption: string }[] = [];
  for (const ev of eventNodes) {
    for (const e of ev.evidences) {
      if (e.kind === "foto" && !e.redacted && photoRefs.length < MAX_EMBED_PHOTOS) {
        photoRefs.push({ ref: e, caption: EVENT_TYPE_META[ev.event_type]?.label ?? ev.event_type });
      }
    }
  }

  const idsToResolve = [
    ...(pod.signature_evidence_id ? [pod.signature_evidence_id] : []),
    ...photoRefs.map((p) => p.ref.evidence_id),
  ];
  const paths = await resolveEvidencePaths(admin, idsToResolve);

  // Firma (custody-pii).
  let signatureDataUrl: string | null = null;
  if (pod.signature_evidence_id) {
    const meta = paths.get(pod.signature_evidence_id);
    if (meta && !meta.redacted) {
      signatureDataUrl = await toDataUrl(admin, meta.storage_bucket, meta.storage_path);
    }
  }

  // Fotos (custody-evidence).
  const photos: PodPdfPhoto[] = [];
  for (const p of photoRefs) {
    const meta = paths.get(p.ref.evidence_id);
    if (!meta || meta.redacted) continue;
    const dataUrl = await toDataUrl(admin, meta.storage_bucket, meta.storage_path);
    if (dataUrl) photos.push({ dataUrl, caption: p.caption });
  }

  const qrDataUrl = token ? await custodyQrDataUrl(token, env.app.url).catch(() => null) : null;

  const data: PodPdfData = {
    podPublicId: pod.public_id,
    shipmentPublicId: pod.shipment_public_id,
    shipmentId,
    receiverName: pod.receiver_name,
    receiverDocument: pod.receiver_document,
    observations: pod.observations,
    signedAt: pod.signed_at,
    timeline: eventNodes.map((n) => ({
      stage: n.stage,
      event_type: n.event_type,
      occurred_at: n.occurred_at,
      notes: n.notes,
      geo: n.geo ? { lat: n.geo.lat, lng: n.geo.lng } : null,
    })),
    signatureDataUrl,
    photos,
    qrDataUrl,
    chainValid: summary?.chain_valid ?? false,
    chainEventsChecked: summary?.chain_events_checked ?? 0,
    events: summary?.events ?? eventNodes.length,
    evidences: summary?.evidences ?? photoRefs.length,
    generatedAt: new Date().toISOString(),
  };

  // Render único → el sha256 del binario es el hash canónico (tamper-evidence) que
  // entra a la hash-chain como evidencia 'pod'. No se auto-referencia dentro del PDF.
  const buf = await renderToBuffer(
    PodPdfDocument(data) as unknown as React.ReactElement
  );
  const finalSha = createHash("sha256").update(buf).digest("hex");

  const path = `shipment/${shipmentId}/pod/${randomUUID()}.pdf`;
  const up = await admin.storage.from(POD_BUCKET).upload(path, buf, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (up.error) throw new Error(`upload POD-PDF: ${up.error.message}`);

  // Registrar el PDF como evidencia documento 'pod' (sha256 → hash-chain + audit).
  let evidenceId: string | null = null;
  try {
    const attach = await attachCustodyEvidence({
      shipmentId,
      packingUnitId: null,
      stage: "pod",
      eventType: "pod",
      kind: "documento",
      bucket: POD_BUCKET,
      storagePath: path,
      sha256: finalSha,
      fileName: `${pod.public_id}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: buf.byteLength,
      notes: "POD-PDF generado server-side",
    });
    evidenceId = attach.evidence_id;
  } catch (e) {
    // Si el attach falla, removemos el binario huérfano para no dejar basura en el bucket.
    await admin.storage.from(POD_BUCKET).remove([path]).catch(() => {});
    throw new Error(`attach POD-PDF: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Actualizar el puntero canónico en delivery_pods (sin trigger de inmutabilidad).
  const upd = await admin
    .from("delivery_pods")
    .update({ pod_storage_path: path })
    .eq("shipment_id", shipmentId);
  if (upd.error) throw new Error(`update pod_storage_path: ${upd.error.message}`);

  return { path, evidenceId, regenerated: Boolean(pod.pod_storage_path) };
}

/**
 * Resuelve el evidence_id del POD-PDF de un shipment (la evidencia 'documento' en
 * custody-pod cuyo path coincide con delivery_pods.pod_storage_path). Lo usa la
 * descarga auditada (emit_custody_signed_url). Devuelve null si aún no se generó.
 */
export async function getPodPdfEvidenceId(shipmentId: string): Promise<string | null> {
  if (isMock()) return null;
  const supabase = createClient();
  if (!supabase) return null;

  const pod = await getDeliveryPodByShipment(shipmentId);
  if (!pod?.pod_storage_path) return null;

  const { data, error } = await supabase
    .from("custody_evidence")
    .select("id, redacted")
    .eq("storage_bucket", POD_BUCKET)
    .eq("storage_path", pod.pod_storage_path)
    .eq("kind", "documento")
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; redacted: boolean };
  return row.redacted ? null : row.id;
}
