"use server";

import { createHash, randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import {
  attachCustodyEvidence,
  registerCustodyEvent,
  generateDeliveryPod,
  redactCustodyEvidence,
  getEvidenceSignedUrl,
} from "@/lib/custody/custody";
import { generateAndStorePodPdf, getPodPdfEvidenceId } from "@/lib/custody/pod-pdf";
import type {
  CustodyBucket,
  CustodyEventType,
  CustodyStage,
  EvidenceKind,
  GeneratePodInput,
  RegisterEventInput,
} from "@/lib/custody/types";

/**
 * Server Actions de la Cadena de Custodia (GATE 5). Toda mutación va por RPC
 * SECURITY DEFINER (0036–0039); la UI nunca escribe directo. Refresco por
 * revalidatePath() — sin router.refresh() (criterio anti-503 de 4A/4B/4C).
 * La autorización/validación la enforce la RPC; acá solo se orquesta + revalida.
 */

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

function revalidate(extra?: string): void {
  revalidatePath("/wms/custody");
  if (extra) revalidatePath(extra);
}

/** Sube un archivo de evidencia a Storage (service-role) y lo adjunta vía attach RPC. */
export async function attachEvidenceAction(form: FormData): Promise<Result<{ evidence_id: string; event_public_id: string }>> {
  try {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Archivo requerido" };

    const scope = String(form.get("scope") ?? ""); // 'packing_unit' | 'shipment'
    const entityId = String(form.get("entity_id") ?? "");
    const stage = String(form.get("stage") ?? "") as CustodyStage;
    const eventType = String(form.get("event_type") ?? "") as CustodyEventType;
    const kind = String(form.get("kind") ?? "foto") as EvidenceKind;
    const notes = (form.get("notes") as string | null) || null;
    const revalHint = (form.get("revalidate") as string | null) || null;
    if (!entityId) return { ok: false, error: "Entidad requerida" };

    // Bucket por sensibilidad (firma/documento = PII).
    const bucket: CustodyBucket = kind === "foto" ? "custody-evidence" : "custody-pii";

    // sha256 del binario + path dentro del bucket.
    const bytes = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const storagePath = `${scope}/${entityId}/${stage}/${randomUUID()}.${ext}`;

    const admin = createAdminClient() ?? createClient();
    if (!admin) return { ok: false, error: "Supabase no configurado" };
    const up = await admin.storage.from(bucket).upload(storagePath, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (up.error) return { ok: false, error: `upload: ${up.error.message}` };

    const res = await attachCustodyEvidence({
      packingUnitId: scope === "packing_unit" ? entityId : null,
      shipmentId: scope === "shipment" ? entityId : null,
      stage,
      eventType,
      kind,
      bucket,
      storagePath,
      sha256,
      fileName: file.name,
      mimeType: file.type || null,
      sizeBytes: file.size,
      notes,
    });
    revalidate(revalHint ?? undefined);
    return { ok: true, data: { evidence_id: res.evidence_id, event_public_id: res.event_public_id } };
  } catch (e) {
    return fail(e);
  }
}

/** Registra un evento sin archivo (cargado / en_transito / etc.). */
export async function registerEventAction(input: RegisterEventInput, revalHint?: string): Promise<Result<{ event_id: string }>> {
  try {
    const eventId = await registerCustodyEvent(input);
    revalidate(revalHint);
    return { ok: true, data: { event_id: eventId } };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Genera el POD de un shipment y, a continuación, construye el POD-PDF server-side
 * (sube a custody-pod + completa pod_storage_path). El PDF es best-effort: si falla,
 * el POD queda creado y se puede regenerar (regeneratePodPdfAction) sin perder datos.
 */
export async function generatePodAction(
  input: GeneratePodInput,
  revalHint?: string
): Promise<Result<{ pod_id: string; public_id: string; pdf_path?: string; pdf_warning?: string }>> {
  try {
    const res = await generateDeliveryPod(input);
    let pdf_path: string | undefined;
    let pdf_warning: string | undefined;
    try {
      const pdf = await generateAndStorePodPdf(input.shipmentId, { force: true });
      pdf_path = pdf?.path;
    } catch (e) {
      pdf_warning = e instanceof Error ? e.message : String(e);
    }
    revalidate(revalHint);
    return { ok: true, data: { ...res, pdf_path, pdf_warning } };
  } catch (e) {
    return fail(e);
  }
}

/** (Re)genera el POD-PDF server-side de un POD ya existente (idempotente con force). */
export async function regeneratePodPdfAction(
  shipmentId: string,
  revalHint?: string
): Promise<Result<{ path: string }>> {
  try {
    const pdf = await generateAndStorePodPdf(shipmentId, { force: true });
    if (!pdf) return { ok: false, error: "No hay POD para este despacho (o modo demo)." };
    revalidate(revalHint);
    return { ok: true, data: { path: pdf.path } };
  } catch (e) {
    return fail(e);
  }
}

/** Emite (auditado) y firma un signed URL para descargar el POD-PDF de un shipment. */
export async function podPdfSignedUrlAction(shipmentId: string): Promise<Result<{ url: string }>> {
  try {
    const evidenceId = await getPodPdfEvidenceId(shipmentId);
    if (!evidenceId) return { ok: false, error: "El POD-PDF aún no fue generado." };
    const url = await getEvidenceSignedUrl(evidenceId, "descarga_pod");
    return { ok: true, data: { url } };
  } catch (e) {
    return fail(e);
  }
}

/** Redacta (erasure de PII) una evidencia. */
export async function redactEvidenceAction(evidenceId: string, reason?: string | null, revalHint?: string): Promise<Result> {
  try {
    await redactCustodyEvidence(evidenceId, reason ?? null);
    revalidate(revalHint);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Emite (auditado) y firma un signed URL para ver/descargar una evidencia. */
export async function evidenceSignedUrlAction(evidenceId: string, reason?: string | null): Promise<Result<{ url: string }>> {
  try {
    const url = await getEvidenceSignedUrl(evidenceId, reason ?? "visualizacion");
    return { ok: true, data: { url } };
  } catch (e) {
    return fail(e);
  }
}
