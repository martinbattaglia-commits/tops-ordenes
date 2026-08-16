/**
 * WMS UI-1 · MODELO DE PRESENTACIÓN DEL CASO. Módulo PURO.
 *
 * Es la frontera entre el dominio y la pantalla, y existe por dos razones:
 *
 *  1. **Seguridad visual.** El view-model no tiene forma de transportar bucket,
 *     path, digest, token, signed URL ni identificadores de sesión: esos
 *     campos no existen en el tipo. No es una promesa del componente, es una
 *     imposibilidad estructural, y por eso se puede probar.
 *
 *  2. **La IA informa, no decide.** El panel de análisis se arma acá y no tiene
 *     ninguna salida que habilite una acción. La habilitación de `release` y
 *     `quarantine` se deriva de estado, rol, permiso y política de liberación,
 *     nunca del veredicto ni de la confianza del modelo.
 */

import type { CustodyCaseIdentity } from "./integrity-adapters";
import {
  CUSTODY_DECISION_PERMISSION,
  evaluateReleaseEligibility,
  MIN_OVERRIDE_REASON_LENGTH,
  MIN_REASON_LENGTH,
  type HoldReason,
  type IntegrityAssessment,
  type IntegrityCase,
  type IntegrityCaseState,
  type ReleaseBlocker,
  type VerifiedActor,
} from "./integrity";

export type CaseTone = "pending" | "hold" | "review" | "released" | "quarantined";

/**
 * §5 · RELEASE ADMIN-ONLY. No es una regla de UI: la fila de decisión de 0222
 * tiene un CHECK que impide registrar una liberación con un rol distinto de
 * `admin`. La pantalla refleja esa verdad en vez de ofrecer un botón que la
 * base va a rechazar.
 */
export const RELEASE_ROLES: readonly string[] = ["admin"];
export const QUARANTINE_ROLES: readonly string[] = ["admin", "operaciones", "supervisor"];

const STATE_LABEL: Record<IntegrityCaseState, string> = {
  PENDING_EVIDENCE: "Pendiente de evidencia",
  HOLD: "Retenido — revisión humana obligatoria",
  REVIEW_REQUIRED: "Revisión humana",
  RELEASED: "Liberado",
  QUARANTINED: "En cuarentena",
};

const STATE_TONE: Record<IntegrityCaseState, CaseTone> = {
  PENDING_EVIDENCE: "pending",
  HOLD: "hold",
  REVIEW_REQUIRED: "review",
  RELEASED: "released",
  QUARANTINED: "quarantined",
};

