/**
 * WMS UI-1 · ADAPTADORES PRODUCTIVOS DE LOS PUERTOS DE INTEGRIDAD
 *
 * ─── POR QUÉ VIVEN ACÁ Y NO DENTRO DE `integrity/` ────────────────────────
 *
 * `src/lib/custody/integrity/**` es dominio PURO: sin IO, sin red, sin
 * Supabase, sin `env`. Meter un adaptador ahí invertiría la dependencia y
 * volvería impura la única capa que hoy se puede razonar sin plataforma. Los
 * adaptadores viven fuera y dependen del dominio, nunca al revés.
 *
 * ─── QUÉ NO HACE ESTE MÓDULO ──────────────────────────────────────────────
 *
 * No inventa RPC. Cada método se apoya en un contrato que ya existe en
 * 0221–0226 y que está autorizado para `authenticated`:
 *
 *   · lectura del caso        → select sobre `custody_integrity_cases` (RLS)
 *   · lectura de decisión     → select sobre `custody_integrity_decisions` (RLS)
 *   · lectura de evidencia    → select sobre `custody_evidence` + `custody_events`
 *   · head vigente de cadena  → `verify_custody_chain` (0222)
 *   · candidatos a inspección → `custody_inspection_candidates` (0224)
 *   · decisión humana         → `decide_custody_integrity` (0224)
 *   · reserva de evaluación   → `begin_custody_integrity_evaluation` (0223)
 *
 * `complete_custody_integrity_evaluation` es del ROL INTERNO DE SERVIDOR: no se
 * expone acá y el camino de UI no lo toca.
 *
 * ─── FRONTERA DE CONFIANZA ────────────────────────────────────────────────
 *
 * Identidad, sesión, tenant, rol, permisos, verdict, threshold, chain head y
 * timestamps salen SIEMPRE del servidor. Este módulo no acepta ninguno de esos
 * valores por parámetro desde el exterior, y el `clientId` efectivo del actor
 * se deriva del perfil o del caso —jamás del navegador—.
 */

import {
  type ActorAuthorizationPort,
  type CasResult,
  type ChainHeadPort,
  type ChainVerification,
  type CustodyEntityScope,
  type CustodyEvidenceKind,
  type EvidenceLoaderPort,
  type EvidenceRecord,
  type HumanDecisionRecord,
  type IntegrityAssessment,
  type IntegrityCase,
  type IntegrityCaseRepository,
  type IntegrityCaseState,
  type HoldReason,
  type LoadEvidencePairInput,
  type ReserveResult,
  type VerifiedActor,
  CUSTODY_DECISION_PERMISSION,
} from "./integrity";

/** Fallo de contrato: lo que se pidió no existe como camino autorizado. */
export class CustodyContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustodyContractError";
  }
}

// ---------------------------------------------------------------------------
// Puerto de consulta: la ÚNICA superficie que toca la plataforma
// ---------------------------------------------------------------------------

export interface RawCaseRow {
  id: string;
  version: number;
  client_id: string;
  physical_unit_id?: string | null;
  packing_unit_id: string | null;
  shipment_id: string | null;
  state: string;
  hold_reasons: string[] | null;
  ingress_evidence_id: string | null;
  egress_evidence_id: string | null;
  provider: string | null;
  model: string | null;
  prompt_version: string | null;
  execution_mode: string | null;
  outcome: string | null;
  verdict: string | null;
  model_confidence: number | string | null;
  similarity_score?: number | string | null;
  threshold_percent?: number | string | null;
  threshold_policy_version?: string | null;
  threshold_result?: string | null;
  score_components?: Record<string, unknown> | null;
  packaging_changed?: boolean | null;
  missing_items_suspected?: boolean | null;
  damage_suspected?: boolean | null;
  provider_details?: Record<string, unknown> | null;
  provider_error: string | null;
  chain_status: string | null;
  chain_events_checked: number | null;
  chain_head: string | null;
  chain_attested_at: string | null;
  decision_id: string | null;
  created_at: string;
  updated_at: string;
  public_id?: string | null;
  /** Embeds de S1-2. PostgREST devuelve objeto o array de uno según la FK. */
  clients?: RawClientEmbed | RawClientEmbed[] | null;
  custody_physical_units?: RawPhysicalUnitEmbed | RawPhysicalUnitEmbed[] | null;
}

