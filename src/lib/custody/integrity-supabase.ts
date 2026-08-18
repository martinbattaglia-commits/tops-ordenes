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

import { CustodyContractError } from "./integrity-adapters";
import type {
  CertificateDocumentContext,
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
import type {
  ProductiveVisionEvidenceRow,
  ProductiveVisionServerPort,
  ProductiveVisionSessionPort,
} from "./productive-vision-evaluation";

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

/** Cliente mínimo para el camino productivo. Sólo se construye en servidor. */
export interface ProductiveVisionDataClient extends CustodyDataClient {
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{ data: Blob | null; error: unknown }>;
    };
  };
}

/**
 * S1-2 · La identidad viaja con el caso, en la MISMA lectura.
 *
 * El caso no se lee por RPC: se lee por PostgREST, acá abajo. Antes esta lista
 * traía `client_id` —un UUID— y `physical_unit_id`, y ahí terminaba: la razón
 * social y los identificadores legibles del bien no se pedían en ninguna capa,
 * así que no había forma de pintarlos aunque el view-model los hubiera
 * transportado. Se amplía la consulta, que es donde estaba el corte real.
 *
 * Dos fuentes para el nombre del depositante, y las dos son deliberadas:
 *
 *  · `clients(razon)` es la razón social CANÓNICA. Su policy (0241) exige
 *    `clientes.view` o ser el propio cliente, así que para un encargado de
 *    depósito viene `null`. No es un error: es la frontera de datos maestros.
 *  · `receptions(client_name)` es el depositante tal como quedó asentado al
 *    recibir la mercadería. ADR-P3-13 lo conserva como dato descriptivo y su
 *    RLS sí alcanza al operario de depósito.
 *
 * La presentación prefiere la canónica y cae a la de recepción. Un operario
 * que no puede ver el maestro de clientes igual tiene que saber de quién es el
 * bien que está por liberar: ésa es la costura C1 entera.
 *
 * `provider_details` se agrega acá por la misma razón: se escribía en la base
 * y no se leía en ningún lado, así que las observaciones y las zonas de daño
 * del análisis se perdían antes de llegar al adaptador.
 */
