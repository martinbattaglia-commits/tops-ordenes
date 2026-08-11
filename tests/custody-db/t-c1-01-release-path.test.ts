/**
 * T-C1-01 · LA ÚNICA liberación humana válida.
 *
 * Ejercita el camino completo D1+D2+D3 de punta a punta y después demuestra que
 * es IRREPETIBLE. Si este archivo pasa pero los adversariales fallan, la
 * funcionalidad existe pero no está protegida; si pasa sólo éste, no se puede
 * afirmar que la liberación sea posible por una vía legítima.
 */
import { describe, expect, inject, it, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { actAs, baseScenario, expectFailure } from "./harness/fixtures";
import { buildReleasableCase } from "./harness/scenario";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

describe("T-C1-01 · liberación humana válida", () => {
  it("el caso queda en REVIEW_REQUIRED con atestación DERIVADA server-side", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    const { rows } = await db.query(
      `select state, version, chain_status, chain_events_checked, chain_head,
              chain_attested_at, outcome, execution_mode, verdict, model_confidence,
              client_id, decision_id
         from public.custody_integrity_cases where id = $1`,
      [built.caseId],
    );
    const c = rows[0];
    expect(c.state).toBe("REVIEW_REQUIRED");
    expect(c.chain_status).toBe("verified");
    expect(Number(c.chain_events_checked)).toBe(3);
    expect(c.chain_head).toMatch(/^[0-9a-f]{64}$/);
    expect(c.chain_attested_at).not.toBeNull();
    expect(c.decision_id).toBeNull();
    // El tenant se derivó de la entidad, no lo aportó el llamador.
    expect(c.client_id).toBe(s.clientId);
  });

  it("§2 · el intento quedó COMPLETADO, atado al caso y con la procedencia humana", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    const { rows } = await db.query(
      `select status, case_id, client_id, scope, entity_id, case_version_at_start,
              completed_case_version, requested_by, requested_session_id, requested_role,
              provider, model, execution_mode, outcome, verdict, closed_at
         from public.custody_integrity_evaluation_attempts where id = $1`,
      [built.attemptId],
    );
    const a = rows[0];
    expect(a.status).toBe("completed");
    expect(a.case_id).toBe(built.caseId);
    expect(a.client_id).toBe(s.clientId);
    expect(a.scope).toBe("packing_unit");
    expect(a.entity_id).toBe(s.packingUnitId);
    expect(Number(a.case_version_at_start)).toBe(1);
    expect(Number(a.completed_case_version)).toBe(built.version);
    // Quién PIDIÓ la evaluación es un humano con sesión acreditada, aunque el
    // que la cerró haya sido el rol interno de servidor.
    expect(a.requested_by).toBe(s.staff.userId);
    expect(a.requested_session_id).toBe(s.staff.sessionId);
    expect(a.requested_role).toBe("operaciones");
    // Los resultados del proveedor sólo aparecen tras la finalización.
    expect(a.provider).toBe("openai");
    expect(a.outcome).toBe("ok");
    expect(a.closed_at).not.toBeNull();
  });

  it("un humano autenticado y autorizado libera, y queda auditado", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    await actAs(db, s.decider);
    const { rows: d } = await db.query<{ id: string }>(
      `select public.decide_custody_integrity(
         $1, $2, 'release', 'Inspección física completa sin novedades', null, $3::uuid[]) as id`,
      [built.caseId, built.version, [built.inspectionEvidenceId]],
    );
    const decisionId = d[0].id;
    expect(decisionId).toBeTruthy();

    const { rows: c } = await db.query(
      `select state, decision_id, version from public.custody_integrity_cases where id = $1`,
      [built.caseId],
    );
    expect(c[0].state).toBe("RELEASED");
    expect(c[0].decision_id).toBe(decisionId);

    // La decisión registra actor, sesión, rol y permiso REALES, derivados server-side.
    const { rows: dec } = await db.query(
      `select decision, actor_user_id, actor_session_id, actor_role, permission,
              previous_state, new_state, chain_head_at_decision, client_id
         from public.custody_integrity_decisions where id = $1`,
      [decisionId],
    );
    expect(dec[0].decision).toBe("release");
    // §5 · quien libera es el admin, no quien preparó el caso.
    expect(dec[0].actor_user_id).toBe(s.decider.userId);
    expect(dec[0].actor_session_id).toBe(s.decider.sessionId);
    expect(dec[0].actor_role).toBe("admin");
    expect(dec[0].permission).toBe("wms.custody.decide");
    expect(dec[0].previous_state).toBe("REVIEW_REQUIRED");
    expect(dec[0].new_state).toBe("RELEASED");
    expect(dec[0].chain_head_at_decision).toMatch(/^[0-9a-f]{64}$/);
    expect(dec[0].client_id).toBe(s.clientId);

    // Evidencia de inspección efectivamente vinculada.
    const { rows: ie } = await db.query<{ evidence_id: string }>(
      `select evidence_id from public.custody_integrity_inspection_evidence where decision_id = $1`,
      [decisionId],
    );
    expect(ie.map((r: { evidence_id: string }) => r.evidence_id)).toEqual([built.inspectionEvidenceId]);

    // Auditoría.
    const { rows: audit } = await db.query<{ action: string }>(
      `select action from public.audit_log
        where entity = 'custody_integrity_case' and entity_id = $1 order by ts`,
      [built.caseId],
    );
    const actions = audit.map((r: { action: string }) => r.action);
    expect(actions).toContain("custody.integrity_decided");
    // §2 · la traza completa del flujo de dos tiempos.
    expect(actions).toContain("custody.integrity_evaluation_opened");
    expect(actions).toContain("custody.integrity_evaluated");
  });

  it("la liberación es IRREPETIBLE: el segundo intento se rechaza", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    await actAs(db, s.decider);
    await db.query(
      `select public.decide_custody_integrity($1, $2, 'release', 'Inspección física sin novedades', null, $3::uuid[])`,
      [built.caseId, built.version, [built.inspectionEvidenceId]],
    );

    // Con la versión vieja: conflicto. Con la nueva: ya decidido. Ninguna pasa.
    const msgStale = await expectFailure(() =>
      db.query(
        `select public.decide_custody_integrity($1, $2, 'release', 'Segundo intento con versión vieja', null, $3::uuid[])`,
        [built.caseId, built.version, [built.inspectionEvidenceId]],
      ),
    );
    expect(msgStale).toMatch(/ya decidido/);

    const msgFresh = await expectFailure(() =>
      db.query(
        `select public.decide_custody_integrity($1, $2, 'release', 'Segundo intento con versión nueva', null, $3::uuid[])`,
        [built.caseId, built.version + 1, [built.inspectionEvidenceId]],
      ),
    );
    expect(msgFresh).toMatch(/ya decidido/);

    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.custody_integrity_decisions where case_id = $1`,
      [built.caseId],
    );
    expect(rows[0].n).toBe("1");
  });

  it("la cuarentena es válida, la decide OPERACIONES y no exige evidencia de inspección", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    // §5 · RELEASE ADMIN-ONLY acota SÓLO la liberación. Retener una carga
    // sospechosa sigue siendo potestad de quien opera; lo contrario habría
    // sido endurecer el lado peligroso del error.
    await actAs(db, s.staff);
    const { rows: d } = await db.query<{ id: string }>(
      `select public.decide_custody_integrity(
         $1, $2, 'quarantine', 'Diferencias visibles en el embalaje', 'retenido en depósito', '{}'::uuid[]) as id`,
      [built.caseId, built.version],
    );
    expect(d[0].id).toBeTruthy();

    const { rows: c } = await db.query(
      `select state from public.custody_integrity_cases where id = $1`,
      [built.caseId],
    );
    expect(c[0].state).toBe("QUARANTINED");

    const { rows: dec } = await db.query<{ actor_role: string }>(
      `select actor_role from public.custody_integrity_decisions where id = $1`,
      [d[0].id],
    );
    expect(dec[0].actor_role).toBe("operaciones");
  });
});