export interface RawClientEmbed {
  razon?: string | null;
}

export interface RawReceptionEmbed {
  id?: string | null;
  public_id?: string | null;
  client_name?: string | null;
}

export interface RawPhysicalUnitEmbed {
  public_id?: string | null;
  sku?: string | null;
  quantity?: number | string | null;
  lot_number?: string | null;
  expiration_date?: string | null;
  receptions?: RawReceptionEmbed | RawReceptionEmbed[] | null;
}

/**
 * IDENTIDAD DEL CASO Y DEL BIEN · S1-2 (clase C1).
 *
 * Vive fuera de `IntegrityCase` a propósito: `src/lib/custody/integrity/**` es
 * dominio PURO y esto es identidad de presentación. Meterlo ahí volvería
 * impura la única capa que hoy se puede razonar sin plataforma.
 *
 * Ningún campo es obligatorio salvo el `public_id` del caso: un caso de scope
 * `packing_unit` o `shipment` no tiene unidad física, y decir «sin dato» es
 * correcto. Lo que NO es correcto es lo que pasaba antes: no decir nada.
 */
export interface CustodyCaseIdentity {
  /** CINT-AAAA-NNNN. */
  casePublicId: string | null;
  /** Razón social canónica (`clients.razon`), si el actor puede verla. */
  clientRazon: string | null;
  /** Depositante asentado en la recepción. Alcanza al operario de depósito. */
  clientNameAtReception: string | null;
  /** CPU-AAAA-NNNNNN. */
  unitPublicId: string | null;
  sku: string | null;
  quantity: number | null;
  lotNumber: string | null;
  expirationDate: string | null;
  receptionId: string | null;
  receptionPublicId: string | null;
}

function firstEmbed<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Mapea la identidad desde la fila que la lectura ya trajo. Sin IO extra. */
export function mapCaseIdentity(row: RawCaseRow): CustodyCaseIdentity {
  const unit = firstEmbed(row.custody_physical_units);
  const reception = firstEmbed(unit?.receptions);
  return {
    casePublicId: text(row.public_id),
    clientRazon: text(firstEmbed(row.clients)?.razon),
    clientNameAtReception: text(reception?.client_name),
    unitPublicId: text(unit?.public_id),
    sku: text(unit?.sku),
    quantity: toNumber(unit?.quantity),
    lotNumber: text(unit?.lot_number),
    expirationDate: text(unit?.expiration_date),
    receptionId: text(reception?.id),
    receptionPublicId: text(reception?.public_id),
  };
}

export interface RawEvidenceRow {
  id: string;
  event_id: string;
  kind: string | null;
  sha256: string;
  redacted: boolean | null;
  captured_at: string | null;
  event: {
    physical_unit_id?: string | null;
    packing_unit_id: string | null;
    shipment_id: string | null;
    stage: string;
    event_type: string;
    occurred_at: string;
  } | null;
}

export interface RawDecisionRow {
  id: string;
  decision: string;
  actor_user_id: string | null;
  actor_session_id: string | null;
  actor_role: string | null;
  client_id: string;
  reason: string | null;
  observations: string | null;
  decided_at: string;
  previous_state: string | null;
  new_state: string;
  chain_head_at_decision: string | null;
}

export interface DecideRpcInput {
  caseId: string;
  expectedVersion: number;
  decision: "release" | "quarantine";
  reason: string;
  observations: string | null;
  inspectionEvidenceIds: readonly string[];
  scope?: CustodyEntityScope;
}

/**
 * Superficie mínima contra la plataforma. Se inyecta, así que los adaptadores
 * de dominio se prueban enteros sin red, sin DOM y sin Supabase.
 */
