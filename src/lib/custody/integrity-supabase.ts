/**
 * WMS UI-1 · Implementación del `CustodyQueryPort` sobre el cliente de SESIÓN.
 *
 * Todo pasa por el cliente de sesión del usuario: RLS y los gates de las RPC
 * son los que deciden qué se ve y qué se puede hacer. El cliente privilegiado
 * NO participa de este camino —no hace falta— y por lo tanto `service_role`
 * nunca se acerca a la pantalla.
 *
 * Ninguna consulta acepta tenant, rol, sesión ni estado desde afuera: se piden
 * filas por id y la base aplica su propia frontera.
 */

import type {
  CustodyQueryPort,
  DecideRpcInput,
  RawCaseRow,
  RawDecisionRow,
  RawEvidenceRow,
} from "./integrity-adapters";
import type { CustodyEntityScope } from "./integrity";
import type {
  CompleteEvaluationInput,
  CustodyServerEvaluationPort,
} from "./integrity-evaluation";

/** Forma mínima del cliente Supabase que este puerto necesita. */
export interface CustodyDataClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>;
        order(
          column: string,
          opts: { ascending: boolean },
        ): { limit(n: number): Promise<{ data: unknown; error: { message: string } | null }> };
      };
      in(column: string, values: readonly unknown[]): Promise<{
        data: unknown;
        error: { message: string } | null;
      }>;
    };
  };
  rpc(fn: string, args: Record<string, unknown>): Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

const CASE_COLUMNS =
  "id, public_id, version, client_id, packing_unit_id, shipment_id, state, hold_reasons, " +
  "ingress_evidence_id, egress_evidence_id, provider, model, prompt_version, execution_mode, " +
  "outcome, verdict, model_confidence, provider_error, chain_status, chain_events_checked, " +
  "chain_head, chain_attested_at, decision_id, created_at, updated_at";

const DECISION_COLUMNS =
  "id, decision, actor_user_id, actor_session_id, actor_role, client_id, reason, observations, " +
  "decided_at, previous_state, new_state, chain_head_at_decision";

/**
 * Columnas de evidencia SIN el binario ni su ubicación: no se lee
 * `storage_bucket` ni `storage_path`, así que no hay forma de que la pantalla
 * los muestre por accidente. El acceso al binario sigue siendo exclusivamente
 * `emit_custody_signed_url`.
 */
const EVIDENCE_COLUMNS =
  "id, event_id, kind, sha256, redacted, captured_at, " +
  "custody_events!inner(packing_unit_id, shipment_id, stage, event_type, occurred_at)";

interface RawEvidenceJoin {
  id: string;
  event_id: string;
  kind: string | null;
  sha256: string;
  redacted: boolean | null;
  captured_at: string | null;
  custody_events:
    | RawEvidenceRow["event"]
    | RawEvidenceRow["event"][]
    | null;
}

