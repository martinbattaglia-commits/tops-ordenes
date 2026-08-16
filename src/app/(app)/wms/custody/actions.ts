"use server";

import { createHash, randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import {
  createAdminClient,
  createClient,
  createCustodyAdminMutationClient,
  createCustodyMutationClient,
  noRetryTransport,
} from "@/lib/supabase/server";
import {
  attachCustodyEvidence,
  attestCustodyContent,
  captureCustodyEvidence,
  registerCustodyEvent,
  generateDeliveryPod,
  redactCustodyEvidence,
  getEvidenceSignedUrl,
  resolveTrustedActor,
  revokeCustodyContentAttestation,
  supabaseStoragePort,
} from "@/lib/custody/custody";
import {
  buildCustodyStoragePath,
  CUSTODY_EVIDENCE_MAX_BYTES,
  parseAttachResult,
  parseCanonicalUuid,
  parseCustodyScope,
  parseCustodyStagePair,
  parseEvidenceKind,
  parseObjectExtension,
} from "@/lib/custody/canonical-contract";
import {
  buildCustodyCaseView,
  leaksSensitiveData,
  type CustodyCaseView,
} from "@/lib/custody/case-presentation";
import {
  createActorAuthorizationPort,
  createChainHeadPort,
  createEvidenceLoaderPort,
  createIntegrityCaseRepository,
  type CustodyQueryPort,
} from "@/lib/custody/integrity-adapters";
import {
  createSupabaseCustodyQueryPort,
  createSupabaseProductiveVisionServerPort,
  createSupabaseServerEvaluationPort,
  type CustodyDataClient,
  type ProductiveVisionDataClient,
} from "@/lib/custody/integrity-supabase";
import {
  CUSTODY_DECISION_PERMISSION,
  decideIntegrityCase,
  DECISION_VALUES,
} from "@/lib/custody/integrity";
import {
  createEvaluationComposition,
  runCustodyReevaluation,
} from "@/lib/custody/integrity-evaluation";
import {
  runProductiveCustodyVisionEvaluation,
  verifyInspectionEvidenceIntegrity,
} from "@/lib/custody/productive-vision-evaluation";
import { OpenAICustodyVisionProvider } from "@/lib/custody/openai-vision-provider";
import { sniffCustodyVisionMime } from "@/lib/custody/productive-vision-evaluation";
import { env } from "@/lib/env";
import { generateAndStorePodPdf, getPodPdfEvidenceId } from "@/lib/custody/pod-pdf";
import type {
  CustodyBucket,
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

async function attachPhysicalEvidenceAction(
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

  // R-6 · La autorización va ANTES del upload. `resolveTrustedActor` sólo
  // acredita la sesión; el permiso y el tenant los verificaba recién el attach,
  // tres pasos después de haber escrito en el bucket con service role. Esta
  // lectura va por el cliente de SESIÓN, así que la RLS de
  // `custody_physical_units` aplica rol y tenant: si el usuario no puede ver la
  // unidad, tampoco puede dejar un objeto ni una atestación colgando de ella.
  const visible = await session
    .from("custody_physical_units")
    .select("id")
    .eq("id", physicalUnitId)
    .maybeSingle();
  if (visible.error || !visible.data) {
    return { ok: false, error: "Unidad física no disponible para tu usuario" };
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
    if (attached.error) throw new Error("adjunto físico rechazado");
    const canonical = parseAttachResult(attached.data);
    if (!canonical) return { ok: false, error: "reconciliation_required" };
    revalidate((form.get("revalidate") as string | null) || undefined);
    return {
      ok: true,
      data: { evidence_id: canonical.evidenceId, event_public_id: canonical.eventPublicId },
    };
  } catch {
    // Si la respuesta de attach fue ambigua no se elimina: podría haber
    // confirmado. En fallos anteriores, la atestación expira y el objeto queda
    // identificado para reconciliación; nunca se borra a ciegas.
    void attestationId;
    return { ok: false, error: "reconciliation_required" };
  }
}

/** Sube un archivo de evidencia a Storage (service-role) y lo adjunta vía attach RPC. */
export async function attachEvidenceAction(form: FormData): Promise<Result<{ evidence_id: string; event_public_id: string }>> {
  try {
    if (form.get("scope") === "physical_unit") return attachPhysicalEvidenceAction(form);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Archivo requerido" };

    const notes = (form.get("notes") as string | null) || null;
    const revalHint = (form.get("revalidate") as string | null) || null;

    // ── W22-TER-C4 · O-1 · CONTRATO CANÓNICO ANTES DE TOCAR STORAGE ──────
    //
    // `scope`, `entity_id`, `stage`, `event_type` y `kind` llegan del
    // navegador y hasta acá viajaban casi crudos hasta la CLAVE de Storage:
    // un `entity_id` arbitrario colocaba el objeto en cualquier prefijo del
    // bucket, y la única barrera era que el `attach` fallara después y
    // hubiera que compensar. Se validan contra los conjuntos cerrados reales
    // (0222 §0 / 0226) ANTES de leer el archivo: lo no canónico no llega a
    // subirse, así que no hay huérfano que limpiar.
    const scope = parseCustodyScope(form.get("scope"));
    const entityId = parseCanonicalUuid(form.get("entity_id"));
    const pair = parseCustodyStagePair(form.get("stage"), form.get("event_type"));
    const kind = parseEvidenceKind(form.get("kind") ?? "foto");
    if (!scope || scope === "physical_unit" || !entityId || !pair || !kind) {
      // Etiqueta única: no se devuelve cuál campo falló ni con qué valor.
      return { ok: false, error: "Solicitud de captura inválida" };
    }

    // ── FRONTERA DE CONFIANZA ────────────────────────────────────────────
    // El formulario aporta QUÉ se adjunta. Nunca QUIÉN lo adjunta: actor,
    // sesión, tenant, rol y claims salen del contexto autenticado del
    // servidor. Un `session_id` en el `FormData` se ignora por construcción,
    // porque no se lee.
    const sessionClient = createClient();
    if (!sessionClient) return { ok: false, error: "Supabase no configurado" };

    // Cliente ADMINISTRATIVO obligatorio y separado: Storage y RPC internas.
    // Sin él no hay upload, ni atestación, ni attach — nunca un fallback que
    // mezcle privilegios.
    const admin = createAdminClient();
    if (!admin) return { ok: false, error: "Operación administrativa no disponible" };

    const actor = await resolveTrustedActor(sessionClient);

    const bucket: CustodyBucket = kind === "foto" ? "custody-evidence" : "custody-pii";
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Digest del buffer recibido: sólo EXPECTATIVA contra lo que quede guardado.
    const declaredSha256 = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    // La extensión también es dato del navegador: se acota a un alfabeto corto
    // y, si no lo cumple, se usa `bin`. Nunca se concatena tal cual.
    const rawExt = (file.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const extension = parseObjectExtension(rawExt) ?? "bin";
    // La clave se CONSTRUYE con partes ya validadas; no se ensambla a mano.
    const storagePath = buildCustodyStoragePath({
      scope,
      entityId,
      stage: pair.stage,
      objectId: randomUUID(),
      extension,
    });
    if (!storagePath) return { ok: false, error: "Solicitud de captura inválida" };

    const outcome = await captureCustodyEvidence(
      {
        storage: supabaseStoragePort(admin),
        attest: attestCustodyContent,
        attach: attachCustodyEvidence,
        revokeAttestation: revokeCustodyContentAttestation,
      },
      {
        bucket,
        storagePath,
        contentType: file.type || "application/octet-stream",
        bytes,
        declaredSha256,
        declaredSizeBytes: file.size,
        scope,
        entityId,
        stage: pair.stage,
        eventType: pair.eventType,
        kind,
        fileName: file.name,
        notes,
        actor,
      },
    );

    if (outcome.status === "ok") {
      revalidate(revalHint ?? undefined);
      return {
        ok: true,
        data: { evidence_id: outcome.evidenceId, event_public_id: outcome.eventPublicId },
      };
    }
    // Los estados de fallo no revelan bucket, path, digest ni nombre de archivo.
    if (outcome.status === "reconciliation_required") {
      return { ok: false, error: "reconciliation_required" };
    }
    if (outcome.status === "cleanup_required") {
      return { ok: false, error: "cleanup_required" };
    }
    return { ok: false, error: outcome.reason };
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

// ===========================================================================
// WMS UI-1 · CASO DE INTEGRIDAD — lectura, inspección humana y decisión
//
// Reglas que gobiernan todo lo de abajo:
//   · la identidad, la sesión, el tenant, el rol y los permisos salen del
//     servidor; el `FormData` sólo aporta QUÉ se decide, nunca QUIÉN decide;
//   · la autoridad final es la RPC `decide_custody_integrity` (0224), que
//     revalida sesión, permiso, tenant, estado, CAS de versión, cadena viva y
//     evidencia de inspección. Lo de acá es la primera línea, no la única;
//   · los errores que salen son ETIQUETAS: no llevan bucket, path, digest,
//     token, sesión ni mensajes crudos de PostgreSQL.
// ===========================================================================

/** Etiquetas de error. Nada de esto revela internals. */
const CASE_ERROR: Record<string, string> = {
  SESSION: "Sesión no verificada",
  NOT_FOUND: "El caso no existe o no es accesible",
  BAD_ID: "Identificador de caso inválido",
  BAD_COMMAND: "La decisión enviada no es válida",
  REASON_MISSING: "El motivo es obligatorio y debe ser específico",
  PERMISSION_DENIED: "No tenés permiso para decidir",
  CLIENT_MISMATCH: "El caso pertenece a otro cliente",
  STATE_NOT_DECIDABLE: "El caso no está en revisión humana",
  ALREADY_DECIDED: "El caso ya tiene una decisión registrada",
  RELEASE_NOT_ELIGIBLE: "La liberación no cumple los requisitos",
  VERSION_CONFLICT: "Otra persona decidió primero: recargá el caso",
  ATTESTATION_STALE:
    "La cadena de custodia avanzó desde el análisis: hay que volver a evaluar el caso antes de liberarlo",
  UNAVAILABLE: "La operación no está disponible en este momento",
};

function caseFail(code: keyof typeof CASE_ERROR | string): { ok: false; error: string } {
  return { ok: false, error: CASE_ERROR[code] ?? CASE_ERROR.UNAVAILABLE };
}

interface CaseContext {
  query: CustodyQueryPort;
  actor: Awaited<ReturnType<typeof resolveTrustedActor>> | null;
  clientId: string;
}

/**
 * Contexto server-side del caso. Resuelve sesión y tenant ANTES de cualquier
 * lectura de negocio, y devuelve `null` en vez de adivinar.
 */
async function caseContext(caseId: string): Promise<CaseContext | null> {
  const session = createClient();
  if (!session) return null;
  // Una sesión que no se puede acreditar NO es una falla genérica: se degrada a
  // «sin actor» y el llamador responde «sesión no verificada». Confundirla con
  // «no disponible» le esconde al inspector que tiene que volver a entrar.
  let actor: Awaited<ReturnType<typeof resolveTrustedActor>> | null = null;
  try {
    actor = await resolveTrustedActor(session);
  } catch {
    actor = null;
  }
  const query = createSupabaseCustodyQueryPort(session as unknown as CustodyDataClient);
  const row = await query.selectCase(caseId);
  if (!row) return null;
  return { query, actor, clientId: row.client_id };
}

export interface CustodyCaseViewOptions {
  draftReason?: string;
}

/**
 * Evidencias de inspección ELEGIBLES, derivadas por el servidor.
 *
 * Esta es la corrección central: antes la lista de evidencias de inspección
 * era un parámetro, y la pantalla —que no tenía cómo armarla— mandaba `[]`,
 * de modo que la liberación quedaba imposible y el motivo mostrado era falso.
 * Ahora no se recibe una lista: se PREGUNTA cuál es, y la respuesta la da
 * `custody_inspection_candidates` (0224) con el predicado canónico completo.
 *
 * Devuelve `[]` ante cualquier problema —sin permiso de decisión, caso ya
 * decidido, RPC no disponible—. Fallar cerrado acá significa exactamente «no
 * se libera», que es la respuesta correcta cuando no se pudo acreditar la
 * inspección; y no impide ver el caso ni cuarentenarlo.
 */
async function deriveInspectionEvidence(
  query: CustodyQueryPort,
  caseId: string,
  actor: { permissions: readonly string[] } | null,
  decided: boolean,
  scope?: "physical_unit" | "packing_unit" | "shipment",
): Promise<string[]> {
  if (decided || !actor || !actor.permissions.includes(CUSTODY_DECISION_PERMISSION)) return [];
  try {
    return await query.selectInspectionCandidates(caseId, scope);
  } catch {
    return [];
  }
}

/** Detalle del caso, ya en modelo de presentación seguro. */
export async function loadCustodyCaseAction(
  caseId: string,
  options: CustodyCaseViewOptions = {},
): Promise<Result<CustodyCaseView>> {
  try {
    const id = parseCanonicalUuid(caseId);
    if (!id) return caseFail("BAD_ID");

    const ctx = await caseContext(id);
    if (!ctx) return caseFail("NOT_FOUND");

    const auth = createActorAuthorizationPort(ctx.query, ctx.actor, ctx.clientId);
    const verified = await auth.resolveActor();
    if (!verified) return caseFail("SESSION");

    const repo = createIntegrityCaseRepository(ctx.query);
    const found = await repo.findById(id, verified.clientId);
    if (!found) return caseFail("NOT_FOUND");

    // ¿La cadena avanzó desde la atestación? Se compara SERVER-SIDE y sólo
    // viaja el booleano: el head nunca llega a la pantalla.
    let chainAdvanced = false;
    if (found.chain?.status === "verified") {
      const head = await ctx.query.verifyChainHead(found.entity.scope, found.entity.entityId);
      chainAdvanced = head !== null && head !== found.chain.attestation.chainHead;
    }

    const decided = found.decision !== null || found.state === "RELEASED" || found.state === "QUARANTINED";
    const inspectionEvidenceIds = await deriveInspectionEvidence(
      ctx.query,
      id,
      verified,
      decided,
      found.entity.scope,
    );
    // Reserva de evaluación viva: también server-side, y sólo como booleano.
    let evaluationInFlight = false;
    try {
      evaluationInFlight = (await ctx.query.selectActiveAttempt(id)) !== null;
    } catch {
      // Si no se puede saber, se asume que la hay: ofrecer el botón para que
      // la reserva lo rechace es peor que pedir que se reintente.
      evaluationInFlight = true;
    }

    // ¿El POD-PDF ya existe? Sólo tiene sentido preguntarlo con el caso
    // liberado, que es cuando la compuerta ofrece algo. La pantalla no importa
    // el generador de PDF para responder esto.
    let podPdfReady = false;
    if (found.state === "RELEASED" && found.entity.scope === "shipment") {
      try {
        podPdfReady = (await getPodPdfEvidenceId(found.entity.entityId)) !== null;
      } catch {
        podPdfReady = false;
      }
    }

    const view = buildCustodyCaseView({
      case: found,
      actor: verified,
      chainAdvanced,
      evaluationInFlight,
      podPdfReady,
      draftReason: options.draftReason,
      candidateInspectionEvidenceIds: inspectionEvidenceIds,
      // Sin configuración aprobada servida por el servidor no se muestra
      // ningún umbral: la pantalla no inventa un porcentaje de referencia.
      referenceThreshold: null,
    });
    // Cinturón y tirantes: si algo se colara al view-model, no sale de acá.
    if (leaksSensitiveData(view)) return caseFail("UNAVAILABLE");
    return { ok: true, data: view };
  } catch {
    return caseFail("UNAVAILABLE");
  }
}

/** Igual que la anterior, pero revalidando la ruta tras una decisión. */
export async function refreshCustodyCaseAction(
  caseId: string,
): Promise<Result<CustodyCaseView>> {
  const id = parseCanonicalUuid(caseId);
  if (!id) return caseFail("BAD_ID");
  revalidate(`/wms/custody/${id}`);
  return loadCustodyCaseAction(id);
}

export interface DecideCustodyCaseInput {
  caseId: string;
  expectedVersion: number;
  decision: "release" | "quarantine";
  reason: string;
  observations?: string | null;
  // NO hay `inspectionEvidenceIds`: la evidencia de inspección se REDERIVA en
  // el servidor justo antes de decidir. Que el campo no exista es la garantía
  // de que el navegador no puede influir en cuál evidencia acredita la
  // liberación —no alcanzaba con ignorarlo, porque nadie lo iba a notar—.
}

/**
 * Decisión humana: liberar o enviar a cuarentena.
 *
 * El doble clic no duplica nada por construcción: `expectedVersion` viaja como
 * CAS y la segunda llamada choca con `VERSION_CONFLICT` en la RPC. No se
 * reintenta automáticamente.
 */
export async function decideCustodyCaseAction(
  input: DecideCustodyCaseInput,
): Promise<Result<CustodyCaseView>> {
  try {
    const id = parseCanonicalUuid(input?.caseId ?? "");
    if (!id) return caseFail("BAD_ID");
    if (!(DECISION_VALUES as readonly string[]).includes(input?.decision)) {
      return caseFail("BAD_COMMAND");
    }
    if (!Number.isSafeInteger(input?.expectedVersion) || input.expectedVersion < 1) {
      return caseFail("BAD_COMMAND");
    }

    const ctx = await caseContext(id);
    if (!ctx) return caseFail("NOT_FOUND");

    const query = ctx.query;
    const auth = createActorAuthorizationPort(query, ctx.actor, ctx.clientId);

    // ── REDERIVACIÓN INMEDIATAMENTE ANTES DE DECIDIR ─────────────────────
    //
    // No se reusa la lista con la que se pintó la pantalla: entre el render y
    // el clic pudo pasar cualquier cosa —otra decisión consumió la evidencia,
    // la cadena avanzó y la atestación dejó de cubrirla, alguien la redactó—.
    // Se vuelve a preguntar y el dominio la revalida otra vez contra el caso.
    //
    // Sólo para LIBERAR. La cuarentena no exige inspección, y adjuntársela
    // consumiría evidencia que después no podría acreditar una liberación.
    const verified = await auth.resolveActor();
    const inspectionEvidenceIds =
      input.decision === "release"
        ? await deriveInspectionEvidence(query, id, verified, false, (await query.selectCase(id))?.physical_unit_id ? "physical_unit" : undefined)
        : [];

    // R-4 · Los BYTES de la inspección se re-verifican acá, contra su digest
    // registrado, justo antes de decidir. La comparación ingreso/egreso ya lo
    // hacía; la inspección no, y es la que sostiene el certificado. Postgres no
    // puede leer Storage, así que el control tiene que estar de este lado.
    if (inspectionEvidenceIds.length > 0) {
      const admin = createAdminClient();
      if (!admin) return caseFail("UNAVAILABLE");
      const integrity = await verifyInspectionEvidenceIntegrity(
        createSupabaseProductiveVisionServerPort(admin as unknown as ProductiveVisionDataClient),
        inspectionEvidenceIds,
      );
      if (!integrity.ok) return { ok: false, error: "EVIDENCE_TAMPERED" };
    }

    const outcome = await decideIntegrityCase(
      {
        repository: createIntegrityCaseRepository(query),
        authorization: auth,
        evidenceLoader: createEvidenceLoaderPort(query),
        chainHead: createChainHeadPort(query),
        now: () => new Date().toISOString(),
      },
      id,
      {
        decision: input.decision,
        reason: String(input.reason ?? ""),
        observations: input.observations ?? null,
        inspectionEvidenceIds,
      },
    );

    if (!outcome.ok) {
      const code = outcome.error.startsWith("PERSIST_")
        ? outcome.error.slice("PERSIST_".length)
        : outcome.error;
      return caseFail(code);
    }

    revalidate(`/wms/custody/${id}`);
    const view = buildCustodyCaseView({ case: outcome.case, actor: verified });
    if (leaksSensitiveData(view)) return caseFail("UNAVAILABLE");
    return { ok: true, data: view };
  } catch {
    return caseFail("UNAVAILABLE");
  }
}

/**
 * Registra la foto de INSPECCIÓN HUMANA (D1).
 *
 * Reusa el camino de captura ya verificado extremo a extremo por G6 —upload,
 * relectura, hash, atestación server-side y attach— pero fija el par canónico
 * en el servidor: el formulario no puede elegir etapa, tipo ni soporte.
 */
export async function registerHumanInspectionAction(
  form: FormData,
): Promise<Result<{ evidence_id: string; event_public_id: string }>> {
  const forced = new FormData();
  for (const key of ["file", "scope", "entity_id", "notes", "revalidate"]) {
    const v = form.get(key);
    if (v !== null) forced.set(key, v);
  }
  forced.set("stage", "despacho");
  forced.set("event_type", "inspeccion_humana");
  forced.set("kind", "foto");
  return attachEvidenceAction(forced);
}

/**
 * Copia sólo lo que el navegador puede aportar: el archivo y a qué unidad va.
 * Deliberadamente NO fija el par canónico — cada acción declara el suyo
 * completo, para que leerla alcance para saber qué registra.
 */
function physicalCaptureForm(form: FormData): FormData {
  const forced = new FormData();
  for (const key of ["file", "entity_id", "notes", "revalidate"]) {
    const v = form.get(key);
    if (v !== null) forced.set(key, v);
  }
  return forced;
}

/**
 * Registra la FOTO DE INGRESO de la unidad física (Adenda N.º 2 §4.2).
 *
 * Mismo forzado que la inspección humana y por la misma razón: el par canónico
 * es del servidor. El navegador manda el archivo y la unidad; etapa, tipo,
 * soporte y scope los pone acá, de modo que un formulario manipulado no puede
 * hacer pasar una foto de ingreso por otra cosa —ni al revés—.
 */
export async function registerPhysicalIngressAction(
  form: FormData,
): Promise<Result<{ evidence_id: string; event_public_id: string }>> {
  const forced = physicalCaptureForm(form);
  forced.set("scope", "physical_unit");
  forced.set("stage", "recepcion");
  forced.set("event_type", "foto_ingreso");
  forced.set("kind", "foto");
  return attachEvidenceAction(forced);
}

/**
 * Registra la FOTO DE EGRESO obligatoria de la unidad física.
 *
 * Es la contraparte del ingreso y la que habilita la comparación visual: sin
 * ella el caso no sale de `PENDING_EVIDENCE` y los gates de despacho y POD
 * permanecen cerrados, que es exactamente lo que el contrato pide.
 */
export async function registerPhysicalEgressAction(
  form: FormData,
): Promise<Result<{ evidence_id: string; event_public_id: string }>> {
  const forced = physicalCaptureForm(form);
  forced.set("scope", "physical_unit");
  forced.set("stage", "despacho");
  forced.set("event_type", "foto_egreso");
  forced.set("kind", "foto");
  return attachEvidenceAction(forced);
}

// ===========================================================================
// RE-EVALUACIÓN OPERATIVA
//
// Cierra el hueco que dejó la inspección humana: al agregar un eslabón a la
// cadena, la atestación de la evaluación queda vieja y 0224 bloquea la
// liberación. Este es el camino para rehacerla, con las mismas reglas de
// siempre: identidad y tenant del servidor, CAS de versión, una sola ejecución
// por intento, y la IA sin poder de decisión.
// ===========================================================================

const REEVAL_ERROR: Record<string, string> = {
  STATE_NOT_EVALUABLE: "El caso no está en revisión humana",
  EVIDENCE_MISSING: "Faltan las dos fotos a comparar",
  LEASE_HELD: "Ya hay una evaluación en curso para este caso",
  VERSION_CONFLICT: "El caso cambió mientras tanto: recargá y volvé a intentar",
  COMPLETE_FAILED: "No se pudo registrar el resultado del análisis",
};

/**
 * Vuelve a evaluar el caso.
 *
 * El navegador aporta QUÉ caso y con qué versión lo vio. Todo lo demás
 * —proveedor, veredicto, confianza, modo de ejecución, head de cadena, actor,
 * sesión y fechas— lo pone el servidor: no hay ningún parámetro por el que
 * puedan entrar.
 */
export async function reevaluateCustodyCaseAction(
  caseId: string,
  expectedVersion: number,
): Promise<Result<CustodyCaseView>> {
  try {
    const id = parseCanonicalUuid(caseId);
    if (!id) return caseFail("BAD_ID");
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return caseFail("BAD_COMMAND");

    const ctx = await caseContext(id);
    if (!ctx) return caseFail("NOT_FOUND");

    const auth = createActorAuthorizationPort(ctx.query, ctx.actor, ctx.clientId);
    const verified = await auth.resolveActor();
    if (!verified) return caseFail("SESSION");
    if (!verified.permissions.includes(CUSTODY_DECISION_PERMISSION)) {
      return caseFail("PERMISSION_DENIED");
    }

    const repo = createIntegrityCaseRepository(ctx.query);
    const found = await repo.findById(id, verified.clientId);
    if (!found) return caseFail("NOT_FOUND");
    // CAS de entrada: si el caso cambió desde que la pantalla lo vio, no se
    // ejecuta nada. El `begin_…` vuelve a comprobarlo del lado de la base.
    if (found.version !== expectedVersion) {
      return { ok: false, error: REEVAL_ERROR.VERSION_CONFLICT };
    }

    // El rol interno de servidor SÓLO se instancia acá dentro, para finalizar
    // el intento. Nunca se expone ni se devuelve.
    const admin = createAdminClient();
    if (!admin) return caseFail("UNAVAILABLE");

    if (found.entity.scope === "physical_unit") {
      const outcome = await runProductiveCustodyVisionEvaluation(
        {
          session: {
            begin: (c, v) => {
              if (!ctx.query.beginProductiveEvaluation) {
                throw new Error("camino productivo no disponible");
              }
              return ctx.query.beginProductiveEvaluation(c, v);
            },
          },
          server: createSupabaseProductiveVisionServerPort(
            admin as unknown as ProductiveVisionDataClient,
          ),
          provider: new OpenAICustodyVisionProvider({ apiKey: env.openai.apiKey }),
        },
        { caseId: id, expectedVersion: found.version },
      );
      if (outcome.status === "in_flight") {
        return { ok: false, error: REEVAL_ERROR.LEASE_HELD };
      }
      if (outcome.status === "cooldown") {
        return { ok: false, error: `El caso está en cooldown (${outcome.retryAfterSeconds} s)` };
      }
      revalidate(`/wms/custody/${id}`);
      return loadCustodyCaseAction(id);
    }

    const outcome = await runCustodyReevaluation(
      {
        composition: createEvaluationComposition(),
        beginEvaluation: (c, v) => ctx.query.beginEvaluation(c, v),
        server: createSupabaseServerEvaluationPort(admin as unknown as CustodyDataClient),
        now: () => new Date().toISOString(),
      },
      {
        caseId: id,
        version: found.version,
        state: found.state,
        ingress: found.evidence.ingress,
        egress: found.evidence.egress,
      },
    );

    if (!outcome.ok) {
      return { ok: false, error: REEVAL_ERROR[outcome.error] ?? CASE_ERROR.UNAVAILABLE };
    }

    revalidate(`/wms/custody/${id}`);
    return loadCustodyCaseAction(id);
  } catch {
    return caseFail("UNAVAILABLE");
  }
}
