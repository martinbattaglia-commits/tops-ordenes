/**
 * T-C1-06 · §2 — PROCEDENCIA SERVER-OWNED de la evaluación.
 *
 * El hallazgo del DB-C4 era que `authenticated` podía DECLARAR provider,
 * modelo, execution_mode, outcome, verdict y confidence. Acá se prueba por
 * agotamiento que ya no puede: ni por la RPC vieja (que no existe), ni por la
 * nueva (que no le está concedida), ni por escritura directa, ni reutilizando
 * o falsificando un intento.
 *
 * NINGUNA prueba llama a un proveedor real. Los resultados son dobles
 * SINTÉTICOS: lo que se verifica es la PROCEDENCIA del dato, no su contenido.
 */
import { describe, expect, inject, it, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import {
  actAs,
  actAsServer,
  baseScenario,
  createEvidence,
  createEvent,
  expectFailure,
} from "./harness/fixtures";
import { buildReleasableCase } from "./harness/scenario";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

/** Ejecuta como el ROL de base de datos indicado y siempre lo revierte. */
async function asDbRole<T>(role: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.query(`reset role`);
  }
}

/**
 * Suspende un trigger para FABRICAR un estado imposible por las vías normales.
 * Es deliberado y acotado: el escenario más favorable al atacante es el único
 * que prueba de verdad la barrera siguiente.
 */
async function withTriggerDisabled<T>(
  table: string,
  trigger: string,
  fn: () => Promise<T>,
): Promise<T> {
  await db.query(`alter table ${table} disable trigger ${trigger}`);
  try {
    return await fn();
  } finally {
    await db.query(`alter table ${table} enable trigger ${trigger}`);
  }
}