function firstEvent(v: RawEvidenceJoin["custody_events"]): RawEvidenceRow["event"] {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export function createSupabaseCustodyQueryPort(db: CustodyDataClient): CustodyQueryPort {
  return {
    async selectCase(caseId: string): Promise<RawCaseRow | null> {
      const { data, error } = await db
        .from("custody_integrity_cases")
        .select(CASE_COLUMNS)
        .eq("id", caseId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as RawCaseRow | null) ?? null;
    },

    async selectDecision(decisionId: string): Promise<RawDecisionRow | null> {
      const { data, error } = await db
        .from("custody_integrity_decisions")
        .select(DECISION_COLUMNS)
        .eq("id", decisionId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as RawDecisionRow | null) ?? null;
    },

    async selectEvidence(evidenceIds: readonly string[]): Promise<RawEvidenceRow[]> {
      if (evidenceIds.length === 0) return [];
      const { data, error } = await db
        .from("custody_evidence")
        .select(EVIDENCE_COLUMNS)
        .in("id", [...evidenceIds]);
      if (error) throw new Error(error.message);
      return ((data ?? []) as RawEvidenceJoin[]).map((r) => ({
        id: r.id,
        event_id: r.event_id,
        kind: r.kind,
        sha256: r.sha256,
        redacted: r.redacted,
        captured_at: r.captured_at,
        event: firstEvent(r.custody_events),
      }));
    },

    /**
     * Head vigente = `row_hash` del último eslabón de la cadena de la entidad.
     * Se lee de `custody_events`, que 0224 concede en SELECT a `authenticated`.
     * No se inventa una RPC: `verify_custody_chain` valida la cadena pero no
     * devuelve el head, y la autoridad final sobre el head la sigue teniendo
     * `decide_custody_integrity`, que lo recalcula por su cuenta.
     */
    async verifyChainHead(scope: CustodyEntityScope, entityId: string): Promise<string | null> {
      const column = scope === "packing_unit" ? "packing_unit_id" : "shipment_id";
      const { data, error } = await db
        .from("custody_events")
        .select("row_hash, chain_seq")
        .eq(column, entityId)
        .order("chain_seq", { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<{ row_hash: string | null }>;
      return rows[0]?.row_hash ?? null;
    },

    async selectProfile(userId: string) {
      const { data, error } = await db
        .from("profiles")
        .select("role, client_id")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const row = data as { role: string | null; client_id: string | null } | null;
      return row ? { role: row.role, clientId: row.client_id } : null;
    },

    /** Vista `my_permissions` (0009): acotada a `auth.uid()` por definición. */
    async selectPermissions(): Promise<string[]> {
      const { data, error } = await db.from("my_permissions").select("slug").in("slug", [
        "wms.custody.decide",
        "wms.edit",
        "wms.view",
      ]);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<{ slug: string }>).map((r) => r.slug);
    },

    async decide(input: DecideRpcInput): Promise<string> {
      const { data, error } = await db.rpc("decide_custody_integrity", {
        p_case_id: input.caseId,
        p_expected_version: input.expectedVersion,
        p_decision: input.decision,
        p_reason: input.reason,
        p_observations: input.observations,
        p_inspection_evidence_ids: [...input.inspectionEvidenceIds],
      });
      if (error) throw new Error(error.message);
      return data as string;
    },

    async beginEvaluation(caseId: string, expectedVersion: number): Promise<string> {
      const { data, error } = await db.rpc("begin_custody_integrity_evaluation", {
        p_case_id: caseId,
        p_expected_version: expectedVersion,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },

    /**
     * `custody_inspection_candidates` (0224) es SECURITY DEFINER y exige
     * `wms.custody.decide` + tenant. Devuelve SÓLO los ids: ni digest, ni
     * ubicación, ni head. El navegador no participa de esta derivación.
     */
    async selectInspectionCandidates(caseId: string): Promise<string[]> {
      const { data, error } = await db.rpc("custody_inspection_candidates", {
        p_case_id: caseId,
      });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<{ evidence_id?: string | null }>;
      return rows
        .map((r) => r?.evidence_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0);
    },

    /**
     * Intento vigente. Se piden los últimos por caso y se filtra en memoria:
     * el índice parcial único de 0222 garantiza a lo sumo UNO pendiente, así
     * que no hace falta una consulta compuesta para encontrarlo.
     */
    async selectActiveAttempt(caseId: string) {
      const { data, error } = await db
        .from("custody_integrity_evaluation_attempts")
        .select("id, status, expires_at")
        .eq("case_id", caseId)
        .order("requested_at", { ascending: false })
        .limit(5);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<{
        id: string;
        status: string | null;
        expires_at: string | null;
      }>;
      const now = Date.now();
      for (const r of rows) {
        if (r.status !== "pending" || !r.expires_at) continue;
        const expira = Date.parse(r.expires_at);
        // Un vencimiento ilegible NO se interpreta como «ya venció»: se trata
        // como vigente, que es la lectura que no pisa una evaluación en curso.
        if (!Number.isFinite(expira) || expira > now) {
          return { attemptId: r.id, expiresAt: r.expires_at };
        }
      }
      return null;
    },
  };
}

/**
 * Puerto de FINALIZACIÓN de evaluación. Exige el ROL INTERNO DE SERVIDOR
 * (`complete_custody_integrity_evaluation`, 0223), así que se construye con el
 * cliente privilegiado y vive en su propia superficie: separarlo del puerto de
 * sesión es lo que hace evidente, al leer el código, que el privilegio no se
 * mezcla con la consulta del usuario. Se usa SÓLO dentro de una Server Action;
 * el cliente privilegiado nunca sale del servidor.
 */
export function createSupabaseServerEvaluationPort(
  admin: CustodyDataClient,
): CustodyServerEvaluationPort {
  return {
    async abandon(attemptId: string): Promise<void> {
      const { error } = await admin.rpc("abandon_custody_integrity_evaluation", {
        p_attempt_id: attemptId,
      });
      if (error) throw new Error(error.message);
    },

    async complete(input: CompleteEvaluationInput): Promise<void> {
      const { error } = await admin.rpc("complete_custody_integrity_evaluation", {
        p_attempt_id: input.attemptId,
        p_case_id: input.caseId,
        p_expected_version: input.expectedVersion,
        p_provider: input.provider,
        p_model: input.model,
        p_prompt_version: input.promptVersion,
        p_execution_mode: input.executionMode,
        p_outcome: input.outcome,
        p_verdict: input.verdict,
        p_model_confidence: input.modelConfidence,
        p_provider_error: input.providerError,
      });
      if (error) throw new Error(error.message);
    },
  };
}