/** Motivos de retención en lenguaje operativo. Sin internals, sin rutas. */
const HOLD_LABEL: Record<string, string> = {
  EVIDENCE_MISSING: "Falta una de las dos fotos a comparar",
  EVIDENCE_NOT_FOUND: "No se encontró la evidencia indicada",
  EVIDENCE_ID_MISMATCH: "La evidencia recuperada no es la solicitada",
  EVIDENCE_SAME_IMAGE: "Las dos fotos son la misma imagen",
  EVIDENCE_FOREIGN_ENTITY: "La evidencia pertenece a otra unidad",
  EVIDENCE_FOREIGN_CLIENT: "La evidencia pertenece a otro cliente",
  EVIDENCE_REDACTED: "La evidencia fue redactada",
  EVIDENCE_SIZE_MISMATCH: "El tamaño real de la evidencia no coincide",
  EVIDENCE_MIME_MISMATCH: "El formato real de la evidencia no es admisible",
  EVIDENCE_HASH_MISMATCH: "La evidencia almacenada fue alterada",
  EVIDENCE_DOWNLOAD_FAILED: "No se pudo recuperar la evidencia autenticada",
  EVIDENCE_OUT_OF_ORDER: "Las fotos están fuera de orden temporal",
  EVIDENCE_STALE: "La foto de egreso está vencida",
  EVIDENCE_FUTURE: "La foto tiene fecha futura",
  EVIDENCE_MALFORMED_DIGEST: "La evidencia no es verificable",
  EVIDENCE_MALFORMED_TIMESTAMP: "La evidencia no tiene fecha válida",
  EVIDENCE_WRONG_STAGE: "La evidencia no corresponde a la etapa",
  CHAIN_INVALID: "La cadena de custodia no es válida",
  CHAIN_UNVERIFIABLE: "No se pudo verificar la cadena de custodia",
  CHAIN_EVENTS_NOT_CREDIBLE: "La verificación de cadena no es creíble",
  CHAIN_EVIDENCE_NOT_LINKED: "La evidencia no está ligada a la cadena",
  CHAIN_ATTESTATION_STALE: "La verificación de cadena quedó desactualizada",
  PROVIDER_TIMEOUT: "El análisis no respondió a tiempo",
  PROVIDER_UNAVAILABLE: "El análisis no está disponible",
  PROVIDER_INVALID_RESPONSE: "El análisis devolvió un resultado no utilizable",
  POLICY_CONTRACT_MISMATCH: "La política productiva no coincide con el contrato aprobado",
  PROVIDER_NOT_EXECUTED: "El análisis todavía no se ejecutó",
  PROVIDER_THREW: "El análisis falló",
  NON_REAL_EXECUTION: "El análisis no se ejecutó en modo real",
  VERDICT_DIFFERENCES: "El análisis detectó diferencias",
  VERDICT_POSSIBLE_DAMAGE: "El análisis detectó posible daño",
  // REGLA DE BORRADO (I3). Esta etiqueta decía «El score está por debajo del
  // umbral del 90 %» y se pintaba al operario bajo «Retenciones registradas».
  // No existe norma que fije un umbral porcentual de similitud de imágenes, y
  // la única que regula esta comparación prohíbe expresar el resultado como
  // valor numérico de certeza. Además el número no le sirve al operario: lo
  // que necesita saber es qué tiene que HACER.
  BELOW_SIMILARITY_THRESHOLD: "Requiere inspección física antes de decidir",
  PACKAGING_CHANGED: "El embalaje presenta cambios",
  MISSING_ITEMS_SUSPECTED: "Se sospechan faltantes",
  DAMAGE_SUSPECTED: "Se sospecha daño",
  // Regla de borrado, tercera aparición: la palabra «umbral» tampoco va acá.
  // Lo que el operario necesita saber es que el criterio automático no está
  // disponible y que la revisión queda entera del lado humano.
  NO_CALIBRATED_THRESHOLD: "El criterio automático no está configurado: revisión humana completa",
};

/** Bloqueos de liberación, también en lenguaje operativo. */
const BLOCKER_LABEL: Record<ReleaseBlocker | string, string> = {
  STATE_NOT_REVIEWABLE: "El caso no está en revisión humana",
  HOLD_SET_NOT_EXACT: "Hay retenciones que impiden liberar",
  EVIDENCE_NOT_VALID: "La evidencia comparada no es válida",
  CHAIN_NOT_VERIFIED: "La cadena de custodia no está verificada",
  CHAIN_EVENTS_NOT_POSITIVE_INT: "La verificación de cadena no es creíble",
  ASSESSMENT_NOT_OK: "El análisis no está disponible",
  EXECUTION_NOT_REAL: "El análisis no se ejecutó en modo real",
  VERDICT_NOT_MATCHING: "El análisis no indica coincidencia",
  CONFIDENCE_NOT_NUMERIC: "El análisis no informó confianza",
  // Misma regla de borrado: sin número y en términos de lo que hay que hacer.
  SCORE_BELOW_THRESHOLD: "La concordancia exige inspección física adicional",
  DAMAGE_FLAGS_PRESENT: "Hay señales de daño o faltantes que exigen revisión",
  NO_HUMAN_INSPECTION_EVIDENCE: "Falta la foto de inspección humana",
  REASON_TOO_SHORT: `El motivo debe tener al menos ${MIN_REASON_LENGTH} caracteres`,
};

export function holdLabel(reason: HoldReason | string): string {
  return HOLD_LABEL[reason] ?? "Retención registrada por el servidor";
}

export function blockerLabel(blocker: ReleaseBlocker | string): string {
  return BLOCKER_LABEL[blocker] ?? "Requisito de liberación no cumplido";
}

const VERDICT_LABEL: Record<string, string> = {
  coincide: "Coincide con el ingreso",
  diferencias: "Diferencias detectadas",
  posible_dano: "Posible daño detectado",
};

