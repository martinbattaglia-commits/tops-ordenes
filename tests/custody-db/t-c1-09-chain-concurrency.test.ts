/**
 * T-C1-09 · §4 — CADENA Y CONCURRENCIA.
 *
 * El hallazgo del DB-C4 no era que faltara comprobar el head: era que el
 * control y el commit no estaban serializados contra la propia cadena. Entre
 * «leí el head y coincide» y «cerré la decisión» cabía un evento nuevo, y la
 * liberación quedaba tomada sobre una cadena que ya no era la vigente.
 *
 * La corrección es tomar EXACTAMENTE el mismo `pg_advisory_xact_lock` por
 * entidad que usa `custody_event_hashchain` (0036) y sostenerlo hasta el fin de
 * la transacción. Acá se prueba en las dos direcciones: decisión primero y
 * evento primero.
 */
import { describe, expect, inject, it, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import {
  actAs,
  baseScenario,
  createPackingUnit,
  expectFailure,
  uid,
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera hasta ver una solicitud de advisory lock EN COLA, o se rinde. */
async function waitForBlockedAdvisoryLock(timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from pg_locks
        where locktype = 'advisory' and not granted`,
    );
    if (Number(rows[0].n) > 0) return true;
    await sleep(100);
  }
  return false;
}

/** Sesión de usuario sobre una conexión secundaria. */
async function actAsOn(
  conn: Client,
  actor: { userId: string; sessionId: string },
): Promise<void> {
  await conn.query(`select set_config('request.jwt.claim.sub', $1, false)`, [actor.userId]);
  await conn.query(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
  await conn.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: actor.userId, role: "authenticated", session_id: actor.sessionId }),
  ]);
}

describe("T-C1-09 · §4.7 · una cadena vacía no acredita nada", () => {
  it("la atestación interna devuelve valid=false y unverifiable", async () => {
    const s = await baseScenario(db);
    const emptyPu = await createPackingUnit(db, s.orderId);

    const { rows } = await db.query<{ v: Record<string, unknown> }>(
      `select public.custody_chain_attestation('packing_unit', $1) as v`,
      [emptyPu],
    );
    const v = rows[0].v;
    expect(v.valid).toBe(false);
    expect(v.status).toBe("unverifiable");
    expect(v.events_checked).toBe(0);
    expect(v.chain_head).toBeNull();
    expect(v.attested_at).toBeNull();
    expect(v.verified_event_ids).toEqual([]);
    // Acredita SOBRE QUÉ se pronuncia, aun sin eventos.
    expect(v.scope).toBe("packing_unit");
    expect(v.entity_id).toBe(emptyPu);
  });

  it("el CHECK del caso impide persistir una atestación 'verified' incompleta", async () => {
    const { rows } = await db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = 'custody_integrity_cases_chain_attestation_chk'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toMatch(/chain_head/);
    expect(rows[0].def).toMatch(/chain_attested_at/);
  });
});

describe("T-C1-09 · §4.8 · el evento y la decisión quedan serializados", () => {
  it("mientras la decisión está abierta, un evento concurrente ESPERA el mismo lock", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    const url = inject("custodyDbUrl");
    const decider = new Client({ connectionString: url });
    const writer = new Client({ connectionString: url });
    await decider.connect();
    await writer.connect();

    try {
      await actAsOn(decider, s.decider);
      await decider.query("begin");
      await decider.query(
        `select public.decide_custody_integrity(
           $1, $2, 'release', 'Inspección física completa sin novedades', null, $3::uuid[])`,
        [built.caseId, built.version, [built.inspectionEvidenceId]],
      );

      // La decisión sostiene el advisory lock de la entidad hasta el commit.
      const pending = writer.query(
        `insert into public.custody_events
           (public_id, packing_unit_id, stage, event_type, row_hash)
         values ($1, $2, 'transporte', 'en_transito', 'PENDIENTE')`,
        [uid("EVT"), s.packingUnitId],
      );
      let settled = false;
      pending.then(
        () => (settled = true),
        () => (settled = true),
      );

      expect(await waitForBlockedAdvisoryLock()).toBe(true);
      expect(settled, "el evento concurrente NO debería haber avanzado").toBe(false);

      await decider.query("commit");
      await pending; // recién ahora puede entrar

      const { rows } = await db.query<{ state: string }>(
        `select state from public.custody_integrity_cases where id = $1`,
        [built.caseId],
      );
      expect(rows[0].state).toBe("RELEASED");

      // El evento tardío existe, pero DESPUÉS de la decisión: nunca estuvo
      // dentro de la cadena que se atestó ni de la que se liberó.
      const { rows: ev } = await db.query<{ n: string }>(
        `select count(*)::text as n from public.custody_events
          where packing_unit_id = $1 and event_type = 'en_transito'`,
        [s.packingUnitId],
      );
      expect(ev[0].n).toBe("1");
    } finally {
      await decider.query("rollback").catch(() => {});
      await decider.end();
      await writer.end();
    }
  });
});

describe("T-C1-09 · §4.9 · el head cambiado impide liberar", () => {
  it("un evento COMMITEADO mientras la decisión espera el lock la bloquea", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    const url = inject("custodyDbUrl");
    const writer = new Client({ connectionString: url });
    await writer.connect();

    try {
      // El escritor toma el lock primero y lo sostiene sin commitear.
      await writer.query("begin");
      await writer.query(
        `insert into public.custody_events
           (public_id, packing_unit_id, stage, event_type, row_hash)
         values ($1, $2, 'transporte', 'en_transito', 'PENDIENTE')`,
        [uid("EVT"), s.packingUnitId],
      );

      // La decisión entra y queda en cola por el MISMO lock.
      await actAs(db, s.decider);
      const decision = db.query(
        `select public.decide_custody_integrity(
           $1, $2, 'release', 'Inspección física completa sin novedades', null, $3::uuid[])`,
        [built.caseId, built.version, [built.inspectionEvidenceId]],
      );
      let settled = false;
      decision.then(
        () => (settled = true),
        () => (settled = true),
      );

      // La comprobación de bloqueo necesita una conexión distinta de la que
      // está esperando: se usa la del escritor.
      const deadline = Date.now() + 10_000;
      let blocked = false;
      while (Date.now() < deadline && !blocked) {
        const { rows } = await writer.query<{ n: string }>(
          `select count(*)::text as n from pg_locks where locktype = 'advisory' and not granted`,
        );
        blocked = Number(rows[0].n) > 0;
        if (!blocked) await sleep(100);
      }
      expect(blocked, "la decisión debería estar esperando el advisory lock").toBe(true);
      expect(settled).toBe(false);

      await writer.query("commit");

      // Al obtener el lock, la decisión RECOMPUTA el head y descubre que la
      // cadena avanzó. Sin el lock habría leído el head viejo y liberado.
      await expect(decision).rejects.toThrow(/la cadena avanzó desde la atestación/);

      const { rows } = await db.query<{ state: string; decision_id: string | null }>(
        `select state, decision_id from public.custody_integrity_cases where id = $1`,
        [built.caseId],
      );
      expect(rows[0].state).toBe("REVIEW_REQUIRED");
      expect(rows[0].decision_id).toBeNull();
    } finally {
      await writer.query("rollback").catch(() => {});
      await writer.end();
    }
  });

  it("la decisión toma el MISMO lock que la hash-chain, derivado en un solo lugar", async () => {
    // Si la clave se escribiera dos veces, un typo produciría dos locks
    // distintos y la serialización sería aparente. Se comprueba que ambas
    // funciones usan el helper / la misma cadena canónica.
    const { rows } = await db.query<{ proname: string; src: string }>(
      `select p.proname, p.prosrc as src from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('custody_event_hashchain','custody_chain_lock')`,
    );
    const hashchain = rows.find((r) => r.proname === "custody_event_hashchain")!.src;
    const lock = rows.find((r) => r.proname === "custody_chain_lock")!.src;
    // El helper es el ÚNICO lugar donde vive la clave: 0250a retiró la copia
    // que 0036 tenía inlineada en la hash-chain y la hizo delegar. Se exige esa
    // forma —helper con las claves, hash-chain sin ninguna— porque es más
    // fuerte que la anterior: con dos copias un typo pasaba, con una no existe
    // la segunda copia que pueda divergir.
    for (const key of ["custody_chain:pu:", "custody_chain:sh:"]) {
      expect(lock, `el helper usa ${key}`).toContain(key);
      expect(hashchain, `la hash-chain no reimplementa ${key}`).not.toContain(key);
    }
    expect(hashchain, "la hash-chain delega en el helper").toContain("custody_chain_lock");
    expect(lock).toContain("pg_advisory_xact_lock");

    // Y la RPC de decisión delega en el helper, no reimplementa la clave.
    const { rows: dec } = await db.query<{ src: string }>(
      `select p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'decide_custody_integrity'`,
    );
    expect(dec[0].src).toContain("custody_chain_lock");
    expect(dec[0].src).not.toContain("custody_chain:pu:");
  });

  it("STALE secuencial: un evento posterior a la atestación bloquea igual", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    await db.query(
      `insert into public.custody_events
         (public_id, packing_unit_id, stage, event_type, row_hash)
       values ($1, $2, 'transporte', 'en_transito', 'PENDIENTE')`,
      [uid("EVT"), s.packingUnitId],
    );

    await actAs(db, s.decider);
    const msg = await expectFailure(() =>
      db.query(
        `select public.decide_custody_integrity(
           $1, $2, 'release', 'Inspección física completa sin novedades', null, $3::uuid[])`,
        [built.caseId, built.version, [built.inspectionEvidenceId]],
      ),
    );
    expect(msg).toMatch(/la cadena avanzó desde la atestación/);
  });
});
