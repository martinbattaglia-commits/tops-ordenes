/**
 * T-C1-07 · §3 — CAPTURA PRODUCTIVA de la inspección humana.
 *
 * El DB-C4 observó que la inspección sólo existía como INSERT directo del
 * harness: la RPC productiva `attach_custody_evidence` rechazaba el par
 * (despacho, inspeccion_humana) por su propia lista blanca, de modo que la
 * funcionalidad «probada» no tenía camino real en producción.
 *
 * Acá el camino positivo usa la RPC REAL. Los INSERT directos sobreviven sólo
 * como fabricación de casos negativos, y cada uno está marcado.
 */
import { describe, expect, inject, it, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import {
  actAs,
  attachEvidence,
  baseScenario,
  createActor,
  createClient as createErpClient,
  createEventWithEvidence,
  createPackingUnit,
  expectFailure,
  grantPermission,
} from "./harness/fixtures";
import { buildReleasableCase, runEvaluation, tryRelease } from "./harness/scenario";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

describe("T-C1-07 · §3.4 · la captura productiva funciona y deriva todo server-side", () => {
  it("crea evento + evidencia canónicos, con actor y autor acreditados", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);

    const { eventId, evidenceId } = await attachEvidence(db, {
      packingUnitId: s.packingUnitId,
      stage: "despacho",
      eventType: "inspeccion_humana",
    });

    const { rows } = await db.query<{
      stage: string;
      event_type: string;
      actor_id: string;
      kind: string;
      redacted: boolean;
      created_by: string;
      evidence_sha256: string;
      sha256: string;
      prev_hash: string | null;
      row_hash: string;
    }>(
      `select ev.stage::text, ev.event_type::text, ev.actor_id, ev.evidence_sha256,
              ev.prev_hash, ev.row_hash, e.kind::text, e.redacted, e.created_by, e.sha256
         from public.custody_evidence e
         join public.custody_events ev on ev.id = e.event_id
        where e.id = $1`,
      [evidenceId],
    );
    const r = rows[0];
    expect(r.stage).toBe("despacho");
    expect(r.event_type).toBe("inspeccion_humana");
    expect(r.kind).toBe("foto");
    expect(r.redacted).toBe(false);
    // Procedencia HUMANA: actor del evento y autor del archivo, coherentes.
    expect(r.actor_id).toBe(s.staff.userId);
    expect(r.created_by).toBe(s.staff.userId);
    // El archivo quedó PLEGADO en la cadena, no meramente adjunto.
    expect(r.evidence_sha256).toBe(r.sha256);
    expect(r.row_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(eventId).toBeTruthy();
  });

  it("el instante AUTORITATIVO lo pone el servidor: el del cliente se ignora", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);

    const { eventId } = await attachEvidence(
      db,
      { packingUnitId: s.packingUnitId, stage: "despacho", eventType: "inspeccion_humana" },
      { occurredAt: "2020-01-01T00:00:00.000Z" },
    );

    const { rows } = await db.query<{ occurred_at: string }>(
      `select occurred_at from public.custody_events where id = $1`,
      [eventId],
    );
    const delta = Date.now() - new Date(rows[0].occurred_at).getTime();
    expect(delta).toBeGreaterThanOrEqual(0);
    expect(delta).toBeLessThan(120_000);
    expect(new Date(rows[0].occurred_at).getUTCFullYear()).toBeGreaterThan(2020);
  });

  it("la inspección capturada así SÍ sostiene una liberación de punta a punta", async () => {
    const s = await baseScenario(db);
    // buildReleasableCase usa la RPC productiva para las tres evidencias.
    const built = await buildReleasableCase(db, s);
    await expect(tryRelease(db, built)).resolves.toBeTruthy();

    const { rows } = await db.query<{ state: string }>(
      `select state from public.custody_integrity_cases where id = $1`,
      [built.caseId],
    );
    expect(rows[0].state).toBe("RELEASED");
  });
});

