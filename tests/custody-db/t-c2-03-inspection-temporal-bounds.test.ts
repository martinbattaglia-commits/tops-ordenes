/**
 * T-C2-03 · W22-BIS/M-3 y M-4 — COTA TEMPORAL DE LA INSPECCIÓN.
 *
 * 0223 exigía que la inspección cayera DENTRO del tramo atestado (cota
 * superior) pero no que fuera POSTERIOR a las evidencias de ingreso y egreso
 * efectivamente comparadas (cota inferior). Con eso, una inspección HISTÓRICA
 * —anterior a la anomalía— acreditaba la liberación de una carga que nadie
 * miró después del hecho. Las dos filas MAJOR del informe comparten esta única
 * causa raíz.
 *
 * El intervalo admisible es, entonces, cerrado por ambos extremos:
 *
 *     max(chain_seq(ingreso), chain_seq(egreso))  <  inspección  <=  head atestado
 *
 * Los mutantes de acá recorren los dos extremos y los tres modos de «ajena»:
 * anterior, posterior al head, de otra entidad. El camino válido está en el
 * mismo archivo a propósito: una cota que sólo sabe decir que no es
 * indistinguible de un bloqueo total.
 */
import { describe, expect, inject, it, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import {
  actAs,
  attachEvidence,
  baseScenario,
  createOrder,
  createPackingUnit,
  expectFailure,
  type Scenario,
} from "./harness/fixtures";
import { runEvaluation, tryRelease, type ReleasableCase } from "./harness/scenario";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

interface OrderedCaseOptions {
  /** `true` construye la inspección ANTES de ingreso/egreso (mutante histórico). */
  inspectionFirst?: boolean;
  /** Unidad alternativa para la inspección (mutante «ajena»). */
  inspectionPackingUnitId?: string;
}

/**
 * Igual que `buildReleasableCase`, pero con el ORDEN de creación bajo control:
 * es exactamente la variable que las cotas temporales gobiernan.
 */
async function buildOrderedCase(
  s: Scenario,
  opts: OrderedCaseOptions = {},
): Promise<ReleasableCase> {
  await actAs(db, s.staff);

  const inspectionPu = opts.inspectionPackingUnitId ?? s.packingUnitId;

  const early = opts.inspectionFirst
    ? await attachEvidence(db, {
        packingUnitId: inspectionPu,
        stage: "despacho",
        eventType: "inspeccion_humana",
      })
    : null;

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

  const inspection =
    early ??
    (await attachEvidence(db, {
      packingUnitId: inspectionPu,
      stage: "despacho",
      eventType: "inspeccion_humana",
    }));

  const { rows: c } = await db.query<{ id: string }>(
    `select public.upsert_custody_integrity_assessment(
       'packing_unit', $1, null, $2, $3, 'PENDING_EVIDENCE', $4::text[]) as id`,
    [s.packingUnitId, ingress.evidenceId, egress.evidenceId, ["NO_CALIBRATED_THRESHOLD"]],
  );
  const caseId = c[0].id;
  const evaluation = await runEvaluation(db, s, caseId, 1);

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

const OUT_OF_INTERVAL = /fuera del intervalo|evidencia de inspección inválida/i;

describe("T-C2-03 · M-3/M-4 · cota INFERIOR", () => {
  it("MUTANTE · una inspección ANTERIOR a ingreso y egreso no libera", async () => {
    const s = await baseScenario(db);
    const c = await buildOrderedCase(s, { inspectionFirst: true });

    const msg = await expectFailure(() => tryRelease(db, c));
    expect(msg).toMatch(OUT_OF_INTERVAL);
  });

  it("MUTANTE · una inspección HISTÓRICA no se recicla en un caso nuevo", async () => {
    // La inspección vieja pertenece a la misma entidad y al mismo cliente, y
    // está dentro de la cadena: lo único que la descalifica es ser previa a las
    // evidencias que este caso compara.
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const historical = await attachEvidence(db, {
      packingUnitId: s.packingUnitId,
      stage: "despacho",
      eventType: "inspeccion_humana",
    });

    const c = await buildOrderedCase(s);
    const msg = await expectFailure(() => tryRelease(db, c, [historical.evidenceId]));
    expect(msg).toMatch(OUT_OF_INTERVAL);
  });

  it("el predicado único la rechaza y NO la ofrece como candidata", async () => {
    const s = await baseScenario(db);
    const c = await buildOrderedCase(s, { inspectionFirst: true });

    const { rows: p } = await db.query<{ ok: boolean }>(
      `select public.is_custody_inspection_evidence($1, $2) as ok`,
      [c.inspectionEvidenceId, c.caseId],
    );
    expect(p[0].ok).toBe(false);

    await actAs(db, s.decider);
    const { rows: cand } = await db.query<{ evidence_id: string }>(
      `select evidence_id from public.custody_inspection_candidates($1)`,
      [c.caseId],
    );
    expect(cand.map((r) => r.evidence_id)).not.toContain(c.inspectionEvidenceId);
  });
});

describe("T-C2-03 · M-3/M-4 · cota SUPERIOR y pertenencia", () => {
  it("MUTANTE · una inspección POSTERIOR al head atestado no libera", async () => {
    const s = await baseScenario(db);
    const c = await buildOrderedCase(s);

    // Un evento nuevo, creado DESPUÉS de la atestación: existe en la tabla pero
    // la atestación no lo recorrió.
    await actAs(db, s.staff);
    const late = await attachEvidence(db, {
      packingUnitId: s.packingUnitId,
      stage: "despacho",
      eventType: "inspeccion_humana",
    });

    const msg = await expectFailure(() => tryRelease(db, c, [late.evidenceId]));
    // La cadena avanzó: el bloqueo puede llegar por el head vivo o por el
    // intervalo. Las dos son fail-closed y ninguna libera.
    expect(msg).toMatch(/cadena avanzó desde la atestación|fuera del intervalo|inválida/i);
  });

  it("MUTANTE · una inspección de OTRA entidad no libera", async () => {
    const s = await baseScenario(db);
    const otherOrder = await createOrder(db, s.clientId);
    const otherPu = await createPackingUnit(db, otherOrder);
    const c = await buildOrderedCase(s, { inspectionPackingUnitId: otherPu });

    const msg = await expectFailure(() => tryRelease(db, c));
    expect(msg).toMatch(OUT_OF_INTERVAL);
  });
});

describe("T-C2-03 · M-3/M-4 · el camino VÁLIDO sigue liberando", () => {
  it("una inspección posterior a ingreso y egreso, dentro del tramo, libera", async () => {
    const s = await baseScenario(db);
    const c = await buildOrderedCase(s);

    const { rows: p } = await db.query<{ ok: boolean }>(
      `select public.is_custody_inspection_evidence($1, $2) as ok`,
      [c.inspectionEvidenceId, c.caseId],
    );
    expect(p[0].ok).toBe(true);

    const decisionId = await tryRelease(db, c);
    expect(decisionId).toBeTruthy();

    const { rows } = await db.query<{ state: string }>(
      `select state::text as state from public.custody_integrity_cases where id = $1`,
      [c.caseId],
    );
    expect(rows[0].state).toBe("RELEASED");
  });

  it("la selección de candidatas ofrece exactamente la inspección admisible", async () => {
    const s = await baseScenario(db);
    const c = await buildOrderedCase(s);

    await actAs(db, s.decider);
    const { rows } = await db.query<{ evidence_id: string }>(
      `select evidence_id from public.custody_inspection_candidates($1)`,
      [c.caseId],
    );
    expect(rows.map((r) => r.evidence_id)).toEqual([c.inspectionEvidenceId]);
  });
});
