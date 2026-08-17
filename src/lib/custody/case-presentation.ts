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
  BELOW_SIMILARITY_THRESHOLD: "El score está por debajo del umbral del 90 %",
  PACKAGING_CHANGED: "El embalaje presenta cambios",
  MISSING_ITEMS_SUSPECTED: "Se sospechan faltantes",
  DAMAGE_SUSPECTED: "Se sospecha daño",
  NO_CALIBRATED_THRESHOLD: "No hay umbral calibrado aprobado",
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
  SCORE_BELOW_THRESHOLD: "El score no alcanza el umbral productivo",
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

export interface AiPanelView {
  /** El análisis corrió y produjo un resultado utilizable. */
  executed: boolean;
  verdictLabel: string | null;
  /** Autoconfianza del modelo informada por el SERVIDOR, 0..100. */
  confidencePercent: number | null;
  /** Score de similitud DB-owned; nunca se deriva de confidence. */
  similarityScore?: number | null;
  thresholdPercent?: number | null;
  thresholdPolicyVersion?: string | null;
  thresholdResult?: "ABOVE_OR_EQUAL" | "BELOW" | null;
  scoreComponents?: IntegrityAssessment["scoreComponents"];
  damageFlags?: {
    packagingChanged: boolean;
    missingItemsSuspected: boolean;
    damageSuspected: boolean;
  } | null;
  /** Invariante del producto: la IA nunca habilita ni ejecuta una decisión. */
  informativeOnly: true;
  note: string;
  failureLabel: string | null;
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
  holdLabels: string[];
  ai: AiPanelView;
  /**
   * Referencia operativa. `null` mientras el servidor no informe una
   * configuración aprobada: la pantalla NO inventa un porcentaje ni lo usa
   * como criterio. Si llega, se muestra rotulada y con su estado de aprobación.
   */
  referenceThreshold: { percent: number; approved: boolean } | null;
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

export interface BuildCaseViewInput {
  case: IntegrityCase;
  actor: VerifiedActor | null;
  /** Configuración de referencia servida por el servidor. Nunca del navegador. */
  referenceThreshold?: { percent: number; approved: boolean } | null;
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
    thresholdPercent: assessment?.thresholdPercent ?? null,
    thresholdPolicyVersion: assessment?.thresholdPolicyVersion ?? null,
    thresholdResult: assessment?.thresholdResult ?? null,
    scoreComponents: assessment?.scoreComponents ?? null,
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
  else if (c.state !== "REVIEW_REQUIRED") {
    quarantineBlockers.push("El caso no está en revisión humana");
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
    holdLabels: c.holdReasons.map(holdLabel),
    ai,
    referenceThreshold: input.referenceThreshold ?? null,
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
