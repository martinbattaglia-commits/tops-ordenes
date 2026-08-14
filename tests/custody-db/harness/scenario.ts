/**
 * DB-1 · Construcción del caso LIBERABLE.
 *
 * Vive acá y no en cada archivo de prueba a propósito: todos los adversariales
 * parten EXACTAMENTE del mismo caso válido y alteran UNA sola variable. Si cada
 * archivo armara el suyo, un fallo podría deberse a la construcción y no a la
 * regla bajo prueba.
 *
 * POST-C4 · Dos cambios de fondo en la construcción:
 *
 *   §2 · la evaluación ya no se DECLARA. Se abre un intento como usuario
 *        autenticado y se cierra como rol interno de servidor. El camino
 *        positivo ejercita exactamente ese flujo, con dobles SINTÉTICOS: no se
 *        llama a ningún proveedor externo.
 *
 *   §3 · la inspección humana se captura con la RPC PRODUCTIVA
 *        `attach_custody_evidence`. Los INSERT directos quedan reservados a
 *        casos negativos, y cada uno está marcado como tal.
 */

import type { Client } from "pg";
import {
  actAs,
  actAsServer,
  attachEvidence,
  createEventWithEvidence,
  type Scenario,
} from "./fixtures";

export interface ReleasableCase {
  caseId: string;
  /** Versión vigente tras cerrar la evaluación. */
  version: number;
  /** Intento de evaluación efectivamente completado (§2). */
  attemptId: string;
  inspectionEvidenceId: string;
  inspectionEventId: string;
  ingressEvidenceId: string;
  egressEvidenceId: string;
  /** Decisor habilitado a liberar en la fase inicial: admin (§5). */
  decider: Scenario["decider"];
}

export interface BuildOptions {
  /** Etapa del evento de inspección. Por defecto la canónica: 'despacho'. */
  inspectionStage?: "packing" | "despacho" | "transporte" | "entrega" | "pod";
  /** Tipo del evento de inspección. Por defecto el canónico. */
  inspectionEventType?:
    | "foto_packing"
    | "cargado"
    | "en_transito"
    | "foto_entrega"
    | "firmado"
    | "pod"
    | "inspeccion_humana";
  /** Soporte de la evidencia de inspección. Por defecto 'foto'. */
  inspectionKind?: "foto" | "firma" | "documento";
  /** Marca la evidencia de inspección como redactada. */
  inspectionRedacted?: boolean;
  /**
   * Fuerza el INSERT DIRECTO aunque la forma sea canónica. Sirve para producir
   * una inspección SIN actor acreditado —imposible por la RPC productiva— y
   * comprobar que la decisión la rechaza igual.
   */
  inspectionDirectInsert?: boolean;
  /** Retenciones del caso. Por defecto la única compatible con liberar. */
  holdReasons?: string[];
  /** Resultado reportado por el proveedor de visión (doble sintético). */
  outcome?: string;
  executionMode?: string;
  verdict?: string | null;
  modelConfidence?: number | null;
}

export interface EvaluationResult {
  attemptId: string;
  version: number;
}

/**
 * §2 · Evaluación completa en dos tiempos, con dobles SINTÉTICOS.
 *
 * Paso 1 como el usuario autenticado que está activo; paso 2 como rol interno
 * de servidor. Al terminar restaura la sesión de `s.staff`, para que ninguna
 * prueba herede sin darse cuenta el contexto de servidor.
 */
export async function runEvaluation(
  db: Client,
  s: Scenario,
  caseId: string,
  expectedVersion: number,
  opts: BuildOptions = {},
): Promise<EvaluationResult> {
  const { rows: att } = await db.query<{ id: string }>(
    `select public.begin_custody_integrity_evaluation($1, $2) as id`,
    [caseId, expectedVersion],
  );
  const attemptId = att[0].id;

  await actAsServer(db);
  const { rows: v } = await db.query<{ v: number }>(
    `select public.complete_custody_integrity_evaluation(
       $1, $2, $3, 'openai', 'gpt-vision', 'custody-integrity/v2', $4, $5, $6, $7, null) as v`,
    [
      attemptId,
      caseId,
      expectedVersion,
      opts.executionMode ?? "real",
      opts.outcome ?? "ok",
      opts.verdict === undefined ? "coincide" : opts.verdict,
      opts.modelConfidence === undefined ? 0.871 : opts.modelConfidence,
    ],
  );
  await actAs(db, s.staff);
  return { attemptId, version: v[0].v };
}

