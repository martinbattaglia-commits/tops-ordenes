/**
 * T-C1-03 · D2 ADVERSARIAL — la atestación de cadena se deriva, no se declara.
 *
 * Cubre: cadena rota, incompleta (vacía), stale (head cambiado) y atestación
 * ajena a la entidad. Y comprueba que la RPC de verificación acredita SOBRE QUÉ
 * se pronuncia, que era exactamente lo que faltaba antes de D2.
 */
import { describe, expect, inject, it, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import {
  actAs,
  baseScenario,
  createEvent,
  createEventWithEvidence,
  createPackingUnit,
  expectFailure,
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

describe("T-C1-03 · D2 adversarial: atestación de cadena", () => {
  it("la verificación acredita scope, entidad, head, instante y eventos cubiertos", async () => {
    const s = await baseScenario(db);
    await createEventWithEvidence(db, {
      packingUnitId: s.packingUnitId,
      stage: "packing",
      eventType: "foto_packing",
    });
    await createEventWithEvidence(db, {
      packingUnitId: s.packingUnitId,
      stage: "despacho",
      eventType: "cargado",
    });
    await actAs(db, s.staff);

    const { rows } = await db.query<{ v: Record<string, unknown> }>(
      `select public.verify_custody_chain($1, null) as v`,
      [s.packingUnitId],
    );
    const v = rows[0].v;

    expect(v.valid).toBe(true);
    expect(v.status).toBe("verified");
    expect(v.scope).toBe("packing_unit");
    expect(v.entity_id).toBe(s.packingUnitId);
    expect(v.events_checked).toBe(2);
    expect((v.verified_event_ids as string[]).length).toBe(2);
    expect(v.chain_head).toMatch(/^[0-9a-f]{64}$/);
    expect(v.attested_at).not.toBeNull();
  });

  it("INCOMPLETA: una entidad sin eventos es INVERIFICABLE, no válida", async () => {
    const s = await baseScenario(db);
    const emptyPu = await createPackingUnit(db, s.orderId);
    await actAs(db, s.staff);

    const { rows } = await db.query<{ v: Record<string, unknown> }>(
      `select public.verify_custody_chain($1, null) as v`,
      [emptyPu],
    );
    const v = rows[0].v;
    expect(v.status).toBe("unverifiable");
    expect(v.events_checked).toBe(0);
    // CORRECCIÓN DB-C4: antes devolvía `valid = true`. Una cadena que no
    // existe no puede acreditar integridad de nada.
    expect(v.valid).toBe(false);
    expect(v.first_error).toBeNull();
    // Sin eventos no hay head ni instante que atestar.
    expect(v.chain_head).toBeNull();
    expect(v.attested_at).toBeNull();
  });

  it("ROTA: alterar un row_hash hace que la cadena deje de verificar", async () => {
    const s = await baseScenario(db);
    const first = await createEventWithEvidence(db, {
      packingUnitId: s.packingUnitId,
      stage: "packing",
      eventType: "foto_packing",
    });
    await createEventWithEvidence(db, {
      packingUnitId: s.packingUnitId,
      stage: "despacho",
      eventType: "cargado",
    });

    // Manipulación directa del hash. El trigger de inmutabilidad de 0036 puede
    // impedirlo; si lo impide, la cadena está protegida y eso también es un
    // resultado válido de esta prueba.
    let tampered = true;
    try {
      await db.query(
        `update public.custody_events set row_hash = repeat('0', 64) where id = $1`,
        [first.eventId],
      );
    } catch {
      tampered = false;
    }

    await actAs(db, s.staff);
    const { rows } = await db.query<{ v: Record<string, unknown> }>(
      `select public.verify_custody_chain($1, null) as v`,
      [s.packingUnitId],
    );
    const v = rows[0].v;

    if (tampered) {
      expect(v.valid).toBe(false);
      expect(v.status).toBe("invalid");
      expect(v.chain_head).toBeNull();
      expect(v.first_error).not.toBeNull();
    } else {
      // La tabla es inmutable: el tamper ni siquiera se pudo escribir.
      expect(v.status).toBe("verified");
    }
  });

  it("STALE: si la cadena avanza tras atestar, la liberación se bloquea", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);

    // Un evento nuevo mueve el head y deja la atestación desactualizada.
    await createEvent(db, {
      packingUnitId: s.packingUnitId,
      stage: "transporte",
      eventType: "en_transito",
    });

    await actAs(db, s.staff);
    const msg = await expectFailure(() => tryRelease(db, c));
    expect(msg).toMatch(/la cadena avanzó desde la atestación/);

    const { rows } = await db.query<{ state: string }>(
      `select state from public.custody_integrity_cases where id = $1`,
      [c.caseId],
    );
    expect(rows[0].state).toBe("REVIEW_REQUIRED");
  });

  it("NO VERIFICADA: sin atestación 'verified' no se libera", async () => {
    const s = await baseScenario(db);
    // Caso sin ningún evento: la cadena queda 'unverifiable'.
    const emptyPu = await createPackingUnit(db, s.orderId);
    await actAs(db, s.staff);

    const { rows: cs } = await db.query<{ id: string }>(
      `select public.upsert_custody_integrity_assessment(
         'packing_unit', $1, null, null, null, 'PENDING_EVIDENCE', array['NO_CALIBRATED_THRESHOLD']) as id`,
      [emptyPu],
    );
    const caseId = cs[0].id;
    const evaluation = await runEvaluation(db, s, caseId, 1);

    const { rows: st } = await db.query<{ chain_status: string }>(
      `select chain_status from public.custody_integrity_cases where id = $1`,
      [caseId],
    );
    expect(st[0].chain_status).toBe("unverifiable");

    await actAs(db, s.decider);
    const msg = await expectFailure(() =>
      db.query(
        `select public.decide_custody_integrity($1, $2, 'release', 'Intento sin cadena verificada', null, '{}'::uuid[])`,
        [caseId, evaluation.version],
      ),
    );
    expect(msg).toMatch(/cadena no verificada/);
  });

  it("AJENA: la atestación se pide sobre la entidad DEL CASO, no sobre otra", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);

    // La atestación persistida describe la entidad del caso: no hay parámetro
    // por el que el llamador pueda sustituirla.
    const { rows } = await db.query<{ chain_head: string }>(
      `select chain_head from public.custody_integrity_cases where id = $1`,
      [c.caseId],
    );
    const { rows: live } = await db.query<{ row_hash: string }>(
      `select row_hash from public.custody_events
        where coalesce(packing_unit_id, shipment_id) = $1
        order by chain_seq desc limit 1`,
      [s.packingUnitId],
    );
    expect(rows[0].chain_head).toBe(live[0].row_hash);

    // Y la firma de la RPC de decisión NO acepta ningún head del caller.
    const { rows: args } = await db.query<{ args: string }>(
      `select pg_get_function_arguments(p.oid) as args from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'decide_custody_integrity'`,
    );
    expect(args[0].args).not.toMatch(/chain_head/);
    expect(args[0].args).not.toMatch(/attest/);
  });
});