/**
 * Veredicto CUALITATIVO de tres categorías (I3).
 *
 * OSAC 2022-S-0001 / NIST prohíben expresar el resultado de una comparación de
 * imágenes como valor numérico de certeza y prescriben una escala cualitativa.
 * El porcentaje de concordancia SÍ se muestra —es útil y el operario lo
 * entiende—; lo que se elimina es el umbral y toda expresión de la forma
 * «X % ≥ Y %». El veredicto determina cuánta verificación se exige, nunca si
 * el bien sale: eso lo decide una persona (I1).
 */
export type ConcordanceVerdict = "ALTA" | "BAJA" | "NO_CONCLUYENTE";

export interface ConcordanceView {
  verdict: ConcordanceVerdict;
  label: string;
  /** Qué exige, en términos de lo que hay que hacer. */
  requirement: string;
  /** Token de color del sistema. Nunca `--tops-red`, que es de marca. */
  tone: "ok" | "danger" | "warn";
}

const CONCORDANCE: Record<ConcordanceVerdict, ConcordanceView> = {
  ALTA: {
    verdict: "ALTA",
    label: "CONCORDANCIA ALTA",
    requirement: "no requiere inspección adicional · la decisión sigue siendo tuya",
    tone: "ok",
  },
  BAJA: {
    verdict: "BAJA",
    label: "CONCORDANCIA BAJA",
    requirement: "inspección física obligatoria antes de poder decidir",
    tone: "danger",
  },
  NO_CONCLUYENTE: {
    verdict: "NO_CONCLUYENTE",
    label: "NO CONCLUYENTE",
    requirement: "las fotos no son comparables: repetí la de egreso",
    tone: "warn",
  },
};

export interface AiPanelView {
  /** El análisis corrió y produjo un resultado utilizable. */
  executed: boolean;
  verdictLabel: string | null;
  /** Autoconfianza del modelo informada por el SERVIDOR, 0..100. */
  confidencePercent: number | null;
  /** Score de similitud DB-owned; nunca se deriva de confidence. */
  similarityScore?: number | null;
  /**
   * ⚠ `thresholdPercent` NO ESTÁ Y NO DEBE ESTAR.
   *
   * Se lee de la base para derivar `concordance` y se sigue persistiendo en el
   * caso, pero no viaja al cliente. Que el campo no exista en este tipo es la
   * misma clase de garantía que usa el resto del view-model para bucket, path
   * y digest: no es una promesa del componente, es una imposibilidad
   * estructural, y por eso se puede probar.
   */
  thresholdPolicyVersion?: string | null;
  /** Veredicto cualitativo ya derivado server-side (I3). */
  concordance?: ConcordanceView | null;
  scoreComponents?: IntegrityAssessment["scoreComponents"];
  damageFlags?: {
    packagingChanged: boolean;
    missingItemsSuspected: boolean;
    damageSuspected: boolean;
  } | null;
  /** Observaciones y zonas señaladas por el análisis (`provider_details`). */
  observations?: string[];
  zones?: string[];
  /** Procedencia probatoria: sin esto el documento no es reproducible (I3). */
  model?: string | null;
  evaluatedAt?: string | null;
  /** Invariante del producto: la IA nunca habilita ni ejecuta una decisión. */
  informativeOnly: true;
  note: string;
  failureLabel: string | null;
}

/**
 * Deriva el veredicto cualitativo. `thresholdResult` lo calcula la base
 * comparando score contra la política vigente; acá sólo se traduce a la escala
 * que el operario necesita. Sin resultado de umbral no se inventa uno: las
 * fotos no son comparables y eso se dice.
 */
export function deriveConcordance(
  assessment: IntegrityAssessment | null,
): ConcordanceView | null {
  if (!assessment || assessment.outcome !== "ok") return null;
  if (assessment.thresholdResult === "ABOVE_OR_EQUAL") return CONCORDANCE.ALTA;
  if (assessment.thresholdResult === "BELOW") return CONCORDANCE.BAJA;
  return CONCORDANCE.NO_CONCLUYENTE;
}

/**
 * Estado operativo de la re-evaluación.
 *
 * `required` NO expone el head de la cadena: es un booleano derivado
 * server-side de comparar la atestación del caso con el head vigente. Un hash
 * en el view-model sería exactamente el dato que la pantalla no debe conocer.
 *
 * `analysis` existe porque «al día» y «nunca se ejecutó» no son lo mismo y la
 * pantalla los mostraba igual: un caso sin ningún análisis anunciaba estar al
 * día. Son tres estados distintos y se nombran los tres.
 */
