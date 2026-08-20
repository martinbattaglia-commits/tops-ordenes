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
  attachCustodyPodSignature,
  attestCustodyContent,
  attestCustodyPodSignatureContent,
  captureCustodyEvidence,
  registerCustodyEvent,
  generateDeliveryPodV2,
  getDeliveryPodByShipment,
  redactCustodyEvidence,
  getEvidenceSignedUrl,
  resolveTrustedActor,
  revokeCustodyContentAttestation,
  supabaseStoragePort,
  verifyStoredContent,
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
  CUSTODY_CAPTURE_PERMISSION,
  leaksSensitiveData,
  type BuildCaseViewInput,
  type CustodyCaseView,
} from "@/lib/custody/case-presentation";
import { resolvePhysicalUnitPodShipment } from "@/lib/custody/dispatch-egress";
import {
  createActorAuthorizationPort,
  createChainHeadPort,
  createEvidenceLoaderPort,
  createIntegrityCaseRepository,
  mapCaseIdentity,
  type CustodyCaseIdentity,
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
  verifyInspectionEvidenceIntegrity,
} from "@/lib/custody/productive-vision-evaluation";
import { sniffCustodyVisionMime } from "@/lib/custody/productive-vision-evaluation";
import { runPhysicalUnitVisionEvaluation } from "@/lib/custody/vision-evaluation-composition";
import { triggerAnalysisIfPairComplete } from "@/lib/custody/analysis-trigger";
import {
  resolveCustodyDocument,
  type CustodyDocument,
  type PersistedCertificate,
} from "@/lib/custody/certificate-emission";
import { buildDocumentChain } from "@/lib/custody/integrity/certificate-document";
import {
  attachPhysicalEvidence,
  classifyPhysicalAttachRejection,
} from "@/lib/custody/physical-ingress";
import { generateAndStorePodPdf, getPodPdfEvidenceId } from "@/lib/custody/pod-pdf";
import type {
  CustodyBucket,
  RegisterEventInput,
} from "@/lib/custody/types";

/**
 * Server Actions de la Cadena de Custodia (GATE 5). Toda mutación va por RPC
 * SECURITY DEFINER (0036–0039); la UI nunca escribe directo. Refresco por
 * revalidatePath() — sin router.refresh() (criterio anti-503 de 4A/4B/4C).
 * La autorización/validación la enforce la RPC; acá solo se orquesta + revalida.
 */

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

type ShipmentPodReadiness = {
  delivered: boolean;
};