/**
 * Caso en REVIEW_REQUIRED con cadena atestada y una evidencia de inspección
 * humana dentro de la cadena.
 *
 * ORDEN IMPORTANTE: los tres eventos se crean ANTES de atestar. La atestación
 * fija la frontera de lo verificado (`chain_head`), y una inspección posterior
 * quedaría fuera de ella.
 */
export async function buildReleasableCase(
  db: Client,
  s: Scenario,
  opts: BuildOptions = {},
): Promise<ReleasableCase> {
  // La captura productiva exige sesión: se activa ANTES de crear los eventos.
  await actAs(db, s.staff);

  const ingress = await attachEvidence(db, {
    packingUnitId: s.packingUnitId,
    stage: "packing",
    eventType: "foto_packing",
  });
  const egress = await attachEvidence(db, {
    packingUnitId: s.packingUnitId,
    stage: "despacho",
    eventType: "cargado",
  });

  const stage = opts.inspectionStage ?? "despacho";
  const eventType = opts.inspectionEventType ?? "inspeccion_humana";
  const kind = opts.inspectionKind ?? "foto";
  const redacted = opts.inspectionRedacted ?? false;
  const canonical =
    stage === "despacho" && eventType === "inspeccion_humana" && kind === "foto" && !redacted;

  // Camino productivo cuando la forma es la canónica; INSERT directo SÓLO para
  // preparar formas que la RPC rechaza —y que la decisión debe rechazar igual—.
  const inspection =
    canonical && !opts.inspectionDirectInsert
      ? await attachEvidence(db, { packingUnitId: s.packingUnitId, stage, eventType }, { kind })
      : await createEventWithEvidence(
          db,
          { packingUnitId: s.packingUnitId, stage, eventType },
          kind,
          redacted,
        );

  const { rows: c } = await db.query<{ id: string }>(
    `select public.upsert_custody_integrity_assessment(
       'packing_unit', $1, null, $2, $3, 'PENDING_EVIDENCE', $4::text[]) as id`,
    [
      s.packingUnitId,
      ingress.evidenceId,
      egress.evidenceId,
      opts.holdReasons ?? ["NO_CALIBRATED_THRESHOLD"],
    ],
  );
  const caseId = c[0].id;

  const evaluation = await runEvaluation(db, s, caseId, 1, opts);

  return {
    caseId,
    version: evaluation.version,
    attemptId: evaluation.attemptId,
    inspectionEvidenceId: inspection.evidenceId,
    inspectionEventId: inspection.eventId,
    ingressEvidenceId: ingress.evidenceId,
    egressEvidenceId: egress.evidenceId,
    decider: s.decider,
  };
}

/**
 * Intento de liberación estándar, con el motivo mínimo aceptable.
 *
 * `as` decide QUIÉN decide. Por defecto el admin del escenario (§5: la
 * liberación es admin-only). `"keep"` deja intacta la sesión activa, que es lo
 * que necesitan los adversariales que instalaron un actor a propósito.
 */
export async function tryRelease(
  db: Client,
  c: ReleasableCase,
  evidenceIds: string[] = [c.inspectionEvidenceId],
  version: number = c.version,
  as: Scenario["decider"] | "keep" = c.decider,
): Promise<string> {
  if (as !== "keep") await actAs(db, as);
  const { rows } = await db.query<{ id: string }>(
    `select public.decide_custody_integrity(
       $1, $2, 'release', 'Inspección física completa sin novedades', null, $3::uuid[]) as id`,
    [c.caseId, version, evidenceIds],
  );
  return rows[0].id;
}
