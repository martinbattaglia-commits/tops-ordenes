/**
 * T-C1-08 · §5 — POLÍTICA ÚNICA DE ACCESO y RELEASE ADMIN-ONLY.
 *
 * Dos afirmaciones distintas, y ninguna se deduce de la otra:
 *
 *   · el acotamiento por TENANT rige en TODA la superficie del feature —crear,
 *     evaluar y decidir—, no sólo donde alguien se acordó de escribirlo;
 *   · la LIBERACIÓN está reservada a 'admin' en la fase inicial, y eso no se
 *     relaja «para que los tests pasen»: los tests se adaptan a la política.
 *
 * La cuarentena conserva sus permisos: cerrar la puerta peligrosa no puede
 * costar la capacidad de retener una carga sospechosa.
 */
import { describe, expect, inject, it, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import {
  actAs,
  baseScenario,
  createActor,
  createClient as createErpClient,
  createOrder,
  createPackingUnit,
  expectFailure,
  grantPermission,
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

/** Tabla protegida y una columna suya, para intentar un UPDATE creíble. */
const PROTECTED_TABLES: ReadonlyArray<[table: string, column: string]> = [
  ["custody_integrity_cases", "client_id"],
  ["custody_integrity_decisions", "client_id"],
  ["custody_integrity_inspection_evidence", "evidence_id"],
  ["custody_integrity_evaluation_attempts", "client_id"],
];

async function asDbRole<T>(role: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.query(`reset role`);
  }
}

describe("T-C1-08 · §5.10 · el usuario client-bound no cruza de tenant", () => {
  it("no CREA el caso de otro cliente", async () => {
    const s = await baseScenario(db);
    const otherClientId = await createErpClient(db);
    const intruder = await createActor(db, "cliente", otherClientId);
    await grantPermission(db, intruder, "wms.edit");
    await actAs(db, intruder);

    const msg = await expectFailure(() =>
      db.query(
        `select public.upsert_custody_integrity_assessment(
           'packing_unit', $1, null, null, null, 'PENDING_EVIDENCE', array['NO_CALIBRATED_THRESHOLD'])`,
        [s.packingUnitId],
      ),
    );
    expect(msg).toMatch(/cliente ajeno/);
  });

  it("no EVALÚA el caso de otro cliente", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    const otherClientId = await createErpClient(db);
    const intruder = await createActor(db, "cliente", otherClientId);
    await grantPermission(db, intruder, "wms.edit");
    await actAs(db, intruder);

    const msg = await expectFailure(() =>
      db.query(`select public.begin_custody_integrity_evaluation($1, $2)`, [
        built.caseId,
        built.version,
      ]),
    );
    expect(msg).toMatch(/cliente ajeno/);
  });

  it("no DECIDE el caso de otro cliente", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    const otherClientId = await createErpClient(db);
    const intruder = await createActor(db, "cliente", otherClientId);
    await grantPermission(db, intruder, "wms.custody.decide");
    await actAs(db, intruder);

    const msg = await expectFailure(() => tryRelease(db, built, undefined, undefined, "keep"));
    expect(msg).toMatch(/cliente ajeno/);
  });

  it("CONTROL POSITIVO: sobre su PROPIO cliente, el mismo usuario sí opera", async () => {
    // Sin este control la regla anterior sería indistinguible de «ningún
    // cliente puede nada», que es una política distinta y no la acordada.
    const clientId = await createErpClient(db);
    const orderId = await createOrder(db, clientId);
    const pu = await createPackingUnit(db, orderId);
    const owner = await createActor(db, "cliente", clientId);
    await grantPermission(db, owner, "wms.edit");
    await actAs(db, owner);

    const { rows } = await db.query<{ id: string }>(
      `select public.upsert_custody_integrity_assessment(
         'packing_unit', $1, null, null, null, 'PENDING_EVIDENCE', array['NO_CALIBRATED_THRESHOLD']) as id`,
      [pu],
    );
    expect(rows[0].id).toBeTruthy();

    const { rows: att } = await db.query<{ id: string }>(
      `select public.begin_custody_integrity_evaluation($1, 1) as id`,
      [rows[0].id],
    );
    expect(att[0].id).toBeTruthy();
  });
});

describe("T-C1-08 · §5.11 · RELEASE ADMIN-ONLY", () => {
  it("`operaciones` CON el permiso no libera", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    await actAs(db, s.staff);
    const msg = await expectFailure(() => tryRelease(db, built, undefined, undefined, "keep"));
    expect(msg).toMatch(/liberación reservada a admin/);
    expect(msg).toMatch(/operaciones/);
  });

  it("`supervisor` CON el permiso tampoco libera", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    const sup = await createActor(db, "supervisor");
    await grantPermission(db, sup, "wms.custody.decide");
    await actAs(db, sup);
    const msg = await expectFailure(() => tryRelease(db, built, undefined, undefined, "keep"));
    expect(msg).toMatch(/liberación reservada a admin/);
  });

  it("`admin` sí libera", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);
    await expect(tryRelease(db, built)).resolves.toBeTruthy();
  });

  it("la migración NO siembra `wms.custody.decide` a ningún rol del catálogo", async () => {
    // 0222 crea el PERMISO y deliberadamente no lo ata a ningún rol. Lo único
    // que puede aparecer acá son los roles ad-hoc que fabrica el harness.
    const { rows } = await db.query<{ slug: string }>(
      `select r.slug from public.role_permissions rp
         join public.permissions p on p.id = rp.permission_id
         join public.roles r on r.id = rp.role_id
        where p.slug = 'wms.custody.decide'`,
    );
    for (const r of rows) {
      expect(r.slug, `rol del catálogo con el permiso: ${r.slug}`).toMatch(/^test-role-/);
    }
  });

  it("el CHECK de la tabla impide siquiera ESCRIBIR una liberación no-admin", async () => {
    const { rows } = await db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = 'custody_integrity_decisions_release_admin_chk'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toMatch(/admin/);
  });
});

