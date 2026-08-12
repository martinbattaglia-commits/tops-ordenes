/**
 * T-C1-02 · D1 ADVERSARIAL — la inspección humana no se puede falsificar.
 *
 * Cada caso parte del MISMO caso liberable y altera UNA sola variable. Si la
 * liberación sigue ocurriendo, la regla correspondiente no existe.
 */
import { describe, expect, inject, it, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import {
  actAs,
  baseScenario,
  createClient as createErpClient,
  createEventWithEvidence,
  createOrder,
  createPackingUnit,
  expectFailure,
} from "./harness/fixtures";
import { buildReleasableCase, tryRelease } from "./harness/scenario";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

/** Ningún caso de este archivo debe terminar liberado. */
async function expectNotReleased(caseId: string): Promise<void> {
  const { rows } = await db.query<{ state: string; decision_id: string | null }>(
    `select state, decision_id from public.custody_integrity_cases where id = $1`,
    [caseId],
  );
  expect(rows[0].state).not.toBe("RELEASED");
  expect(rows[0].decision_id).toBeNull();
}

describe("T-C1-02 · D1 adversarial: evidencia de inspección", () => {
  it("AUSENTE: liberar sin evidencia de inspección se rechaza", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);

    const msg = await expectFailure(() => tryRelease(db, c, []));
    expect(msg).toMatch(/sin evidencia de inspección/);
    await expectNotReleased(c.caseId);
  });

  it("TIPO INCORRECTO: un evento 'cargado' no acredita inspección humana", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s, {
      inspectionStage: "despacho",
      inspectionEventType: "cargado",
    });

    const msg = await expectFailure(() => tryRelease(db, c));
    expect(msg).toMatch(/evidencia de inspección inválida/);
    await expectNotReleased(c.caseId);
  });

  it("ETAPA INCORRECTA: la inspección fuera de 'despacho' no acredita", async () => {
    const s = await baseScenario(db);
    // El CHECK sólo admite inspeccion_humana en 'despacho'; el esquema mismo
    // impide fabricar el par inválido.
    const msg = await expectFailure(() =>
      createEventWithEvidence(db, {
        packingUnitId: s.packingUnitId,
        stage: "entrega",
        eventType: "inspeccion_humana",
      }),
    );
    expect(msg).toMatch(/custody_events_stage_type_chk/);
  });

  it("SOPORTE INCORRECTO: una firma o un documento no son la foto de inspección", async () => {
    for (const kind of ["firma", "documento"] as const) {
      const s = await baseScenario(db);
      const c = await buildReleasableCase(db, s, { inspectionKind: kind });

      const msg = await expectFailure(() => tryRelease(db, c));
      expect(msg).toMatch(/evidencia de inspección inválida/);
      await expectNotReleased(c.caseId);
    }
  });

  it("REDACTADA: una evidencia con erasure de PII no acredita nada", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s, { inspectionRedacted: true });

    const msg = await expectFailure(() => tryRelease(db, c));
    expect(msg).toMatch(/evidencia de inspección inválida/);
    await expectNotReleased(c.caseId);
  });

  it("REUTILIZADA: la evidencia comparada por la IA no puede contarse como inspección", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);

    for (const reused of [c.ingressEvidenceId, c.egressEvidenceId]) {
      const msg = await expectFailure(() => tryRelease(db, c, [reused]));
      expect(msg).toMatch(/evidencia de inspección inválida/);
    }
    await expectNotReleased(c.caseId);
  });

  it("DUPLICADA: la misma evidencia repetida no multiplica la inspección", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);

    const msg = await expectFailure(() =>
      tryRelease(db, c, [c.inspectionEvidenceId, c.inspectionEvidenceId]),
    );
    expect(msg).toMatch(/repetida/);
    await expectNotReleased(c.caseId);
  });

  it("AJENA: una inspección de OTRA entidad y OTRO cliente no sirve", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);

    // Entidad y cliente completamente distintos.
    const otherClient = await createErpClient(db);
    const otherOrder = await createOrder(db, otherClient);
    const otherPu = await createPackingUnit(db, otherOrder);
    const foreign = await createEventWithEvidence(db, {
      packingUnitId: otherPu,
      stage: "despacho",
      eventType: "inspeccion_humana",
    });

    await actAs(db, s.staff);
    const msg = await expectFailure(() => tryRelease(db, c, [foreign.evidenceId]));
    expect(msg).toMatch(/evidencia de inspección inválida/);
    await expectNotReleased(c.caseId);
  });

  it("FUERA DE LA CADENA ATESTADA: una inspección posterior a la atestación no cuenta", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);

    // Inspección creada DESPUÉS de atestar: válida en forma, pero su evento
    // quedó fuera del tramo que la atestación recorrió.
    const late = await createEventWithEvidence(db, {
      packingUnitId: s.packingUnitId,
      stage: "despacho",
      eventType: "inspeccion_humana",
    });

    await actAs(db, s.staff);
    const msg = await expectFailure(() => tryRelease(db, c, [late.evidenceId]));
    // El evento nuevo además movió el head: cualquiera de las dos barreras es
    // suficiente, y ninguna debe dejar pasar la liberación.
    expect(msg).toMatch(/fuera de la cadena atestada|la cadena avanzó/);
    await expectNotReleased(c.caseId);
  });

  it("INEXISTENTE: un uuid inventado no acredita inspección", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);

    const msg = await expectFailure(() =>
      tryRelease(db, c, ["00000000-0000-0000-0000-000000000000"]),
    );
    expect(msg).toMatch(/evidencia de inspección inválida/);
    await expectNotReleased(c.caseId);
  });
});
