/**
 * CAPTURA FÍSICA DE EVIDENCIA · implementación única.
 *
 * ─── POR QUÉ VIVE ACÁ Y NO EN LA SERVER ACTION ───────────────────────────
 *
 * El bloque 2-A necesita registrar la foto de ingreso DESDE LA RECEPCIÓN, y la
 * primera versión importó `registerPhysicalIngressAction` de
 * `wms/custody/actions.ts`. Eso arrastró todo ese módulo —incluido
 * `OpenAICustodyVisionProvider`— al grafo de dependencias de recepciones, que
 * está dentro de la clausura del maestro de clientes. El guard de egreso de red
 * de `clients-native-only` lo cazó, y con razón: el módulo de recepciones no
 * tiene por qué alcanzar un cliente HTTP de OpenAI.
 *
 * La salida NO es duplicar el camino: éste es el único lugar donde se sube el
 * binario, se re-lee, se recalcula el hash, se atesta server-side y se adjunta.
 * Duplicarlo habría dejado dos superficies de seguridad divergiendo en silencio.
 * Se extrae, y la server action de custodia delega acá.
 */

import { createHash, randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import {
  createAdminClient,
  createClient,
  createCustodyAdminMutationClient,
  createCustodyMutationClient,
  noRetryTransport,
} from "@/lib/supabase/server";
import { resolveTrustedActor, supabaseStoragePort } from "@/lib/custody/custody";
import {
  buildCustodyStoragePath,
  CUSTODY_EVIDENCE_MAX_BYTES,
  parseAttachResult,
  parseCanonicalUuid,
  parseCustodyStagePair,
} from "@/lib/custody/canonical-contract";
import { CUSTODY_CAPTURE_PERMISSION } from "@/lib/custody/case-presentation";
import {
  createActorAuthorizationPort,
  type CustodyQueryPort,
} from "@/lib/custody/integrity-adapters";
import {
  createSupabaseCustodyQueryPort,
  type CustodyDataClient,
} from "@/lib/custody/integrity-supabase";
import { sniffCustodyVisionMime } from "@/lib/custody/vision-mime";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function revalidate(extra?: string): void {
  revalidatePath("/wms/custody");
  if (extra) revalidatePath(extra);
}

export async function attachPhysicalEvidence(
  form: FormData,
): Promise<Result<{ evidence_id: string; event_public_id: string }>> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size < 1) {
    return { ok: false, error: "Foto física requerida" };
  }
  // El bucket `custody-evidence` corta en 8 MiB (0037). Aceptar 12 acá hacía
  // que una foto de teléfono de 8–12 MiB pasara toda la validación y muriera
  // recién en Storage, con un error que no le decía nada al operario.
  if (file.size > CUSTODY_EVIDENCE_MAX_BYTES) {
    return {
      ok: false,
      error: "La foto supera los 8 MB: sacala de nuevo con menor resolución",
    };
  }
  const physicalUnitId = parseCanonicalUuid(form.get("entity_id"));
  const pair = parseCustodyStagePair(form.get("stage"), form.get("event_type"));
  if (!physicalUnitId || !pair || !(
    (pair.stage === "recepcion" && pair.eventType === "foto_ingreso")
    || (pair.stage === "despacho" && ["foto_egreso", "inspeccion_humana"].includes(pair.eventType))
  )) return { ok: false, error: "Solicitud de captura física inválida" };

  const session = createClient();
  const admin = createAdminClient();
  if (!session || !admin) return { ok: false, error: "Operación administrativa no disponible" };
  const actor = await resolveTrustedActor(session);

  // R-6 · La autorización COMPLETA va ANTES del upload. `resolveTrustedActor`
  // sólo acredita la sesión; el permiso y el tenant los verificaba recién el
  // attach, tres pasos después de haber escrito en el bucket con service role,
  // de modo que un usuario sin `wms.edit` conseguía igual un objeto huérfano y
  // una fila de atestación a nombre del tenant ajeno.
  //
  // Son DOS comprobaciones distintas y hacen falta las dos:
  //  · la lectura por el cliente de SESIÓN somete la unidad a su RLS, que
  //    resuelve el TENANT;
  //  · el perfil y sus permisos resuelven la CAPACIDAD de escribir evidencia.
  const visible = await session
    .from("custody_physical_units")
    .select("id, client_id")
    .eq("id", physicalUnitId)
    .maybeSingle();
  if (visible.error || !visible.data) {
    return { ok: false, error: "Unidad física no disponible para tu usuario" };
  }
  const unitClientId = String((visible.data as { client_id?: unknown }).client_id ?? "");
  const authz = createActorAuthorizationPort(
    createSupabaseCustodyQueryPort(session as unknown as CustodyDataClient),
    { actorId: actor.actorId, sessionId: actor.sessionId },
    unitClientId,
  );
  const verified = await authz.resolveActor();
  if (!verified || !verified.permissions.includes(CUSTODY_CAPTURE_PERMISSION)) {
    return { ok: false, error: "No tenés permiso para registrar evidencia" };
  }

  const supplied = new Uint8Array(await file.arrayBuffer());
  const suppliedMime = sniffCustodyVisionMime(supplied);
  if (!suppliedMime) return { ok: false, error: "Formato de foto no admitido" };
  const extension = suppliedMime === "image/jpeg" ? "jpg" : suppliedMime === "image/png" ? "png" : "webp";
  const storagePath = buildCustodyStoragePath({
    scope: "physical_unit",
    entityId: physicalUnitId,
    stage: pair.stage,
    objectId: randomUUID(),
    extension,
  });
  if (!storagePath) return { ok: false, error: "Solicitud de captura física inválida" };

  const storage = supabaseStoragePort(admin);
  await storage.upload("custody-evidence", storagePath, supplied, suppliedMime);
  let attestationId: string | null = null;
  try {
    const stored = await storage.download("custody-evidence", storagePath);
    if (!stored || stored.byteLength !== supplied.byteLength) {
      await storage.remove("custody-evidence", storagePath);
      return { ok: false, error: "La foto almacenada no pudo verificarse" };
    }
    const observedMime = sniffCustodyVisionMime(stored);
    const suppliedSha = createHash("sha256").update(supplied).digest("hex");
    const observedSha = createHash("sha256").update(stored).digest("hex");
    if (!observedMime || observedMime !== suppliedMime || observedSha !== suppliedSha) {
      await storage.remove("custody-evidence", storagePath);
      return { ok: false, error: "La foto almacenada no coincide con los bytes recibidos" };
    }

    const adminTransport = noRetryTransport();
    const adminMutation = createCustodyAdminMutationClient(adminTransport);
    const sessionMutation = createCustodyMutationClient(noRetryTransport());
    if (!adminMutation || !sessionMutation) throw new Error("clientes de mutación no disponibles");
    const attested = await adminMutation.rpc("attest_custody_physical_content", {
      p_bucket: "custody-evidence",
      p_storage_path: storagePath,
      p_sha256: observedSha,
      p_size_bytes: stored.byteLength,
      p_observed_mime_type: observedMime,
      p_actor_id: actor.actorId,
      p_session_id: actor.sessionId,
      p_physical_unit_id: physicalUnitId,
      p_stage: pair.stage,
      p_event_type: pair.eventType,
      p_ttl_seconds: 900,
    });
    if (attested.error || typeof attested.data !== "string") throw new Error("atestación rechazada");
    attestationId = attested.data;

    const attached = await sessionMutation.rpc("attach_custody_physical_evidence", {
      p_physical_unit_id: physicalUnitId,
      p_stage: pair.stage,
      p_event_type: pair.eventType,
      p_storage_path: storagePath,
      p_attestation_id: attestationId,
      p_file_name: file.name || null,
      p_captured_at: null,
      p_exif: null,
      p_notes: (form.get("notes") as string | null) || null,
    });
    if (attached.error) {
      // S1-3 · Un rechazo de REGLA no es una carga ambigua.
      //
      // Antes esto caía al `catch` de abajo y salía como
      // `reconciliation_required`, cuyo texto le dice al operario que NO vuelva
      // a sacar la foto y que llame a soporte — lo contrario de lo correcto
      // cuando la base rechazó por una regla que él puede resolver solo. La
      // transacción de la RPC no dejó nada a medias: no hay qué reconciliar.
      const known = classifyPhysicalAttachRejection(attached.error.message);
      if (known) return { ok: false, error: known };
      throw new Error("adjunto físico rechazado");
    }
    const canonical = parseAttachResult(attached.data);
    if (!canonical) return { ok: false, error: "reconciliation_required" };
    revalidate((form.get("revalidate") as string | null) || undefined);
    return {
      ok: true,
      data: { evidence_id: canonical.evidenceId, event_public_id: canonical.eventPublicId },
    };
  } catch (e) {
    // Un rechazo conocido puede llegar también por acá si vino como excepción.
    const known = classifyPhysicalAttachRejection(e instanceof Error ? e.message : String(e));
    if (known) return { ok: false, error: known };
    // Si la respuesta de attach fue ambigua no se elimina: podría haber
    // confirmado. En fallos anteriores, la atestación expira y el objeto queda
    // identificado para reconciliación; nunca se borra a ciegas.
    void attestationId;
    return { ok: false, error: "reconciliation_required" };
  }
}


