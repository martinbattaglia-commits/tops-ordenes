/**
 * T-C2-01 · W22-BIS/B-1 — `profiles.role` deja de ser autoescribible.
 *
 * El DB-C4 encontró la escalada completa: un usuario `authenticated` ejecutaba
 * `update profiles set role='admin' where id = auth.uid()` y, con eso,
 * `has_permission()` empezaba a devolver true por su rama `current_role() =
 * 'admin'`. Toda la autoridad del feature colgaba de una columna que el propio
 * sujeto escribía.
 *
 * Estas pruebas se ejecutan CONTRA EL ROL `authenticated` de verdad (`set role`),
 * no contra el rol de la conexión del harness: la afirmación es sobre lo que
 * puede hacer un cliente de la API, no sobre lo que puede hacer el dueño del
 * esquema.
 *
 * Se afirman las cuatro cosas por separado, porque ninguna se deduce de otra:
 *   1. la autoelevación de `role` está DENEGADA;
 *   2. `client_id` y `active` tampoco se autoescriben;
 *   3. la edición LEGÍTIMA de perfil sigue permitida;
 *   4. el ADMINISTRADOR VÁLIDO conserva la capacidad de asignar roles.
 */
import { describe, expect, inject, it, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { actAs, baseScenario, createActor, createClient as createErpClient, expectFailure } from "./harness/fixtures";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

/** Ejecuta como el rol de base de datos `authenticated`, igual que PostgREST. */
async function asAuthenticated<T>(fn: () => Promise<T>): Promise<T> {
  await db.query("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.query("reset role");
  }
}

describe("T-C2-01 · B-1 · autoelevación denegada", () => {
  it("un usuario de operaciones NO puede hacerse admin", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);

    const msg = await expectFailure(() =>
      asAuthenticated(() =>
        db.query(`update public.profiles set role = 'admin' where id = $1`, [s.staff.userId]),
      ),
    );
    expect(msg).toMatch(/sólo los modifica un administrador/i);

    const { rows } = await db.query<{ role: string }>(
      `select role::text as role from public.profiles where id = $1`,
      [s.staff.userId],
    );
    expect(rows[0].role).toBe("operaciones");
  });

  it("tampoco puede reasignarse `client_id`", async () => {
    const s = await baseScenario(db);
    const otherClientId = await createErpClient(db);
    await actAs(db, s.staff);

    const msg = await expectFailure(() =>
      asAuthenticated(() =>
        db.query(`update public.profiles set client_id = $2 where id = $1`, [
          s.staff.userId,
          otherClientId,
        ]),
      ),
    );
    expect(msg).toMatch(/sólo los modifica un administrador/i);
  });

  it("tampoco puede tocar `active`", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);

    const msg = await expectFailure(() =>
      asAuthenticated(() =>
        db.query(`update public.profiles set active = false where id = $1`, [s.staff.userId]),
      ),
    );
    expect(msg).toMatch(/sólo los modifica un administrador/i);
  });

  it("un usuario 'cliente' tampoco se eleva", async () => {
    const clientId = await createErpClient(db);
    const intruder = await createActor(db, "cliente", clientId);
    await actAs(db, intruder);

    const msg = await expectFailure(() =>
      asAuthenticated(() =>
        db.query(`update public.profiles set role = 'admin' where id = $1`, [intruder.userId]),
      ),
    );
    expect(msg).toMatch(/sólo los modifica un administrador/i);
  });

  it("BYPASS EQUIVALENTE · el rodeo en dos pasos tampoco funciona", async () => {
    // Paso 1: intentar 'supervisor' —un rol staff, no admin—; Paso 2: 'admin'.
    // Si el primero pasara, el segundo lo haría desde una posición más cómoda.
    const s = await baseScenario(db);
    await actAs(db, s.staff);

    const first = await expectFailure(() =>
      asAuthenticated(() =>
        db.query(`update public.profiles set role = 'supervisor' where id = $1`, [s.staff.userId]),
      ),
    );
    expect(first).toMatch(/sólo los modifica un administrador/i);

    const second = await expectFailure(() =>
      asAuthenticated(() =>
        db.query(`update public.profiles set role = 'admin' where id = $1`, [s.staff.userId]),
      ),
    );
    expect(second).toMatch(/sólo los modifica un administrador/i);

    const { rows } = await db.query<{ role: string }>(
      `select role::text as role from public.profiles where id = $1`,
      [s.staff.userId],
    );
    expect(rows[0].role).toBe("operaciones");
  });
});

describe("T-C2-01 · B-1 · lo legítimo se conserva", () => {
  it("la edición de perfil por columnas seguras sigue permitida", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);

    await asAuthenticated(() =>
      db.query(`update public.profiles set full_name = $2 where id = $1`, [
        s.staff.userId,
        "Nombre Editado",
      ]),
    );

    const { rows } = await db.query<{ full_name: string; role: string }>(
      `select full_name, role::text as role from public.profiles where id = $1`,
      [s.staff.userId],
    );
    expect(rows[0].full_name).toBe("Nombre Editado");
    expect(rows[0].role).toBe("operaciones");
  });

  it("el ADMINISTRADOR VÁLIDO sigue asignando roles", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.decider); // rol 'admin'

    await asAuthenticated(() =>
      db.query(`update public.profiles set role = 'supervisor' where id = $1`, [s.staff.userId]),
    );

    const { rows } = await db.query<{ role: string }>(
      `select role::text as role from public.profiles where id = $1`,
      [s.staff.userId],
    );
    expect(rows[0].role).toBe("supervisor");
  });

  it("el rol interno de servidor (sin sujeto) conserva el alta y la corrección", async () => {
    const s = await baseScenario(db);
    // Sin `auth.uid()` no hay sujeto que se eleve: es el camino de seeds,
    // migraciones y del rol interno de servidor.
    await actAs(db, null);
    await db.query(`update public.profiles set role = 'supervisor' where id = $1`, [s.staff.userId]);

    const { rows } = await db.query<{ role: string }>(
      `select role::text as role from public.profiles where id = $1`,
      [s.staff.userId],
    );
    expect(rows[0].role).toBe("supervisor");
  });
});

describe("T-C2-01 · B-1 · el control de decisión no cuelga de la columna", () => {
  it("sin poder elevarse, `has_permission` no concede el bypass admin", async () => {
    const s = await baseScenario(db);
    const plain = await createActor(db, "operaciones");
    await actAs(db, plain);

    // Sin permiso RBAC y sin rol admin: la autoridad tiene que ser false.
    const { rows: before } = await db.query<{ ok: boolean | null }>(
      `select public.has_permission('wms.custody.decide') as ok`,
    );
    expect(before[0].ok).toBe(false);

    await expectFailure(() =>
      asAuthenticated(() =>
        db.query(`update public.profiles set role = 'admin' where id = $1`, [plain.userId]),
      ),
    );

    const { rows: after } = await db.query<{ ok: boolean | null }>(
      `select public.has_permission('wms.custody.decide') as ok`,
    );
    expect(after[0].ok).toBe(false);
    expect(s.staff.role).toBe("operaciones");
  });
});