function fail(e: unknown): { ok: false; error: string } {
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

function revalidate(extra?: string): void {
  revalidatePath("/wms/custody");
  if (extra) revalidatePath(extra);
}

/**
 * Deriva estado y firma desde filas shipment-scoped. El timeline histórico de
 * un shipment también agrega eventos de sus bultos; por eso no sirve para
 * elegir una firma del receptor sin riesgo de cruzar scopes.
 */
async function resolveShipmentPodReadiness(
  shipmentId: string,
): Promise<ShipmentPodReadiness> {
  const shipment = parseCanonicalUuid(shipmentId);
  if (!shipment) throw new Error("Identificador de despacho inválido");

  const session = createClient();
  if (!session) throw new Error("Supabase no configurado");

  const { data: shipmentRow, error: shipmentError } = await session
    .from("shipments")
    .select("id, status, delivered_at")
    .eq("id", shipment)
    .maybeSingle();
  if (shipmentError || !shipmentRow) throw new Error("Despacho no disponible");

  const row = shipmentRow as { status?: string; delivered_at?: string | null };
  const deliveredAt = typeof row.delivered_at === "string" ? row.delivered_at : null;
  if (row.status !== "entregado" || !deliveredAt || !Number.isFinite(Date.parse(deliveredAt))) {
    return { delivered: false };
  }
  return { delivered: true };
}

export async function shipmentPodReadinessAction(
  shipmentId: string,
): Promise<Result<ShipmentPodReadiness>> {
  try {
    return { ok: true, data: await resolveShipmentPodReadiness(shipmentId) };
  } catch (e) {
    return fail(e);
  }
}

async function attachPhysicalEvidenceAction(
  form: FormData,
): Promise<Result<{ evidence_id: string; event_public_id: string }>> {
  // Implementación ÚNICA en `@/lib/custody/physical-ingress`. Se extrajo para
  // que el módulo de recepciones pueda registrar la foto de ingreso sin
  // arrastrar este archivo entero —y con él el proveedor de visión— a su grafo
  // de dependencias. Ver el encabezado de ese módulo.
  return attachPhysicalEvidence(form);
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

    // Una llamada directa a la Server Action no puede adelantar la firma o la
    // evidencia de entrega. La UI oculta esos presets, y el servidor vuelve a
    // comprobar el estado antes de cualquier upload.
    if (scope === "shipment" && pair.stage === "entrega") {
      const { data: shipmentRow, error: shipmentError } = await sessionClient
        .from("shipments")
        .select("status, delivered_at")
        .eq("id", entityId)
        .maybeSingle();
      const shipment = shipmentRow as { status?: string; delivered_at?: string | null } | null;
      if (
        shipmentError ||
        !shipment ||
        shipment.status !== "entregado" ||
        typeof shipment.delivered_at !== "string" ||
        !Number.isFinite(Date.parse(shipment.delivered_at))
      ) {
        return { ok: false, error: "La evidencia de entrega se habilita después de confirmar la entrega" };
      }
    }

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
  form: FormData,
  revalHint?: string
): Promise<Result<{ pod_id: string; public_id: string; pdf_path?: string; pdf_warning?: string }>> {
  try {
    const shipmentId = parseCanonicalUuid(form.get("shipment_id"));
    if (!shipmentId) return { ok: false, error: "Identificador de despacho inválido" };
    const receiverName = String(form.get("receiver_name") ?? "").trim();
    const receiverDocument = String(form.get("receiver_document") ?? "").trim() || null;
    const observations = String(form.get("observations") ?? "").trim() || null;
    if (!receiverName) return { ok: false, error: "Nombre del receptor requerido" };
    const readiness = await resolveShipmentPodReadiness(shipmentId);
    if (!readiness.delivered) {
      return { ok: false, error: "El POD se habilita únicamente después de confirmar la entrega" };
    }
    let signatureOperationId: string | null = null;
    const signature = form.get("signature");
    if (signature instanceof File && signature.size > 0) {
      if (signature.size > CUSTODY_EVIDENCE_MAX_BYTES) {
        return { ok: false, error: "La firma supera el máximo permitido de 8 MiB" };
      }
      const bytes = new Uint8Array(await signature.arrayBuffer());
      const mime = sniffCustodyVisionMime(bytes);
      if (!mime) return { ok: false, error: "La firma debe ser JPEG, PNG o WebP válido" };
      const session = createClient();
      const admin = createAdminClient();
      if (!session || !admin) return { ok: false, error: "Operación administrativa no disponible" };
      const actor = await resolveTrustedActor(session);
      const extension = mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp";
      const storagePath = buildCustodyStoragePath({
        scope: "shipment", entityId: shipmentId, stage: "entrega",
        objectId: randomUUID(), extension,
      });
      if (!storagePath) return { ok: false, error: "Ruta de firma no verificable" };
      const storage = supabaseStoragePort(admin);
      await storage.upload("custody-pii", storagePath, bytes, mime);
      const verified = await verifyStoredContent(storage, "custody-pii", storagePath, {
        sizeBytes: bytes.byteLength,
        sha256: createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
      });
      const authorization = await attestCustodyPodSignatureContent({
        bucket: "custody-pii", storagePath, sha256: verified.sha256,
        sizeBytes: verified.sizeBytes, mimeType: mime,
        actorId: actor.actorId, sessionId: actor.sessionId, shipmentId,
        receiverName, receiverDocument,
      });
      const attached = await attachCustodyPodSignature({
        operationId: authorization.operationId, shipmentId, receiverName,
        receiverDocument, fileName: signature.name, mimeType: mime,
      });
      signatureOperationId = attached.operationId;
    }
    const res = await generateDeliveryPodV2({
      shipmentId, receiverName, receiverDocument, observations, signatureOperationId,
    });
    let pdf_path: string | undefined;
    let pdf_warning: string | undefined;
    try {
      const pdf = await generateAndStorePodPdf(shipmentId, { force: true });
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
//   · la autoridad final es la RPC `decide_custody_integrity_v2` (0250a/0251),
//     que revalida sesión, permiso, tenant, estado, CAS de versión, cadena viva
//     y evidencia de inspección. Lo de acá es la primera línea, no la única.
//     La v1 está revocada para `authenticated` desde `0250a:2199-2200` y, desde
//     HN-1, ningún scope la alcanza: un caso no físico se rechaza tipado en el
//     puerto y llega acá como `SCOPE_NOT_DECIDABLE`;
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
  SCOPE_NOT_DECIDABLE:
    "Este caso no es de una unidad física: no se decide desde esta pantalla",
  UNAVAILABLE: "La operación no está disponible en este momento",
};

function caseFail(code: keyof typeof CASE_ERROR | string): { ok: false; error: string } {
  return { ok: false, error: CASE_ERROR[code] ?? CASE_ERROR.UNAVAILABLE };
}

interface CaseContext {
  query: CustodyQueryPort;
  actor: Awaited<ReturnType<typeof resolveTrustedActor>> | null;
  clientId: string;
  /**
   * S1-2 · La identidad sale de la MISMA fila que ya se leyó para resolver el
   * tenant. Cero viajes extra: el corte no era de disponibilidad, era que la
   * consulta no pedía las columnas y el adaptador descartaba las que sí venían.
   */
  identity: CustodyCaseIdentity;
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
  return { query, actor, clientId: row.client_id, identity: mapCaseIdentity(row) };
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
    //
    // S1-6 · EL DEADLOCK ERA DE ESTE LADO, NO DE LA BASE.
    //
    // Antes acá se comparaban dos hashes sin mirar el tipo de evento, así que
    // la foto de inspección humana —que el inspector está OBLIGADO a registrar
    // para poder liberar— hacía avanzar la cadena y con eso bloqueaba la
    // liberación que ella misma habilita; reevaluar la invalidaba de nuevo y el
    // caso no salía nunca. La base NUNCA tuvo ese defecto: `0250a:2129-2133`
    // excluye `inspeccion_humana` al hacer exactamente esta comprobación.
    // Acá se copia esa regla (I6); no se escribe una nueva.
    let chainAdvanced = false;
    if (found.chain?.status === "verified") {
      const attestedHead = found.chain.attestation.chainHead;
      if (ctx.query.chainAdvancedBeyondInspection) {
        chainAdvanced = await ctx.query.chainAdvancedBeyondInspection(
          found.entity.scope,
          found.entity.entityId,
          attestedHead,
        );
      } else {
        const head = await ctx.query.verifyChainHead(found.entity.scope, found.entity.entityId);
        chainAdvanced = head !== null && head !== attestedHead;
      }
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
    //
    // FILA 11b · la unidad física también tiene POD: el de SU despacho,
    // resuelto por genealogía (allocations → pedido → shipment). El POD sigue
    // siendo post-entrega (0250a): acá sólo se lee, no se relaja nada.
    let podPdfReady = false;
    let physicalUnitPod: BuildCaseViewInput["physicalUnitPod"] = null;
    if (found.state === "RELEASED" && found.entity.scope === "shipment") {
      try {
        podPdfReady = (await getPodPdfEvidenceId(found.entity.entityId)) !== null;
      } catch {
        podPdfReady = false;
      }
    } else if (found.state === "RELEASED" && found.entity.scope === "physical_unit") {
      try {
        const resolved = await resolvePhysicalUnitPodShipment(found.entity.entityId);
        if (resolved) {
          const pod = resolved.delivered
            ? await getDeliveryPodByShipment(resolved.shipmentId).catch(() => null)
            : null;
          physicalUnitPod = {
            shipmentId: resolved.shipmentId,
            shipmentPublicId: resolved.shipmentPublicId,
            delivered: resolved.delivered,
            podExists: pod !== null,
          };
          if (pod !== null) {
            podPdfReady = (await getPodPdfEvidenceId(resolved.shipmentId)) !== null;
          }
        }
      } catch {
        physicalUnitPod = null;
      }
    }

    const view = buildCustodyCaseView({
      case: found,
      actor: verified,
      identity: ctx.identity,
      chainAdvanced,
      evaluationInFlight,
      podPdfReady,
      physicalUnitPod,
      draftReason: options.draftReason,
      candidateInspectionEvidenceIds: inspectionEvidenceIds,
    });
    // Cinturón y tirantes: si algo se colara al view-model, no sale de acá.
    if (leaksSensitiveData(view)) return caseFail("UNAVAILABLE");
    return { ok: true, data: view };
  } catch {
    return caseFail("UNAVAILABLE");
  }
}

/**
 * 2-C-2 · EMITE EL DOCUMENTO PROBATORIO DEL CASO.
 *
 * `evaluateCertificateEligibility` estaba escrita, completa y verificada, y no
 * la llamaba NADIE: sus únicos consumidores eran su propio módulo y los tests.
 * Ésta es la acción que faltaba. **No se tocó la política**: se la consume.
 *
 * El contexto se arma con la MISMA lectura que usa `loadCustodyCaseAction` —el
 * caso de dominio, el head vigente, el conjunto de inspección revalidado— para
 * que el documento no pueda describir un caso distinto del que muestra la
 * pantalla.
 *
 * La fila de `custody_release_certificates` la escribe la BASE al liberar
 * (`0251:257`), dentro de la misma transacción que registra la decisión. Acá se
 * LEE —posible desde 0254, que agregó la política de tenant que faltaba— y se
 * combina con el veredicto. No se inserta nada: duplicar el asiento probatorio
 * sobre una tabla inmutable sería un error irreparable.
 */
export async function loadCustodyDocumentAction(
  caseId: string,
): Promise<Result<CustodyDocument>> {
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

    // V4 · Capas 2 y 3. El contexto documental sale de la RPC de lectura de
    // 0258: atestación VIVA —con `verified_event_ids` reales y el head
    // vigente— y canónico RE-DERIVADO por el predicado único, que desde 0258
    // resuelve el eslabón evaluado contra el testigo y por eso sobrevive a la
    // decisión. Si la RPC no responde, el documento se resuelve con lo
    // almacenado, cuya atestación vacía degrada a acta: fail-closed, nunca un
    // certificado que la base no acredite.
    let docContext = null;
    if (ctx.query.selectCertificateDocument) {
      try {
        docContext = await ctx.query.selectCertificateDocument(id);
      } catch {
        docContext = null;
      }
    }

    const liveAtt = docContext?.attestation ?? null;
    const liveVerified =
      liveAtt !== null &&
      liveAtt.status === "verified" &&
      typeof liveAtt.chainHead === "string" &&
      liveAtt.chainHead.length > 0;

    const documentChain = buildDocumentChain(found.chain, liveAtt);

    const currentChainHead = liveVerified
      ? (liveAtt.chainHead as string)
      : await ctx.query.verifyChainHead(found.entity.scope, found.entity.entityId);

    // El conjunto de inspección CANÓNICO: re-derivación desde la base, nunca
    // un alias del declarado. Sin contexto documental queda vacío y una
    // decisión con ids declarados no cierra la comparación: acta, fail-closed.
    const canonical = docContext?.canonicalInspectionEvidenceIds ?? [];

    const evidenceEventIds = [found.evidence.ingress?.eventId, found.evidence.egress?.eventId]
      .filter((v): v is string => typeof v === "string" && v.length > 0);

    // La fila persistida. Sin política de lectura (pre-0254) esto devolvía cero
    // filas y el documento no podía existir.
    let persisted: PersistedCertificate | null = null;
    try {
      const session = createClient();
      if (session) {
        const { data } = await session
          .from("custody_release_certificates")
          .select("id, basis, chain_head_at_release, issued_at")
          .eq("case_id", id)
          .maybeSingle();
        const row = data as {
          id: string; basis: string; chain_head_at_release: string; issued_at: string;
        } | null;
        if (row) {
          persisted = {
            id: row.id,
            basis: row.basis,
            chainHeadAtRelease: row.chain_head_at_release,
            issuedAt: row.issued_at,
          };
        }
      }
    } catch {
      persisted = null;
    }

    return {
      ok: true,
      data: resolveCustodyDocument(
        {
          state: found.state,
          caseClientId: found.entity.clientId,
          requesterClientId: verified.clientId,
          evidenceOk:
            found.evidence.ingress !== null &&
            found.evidence.egress !== null &&
            !found.holdReasons.some((r) => r.startsWith("EVIDENCE_")),
          evidenceEventIds,
          chain: documentChain,
          assessment: found.assessment,
          decision: found.decision,
          canonicalInspectionEvidenceIds: canonical,
          currentChainHead,
          issuedAt: new Date().toISOString(),
        },
        persisted,
      ),
    };
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
    const view = buildCustodyCaseView({
      case: outcome.case,
      actor: verified,
      identity: ctx.identity,
    });
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
  const res = await attachEvidenceAction(forced);
  if (res.ok) await triggerAnalysisIfPairComplete(String(forced.get("entity_id") ?? ""));
  return res;
}

/**
 * D2 · EL ANÁLISIS SE DISPARA SOLO AL COMPLETARSE EL PAR (S1-4).
 *
 * 2-C-2 · la implementación se movió a `@/lib/custody/analysis-trigger`, para que
 * la foto de egreso sacada desde `/wms/despachos` dispare EL MISMO análisis sin
 * arrastrar el proveedor de visión a ese grafo. Las condiciones no cambiaron —par
 * completo, sin decisión, estado no terminal— y siguen siendo best-effort: la
 * captura ya salió bien y un análisis que no arranca no la convierte en error.
 */

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
  const res = await attachEvidenceAction(forced);
  // D2 · el egreso es, en el flujo normal, la segunda foto del par.
  if (res.ok) await triggerAnalysisIfPairComplete(String(forced.get("entity_id") ?? ""));
  return res;
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
      // 2-C-2 · la composición del proveedor se movió a
      // `vision-evaluation-composition.ts`, que es ahora el ÚNICO lugar donde se
      // instancia `OpenAICustodyVisionProvider`. Acá no cambia nada de
      // comportamiento: el lease, el cooldown y el puerto de servidor son los
      // mismos. Lo que cambia es que el disparo automático desde despachos puede
      // reusar esa composición por `import()` dinámico sin arrastrar el
      // proveedor a su grafo estático.
      const outcome = await runPhysicalUnitVisionEvaluation({
        caseId: id,
        expectedVersion: found.version,
        begin: (c, v) => {
          if (!ctx.query.beginProductiveEvaluation) {
            throw new Error("camino productivo no disponible");
          }
          return ctx.query.beginProductiveEvaluation(c, v);
        },
        admin: admin as unknown as ProductiveVisionDataClient,
      });
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