export interface CustodyQueryPort {
  selectCase(caseId: string): Promise<RawCaseRow | null>;
  selectDecision(decisionId: string): Promise<RawDecisionRow | null>;
  selectEvidence(evidenceIds: readonly string[]): Promise<RawEvidenceRow[]>;
  verifyChainHead(scope: CustodyEntityScope, entityId: string): Promise<string | null>;
  /**
   * S1-6 · ¿avanzó la cadena con eventos que NO son inspección humana?
   *
   * Espeja `0250a:2129-2133`. Opcional en el tipo para no romper dobles de
   * prueba existentes; su ausencia se trata como «no se puede afirmar que esté
   * al día», que es la lectura fail-closed.
   */
  chainAdvancedBeyondInspection?(
    scope: CustodyEntityScope,
    entityId: string,
    attestedHead: string,
  ): Promise<boolean>;
  selectProfile(userId: string): Promise<{ role: string | null; clientId: string | null } | null>;
  selectPermissions(): Promise<string[]>;
  decide(input: DecideRpcInput): Promise<string>;
  beginEvaluation(caseId: string, expectedVersion: number): Promise<string>;
  beginProductiveEvaluation?(caseId: string, expectedVersion: number): Promise<unknown>;
  /**
   * Evidencias de inspección humana ELEGIBLES para este caso, derivadas por el
   * servidor. Nunca se recibe una lista del navegador: se pregunta cuáles son.
   *
   * La autoridad es `custody_inspection_candidates` (0224), que aplica el
   * predicado único `is_custody_inspection_evidence`: par canónico D1
   * (`inspeccion_humana`/`despacho`), soporte foto no redactada, misma entidad
   * y mismo cliente que el caso, distinta de las dos comparadas, posterior a
   * ambas y —cota superior— DENTRO de la cadena ya atestada. Esa última cota
   * es la que hace que la foto recién tomada no sea elegible hasta volver a
   * evaluar: no es un efecto colateral, es la regla.
   */
  selectInspectionCandidates(caseId: string, scope?: CustodyEntityScope): Promise<string[]>;
  /** Intento de evaluación vigente (pendiente y no vencido), si lo hay. */
  selectActiveAttempt(caseId: string): Promise<ActiveAttempt | null>;
}