/**
 * Traduce los rechazos de REGLA del adjunto físico a lo que hay que HACER.
 *
 * Devuelve `null` cuando el motivo no se reconoce: en ese caso la carga sí es
 * ambigua y corresponde el camino de reconciliación. Ninguna etiqueta revela
 * bucket, ruta ni digest, que es de donde vienen estos rechazos.
 */
export function classifyPhysicalAttachRejection(message: string): string | null {
  const m = (message || "").toLowerCase();
  if (m.includes("reutilizar los bytes de ingreso")) {
    return "Esa es la misma foto del ingreso. Sacá una foto NUEVA de la unidad ahora, con los mismos ángulos.";
  }
  if (m.includes("contenido de inspección ya utilizado") || m.includes("contenido de inspeccion ya utilizado")) {
    return "Esa foto ya se usó como inspección en otro caso. Sacá una nueva.";
  }
  if (m.includes("evaluación en curso") || m.includes("evaluacion en curso")) {
    return "Hay un análisis corriendo sobre este caso. Esperá a que termine y volvé a intentar.";
  }
  if (m.includes("caso terminal")) {
    return "El caso ya tiene una decisión registrada: no admite más fotografías.";
  }
  if (m.includes("storage_path ya utilizado")) {
    return "Esa fotografía ya estaba registrada. Volvé a sacarla.";
  }
  if (m.includes("inspección no autorizada") || m.includes("inspeccion no autorizada")) {
    return "Tu rol no puede registrar la inspección física.";
  }
  if (m.includes("sin atestación vigente") || m.includes("sin atestacion vigente")) {
    return "La carga tardó demasiado y venció. Volvé a sacar la foto.";
  }
  return null;
}