describe("T-C1-08 · §5.14 · la cuarentena conserva sus permisos", () => {
  it("`supervisor` con el permiso pone en cuarentena", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    const sup = await createActor(db, "supervisor");
    await grantPermission(db, sup, "wms.custody.decide");
    await actAs(db, sup);

    const { rows } = await db.query<{ id: string }>(
      `select public.decide_custody_integrity(
         $1, $2, 'quarantine', 'Sello violado en la inspección', null, '{}'::uuid[]) as id`,
      [built.caseId, built.version],
    );
    expect(rows[0].id).toBeTruthy();

    const { rows: c } = await db.query<{ state: string }>(
      `select state from public.custody_integrity_cases where id = $1`,
      [built.caseId],
    );
    expect(c[0].state).toBe("QUARANTINED");
  });

  it("un usuario del PROPIO cliente con el permiso también puede retener", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    const owner = await createActor(db, "cliente", s.clientId);
    await grantPermission(db, owner, "wms.custody.decide");
    await actAs(db, owner);

    const { rows } = await db.query<{ id: string }>(
      `select public.decide_custody_integrity(
         $1, $2, 'quarantine', 'Embalaje abierto al recibir', null, '{}'::uuid[]) as id`,
      [built.caseId, built.version],
    );
    expect(rows[0].id).toBeTruthy();
  });
});

describe("T-C1-08 · §5.13 · la liberación exige las CUATRO condiciones a la vez", () => {
  it("con las cuatro presentes, libera", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);
    await expect(tryRelease(db, built)).resolves.toBeTruthy();
  });

  it("sin INTENTO CONFIABLE no libera, aunque las columnas de evaluación estén escritas", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    // NEGATIVO FABRICADO: se desacopla el intento de la versión que produjo,
    // que es lo que ocurriría si alguien hubiese escrito la evaluación por
    // otra vía. Las columnas siguen ahí; la procedencia, no.
    await db.query(
      `alter table public.custody_integrity_evaluation_attempts
         disable trigger trg_custody_integrity_attempt_guard`,
    );
    try {
      await db.query(
        `update public.custody_integrity_evaluation_attempts
            set completed_case_version = completed_case_version + 100 where id = $1`,
        [built.attemptId],
      );
    } finally {
      await db.query(
        `alter table public.custody_integrity_evaluation_attempts
           enable trigger trg_custody_integrity_attempt_guard`,
      );
    }

    const msg = await expectFailure(() => tryRelease(db, built));
    expect(msg).toMatch(/evaluación sin intento confiable/);
  });

  it("sin INSPECCIÓN no libera; sin DECISIÓN HUMANA el caso jamás sale de REVIEW_REQUIRED", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    const msg = await expectFailure(() => tryRelease(db, built, []));
    expect(msg).toMatch(/sin evidencia de inspección/);

    // Y sin ninguna decisión, el caso se queda donde está: no hay reloj, cron
    // ni trigger que lo libere solo.
    const { rows } = await db.query<{ state: string; decision_id: string | null }>(
      `select state, decision_id from public.custody_integrity_cases where id = $1`,
      [built.caseId],
    );
    expect(rows[0].state).toBe("REVIEW_REQUIRED");
    expect(rows[0].decision_id).toBeNull();
  });
});

describe("T-C1-08 · §5.15 · ningún camino escribe directamente las tablas protegidas", () => {
  it("`authenticated` no puede INSERT/UPDATE/DELETE en ninguna de ellas", async () => {
    const s = await baseScenario(db);
    const built = await buildReleasableCase(db, s);

    await asDbRole("authenticated", async () => {
      for (const [t, col] of PROTECTED_TABLES) {
        const upd = await expectFailure(() =>
          db.query(`update public.${t} set ${col} = ${col} where true`),
        );
        expect(upd, `${t} UPDATE`).toMatch(/permission denied for table/i);

        const del = await expectFailure(() => db.query(`delete from public.${t} where true`));
        expect(del, `${t} DELETE`).toMatch(/permission denied for table/i);
      }

      const ins = await expectFailure(() =>
        db.query(
          `insert into public.custody_integrity_decisions
             (case_id, decision, actor_user_id, actor_session_id, actor_role, client_id,
              permission, reason, previous_state, new_state, case_version_at_decision)
           values ($1, 'release', $2, $3, 'admin', $4, 'wms.custody.decide',
                   'liberacion fabricada por el atacante', 'REVIEW_REQUIRED', 'RELEASED', 1)`,
          [built.caseId, s.decider.userId, s.decider.sessionId, s.clientId],
        ),
      );
      expect(ins).toMatch(/permission denied for table/i);
    });

    // El caso sigue intacto.
    const { rows } = await db.query<{ state: string }>(
      `select state from public.custody_integrity_cases where id = $1`,
      [built.caseId],
    );
    expect(rows[0].state).toBe("REVIEW_REQUIRED");
  });

  it("`authenticated` sí puede LEER: la lectura nunca fue el problema", async () => {
    await asDbRole("authenticated", async () => {
      for (const [t] of PROTECTED_TABLES) {
        await expect(db.query(`select count(*) from public.${t}`)).resolves.toBeTruthy();
      }
    });
  });
});