describe("T-C1-07 · §3.5 · la captura rechaza toda forma que no acredite inspección", () => {
  it("SOPORTE: la inspección se acredita con foto, no con firma ni documento", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    for (const kind of ["firma", "documento"] as const) {
      const msg = await expectFailure(() =>
        attachEvidence(
          db,
          { packingUnitId: s.packingUnitId, stage: "despacho", eventType: "inspeccion_humana" },
          { kind },
        ),
      );
      expect(msg, kind).toMatch(/se acredita con foto/);
    }
  });

  it("PAR INVÁLIDO: la inspección fuera de 'despacho' no se captura", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    for (const stage of ["packing", "entrega", "pod"] as const) {
      const msg = await expectFailure(() =>
        attachEvidence(db, {
          packingUnitId: s.packingUnitId,
          stage,
          eventType: "inspeccion_humana",
        }),
      );
      expect(msg, stage).toMatch(/no es válido para stage/);
    }
  });

  it("ACTOR AUSENTE: sin sesión no hay inspección", async () => {
    const s = await baseScenario(db);
    await actAs(db, null);
    const msg = await expectFailure(() =>
      attachEvidence(db, {
        packingUnitId: s.packingUnitId,
        stage: "despacho",
        eventType: "inspeccion_humana",
      }),
    );
    expect(msg).toMatch(/sesión inexistente/);
  });

  it("TENANT AJENO: un usuario de otro cliente no captura inspecciones de éste", async () => {
    const s = await baseScenario(db);
    const otherClientId = await createErpClient(db);
    const intruder = await createActor(db, "cliente", otherClientId);
    await grantPermission(db, intruder, "wms.edit");
    await actAs(db, intruder);

    const msg = await expectFailure(() =>
      attachEvidence(db, {
        packingUnitId: s.packingUnitId,
        stage: "despacho",
        eventType: "inspeccion_humana",
      }),
    );
    // El rol 'cliente' no está entre los internos: la puerta se cierra antes
    // incluso de mirar el tenant.
    expect(msg).toMatch(/no autorizado|cliente ajeno/);
  });

  it("REDACTADA: la RPC no puede producir una inspección redactada", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { evidenceId } = await attachEvidence(db, {
      packingUnitId: s.packingUnitId,
      stage: "despacho",
      eventType: "inspeccion_humana",
    });
    const { rows } = await db.query<{ redacted: boolean }>(
      `select redacted from public.custody_evidence where id = $1`,
      [evidenceId],
    );
    expect(rows[0].redacted).toBe(false);
  });

  it("SIN ACTOR: una inspección fabricada por INSERT directo no acredita al decidir", async () => {
    const s = await baseScenario(db);
    // NEGATIVO FABRICADO: forma canónica, pero sin actor ni autor — que es
    // exactamente lo que la RPC productiva no puede producir.
    const built = await buildReleasableCase(db, s, { inspectionDirectInsert: true });

    const { rows } = await db.query<{ actor_id: string | null; created_by: string | null }>(
      `select ev.actor_id, e.created_by from public.custody_evidence e
         join public.custody_events ev on ev.id = e.event_id where e.id = $1`,
      [built.inspectionEvidenceId],
    );
    expect(rows[0].actor_id).toBeNull();
    expect(rows[0].created_by).toBeNull();

    const msg = await expectFailure(() => tryRelease(db, built));
    expect(msg).toMatch(/evidencia de inspección inválida/);

    const { rows: c } = await db.query<{ state: string }>(
      `select state from public.custody_integrity_cases where id = $1`,
      [built.caseId],
    );
    expect(c[0].state).toBe("REVIEW_REQUIRED");
  });

  it("REDACTADA fabricada: tampoco acredita al decidir", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s, { inspectionRedacted: true });
    const msg = await expectFailure(() => tryRelease(db, built));
    expect(msg).toMatch(/evidencia de inspección inválida/);
  });
});

describe("T-C1-07 · §3.6 · una inspección acredita UNA sola liberación", () => {
  it("la misma foto de inspección no libera dos casos", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);

    // Dos pares de evidencias comparadas sobre la MISMA unidad, más UNA sola
    // inspección. Todos los eventos existen ANTES de atestar, de modo que
    // ambas atestaciones comparten el mismo head y ninguna queda stale.
    const in1 = await attachEvidence(db, {
      packingUnitId: s.packingUnitId,
      stage: "packing",
      eventType: "foto_packing",
    });
    const eg1 = await attachEvidence(db, {
      packingUnitId: s.packingUnitId,
      stage: "despacho",
      eventType: "cargado",
    });
    const in2 = await attachEvidence(db, {
      packingUnitId: s.packingUnitId,
      stage: "packing",
      eventType: "foto_packing",
    });
    const eg2 = await attachEvidence(db, {
      packingUnitId: s.packingUnitId,
      stage: "despacho",
      eventType: "cargado",
    });
    const inspection = await attachEvidence(db, {
      packingUnitId: s.packingUnitId,
      stage: "despacho",
      eventType: "inspeccion_humana",
    });

    const openCase = async (ingress: string, egress: string): Promise<string> => {
      const { rows } = await db.query<{ id: string }>(
        `select public.upsert_custody_integrity_assessment(
           'packing_unit', $1, null, $2, $3, 'PENDING_EVIDENCE', array['NO_CALIBRATED_THRESHOLD']) as id`,
        [s.packingUnitId, ingress, egress],
      );
      return rows[0].id;
    };

    const caseA = await openCase(in1.evidenceId, eg1.evidenceId);
    const caseB = await openCase(in2.evidenceId, eg2.evidenceId);
    const evalA = await runEvaluation(db, s, caseA, 1);
    const evalB = await runEvaluation(db, s, caseB, 1);

    const decide = (caseId: string, version: number) =>
      db.query(
        `select public.decide_custody_integrity(
           $1, $2, 'release', 'Inspección física completa sin novedades', null, $3::uuid[]) as id`,
        [caseId, version, [inspection.evidenceId]],
      );

    await actAs(db, s.decider);
    await expect(decide(caseA, evalA.version)).resolves.toBeTruthy();

    const msg = await expectFailure(() => decide(caseB, evalB.version));
    expect(msg).toMatch(/ya utilizada en otra decisión/);

    const { rows: states } = await db.query<{ id: string; state: string }>(
      `select id, state from public.custody_integrity_cases where id = any($1)`,
      [[caseA, caseB]],
    );
    expect(states.find((r) => r.id === caseA)!.state).toBe("RELEASED");
    expect(states.find((r) => r.id === caseB)!.state).toBe("REVIEW_REQUIRED");

    // Y la unicidad estructural existe además del control explícito.
    const { rows: idx } = await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
        where schemaname = 'public' and indexname = 'custody_integrity_inspection_evidence_uk'`,
    );
    expect(idx).toHaveLength(1);
    expect(idx[0].indexdef).toMatch(/UNIQUE/i);
    expect(idx[0].indexdef).toMatch(/\(evidence_id\)/);
  });

  it("una inspección DIRECTA de otra entidad sigue sin acreditar (defensa de la decisión)", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    // NEGATIVO FABRICADO sobre otra unidad del mismo pedido.
    const otherPu = await createPackingUnit(db, s.orderId);
    const foreign = await createEventWithEvidence(db, {
      packingUnitId: otherPu,
      stage: "despacho",
      eventType: "inspeccion_humana",
    });

    const msg = await expectFailure(() => tryRelease(db, built, [foreign.evidenceId]));
    expect(msg).toMatch(/evidencia de inspección inválida/);
  });
});