/** Reserva de evaluación viva. No transporta proveedor ni resultado. */
export interface ActiveAttempt {
  attemptId: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Normalización defensiva de lo que devuelve la DB
// ---------------------------------------------------------------------------

const CASE_STATES: readonly string[] = [
  "PENDING_EVIDENCE",
  "HOLD",
  "REVIEW_REQUIRED",
  "RELEASED",
  "QUARANTINED",
];

function toState(value: unknown): IntegrityCaseState {
  // Fail-closed: un estado que no conocemos NO se degrada a algo decidible.
  return CASE_STATES.includes(value as string)
    ? (value as IntegrityCaseState)
    : "PENDING_EVIDENCE";
}

function toKind(value: unknown): CustodyEvidenceKind | null {
  return value === "foto" || value === "firma" || value === "documento" ? value : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

type ScopeRow = {
  physical_unit_id?: string | null;
  packing_unit_id: string | null;
  shipment_id: string | null;
};

function scopeOf(row: ScopeRow): CustodyEntityScope {
  const present = [row.physical_unit_id ?? null, row.packing_unit_id, row.shipment_id]
    .filter((value) => value !== null);
  if (present.length !== 1) throw new CustodyContractError("scope de custodia ambiguo");
  if (row.physical_unit_id != null) return "physical_unit";
  return row.packing_unit_id !== null ? "packing_unit" : "shipment";
}

function entityIdOf(row: ScopeRow): string {
  scopeOf(row);
  return (row.physical_unit_id ?? row.packing_unit_id ?? row.shipment_id) as string;
}

export function mapEvidenceRow(row: RawEvidenceRow, clientId: string): EvidenceRecord | null {
  if (!row.event) return null;
  return {
    evidenceId: row.id,
    eventId: row.event_id,
    scope: scopeOf(row.event),
    entityId: entityIdOf(row.event),
    clientId,
    stage: row.event.stage as EvidenceRecord["stage"],
    eventType: row.event.event_type as EvidenceRecord["eventType"],
    kind: toKind(row.kind),
    sha256: row.sha256,
    capturedAt: row.captured_at ?? row.event.occurred_at,
    redacted: row.redacted === true,
  };
}

function mapChain(row: RawCaseRow): ChainVerification | null {
  if (row.chain_status === null) return null;
  if (row.chain_status === "verified") {
    // La atestación sólo es «verified» si viene COMPLETA: si falta cualquier
    // parte, se degrada a no verificable en vez de fingir una verificación.
    if (!row.chain_head || !row.chain_attested_at || !row.chain_events_checked) {
      return { status: "unverifiable", verifiedAt: row.updated_at, error: "attestation_incomplete" };
    }
    return {
      status: "verified",
      attestation: {
        scope: scopeOf(row),
        entityId: entityIdOf(row),
        chainHead: row.chain_head,
        eventsChecked: row.chain_events_checked,
        verifiedEventIds: [],
        attestedAt: row.chain_attested_at,
      },
    };
  }
  if (row.chain_status === "invalid") {
    return {
      status: "invalid",
      eventsChecked: row.chain_events_checked ?? 0,
      verifiedAt: row.chain_attested_at ?? row.updated_at,
      firstError: null,
    };
  }
  return {
    status: "unverifiable",
    verifiedAt: row.chain_attested_at ?? row.updated_at,
    error: row.chain_status,
  };
}

/**
 * Cadenas acotadas de `provider_details`. Se recortan y se limitan en cantidad
 * y longitud: lo que viene del proveedor es texto ajeno y termina en pantalla.
 */
function boundedStrings(value: unknown, max: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .slice(0, max)
    .map((v) => v.trim().slice(0, maxLen));
}

function mapAssessment(row: RawCaseRow): IntegrityAssessment | null {
  if (row.outcome === null) return null;
  // S1-7 · `provider_details` se guardaba en la base y se descartaba acá con
  // dos arrays vacíos LITERALES. Las observaciones del análisis y las zonas de
  // daño señaladas son justamente lo que el inspector necesita para saber
  // dónde mirar antes de decidir.
  const details = row.provider_details ?? null;
  return {
    outcome: row.outcome as IntegrityAssessment["outcome"],
    verdict: (row.verdict as IntegrityAssessment["verdict"]) ?? null,
    modelConfidence: toNumber(row.model_confidence),
    observations: boundedStrings(details?.observations, 6, 240),
    zones: boundedStrings(details?.zones, 6, 120),
    provenance: {
      provider: row.provider ?? "",
      model: row.model ?? "",
      promptVersion: row.prompt_version ?? "",
      executionMode: (row.execution_mode as IntegrityAssessment["provenance"]["executionMode"]) ?? "mock",
      requestedAt: row.created_at,
      completedAt: row.updated_at,
    },
    error: row.provider_error,
    similarityScore: toNumber(row.similarity_score),
    thresholdPercent: toNumber(row.threshold_percent),
    thresholdPolicyVersion: row.threshold_policy_version ?? null,
    thresholdResult:
      row.threshold_result === "ABOVE_OR_EQUAL" || row.threshold_result === "BELOW"
        ? row.threshold_result
        : null,
    scoreComponents:
      row.score_components
      && ["identity", "packaging", "quantity", "condition"].every(
        (key) => typeof row.score_components?.[key] === "number",
      )
        ? row.score_components as IntegrityAssessment["scoreComponents"]
        : null,
    packagingChanged: row.packaging_changed ?? null,
    missingItemsSuspected: row.missing_items_suspected ?? null,
    damageSuspected: row.damage_suspected ?? null,
  };
}

function mapDecision(row: RawDecisionRow | null): HumanDecisionRecord | null {
  if (!row) return null;
  return {
    decision: row.decision === "release" ? "release" : "quarantine",
    actorUserId: row.actor_user_id ?? "",
    actorSessionId: row.actor_session_id ?? "",
    actorRole: row.actor_role ?? "",
    clientId: row.client_id,
    permission: CUSTODY_DECISION_PERMISSION,
    decidedAt: row.decided_at,
    reason: row.reason ?? "",
    observations: row.observations,
    inspectionEvidenceIds: [],
    previousState: toState(row.previous_state),
    newState: row.new_state === "RELEASED" ? "RELEASED" : "QUARANTINED",
    chainHeadAtDecision: row.chain_head_at_decision,
  };
}

/** Arma el caso de dominio a partir de las filas autoritativas de la DB. */
export async function buildIntegrityCase(
  query: CustodyQueryPort,
  row: RawCaseRow,
): Promise<IntegrityCase> {
  const ids = [row.ingress_evidence_id, row.egress_evidence_id].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  const rows = ids.length > 0 ? await query.selectEvidence(ids) : [];
  const byId = new Map(rows.map((r) => [r.id, mapEvidenceRow(r, row.client_id)]));
  const decision = row.decision_id ? await query.selectDecision(row.decision_id) : null;

  return {
    caseId: row.id,
    version: row.version,
    evaluationLease: null,
    entity: { scope: scopeOf(row), entityId: entityIdOf(row), clientId: row.client_id },
    selector: {
      ingressEvidenceId: row.ingress_evidence_id,
      egressEvidenceId: row.egress_evidence_id,
    },
    state: toState(row.state),
    holdReasons: (row.hold_reasons ?? []) as HoldReason[],
    evidence: {
      ingress: row.ingress_evidence_id ? byId.get(row.ingress_evidence_id) ?? null : null,
      egress: row.egress_evidence_id ? byId.get(row.egress_evidence_id) ?? null : null,
    },
    chain: mapChain(row),
    assessment: mapAssessment(row),
    decision: mapDecision(decision),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// ActorAuthorizationPort
// ---------------------------------------------------------------------------

export interface TrustedActorIdentity {
  actorId: string;
  sessionId: string;
}

/**
 * Actor verificado, acotado al tenant del CASO.
 *
 * `VerifiedActor.clientId` es el tenant sobre el que el actor va a operar. Para
 * un usuario client-bound sale de su propio perfil, así que un caso de otro
 * cliente produce `CLIENT_MISMATCH` en el dominio. Para los roles internos
 * —admin/operaciones/supervisor, que por política canónica no están atados a un
 * cliente— el tenant efectivo es el del caso, que se leyó server-side bajo RLS.
 *
 * En ningún caso el navegador aporta el tenant, y la autoridad final sigue
 * siendo `assert_custody_tenant` dentro de la RPC: esto es la primera línea.
 */
const INTERNAL_ROLES: readonly string[] = ["admin", "operaciones", "supervisor"];

export function createActorAuthorizationPort(
  query: CustodyQueryPort,
  identity: TrustedActorIdentity | null,
  caseClientId: string,
): ActorAuthorizationPort {
  return {
    async resolveActor(): Promise<VerifiedActor | null> {
      if (!identity || !identity.actorId || !identity.sessionId) return null;
      const profile = await query.selectProfile(identity.actorId);
      if (!profile || !profile.role) return null;

      const effectiveClientId = INTERNAL_ROLES.includes(profile.role)
        ? caseClientId
        : profile.clientId ?? "";
      if (!effectiveClientId) return null;

      const permissions = await query.selectPermissions();
      return {
        subjectType: "human_session",
        userId: identity.actorId,
        sessionId: identity.sessionId,
        clientId: effectiveClientId,
        role: profile.role,
        permissions,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// EvidenceLoaderPort
// ---------------------------------------------------------------------------

export function createEvidenceLoaderPort(query: CustodyQueryPort): EvidenceLoaderPort {
  return {
    async loadPair(input: LoadEvidencePairInput) {
      const ids = [input.selector.ingressEvidenceId, input.selector.egressEvidenceId].filter(
        (v): v is string => typeof v === "string" && v.length > 0,
      );
      if (ids.length !== 2) return { ingress: null, egress: null };
      const rows = await query.selectEvidence(ids);
      const byId = new Map(rows.map((r) => [r.id, mapEvidenceRow(r, input.clientId)]));
      return {
        ingress: byId.get(input.selector.ingressEvidenceId as string) ?? null,
        egress: byId.get(input.selector.egressEvidenceId as string) ?? null,
      };
    },
    async loadInspectionEvidence(input) {
      const ids = input.evidenceIds.filter((v) => typeof v === "string" && v.length > 0);
      if (ids.length === 0) return [];
      const rows = await query.selectEvidence(ids);
      // El dominio revalida entidad, cliente, soporte y redacción; acá sólo se
      // traduce. Un registro sin evento no se completa con supuestos: se cae.
      return rows
        .map((r) => mapEvidenceRow(r, input.clientId))
        .filter((r): r is EvidenceRecord => r !== null);
    },
  };
}

// ---------------------------------------------------------------------------
// ChainHeadPort
// ---------------------------------------------------------------------------

export function createChainHeadPort(query: CustodyQueryPort): ChainHeadPort {
  return {
    async currentChainHead(scope, entityId) {
      return query.verifyChainHead(scope, entityId);
    },
  };
}

// ---------------------------------------------------------------------------
// IntegrityCaseRepository
// ---------------------------------------------------------------------------

/**
 * Traduce el error de la RPC a un fallo CAS tipado.
 *
 * Ambiguo por defecto: si no reconocemos el motivo, no se afirma que la
 * transacción no ocurrió. `VERSION_CONFLICT` es la lectura correcta de una
 * carrera y es lo que la UI debe mostrar como «alguien decidió antes».
 */
export function classifyDecideFailure(message: string): CasResult {
  const m = (message || "").toLowerCase();
  // La cadena avanzó desde la atestación: es el caso más frecuente y el más
  // confuso si se lo muestra como «no disponible». Registrar la foto de
  // inspección humana agrega un eslabón, así que el caso necesita volver a
  // evaluarse ANTES de poder liberarse. Es una regla de 0224, no un fallo.
  if (m.includes("cadena avanz") || m.includes("atestaci")) {
    return { ok: false, failure: "ATTESTATION_STALE" };
  }
  if (m.includes("versión") || m.includes("version") || m.includes("conflicto")) {
    return { ok: false, failure: "VERSION_CONFLICT" };
  }
  if (m.includes("ya decidid") || m.includes("already")) return { ok: false, failure: "ALREADY_DECIDED" };
  if (m.includes("inexistente") || m.includes("no_data_found")) return { ok: false, failure: "NOT_FOUND" };
  if (m.includes("estado")) return { ok: false, failure: "STATE_CONFLICT" };
  return { ok: false, failure: "RECORD_INCOHERENT" };
}

export function createIntegrityCaseRepository(query: CustodyQueryPort): IntegrityCaseRepository {
  return {
    async findById(caseId, clientId) {
      const row = await query.selectCase(caseId);
      if (!row) return null;
      // Doble llave: RLS ya filtró por tenant y acá se vuelve a exigir. Un caso
      // de otro cliente no se devuelve ni siquiera si la policy cambiara.
      if (row.client_id !== clientId) return null;
      return buildIntegrityCase(query, row);
    },

    async applyDecision(input): Promise<CasResult> {
      // La DB es la autoridad: `decide_custody_integrity` revalida sesión,
      // permiso, tenant, estado, CAS de versión, cadena viva y evidencia de
      // inspección. Acá NO se reescribe el registro local como si fuera verdad.
      try {
        await query.decide({
          caseId: input.caseId,
          expectedVersion: input.expectedVersion,
          decision: input.record.decision,
          reason: input.record.reason,
          observations: input.record.observations,
          inspectionEvidenceIds: input.record.inspectionEvidenceIds,
          scope: input.scope,
        });
      } catch (e) {
        // HN-1 · Un rechazo de CONTRATO no es un fallo de la transacción: es
        // que el camino no existe. No pasa por el clasificador de mensajes,
        // que adivinaría `RECORD_INCOHERENT` y le mentiría al inspector.
        if (e instanceof CustodyContractError) {
          return { ok: false, failure: "SCOPE_NOT_DECIDABLE" };
        }
        return classifyDecideFailure(e instanceof Error ? e.message : String(e));
      }
      const row = await query.selectCase(input.caseId);
      if (!row) return { ok: false, failure: "NOT_FOUND" };
      return { ok: true, case: await buildIntegrityCase(query, row) };
    },

    async reserveCase(input): Promise<ReserveResult> {
      const row = await query.selectCase(input.caseId);
      if (!row) return { ok: false, failure: "NOT_FOUND" };
      try {
        await query.beginEvaluation(input.caseId, row.version);
      } catch {
        return { ok: false, failure: "LEASE_HELD" };
      }
      const fresh = await query.selectCase(input.caseId);
      if (!fresh) return { ok: false, failure: "NOT_FOUND" };
      return { ok: true, case: await buildIntegrityCase(query, fresh), claimed: true };
    },

    async recordAssessment(): Promise<CasResult> {
      // `complete_custody_integrity_evaluation` (0223) está reservada al ROL
      // INTERNO DE SERVIDOR. No se expone por la sesión del usuario ni se
      // sustituye con el cliente privilegiado desde la UI: el camino de
      // evaluación es del pipeline, no de la pantalla.
      throw new CustodyContractError(
        "el registro de evaluación exige el rol interno de servidor",
      );
    },
  };
}
