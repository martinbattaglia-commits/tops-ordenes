/**
 * T-C3-01 · E2E OPERATIVO PERMANENTE — el flujo tal como ocurre en la vida real.
 *
 * ─── EN QUÉ SE DIFERENCIA DE T-C1-01 ──────────────────────────────────────
 *
 * `buildReleasableCase` crea los tres eventos ANTES de atestar, así que la
 * inspección nace dentro de la cadena verificada. Es un atajo legítimo para
 * probar la política de liberación, pero NO es el orden en que la operación
 * sucede: primero se evalúa el caso, y la foto de inspección se saca DESPUÉS,
 * cuando el inspector va a mirar el bulto.
 *
 * Ese orden real es el que rompía el producto. La foto agrega un eslabón, la
 * atestación queda vieja y la liberación se bloquea. La UI mostraba el bloqueo
 * pero no ofrecía salida, y —peor— nunca derivaba la evidencia de inspección,
 * así que la liberación era imposible aunque la foto existiera.
 *
 * Este archivo recorre el ciclo completo en ese orden y en una sola corrida:
 *
 *   recepción/foto → evaluación → atestación sobre H1
 *   → inspección humana/foto → la cadena avanza a H2 → atestación STALE
 *   → candidatos VACÍOS (la foto quedó fuera de lo atestado)
 *   → liberar DENEGADO
 *   → volver a evaluar → nueva atestación sobre H2
 *   → candidatos DERIVADOS por el servidor
 *   → decisión humana → RELEASED → POD habilitado
 *
 * Y después lo adversarial: repetición, cross-client, sin sesión, permiso
 * insuficiente, versión vieja, concurrencia de reserva y cuarentena.
 *
 * Es PERMANENTE y reproducible con `npm run test:custody:db`. No depende de
 * ningún script temporal ni de Supabase cloud.
 */
