/**
 * T-C2-02 · W22-BIS/M-1 — ACL de `custody_events` y `custody_evidence`.
 *
 * RLS y PRIVILEGIOS SQL son controles SEPARADOS, y el DB-C4 marcó que sólo se
 * estaba usando el primero. 0036 define policies de SELECT y ninguna de
 * escritura, de modo que INSERT/UPDATE/DELETE quedaban denegados por ausencia
 * de policy — pero el bootstrap de plataforma concede `grant all on tables` a
 * anon/authenticated/service_role, y `TRUNCATE` NO PASA POR RLS. Un rol de API
 * podía vaciar la cadena de custodia entera sin violar una sola policy.
 *
 * Las pruebas corren con `set role`, es decir contra el rol de base de datos
 * real que usa PostgREST, y no contra el dueño del esquema.
 */
import { describe, expect, inject, it, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import {
  actAs,
  attachEvidence,
  baseScenario,
  expectFailure,
  uid,
  type Scenario,
} from "./harness/fixtures";

let db: Client;
let s: Scenario;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
  s = await baseScenario(db);
});

afterAll(async () => {
  await db.end();
});

async function asRole<T>(role: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.query(`reset role`);
  }
}

const API_ROLES = ["anon", "authenticated", "service_role"] as const;
const CUSTODY_TABLES = ["custody_events", "custody_evidence"] as const;

describe("T-C2-02 · M-1 · ningún rol de API conserva DML crudo", () => {
  for (const role of API_ROLES) {
    for (const table of CUSTODY_TABLES) {
      it(`${role} no puede TRUNCATE public.${table}`, async () => {
        // TRUNCATE es el caso decisivo: RLS no lo filtra. Si el privilegio
        // sigue concedido, la cadena de custodia es borrable por la API.
        const msg = await expectFailure(() =>
          asRole(role, () => db.query(`truncate table public.${table} cascade`)),
        );
        expect(msg).toMatch(/permission denied|permiso denegado/i);
      });

      it(`${role} no puede DELETE de public.${table}`, async () => {
        const msg = await expectFailure(() =>
          asRole(role, () => db.query(`delete from public.${table}`)),
        );
        expect(msg).toMatch(/permission denied|permiso denegado/i);
      });

      it(`${role} no puede UPDATE de public.${table}`, async () => {
        const msg = await expectFailure(() =>
          asRole(role, () => db.query(`update public.${table} set id = id`)),
        );
        expect(msg).toMatch(/permission denied|permiso denegado/i);
      });
    }
  }

  it("authenticated no puede fabricar un evento con actor y fecha inventados", async () => {
    const msg = await expectFailure(() =>
      asRole("authenticated", () =>
        db.query(
          `insert into public.custody_events
             (public_id, packing_unit_id, stage, event_type, actor_id, occurred_at, row_hash)
           values ($1, $2, 'despacho', 'inspeccion_humana', gen_random_uuid(), now(), 'PENDIENTE')`,
          [uid("EVT"), s.packingUnitId],
        ),
      ),
    );
    expect(msg).toMatch(/permission denied|permiso denegado/i);
  });

  it("authenticated no puede fabricar una evidencia con hash inventado", async () => {
    const msg = await expectFailure(() =>
      asRole("authenticated", () =>
        db.query(
          `insert into public.custody_evidence
             (event_id, kind, storage_bucket, storage_path, sha256)
           values (gen_random_uuid(), 'foto', 'custody-evidence', $1, $2)`,
          [`${uid("path")}.jpg`, uid("sha")],
        ),
      ),
    );
    expect(msg).toMatch(/permission denied|permiso denegado/i);
  });
});

describe("T-C2-02 · M-1 · lo que debe seguir funcionando, funciona", () => {
  it("authenticated conserva la LECTURA de la cadena", async () => {
    await asRole("authenticated", async () => {
      await db.query(`select count(*) from public.custody_events`);
      await db.query(`select count(*) from public.custody_evidence`);
    });
  });

  it("anon NO lee la cadena de custodia", async () => {
    const msg = await expectFailure(() =>
      asRole("anon", () => db.query(`select count(*) from public.custody_events`)),
    );
    expect(msg).toMatch(/permission denied|permiso denegado/i);
  });

  it("la RPC productiva sigue siendo el ingreso válido", async () => {
    await actAs(db, s.staff);
    const r = await attachEvidence(db, {
      packingUnitId: s.packingUnitId,
      stage: "packing",
      eventType: "foto_packing",
    });
    expect(r.eventId).toBeTruthy();
    expect(r.evidenceId).toBeTruthy();

    // Y el evento nació con actor e instante SERVER-SIDE, no con los del caller.
    const { rows } = await db.query<{ actor_id: string | null }>(
      `select actor_id from public.custody_events where id = $1`,
      [r.eventId],
    );
    expect(rows[0].actor_id).toBe(s.staff.userId);
  });
});