export type AnalysisFreshness = "never" | "current" | "stale";

export interface ReevaluationView {
  enabled: boolean;
  required: boolean;
  analysis: AnalysisFreshness;
  /** Hay una reserva de evaluación viva: no se puede pedir otra. */
  inFlight: boolean;
  blockers: string[];
  reason: string | null;
}

/**
 * Registro de la foto de INSPECCIÓN HUMANA desde la pantalla.
 *
 * `eligible` cuenta las evidencias que el SERVIDOR ya considera admisibles
 * para decidir. No es un dato informativo: mientras sea 0, la liberación no
 * se habilita, y el inspector necesita saber si lo que falta es sacar la foto
 * o volver a evaluar.
 */
export interface InspectionCaptureView {
  enabled: boolean;
  blockers: string[];
  eligible: number;
}

export interface DecisionActionView {
  enabled: boolean;
  /** Motivos, ya traducidos. Vacío si `enabled`. */
  blockers: string[];
  /**
   * Condiciones que no impiden decidir pero que convierten la liberación en un
   * override humano: el caso quedó por debajo del umbral o con banderas de
   * daño. Ya traducidas. El inspector tiene que verlas antes de firmar, no
   * enterarse por el error crudo de la RPC.
   */
  overrideReasons?: string[];
  /** Longitud mínima del motivo que exigirá la RPC para esta decisión. */
  minReasonLength?: number;
}