const CASE_COLUMNS =
  "id, public_id, version, client_id, physical_unit_id, packing_unit_id, shipment_id, state, hold_reasons, " +
  "ingress_evidence_id, egress_evidence_id, provider, model, prompt_version, execution_mode, " +
  "outcome, verdict, model_confidence, similarity_score, threshold_percent, threshold_policy_version, " +
  "threshold_result, score_components, packaging_changed, missing_items_suspected, damage_suspected, " +
  "provider_details, provider_error, chain_status, chain_events_checked, " +
  "chain_head, chain_attested_at, decision_id, created_at, updated_at, " +
  "clients(razon), " +
  "custody_physical_units(public_id, sku, quantity, lot_number, expiration_date, " +
  "receptions(id, public_id, client_name))";

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
  "custody_events!inner(physical_unit_id, packing_unit_id, shipment_id, stage, event_type, occurred_at)";

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
      const column = scope === "physical_unit"
        ? "physical_unit_id"
        : scope === "packing_unit" ? "packing_unit_id" : "shipment_id";
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

    /**
     * S1-6 · ¿La cadena avanzó con eventos que NO son inspección humana?
     *
     * La base ya aplicaba esta regla y la aplicaba bien: `0250a:2129-2133`
     * excluye `inspeccion_humana` al comprobar si la cadena se movió respecto
     * del head evaluado. La UI comparaba dos hashes sin mirar el tipo de
     * evento, así que la foto de inspección —el único eslabón que el inspector
     * está OBLIGADO a agregar— bloqueaba la liberación que ella misma
     * habilita, y reevaluar la invalidaba. El caso no salía nunca.
     *
     * Acá no se escribe una regla nueva: se copia la que la base declara (I6).
     * La autoridad sigue siendo la RPC; esto sólo evita ofrecerle al inspector
     * un bloqueo que la base no le va a aplicar.
     */
    async chainAdvancedBeyondInspection(
      scope: CustodyEntityScope,
      entityId: string,
      attestedHead: string,
    ): Promise<boolean> {
      const column = scope === "physical_unit"
        ? "physical_unit_id"
        : scope === "packing_unit" ? "packing_unit_id" : "shipment_id";
      const { data, error } = await db
        .from("custody_events")
        .select("row_hash, chain_seq, event_type")
        .eq(column, entityId)
        .order("chain_seq", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<{
        row_hash: string | null;
        chain_seq: number | null;
        event_type: string | null;
      }>;
      const attested = rows.find((r) => r.row_hash === attestedHead);
      // Head atestado fuera de la ventana leída o ajeno al scope: no se afirma
      // que la cadena esté al día. Fail-closed, igual que el resto del módulo.
      if (!attested || typeof attested.chain_seq !== "number") return true;
      return rows.some(
        (r) =>
          typeof r.chain_seq === "number"
          && r.chain_seq > (attested.chain_seq as number)
          && r.event_type !== "inspeccion_humana",
      );
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

    /**
     * HN-1 · La v1 YA NO ES UN CAMINO, y la pantalla deja de fingir que lo es.
     *
     * `decide_custody_integrity` está revocada para `authenticated` desde
     * `0250a:2199-2200`, así que el ternario que enrutaba ahí todo scope no
     * físico no elegía entre dos caminos: elegía entre un camino y un `42501`
     * de PostgreSQL subiendo crudo a la cara del inspector. Y `0257` retira
     * también `upsert_custody_integrity_assessment`, la única RPC capaz de
     * fabricar un caso no físico —sin consumidor en `src/`—, con lo que ya no
     * hay ni siquiera de dónde salga un caso así.
     *
     * Se rechaza acá, TIPADO y explícito, antes de tocar la plataforma. El
     * `scope` ausente cae del mismo lado: fail-closed.
     */
    async decide(input: DecideRpcInput): Promise<string> {
      if (input.scope !== "physical_unit") {
        throw new CustodyContractError(
          "alcance sin camino de decisión: sólo la unidad física se decide desde la pantalla",
        );
      }
      const { data, error } = await db.rpc("decide_custody_integrity_v2", {
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

    async beginProductiveEvaluation(caseId: string, expectedVersion: number): Promise<unknown> {
      const { data, error } = await db.rpc("begin_custody_integrity_evaluation_v2", {
        p_case_id: caseId,
        p_expected_version: expectedVersion,
      });
      if (error) throw new Error(error.message);
      return data;
    },

    /**
     * `custody_inspection_candidates` (0224) es SECURITY DEFINER y exige
     * `wms.custody.decide` + tenant. Devuelve SÓLO los ids: ni digest, ni
     * ubicación, ni head. El navegador no participa de esta derivación.
     */
    async selectInspectionCandidates(caseId: string, scope?: CustodyEntityScope): Promise<string[]> {
      const fn = scope === "physical_unit"
        ? "custody_inspection_candidates_v2"
        : "custody_inspection_candidates";
      const { data, error } = await db.rpc(fn, {
        p_case_id: caseId,
      });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<{ evidence_id?: string | null }>;
      return rows
        .map((r) => r?.evidence_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0);
    },

    /**
     * V4 · Capa 1. Los ids que la DECISIÓN registró, leídos de la tabla que
     * 0251 puebla y 0222 concede con su propia RLS. Cliente de sesión: la base
     * decide qué filas existen para quien pregunta.
     */
    async selectDecisionInspectionEvidence(decisionId: string): Promise<string[]> {
      const { data, error } = await db
        .from("custody_integrity_inspection_evidence")
        .select("evidence_id")
        .in("decision_id", [decisionId]);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<{ evidence_id?: string | null }>)
        .map((r) => r?.evidence_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0);
    },

    /**
     * V4 · Capas 2 y 3. Una sola RPC de lectura (0258) devuelve la atestación
     * VIVA —con `verified_event_ids` y el head vigente— y el canónico
     * RE-DERIVADO por el predicado único. La compuerta es la política de 0254:
     * quien puede leer su certificado puede leer su contexto documental.
     */
    async selectCertificateDocument(caseId: string): Promise<CertificateDocumentContext | null> {
      const { data, error } = await db.rpc("custody_certificate_document_v2", {
        p_case_id: caseId,
      });
      if (error) throw new Error(error.message);
      if (typeof data !== "object" || data === null) return null;
      const raw = data as {
        attestation?: {
          status?: unknown; chain_head?: unknown; events_checked?: unknown;
          attested_at?: unknown; verified_event_ids?: unknown;
        } | null;
        canonical_inspection_evidence_ids?: unknown;
      };
      const att = raw.attestation ?? null;
      if (!att || typeof att.status !== "string") return null;
      const idList = (v: unknown): string[] =>
        Array.isArray(v)
          ? v.filter((x): x is string => typeof x === "string" && x.length > 0)
          : [];
      return {
        attestation: {
          status: att.status,
          chainHead: typeof att.chain_head === "string" ? att.chain_head : null,
          eventsChecked: typeof att.events_checked === "number" ? att.events_checked : null,
          attestedAt: typeof att.attested_at === "string" ? att.attested_at : null,
          verifiedEventIds: idList(att.verified_event_ids),
        },
        canonicalInspectionEvidenceIds: idList(raw.canonical_inspection_evidence_ids),
      };
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

export function createSupabaseProductiveVisionSessionPort(
  session: CustodyDataClient,
): ProductiveVisionSessionPort {
  return {
    async begin(caseId, expectedVersion) {
      const { data, error } = await session.rpc("begin_custody_integrity_evaluation_v2", {
        p_case_id: caseId,
        p_expected_version: expectedVersion,
      });
      if (error) throw new Error(error.message);
      return data;
    },
  };
}

interface RawProductiveEvidence {
  id?: unknown;
  storage_bucket?: unknown;
  storage_path?: unknown;
  mime_type?: unknown;
  size_bytes?: unknown;
  sha256?: unknown;
  redacted?: unknown;
  custody_events?: unknown;
}

function productiveEvent(value: unknown): Record<string, unknown> | null {
  const event = Array.isArray(value) ? value[0] : value;
  return typeof event === "object" && event !== null ? event as Record<string, unknown> : null;
}

export function createSupabaseProductiveVisionServerPort(
  admin: ProductiveVisionDataClient,
): ProductiveVisionServerPort {
  return {
    async loadEvidence(evidenceId): Promise<ProductiveVisionEvidenceRow | null> {
      const { data, error } = await admin
        .from("custody_evidence")
        .select("id, storage_bucket, storage_path, mime_type, size_bytes, sha256, redacted, "
          + "custody_events!inner(physical_unit_id, stage, event_type)")
        .eq("id", evidenceId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const row = data as RawProductiveEvidence | null;
      if (!row) return null;
      const event = productiveEvent(row.custody_events);
      if (!event) return null;
      return {
        id: String(row.id ?? ""),
        physicalUnitId: String(event.physical_unit_id ?? ""),
        stage: String(event.stage ?? "") as ProductiveVisionEvidenceRow["stage"],
        eventType: String(event.event_type ?? "") as ProductiveVisionEvidenceRow["eventType"],
        bucket: String(row.storage_bucket ?? ""),
        path: String(row.storage_path ?? ""),
        mimeType: typeof row.mime_type === "string" ? row.mime_type : null,
        sizeBytes: typeof row.size_bytes === "number"
          ? row.size_bytes
          : typeof row.size_bytes === "string" && row.size_bytes.trim() !== ""
            ? Number(row.size_bytes)
            : null,
        sha256: String(row.sha256 ?? ""),
        redacted: row.redacted === true,
      };
    },

    async download(bucket, path) {
      const { data, error } = await admin.storage.from(bucket).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },

    async complete(input) {
      const result = input.provider.result;
      const { data, error } = await admin.rpc("complete_custody_integrity_evaluation_v2", {
        p_attempt_id: input.attemptId,
        p_case_id: input.caseId,
        p_expected_version: input.expectedVersion,
        p_ingress_observed_sha256: input.ingressObservedSha256,
        p_egress_observed_sha256: input.egressObservedSha256,
        p_score_components: {
          identity: result.identity,
          packaging: result.packaging,
          quantity: result.quantity,
          condition: result.condition,
        },
        p_model_confidence: result.model_confidence,
        p_verdict: result.verdict,
        p_packaging_changed: result.packaging_changed,
        p_missing_items_suspected: result.missing_items_suspected,
        p_damage_suspected: result.damage_suspected,
        p_provider_response_id: input.provider.providerResponseId,
        p_response_model: input.provider.responseModel,
        p_system_fingerprint: input.provider.systemFingerprint,
        p_request_sha256: input.provider.requestSha256,
        p_response_sha256: input.provider.responseSha256,
        p_provider_details: {
          observations: result.observations,
          zones: result.zones,
          openai_request_id: input.provider.openaiRequestId,
        },
      });
      if (error) throw new Error(error.message);
      if (typeof data !== "number" || !Number.isSafeInteger(data) || data <= 0) {
        throw new Error("finalización productiva inválida");
      }
      return data;
    },

    async fail(input) {
      const { data, error } = await admin.rpc("fail_custody_integrity_evaluation_v2", {
        p_attempt_id: input.attemptId,
        p_case_id: input.caseId,
        p_expected_version: input.expectedVersion,
        p_failure_code: input.failureCode,
        p_ingress_observed_sha256: input.ingressObservedSha256,
        p_egress_observed_sha256: input.egressObservedSha256,
      });
      if (error) throw new Error(error.message);
      if (typeof data !== "number" || !Number.isSafeInteger(data) || data <= 0) {
        throw new Error("fallo productivo inválido");
      }
      return data;
    },
  };
}