describe("T-C1-06 · §2.1 · authenticated no completa resultados del proveedor", () => {
  it("la RPC de finalización NO le está concedida a `authenticated`", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { rows: c } = await db.query<{ id: string }>(
      `select public.upsert_custody_integrity_assessment(
         'packing_unit', $1, null, null, null, 'PENDING_EVIDENCE', array['NO_CALIBRATED_THRESHOLD']) as id`,
      [s.packingUnitId],
    );
    const { rows: a } = await db.query<{ id: string }>(
      `select public.begin_custody_integrity_evaluation($1, 1) as id`,
      [c[0].id],
    );

    const msg = await asDbRole("authenticated", () =>
      expectFailure(() =>
        db.query(
          `select public.complete_custody_integrity_evaluation(
             $1, $2, 1, 'openai', 'gpt-vision', 'v2', 'real', 'ok', 'coincide', 0.9, null)`,
          [a[0].id, c[0].id],
        ),
      ),
    );
    expect(msg).toMatch(/permission denied for function complete_custody_integrity_evaluation/i);
  });

  it("con el CONTEXTO de un usuario final tampoco, aunque el privilegio alcanzara", async () => {
    // Segunda barrera: la conexión del harness es superusuaria, de modo que el
    // privilegio NO frena nada acá. Lo que frena es el claim del request.
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { rows: c } = await db.query<{ id: string }>(
      `select public.upsert_custody_integrity_assessment(
         'packing_unit', $1, null, null, null, 'PENDING_EVIDENCE', array['NO_CALIBRATED_THRESHOLD']) as id`,
      [s.packingUnitId],
    );
    const { rows: a } = await db.query<{ id: string }>(
      `select public.begin_custody_integrity_evaluation($1, 1) as id`,
      [c[0].id],
    );

    const msg = await expectFailure(() =>
      db.query(
        `select public.complete_custody_integrity_evaluation(
           $1, $2, 1, 'openai', 'gpt-vision', 'v2', 'real', 'ok', 'coincide', 0.9, null)`,
        [a[0].id, c[0].id],
      ),
    );
    expect(msg).toMatch(/reservada al rol interno de servidor/);
  });

  it("un intento PENDIENTE no contiene resultados: el CHECK lo impide", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { rows: c } = await db.query<{ id: string }>(
      `select public.upsert_custody_integrity_assessment(
         'packing_unit', $1, null, null, null, 'PENDING_EVIDENCE', array['NO_CALIBRATED_THRESHOLD']) as id`,
      [s.packingUnitId],
    );
    await db.query(`select public.begin_custody_integrity_evaluation($1, 1) as id`, [c[0].id]);

    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.custody_integrity_evaluation_attempts
        where case_id = $1 and status = 'pending'
          and provider is null and outcome is null and verdict is null`,
      [c[0].id],
    );
    expect(rows[0].n).toBe("1");

    // Y el caso sigue sin una sola columna de evaluación escrita.
    const { rows: cc } = await db.query<{ provider: string | null; state: string }>(
      `select provider, state from public.custody_integrity_cases where id = $1`,
      [c[0].id],
    );
    expect(cc[0].provider).toBeNull();
    expect(cc[0].state).toBe("PENDING_EVIDENCE");
  });
});

describe("T-C1-06 · §2.2 · el intento se verifica pieza por pieza", () => {
  it("SIN INTENTO: un uuid inventado no finaliza nada", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    await actAsServer(db);
    const msg = await expectFailure(() =>
      db.query(
        `select public.complete_custody_integrity_evaluation(
           $1, $2, $3, 'openai', 'gpt-vision', 'v2', 'real', 'ok', 'coincide', 0.9, null)`,
        ["00000000-0000-0000-0000-000000000000", built.caseId, built.version],
      ),
    );
    expect(msg).toMatch(/intento inexistente/);
  });

  it("AJENO: el intento de un caso no cierra la evaluación de otro", async () => {
    const sA = await baseScenario(db);
    const sB = await baseScenario(db);
    await actAs(db, sA.staff);
    const { rows: cA } = await db.query<{ id: string }>(
      `select public.upsert_custody_integrity_assessment(
         'packing_unit', $1, null, null, null, 'PENDING_EVIDENCE', array['NO_CALIBRATED_THRESHOLD']) as id`,
      [sA.packingUnitId],
    );
    const { rows: aA } = await db.query<{ id: string }>(
      `select public.begin_custody_integrity_evaluation($1, 1) as id`,
      [cA[0].id],
    );
    await actAs(db, sB.staff);
    const { rows: cB } = await db.query<{ id: string }>(
      `select public.upsert_custody_integrity_assessment(
         'packing_unit', $1, null, null, null, 'PENDING_EVIDENCE', array['NO_CALIBRATED_THRESHOLD']) as id`,
      [sB.packingUnitId],
    );

    await actAsServer(db);
    const msg = await expectFailure(() =>
      db.query(
        `select public.complete_custody_integrity_evaluation(
           $1, $2, 1, 'openai', 'gpt-vision', 'v2', 'real', 'ok', 'coincide', 0.9, null)`,
        [aA[0].id, cB[0].id],
      ),
    );
    expect(msg).toMatch(/intento ajeno al caso/);
  });

  it("YA USADO: un intento completado no vuelve a completarse", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    await actAsServer(db);
    const msg = await expectFailure(() =>
      db.query(
        `select public.complete_custody_integrity_evaluation(
           $1, $2, 1, 'openai', 'gpt-vision', 'v2', 'real', 'ok', 'coincide', 0.9, null)`,
        [built.attemptId, built.caseId],
      ),
    );
    expect(msg).toMatch(/intento ya utilizado o abandonado/);
  });

  it("VENCIDO: pasada la ventana, el intento no sirve", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { rows: c } = await db.query<{ id: string }>(
      `select public.upsert_custody_integrity_assessment(
         'packing_unit', $1, null, null, null, 'PENDING_EVIDENCE', array['NO_CALIBRATED_THRESHOLD']) as id`,
      [s.packingUnitId],
    );
    const { rows: a } = await db.query<{ id: string }>(
      `select public.begin_custody_integrity_evaluation($1, 1) as id`,
      [c[0].id],
    );

    // `expires_at` es inmutable por el guard: se lo suspende a propósito para
    // envejecer el intento sin esperar media hora de reloj.
    await withTriggerDisabled(
      "public.custody_integrity_evaluation_attempts",
      "trg_custody_integrity_attempt_guard",
      async () => {
        await db.query(
          `update public.custody_integrity_evaluation_attempts
              set requested_at = now() - interval '2 hours',
                  expires_at   = now() - interval '90 minutes'
            where id = $1`,
          [a[0].id],
        );
      },
    );

    await actAsServer(db);
    const msg = await expectFailure(() =>
      db.query(
        `select public.complete_custody_integrity_evaluation(
           $1, $2, 1, 'openai', 'gpt-vision', 'v2', 'real', 'ok', 'coincide', 0.9, null)`,
        [a[0].id, c[0].id],
      ),
    );
    expect(msg).toMatch(/intento vencido/);
  });

  it("VERSIÓN DISTINTA: la del intento es la única aceptable", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { rows: c } = await db.query<{ id: string }>(
      `select public.upsert_custody_integrity_assessment(
         'packing_unit', $1, null, null, null, 'PENDING_EVIDENCE', array['NO_CALIBRATED_THRESHOLD']) as id`,
      [s.packingUnitId],
    );
    const { rows: a } = await db.query<{ id: string }>(
      `select public.begin_custody_integrity_evaluation($1, 1) as id`,
      [c[0].id],
    );

    await actAsServer(db);
    for (const bad of [2, 7]) {
      const msg = await expectFailure(() =>
        db.query(
          `select public.complete_custody_integrity_evaluation(
             $1, $2, $3, 'openai', 'gpt-vision', 'v2', 'real', 'ok', 'coincide', 0.9, null)`,
          [a[0].id, c[0].id, bad],
        ),
      );
      expect(msg).toMatch(/versión distinta de la del intento/);
    }
  });

  it("EVIDENCIAS DISTINTAS: si el caso cambió de evidencias, el intento caduca de hecho", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    // Nuevo intento sobre el caso ya evaluado (versión vigente).
    await actAs(db, s.staff);
    const { rows: a } = await db.query<{ id: string }>(
      `select public.begin_custody_integrity_evaluation($1, $2) as id`,
      [built.caseId, built.version],
    );

    // NEGATIVO FABRICADO: se mueve la evidencia de ingreso del caso por la
    // fuerza, para comprobar que el binding del intento lo detecta.
    const otherEvent = await createEvent(db, {
      packingUnitId: s.packingUnitId,
      stage: "transporte",
      eventType: "en_transito",
    });
    const otherEvidence = await createEvidence(db, otherEvent);
    await db.query(
      `update public.custody_integrity_cases set ingress_evidence_id = $2 where id = $1`,
      [built.caseId, otherEvidence],
    );

    await actAsServer(db);
    const msg = await expectFailure(() =>
      db.query(
        `select public.complete_custody_integrity_evaluation(
           $1, $2, $3, 'openai', 'gpt-vision', 'v2', 'real', 'ok', 'coincide', 0.9, null)`,
        [a[0].id, built.caseId, built.version],
      ),
    );
    expect(msg).toMatch(/evidencias distintas de las del intento/);
  });

  it("CLIENTE DISTINTO: un caso reasignado a otro tenant no cierra con el intento viejo", async () => {
    const s = await baseScenario(db);
    const other = await baseScenario(db);
    await actAs(db, s.staff);
    const { rows: c } = await db.query<{ id: string }>(
      `select public.upsert_custody_integrity_assessment(
         'packing_unit', $1, null, null, null, 'PENDING_EVIDENCE', array['NO_CALIBRATED_THRESHOLD']) as id`,
      [s.packingUnitId],
    );
    const { rows: a } = await db.query<{ id: string }>(
      `select public.begin_custody_integrity_evaluation($1, 1) as id`,
      [c[0].id],
    );

    // NEGATIVO FABRICADO: el trigger de coherencia impediría este UPDATE, y
    // ése es justamente el punto: se lo suspende para llegar a la barrera de
    // la finalización y comprobar que ella TAMBIÉN lo detiene.
    await withTriggerDisabled(
      "public.custody_integrity_cases",
      "trg_custody_integrity_case_coherence",
      async () => {
        await db.query(`update public.custody_integrity_cases set client_id = $2 where id = $1`, [
          c[0].id,
          other.clientId,
        ]);
      },
    );

    await actAsServer(db);
    const msg = await expectFailure(() =>
      db.query(
        `select public.complete_custody_integrity_evaluation(
           $1, $2, 1, 'openai', 'gpt-vision', 'v2', 'real', 'ok', 'coincide', 0.9, null)`,
        [a[0].id, c[0].id],
      ),
    );
    expect(msg).toMatch(/cliente distinto del intento/);
  });

  it("EXCLUSIVO (0232): con un intento VIGENTE, una segunda reserva es rechazada", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { rows: c } = await db.query<{ id: string }>(
      `select public.upsert_custody_integrity_assessment(
         'packing_unit', $1, null, null, null, 'PENDING_EVIDENCE', array['NO_CALIBRATED_THRESHOLD']) as id`,
      [s.packingUnitId],
    );
    const { rows: a1 } = await db.query<{ id: string }>(
      `select public.begin_custody_integrity_evaluation($1, 1) as id`,
      [c[0].id],
    );

    // ANTES esta llamada abandonaba el intento de a1 y devolvía uno nuevo. Eso
    // hacía que dos pedidos concurrentes ejecutaran DOS veces el análisis —con
    // un proveedor real, dos llamadas facturadas— aunque sólo uno pudiera
    // registrarse. 0232 lo cierra: la reserva es exclusiva mientras esté viva.
    const msg = await expectFailure(() =>
      db.query(`select public.begin_custody_integrity_evaluation($1, 1)`, [c[0].id]),
    );
    expect(msg).toMatch(/ya hay una evaluación en curso/i);

    // El primero sigue siendo el único pendiente, intacto.
    const { rows: st } = await db.query<{ id: string; status: string }>(
      `select id, status from public.custody_integrity_evaluation_attempts where case_id = $1`,
      [c[0].id],
    );
    expect(st).toHaveLength(1);
    expect(st[0].id).toBe(a1[0].id);
    expect(st[0].status).toBe("pending");

    // Y su finalización sigue siendo posible: no se lo invalidó por el intento.
    await actAsServer(db);
    const { rows: v } = await db.query<{ v: number }>(
      `select public.complete_custody_integrity_evaluation(
         $1, $2, 1, 'openai', 'gpt-vision', 'v2', 'real', 'ok', 'coincide', 0.9, null) as v`,
      [a1[0].id, c[0].id],
    );
    expect(Number(v[0].v)).toBe(2);
    await actAs(db, s.staff);
  });

  it("el BINDING del intento es inmutable incluso para el superusuario", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { rows: c } = await db.query<{ id: string }>(
      `select public.upsert_custody_integrity_assessment(
         'packing_unit', $1, null, null, null, 'PENDING_EVIDENCE', array['NO_CALIBRATED_THRESHOLD']) as id`,
      [s.packingUnitId],
    );
    const { rows: a } = await db.query<{ id: string }>(
      `select public.begin_custody_integrity_evaluation($1, 1) as id`,
      [c[0].id],
    );

    for (const [col, val] of [
      ["case_version_at_start", "9"],
      ["requested_role", "'admin'"],
    ] as const) {
      const msg = await expectFailure(() =>
        db.query(
          `update public.custody_integrity_evaluation_attempts set ${col} = ${val} where id = $1`,
          [a[0].id],
        ),
      );
      expect(msg, col).toMatch(/binding del intento es inmutable/);
    }

    const del = await expectFailure(() =>
      db.query(`delete from public.custody_integrity_evaluation_attempts where id = $1`, [a[0].id]),
    );
    expect(del).toMatch(/no se borran/);
  });
});

describe("T-C1-06 · §2.3 · concurrencia de la finalización", () => {
  it("dos finalizaciones concurrentes del MISMO intento: gana exactamente una", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { rows: c } = await db.query<{ id: string }>(
      `select public.upsert_custody_integrity_assessment(
         'packing_unit', $1, null, null, null, 'PENDING_EVIDENCE', array['NO_CALIBRATED_THRESHOLD']) as id`,
      [s.packingUnitId],
    );
    const { rows: a } = await db.query<{ id: string }>(
      `select public.begin_custody_integrity_evaluation($1, 1) as id`,
      [c[0].id],
    );

    const url = inject("custodyDbUrl");
    const x = new Client({ connectionString: url });
    const y = new Client({ connectionString: url });
    await x.connect();
    await y.connect();
    try {
      for (const conn of [x, y]) {
        await conn.query(`select set_config('request.jwt.claim.role', 'service_role', false)`);
        await conn.query(`select set_config('request.jwt.claims', $1, false)`, [
          JSON.stringify({ role: "service_role" }),
        ]);
      }
      const call = (conn: Client) =>
        conn.query(
          `select public.complete_custody_integrity_evaluation(
             $1, $2, 1, 'openai', 'gpt-vision', 'v2', 'real', 'ok', 'coincide', 0.9, null)`,
          [a[0].id, c[0].id],
        );

      const results = await Promise.allSettled([call(x), call(y)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

      const { rows: att } = await db.query<{ status: string; n: string }>(
        `select status, count(*)::text as n from public.custody_integrity_evaluation_attempts
          where case_id = $1 group by status`,
        [c[0].id],
      );
      expect(att).toEqual([{ status: "completed", n: "1" }]);

      // Y el caso avanzó UNA sola versión.
      const { rows: cc } = await db.query<{ version: number; state: string }>(
        `select version, state from public.custody_integrity_cases where id = $1`,
        [c[0].id],
      );
      expect(Number(cc[0].version)).toBe(2);
      expect(cc[0].state).toBe("REVIEW_REQUIRED");
    } finally {
      await x.end();
      await y.end();
    }
  });
});