export interface CustodyCaseView {
  caseId: string;
  state: IntegrityCaseState;
  stateLabel: string;
  tone: CaseTone;
  version: number;
  scope: "physical_unit" | "packing_unit" | "shipment";
  entityId: string;
  /**
   * S1-2 · De quién es el bien y cuál es. Antes este tipo no tenía ningún
   * campo de cliente ni identificador legible, así que la pantalla no podía
   * decirlo aunque la base lo supiera.
   */
  identity: CustodyCaseIdentityView;
  holdLabels: string[];
  ai: AiPanelView;
  release: DecisionActionView;
  quarantine: DecisionActionView;
  reevaluation: ReevaluationView;
  inspection: InspectionCaptureView;
  /** El POD permanece bloqueado hasta que exista una decisión humana válida. */
  podBlocked: boolean;
  podBlockedReason: string | null;
  /**
   * El POD-PDF ya está generado. Lo averigua el servidor; si no, la compuerta
   * ofrece generarlo. Nunca transporta la ruta ni el identificador del binario.
   */
  podPdfReady: boolean;
  decision: {
    kind: "release" | "quarantine";
    label: string;
    decidedAt: string;
    actorRole: string;
    reason: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Identidad tal como se PINTA. Se separa de `CustodyCaseIdentity` —el mapeo
 * crudo del adaptador— porque acá ya se resolvió la precedencia entre la razón
 * social canónica y el depositante asentado en la recepción, y porque el
 * componente no debe volver a decidir eso.
 */
export interface CustodyCaseIdentityView {
  /** Lo que se muestra como titular del bien. `null` si no hay ninguna fuente. */
  clientLabel: string | null;
  /** `true` cuando el label sale de la recepción y no del maestro de clientes. */
  clientFromReception: boolean;
  casePublicId: string | null;
  unitPublicId: string | null;
  sku: string | null;
  quantity: number | null;
  lotNumber: string | null;
  receptionId: string | null;
  receptionPublicId: string | null;
}

export interface BuildCaseViewInput {
  case: IntegrityCase;
  actor: VerifiedActor | null;
  /** Identidad resuelta por el servidor desde la MISMA lectura del caso. */
  identity?: CustodyCaseIdentity | null;
  /** Evidencia de inspección ya seleccionada por el inspector, si la hubiera. */
  candidateInspectionEvidenceIds?: readonly string[];
  /** Motivo tipeado, para anticipar el bloqueo por motivo corto. */
  draftReason?: string;
  /**
   * La cadena avanzó desde la atestación del caso. Lo calcula el servidor
   * comparando el head vigente contra el atestado; acá sólo llega el booleano.
   */
  chainAdvanced?: boolean;
  /** Hay una reserva de evaluación pendiente y vigente (leída del servidor). */
  evaluationInFlight?: boolean;
  /** El POD-PDF ya existe. Lo resuelve el servidor, no la pantalla. */
  podPdfReady?: boolean;
}

/**
 * Permiso de CAPTURA. Es el que exige `attach_custody_evidence`, y es distinto
 * del de decisión: quien saca la foto de inspección no es necesariamente quien
 * después libera. Reflejar esa diferencia en la pantalla evita ofrecerle a un
 * operario un botón que la RPC le va a rechazar.
 */
export const CUSTODY_CAPTURE_PERMISSION = "wms.edit";

function hasPermission(actor: VerifiedActor | null): boolean {
  return actor !== null && actor.permissions.includes(CUSTODY_DECISION_PERMISSION);
}

function mayCapture(actor: VerifiedActor | null): boolean {
  return actor !== null && actor.permissions.includes(CUSTODY_CAPTURE_PERMISSION);
}

export function buildCustodyCaseView(input: BuildCaseViewInput): CustodyCaseView {
  const c = input.case;
  const actor = input.actor ?? null;
  const decided = c.state === "RELEASED" || c.state === "QUARANTINED";

  const assessment = c.assessment;
  const ai: AiPanelView = {
    executed: assessment !== null && assessment.outcome === "ok",
    verdictLabel: assessment?.verdict ? VERDICT_LABEL[assessment.verdict] ?? null : null,
    confidencePercent:
      typeof assessment?.modelConfidence === "number"
        ? Math.round(assessment.modelConfidence * 100)
        : null,
    similarityScore: assessment?.similarityScore ?? null,
    thresholdPolicyVersion: assessment?.thresholdPolicyVersion ?? null,
    // El umbral se LEE para derivar esto y no viaja: ver el comentario del tipo.
    concordance: deriveConcordance(assessment),
    scoreComponents: assessment?.scoreComponents ?? null,
    observations: assessment?.observations ?? [],
    zones: assessment?.zones ?? [],
    model: assessment?.provenance.model ?? null,
    evaluatedAt: assessment?.provenance.completedAt ?? null,
    damageFlags:
      typeof assessment?.packagingChanged === "boolean"
      && typeof assessment?.missingItemsSuspected === "boolean"
      && typeof assessment?.damageSuspected === "boolean"
        ? {
            packagingChanged: assessment.packagingChanged,
            missingItemsSuspected: assessment.missingItemsSuspected,
            damageSuspected: assessment.damageSuspected,
          }
        : null,
    informativeOnly: true,
    note: "La IA informa y alerta. La decisión es humana.",
    failureLabel:
      assessment && assessment.outcome !== "ok"
        ? holdLabel(
            assessment.outcome === "timeout"
              ? "PROVIDER_TIMEOUT"
              : assessment.outcome === "unavailable"
                ? "PROVIDER_UNAVAILABLE"
                : assessment.outcome === "invalid_response"
                  ? "PROVIDER_INVALID_RESPONSE"
                  : assessment.outcome === "not_executed"
                    ? "PROVIDER_NOT_EXECUTED"
                    : "PROVIDER_THREW",
          )
        : null,
  };

  // ── Liberación ─────────────────────────────────────────────────────────
  const releaseBlockers: string[] = [];
  if (decided) releaseBlockers.push("El caso ya tiene una decisión registrada");
  if (!actor) releaseBlockers.push("Sesión no verificada");
  else {
    if (!hasPermission(actor)) releaseBlockers.push("No tenés permiso para decidir");
    if (!RELEASE_ROLES.includes(actor.role)) {
      releaseBlockers.push("La liberación está reservada a Dirección (admin)");
    }
  }
  let releaseOverrides: string[] = [];
  let releaseMinReason = MIN_REASON_LENGTH;
  if (!decided) {
    const eligibility = evaluateReleaseEligibility({
      state: c.state,
      holdReasons: c.holdReasons,
      evidenceOk:
        c.evidence.ingress !== null &&
        c.evidence.egress !== null &&
        !c.holdReasons.some((r) => r.startsWith("EVIDENCE_")),
      chain: c.chain,
      assessment: c.assessment,
      canonicalInspectionEvidenceIds: input.candidateInspectionEvidenceIds ?? [],
      reason: input.draftReason ?? "",
    });
    // El MOTIVO se excluye a propósito de la habilitación server-side.
    //
    // No es una propiedad del caso: es texto que el inspector está tipeando en
    // el navegador, y el servidor no lo ve hasta que se envía la decisión. Si
    // participara de `enabled`, el botón quedaría deshabilitado PARA SIEMPRE
    // —el servidor siempre vería el motivo vacío—, que es exactamente lo que
    // pasaba. Lo gobiernan el panel (mientras se escribe), el dominio y la RPC
    // (al decidir), y esos tres sí lo ven.
    for (const b of eligibility.blockers) {
      if (b === "REASON_TOO_SHORT") continue;
      releaseBlockers.push(blockerLabel(b));
    }
    // El override no deshabilita el botón —bloquearlo dejaría que la IA decida
    // por omisión— pero sí se declara, y arrastra el motivo reforzado que la
    // RPC va a exigir.
    releaseOverrides = eligibility.overrideReasons.map(blockerLabel);
    if (eligibility.overrideReasons.length > 0) {
      releaseMinReason = MIN_OVERRIDE_REASON_LENGTH;
    }
  }

  // La cadena avanzada invalida la atestación: 0224 rechaza la liberación
  // aunque todo lo demás esté en orden. Se dice ANTES de que el inspector
  // apriete el botón, no después.
  if (!decided && input.chainAdvanced === true) {
    releaseBlockers.push(
      "La cadena avanzó desde el análisis: volvé a evaluar el caso antes de liberar",
    );
  }

  // ── Cuarentena ─────────────────────────────────────────────────────────
  const quarantineBlockers: string[] = [];
  if (decided) quarantineBlockers.push("El caso ya tiene una decisión registrada");
  // S1-5 · La RPC acepta decidir desde REVIEW_REQUIRED **y desde HOLD**
  // (`0250a:2096`). El view-model bloqueaba todo estado distinto de
  // REVIEW_REQUIRED, de modo que el caso retenido —el escenario central del
  // contrato— era el único sin salida: no se podía liberar por definición y
  // tampoco cuarentenar. La pantalla ahora refleja la autoridad real.
  else if (c.state !== "REVIEW_REQUIRED" && c.state !== "HOLD") {
    quarantineBlockers.push("El caso todavía no está listo para decidir");
  }
  if (!actor) quarantineBlockers.push("Sesión no verificada");
  else {
    if (!hasPermission(actor)) quarantineBlockers.push("No tenés permiso para decidir");
    if (!QUARANTINE_ROLES.includes(actor.role)) quarantineBlockers.push("Tu rol no puede decidir");
  }
  // El motivo NO entra acá, por lo mismo que en la liberación: lo tiene el
  // navegador, no el servidor. Lo exige el panel y lo vuelve a exigir la RPC.

  // ── Re-evaluación ──────────────────────────────────────────────────────
  const inFlight = input.evaluationInFlight === true;
  const reevalBlockers: string[] = [];
  if (decided) reevalBlockers.push("El caso ya tiene una decisión registrada");
  else if (!(["PENDING_EVIDENCE", "REVIEW_REQUIRED", "HOLD"] as string[]).includes(c.state)) {
    reevalBlockers.push("El caso no admite una evaluación");
  }
  if (!actor) reevalBlockers.push("Sesión no verificada");
  else if (!hasPermission(actor)) reevalBlockers.push("No tenés permiso para decidir");
  if (c.evidence.ingress === null || c.evidence.egress === null) {
    reevalBlockers.push("Faltan las dos fotos a comparar");
  }
  // Una reserva viva impide pedir otra: la exclusividad la garantiza 0232, y
  // la pantalla la anticipa en vez de ofrecer un botón que va a fallar.
  if (inFlight) reevalBlockers.push("Ya hay una evaluación en curso para este caso");

  // Nunca ejecutado ≠ al día. `assessment` nulo o con outcome distinto de `ok`
  // es un análisis que no existe como resultado utilizable.
  const analysis: AnalysisFreshness =
    input.chainAdvanced === true && !decided
      ? "stale"
      : assessment === null || assessment.outcome === "not_executed"
        ? "never"
        : "current";

  // ── Captura de inspección humana ───────────────────────────────────────
  const inspectionBlockers: string[] = [];
  if (decided) inspectionBlockers.push("El caso ya tiene una decisión registrada");
  else if (c.state !== "REVIEW_REQUIRED" && c.state !== "HOLD") {
    inspectionBlockers.push("El caso todavía no está listo para inspección humana");
  }
  if (!actor) inspectionBlockers.push("Sesión no verificada");
  else if (!mayCapture(actor)) inspectionBlockers.push("No tenés permiso para registrar evidencia");

  return {
    caseId: c.caseId,
    state: c.state,
    stateLabel: STATE_LABEL[c.state],
    tone: STATE_TONE[c.state],
    version: c.version,
    scope: c.entity.scope,
    entityId: c.entity.entityId,
    identity: buildIdentityView(input.identity ?? null),
    holdLabels: c.holdReasons.map(holdLabel),
    ai,
    release: {
      enabled: releaseBlockers.length === 0,
      blockers: dedupe(releaseBlockers),
      overrideReasons: dedupe(releaseOverrides),
      minReasonLength: releaseMinReason,
    },
    quarantine: { enabled: quarantineBlockers.length === 0, blockers: dedupe(quarantineBlockers) },
    reevaluation: {
      enabled: reevalBlockers.length === 0,
      required: input.chainAdvanced === true && !decided,
      analysis,
      inFlight,
      blockers: dedupe(reevalBlockers),
      reason:
        input.chainAdvanced === true && !decided
          ? "La inspección humana agregó un eslabón a la cadena: el análisis quedó desactualizado"
          : null,
    },
    inspection: {
      enabled: inspectionBlockers.length === 0,
      blockers: dedupe(inspectionBlockers),
      eligible: (input.candidateInspectionEvidenceIds ?? []).length,
    },
    podPdfReady: input.podPdfReady === true,
    podBlocked: c.state !== "RELEASED",
    podBlockedReason:
      c.state === "RELEASED"
        ? null
        : c.state === "QUARANTINED"
          ? "La unidad está en cuarentena: el POD no se emite"
          : "POD y despacho bloqueados hasta registrar la decisión humana",
    decision: c.decision
      ? {
          kind: c.decision.decision,
          label: c.decision.decision === "release" ? "Liberado para despacho" : "Enviado a cuarentena",
          decidedAt: c.decision.decidedAt,
          actorRole: c.decision.actorRole,
          reason: c.decision.reason,
        }
      : null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Resuelve la identidad que se pinta.
 *
 * Precedencia: razón social canónica del maestro de clientes; si el actor no
 * puede verla —un encargado de depósito no tiene `clientes.view`—, el
 * depositante asentado en la recepción. Se declara cuál de las dos es con
 * `clientFromReception`, porque en un módulo probatorio la procedencia del
 * dato importa tanto como el dato.
 */
export function buildIdentityView(
  identity: CustodyCaseIdentity | null,
): CustodyCaseIdentityView {
  const canonical = identity?.clientRazon ?? null;
  const fromReception = identity?.clientNameAtReception ?? null;
  return {
    clientLabel: canonical ?? fromReception,
    clientFromReception: canonical === null && fromReception !== null,
    casePublicId: identity?.casePublicId ?? null,
    unitPublicId: identity?.unitPublicId ?? null,
    sku: identity?.sku ?? null,
    quantity: identity?.quantity ?? null,
    lotNumber: identity?.lotNumber ?? null,
    receptionId: identity?.receptionId ?? null,
    receptionPublicId: identity?.receptionPublicId ?? null,
  };
}

/**
 * Red de seguridad probable: ninguna cadena del view-model puede parecerse a un
 * secreto o a una ubicación de Storage. Se usa en las pruebas y como assert
 * barato antes de serializar hacia el cliente.
 */
const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /custody-(evidence|pii|pod)/i,
  /\beyJ[A-Za-z0-9_-]{6,}\./,
  /\b[0-9a-f]{64}\b/i,
  /token=/i,
  /storage\/v1/i,
  /supabase\.co/i,
];

export function leaksSensitiveData(view: unknown): boolean {
  const serialized = JSON.stringify(view ?? null);
  return FORBIDDEN_PATTERNS.some((re) => re.test(serialized));
}