import { describe, expect, inject, it, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import {
  actAs,
  actAsServer,
  actAsWithSession,
  attachEvidence,
  baseScenario,
  createActor,
  expectFailure,
  grantPermission,
  type Scenario,
} from "./harness/fixtures";
import { runEvaluation } from "./harness/scenario";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

interface Caso {
  caseId: string;
  version: number;
  attemptId: string;
  ingressEvidenceId: string;
  egressEvidenceId: string;
}

/** Caso evaluado y en revisión humana, TODAVÍA sin foto de inspección. */
async function casoEvaluadoSinInspeccion(s: Scenario): Promise<Caso> {
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

  const { rows } = await db.query<{ id: string }>(
    `select public.upsert_custody_integrity_assessment(
       'packing_unit', $1, null, $2, $3, 'PENDING_EVIDENCE', $4::text[]) as id`,
    [s.packingUnitId, ingress.evidenceId, egress.evidenceId, ["NO_CALIBRATED_THRESHOLD"]],
  );
  const caseId = rows[0].id;
  const evaluacion = await runEvaluation(db, s, caseId, 1);

  return {
    caseId,
    version: evaluacion.version,
    attemptId: evaluacion.attemptId,
    ingressEvidenceId: ingress.evidenceId,
    egressEvidenceId: egress.evidenceId,
  };
}

/** Lo mismo que consulta la Server Action al armar la pantalla y al decidir. */
async function candidatos(caseId: string): Promise<string[]> {
  const { rows } = await db.query<{ evidence_id: string }>(
    `select evidence_id from public.custody_inspection_candidates($1)`,
    [caseId],
  );
  return rows.map((r) => r.evidence_id);
}

async function headVigente(packingUnitId: string): Promise<string> {
  const { rows } = await db.query<{ row_hash: string }>(
    `select row_hash from public.custody_events
      where coalesce(packing_unit_id, shipment_id) = $1
      order by chain_seq desc limit 1`,
    [packingUnitId],
  );
  return rows[0].row_hash;
}

async function estadoCaso(caseId: string) {
  const { rows } = await db.query(
    `select state, version, chain_head, decision_id from public.custody_integrity_cases where id = $1`,
    [caseId],
  );
  return rows[0] as { state: string; version: number; chain_head: string; decision_id: string | null };
}

describe("T-C3-01 · ciclo operativo completo hasta el POD", () => {
  it("recorre inspección → stale → re-evaluación → liberación → POD", async () => {
    const s = await baseScenario(db);
    const caso = await casoEvaluadoSinInspeccion(s);

    // ── 1 · Evaluado y en revisión, atestado sobre el head de ESE momento ──
    const h1 = await headVigente(s.packingUnitId);
    let estado = await estadoCaso(caso.caseId);
    expect(estado.state).toBe("REVIEW_REQUIRED");
    expect(estado.chain_head).toBe(h1);
    expect(estado.decision_id).toBeNull();

    // Sin foto de inspección, el servidor no deriva ninguna evidencia.
    await actAs(db, s.decider);
    expect(await candidatos(caso.caseId)).toEqual([]);

    // ── 2 · El inspector saca la foto: la cadena AVANZA ────────────────────
    await actAs(db, s.staff);
    const inspeccion = await attachEvidence(db, {
      packingUnitId: s.packingUnitId,
      stage: "despacho",
      eventType: "inspeccion_humana",
    });
    const h2 = await headVigente(s.packingUnitId);
    expect(h2).not.toBe(h1);

    // La atestación del caso quedó vieja: sigue apuntando a H1.
    estado = await estadoCaso(caso.caseId);
    expect(estado.chain_head).toBe(h1);

    // ── 3 · La foto TODAVÍA no es admisible: está fuera de lo atestado ────
    await actAs(db, s.decider);
    expect(await candidatos(caso.caseId)).toEqual([]);

    // ── 4 · Liberar está DENEGADO, y el motivo es exactamente ése ──────────
    const err = await expectFailure(() =>
      db.query(
        `select public.decide_custody_integrity($1, $2, 'release', 'Inspección física sin novedades', null, $3::uuid[])`,
        [caso.caseId, caso.version, [inspeccion.evidenceId]],
      ),
    );
    expect(err).toMatch(/cadena avanzó desde la atestación/i);
    expect((await estadoCaso(caso.caseId)).state).toBe("REVIEW_REQUIRED");

    // ── 5 · Volver a evaluar: nueva atestación sobre el head ACTUAL ────────
    await actAs(db, s.staff);
    const reevaluacion = await runEvaluation(db, s, caso.caseId, caso.version);
    estado = await estadoCaso(caso.caseId);
    expect(estado.chain_head).toBe(h2);
    expect(Number(estado.version)).toBe(reevaluacion.version);
    expect(estado.state).toBe("REVIEW_REQUIRED"); // la IA NO libera

    // ── 6 · Recién ahora el servidor deriva la evidencia de inspección ─────
    await actAs(db, s.decider);
    const derivados = await candidatos(caso.caseId);
    expect(derivados).toEqual([inspeccion.evidenceId]);

    // ── 7 · Decisión humana con la lista DERIVADA ─────────────────────────
    const { rows: dec } = await db.query<{ id: string }>(
      `select public.decide_custody_integrity(
         $1, $2, 'release', 'Inspección física completa sin novedades', null, $3::uuid[]) as id`,
      [caso.caseId, reevaluacion.version, derivados],
    );
    expect(dec[0].id).toMatch(/^[0-9a-f-]{36}$/);

    estado = await estadoCaso(caso.caseId);
    expect(estado.state).toBe("RELEASED");
    expect(estado.decision_id).toBe(dec[0].id);

    // ── 8 · El POD se habilita SÓLO con el caso liberado ──────────────────
    // (la compuerta de la pantalla es `state === 'RELEASED'`; acá se acredita
    //  el hecho del que depende.)
    expect(estado.state).toBe("RELEASED");

    // La decisión quedó atada al head vigente y a la evidencia consumida.
    const { rows: d } = await db.query(
      `select d.decision, d.actor_role, d.chain_head_at_decision,
              (select count(*) from public.custody_integrity_inspection_evidence i
                where i.decision_id = d.id) as inspecciones
         from public.custody_integrity_decisions d where d.id = $1`,
      [dec[0].id],
    );
    expect(d[0].decision).toBe("release");
    expect(d[0].actor_role).toBe("admin");
    expect(d[0].chain_head_at_decision).toBe(h2);
    expect(Number(d[0].inspecciones)).toBe(1);

    // ── 9 · Ya consumida, la evidencia no vuelve a ofrecerse ──────────────
    expect(await candidatos(caso.caseId)).toEqual([]);
  });

  it("una segunda liberación del mismo caso es imposible", async () => {
    const s = await baseScenario(db);
    const caso = await casoEvaluadoSinInspeccion(s);
    await actAs(db, s.staff);
    await attachEvidence(db, {
      packingUnitId: s.packingUnitId, stage: "despacho", eventType: "inspeccion_humana",
    });
    const re = await runEvaluation(db, s, caso.caseId, caso.version);
    await actAs(db, s.decider);
    const ids = await candidatos(caso.caseId);
    await db.query(
      `select public.decide_custody_integrity($1, $2, 'release', 'Inspección física sin novedades', null, $3::uuid[])`,
      [caso.caseId, re.version, ids],
    );

    const err = await expectFailure(() =>
      db.query(
        `select public.decide_custody_integrity($1, $2, 'release', 'Otra vez, a ver si cuela', null, $3::uuid[])`,
        [caso.caseId, re.version + 1, ids],
      ),
    );
    expect(err).toMatch(/ya decidido/i);
  });

  it("la cuarentena cierra el caso sin consumir evidencia de inspección", async () => {
    const s = await baseScenario(db);
    const caso = await casoEvaluadoSinInspeccion(s);
    await actAs(db, s.staff);
    const inspeccion = await attachEvidence(db, {
      packingUnitId: s.packingUnitId, stage: "despacho", eventType: "inspeccion_humana",
    });
    const re = await runEvaluation(db, s, caso.caseId, caso.version);

    // `staff` es 'operaciones': NO puede liberar, pero SÍ retener.
    await actAs(db, s.staff);
    const { rows } = await db.query<{ id: string }>(
      `select public.decide_custody_integrity(
         $1, $2, 'quarantine', 'Diferencias visibles en la esquina del bulto', null, '{}'::uuid[]) as id`,
      [caso.caseId, re.version],
    );
    const estado = await estadoCaso(caso.caseId);
    expect(estado.state).toBe("QUARANTINED");
    expect(estado.decision_id).toBe(rows[0].id);

    // La evidencia NO se consumió: sigue sin estar atada a ninguna decisión.
    const { rows: usos } = await db.query(
      `select count(*)::int as n from public.custody_integrity_inspection_evidence where evidence_id = $1`,
      [inspeccion.evidenceId],
    );
    expect(usos[0].n).toBe(0);
  });
});

describe("T-C3-01 · lo que NO se puede hacer", () => {
  it("sin sesión acreditada no hay derivación ni decisión", async () => {
    const s = await baseScenario(db);
    const caso = await casoEvaluadoSinInspeccion(s);

    await actAsWithSession(db, s.decider, null);
    expect(await expectFailure(() => db.query(
      `select * from public.custody_inspection_candidates($1)`, [caso.caseId],
    ))).toMatch(/sesi|session/i);

    await actAs(db, null);
    expect(await expectFailure(() => db.query(
      `select * from public.custody_inspection_candidates($1)`, [caso.caseId],
    ))).toMatch(/sesi|session|permiso|denied/i);
  });

  it("un usuario de OTRO cliente no deriva candidatos del caso ajeno", async () => {
    const s = await baseScenario(db);
    const caso = await casoEvaluadoSinInspeccion(s);
    await actAs(db, s.staff);
    await attachEvidence(db, {
      packingUnitId: s.packingUnitId, stage: "despacho", eventType: "inspeccion_humana",
    });
    await runEvaluation(db, s, caso.caseId, caso.version);

    // Actor atado a OTRO cliente.
    const ajeno = await createActor(db, "cliente");
    await grantPermission(db, ajeno, "wms.custody.decide");
    await actAs(db, ajeno);

    const err = await expectFailure(() => db.query(
      `select * from public.custody_inspection_candidates($1)`, [caso.caseId],
    ));
    expect(err).toMatch(/cliente|tenant|ajen/i);
  });

  it("sin `wms.custody.decide` no se derivan candidatos", async () => {
    const s = await baseScenario(db);
    const caso = await casoEvaluadoSinInspeccion(s);
    const solaLectura = await createActor(db, "operaciones");
    await grantPermission(db, solaLectura, "wms.edit");
    await actAs(db, solaLectura);

    const err = await expectFailure(() => db.query(
      `select * from public.custody_inspection_candidates($1)`, [caso.caseId],
    ));
    expect(err).toMatch(/no autorizado|permiso|denied|privilege/i);
  });

  it("una versión vieja no decide", async () => {
    const s = await baseScenario(db);
    const caso = await casoEvaluadoSinInspeccion(s);
    await actAs(db, s.staff);
    await attachEvidence(db, {
      packingUnitId: s.packingUnitId, stage: "despacho", eventType: "inspeccion_humana",
    });
    const re = await runEvaluation(db, s, caso.caseId, caso.version);
    await actAs(db, s.decider);
    const ids = await candidatos(caso.caseId);

    const err = await expectFailure(() => db.query(
      `select public.decide_custody_integrity($1, $2, 'release', 'Inspección física sin novedades', null, $3::uuid[])`,
      [caso.caseId, re.version - 1, ids],
    ));
    expect(err).toMatch(/conflicto de versión/i);
  });
});

describe("T-C3-01 · la reserva de evaluación es EXCLUSIVA (0232)", () => {
  it("con un intento vigente, una segunda reserva es rechazada", async () => {
    const s = await baseScenario(db);
    const caso = await casoEvaluadoSinInspeccion(s);
    await actAs(db, s.staff);

    const { rows } = await db.query<{ id: string }>(
      `select public.begin_custody_integrity_evaluation($1, $2) as id`,
      [caso.caseId, caso.version],
    );
    const primero = rows[0].id;

    const err = await expectFailure(() => db.query(
      `select public.begin_custody_integrity_evaluation($1, $2)`, [caso.caseId, caso.version],
    ));
    expect(err).toMatch(/ya hay una evaluación en curso/i);
    // Y el mensaje NO habla de versión: el llamador lo clasifica por texto y
    // esto es una reserva tomada, no un conflicto de CAS.
    expect(err).not.toMatch(/versión|version/i);

    // El primero sigue vivo y es el único pendiente.
    const { rows: pend } = await db.query(
      `select id, status from public.custody_integrity_evaluation_attempts
        where case_id = $1 and status = 'pending'`,
      [caso.caseId],
    );
    expect(pend).toHaveLength(1);
    expect(pend[0].id).toBe(primero);
  });

  it("el abandono explícito devuelve el caso a la operación", async () => {
    const s = await baseScenario(db);
    const caso = await casoEvaluadoSinInspeccion(s);
    await actAs(db, s.staff);
    const { rows } = await db.query<{ id: string }>(
      `select public.begin_custody_integrity_evaluation($1, $2) as id`,
      [caso.caseId, caso.version],
    );

    // El abandono es del ROL INTERNO DE SERVIDOR: `authenticated` no puede.
    const err = await expectFailure(() => db.query(
      `select public.abandon_custody_integrity_evaluation($1)`, [rows[0].id],
    ));
    expect(err).toMatch(/rol interno de servidor/i);

    await actAsServer(db);
    const { rows: ab } = await db.query<{ ok: boolean }>(
      `select public.abandon_custody_integrity_evaluation($1) as ok`, [rows[0].id],
    );
    expect(ab[0].ok).toBe(true);
    // Idempotente: abandonar dos veces no explota ni miente.
    const { rows: ab2 } = await db.query<{ ok: boolean }>(
      `select public.abandon_custody_integrity_evaluation($1) as ok`, [rows[0].id],
    );
    expect(ab2[0].ok).toBe(false);

    // Y ahora sí se puede volver a reservar.
    await actAs(db, s.staff);
    const { rows: otra } = await db.query<{ id: string }>(
      `select public.begin_custody_integrity_evaluation($1, $2) as id`,
      [caso.caseId, caso.version],
    );
    expect(otra[0].id).not.toBe(rows[0].id);
  });

  it("un intento VENCIDO no bloquea: se abandona y se reemplaza", async () => {
    const s = await baseScenario(db);
    const caso = await casoEvaluadoSinInspeccion(s);
    await actAs(db, s.staff);
    const { rows } = await db.query<{ id: string }>(
      `select public.begin_custody_integrity_evaluation($1, $2) as id`,
      [caso.caseId, caso.version],
    );

    // `expires_at` es parte del binding CONGELADO: el trigger de 0222 impide
    // reescribirlo, y está bien que así sea —si se pudiera mover la ventana,
    // la exclusividad no valdría nada—. Para simular el paso del tiempo, el
    // harness suspende el guard un instante, envejece la fila y lo repone.
    await db.query(
      `alter table public.custody_integrity_evaluation_attempts
         disable trigger trg_custody_integrity_attempt_guard`,
    );
    try {
      await db.query(
        // La ventana se mueve ENTERA: el CHECK exige expires_at > requested_at,
        // así que envejecer sólo el vencimiento produciría una fila imposible.
        `update public.custody_integrity_evaluation_attempts
            set requested_at = now() - interval '2 hours',
                expires_at   = now() - interval '90 minutes'
          where id = $1`,
        [rows[0].id],
      );
    } finally {
      await db.query(
        `alter table public.custody_integrity_evaluation_attempts
           enable trigger trg_custody_integrity_attempt_guard`,
      );
    }

    // El guard vuelve a estar activo ANTES de ejercitar la reserva: lo que se
    // mide es 0232, no una tabla con las defensas bajadas.
    const { rows: guard } = await db.query<{ tgenabled: string }>(
      `select tgenabled from pg_trigger where tgname = 'trg_custody_integrity_attempt_guard'`,
    );
    expect(guard[0].tgenabled).toBe("O");

    const { rows: otra } = await db.query<{ id: string }>(
      `select public.begin_custody_integrity_evaluation($1, $2) as id`,
      [caso.caseId, caso.version],
    );
    expect(otra[0].id).not.toBe(rows[0].id);

    const { rows: viejo } = await db.query(
      `select status from public.custody_integrity_evaluation_attempts where id = $1`,
      [rows[0].id],
    );
    expect(viejo[0].status).toBe("abandoned");
  });
});
