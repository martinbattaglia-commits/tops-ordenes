/**
 * T-FB-02 · La frontera del encargado, medida en la base.
 *
 * Es la superficie que no tenía NINGUNA cobertura automatizada, y por eso la
 * polaridad invertida de la policy de `operators` (0249:149) llegó hasta el
 * gate: denegaba al encargado válido —dejándolo sin responsables y por lo
 * tanto sin poder emitir una OS— y se la concedía al inválido.
 *
 * Acá se prueban las dos direcciones, que es lo que un test de una sola
 * dirección no habría detectado.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { connectGuarded, startEphemeralCluster, type EphemeralCluster } from "../db/harness/cluster";
import {
  BOOTSTRAP,
  FASE_B_FORWARDS,
  JORGE,
  JUAN,
  aplicar,
  aplicarCadena,
  cadenaHasta,
  comoUsuario,
  seedCanonico,
} from "./harness/chain";

let cluster: EphemeralCluster;
let db: Client;

beforeAll(async () => {
  cluster = await startEphemeralCluster();
  try {
    db = await connectGuarded(cluster.url);
    await db.query(readFileSync(BOOTSTRAP, "utf8"));
    await aplicarCadena(db, cadenaHasta(245));
    await seedCanonico(db);
    for (const f of FASE_B_FORWARDS) await aplicar(db, f);

    // Un operador por sede, para poder distinguir alcance de ceguera.
    await db.query(
      `insert into public.operators (full_name, depot, active)
       values ('Operador Lujan','LUJAN',true),('Operador Magaldi','MAGALDI',true)
       on conflict do nothing`,
    );
  } catch (e) {
    // Sin esto un fallo de carga deja el cluster vivo y el guard de residuos
    // del harness vanilla se pone en rojo por un motivo ajeno a su suite.
    await cluster.teardown().catch(() => {});
    throw e;
  }
}, 300_000);

afterAll(async () => {
  await db?.end().catch(() => {});
  await cluster?.teardown().catch(() => {});
});

describe("T-FB-02 · identidad y alcance del encargado", () => {
  it("el encargado canónico queda AUTORIZADO, con su sede como identidad", async () => {
    // `depot` identifica y rotula; ya no acota sobre qué nave puede operar.
    // La columna `warehouse_code` que la función sigue proyectando quedó sin
    // consumidor al retirarse el aislamiento y no se afirma acá.
    for (const p of [JORGE, JUAN]) {
      const scope = await comoUsuario(db, p.id, p.email, async () =>
        db.query<{ is_principal: boolean; is_authorized: boolean; depot: string }>(
          `select * from public.nexus_depot_manager_scope()`,
        ),
      );
      expect(scope.rows[0].is_principal).toBe(true);
      expect(scope.rows[0].is_authorized).toBe(true);
      expect(scope.rows[0].depot).toBe(p.depot);
    }
  });

  it("R-2 · el encargado VÁLIDO lee operadores; el filtro por sede ya no existe", async () => {
    // RECORTE POR EL RETIRO DEL AISLAMIENTO. Este caso exigía que sólo viera
    // los de su nave, y su gemelo exigía que no viera ninguno de la otra. Ese
    // sujeto se fue con la compuerta `depot` de la policy `ops read all`: los
    // encargados se cubren entre sí y una orden de la otra nave lleva un
    // responsable de esa nave. Que los vea de las DOS lo afirma T-FB-09; acá
    // queda lo que sobrevive, que es la autorización por identidad.
    const { rows } = await comoUsuario(db, JORGE.id, JORGE.email, async () =>
      db.query<{ depot: string }>(`select depot from public.operators`),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("R-2 · el encargado INVÁLIDO no lee ningún operador", async () => {
    // Se le quita la asignación de rol: exactamente el estado que el contrato
    // manda denegar. Con la polaridad invertida, éste era el único que leía.
    await db.query(`delete from public.user_roles where user_id = $1`, [JUAN.id]);
    try {
      const scope = await comoUsuario(db, JUAN.id, JUAN.email, async () =>
        db.query<{ is_authorized: boolean }>(`select * from public.nexus_depot_manager_scope()`),
      );
      expect(scope.rows[0].is_authorized).toBe(false);

      const { rows } = await comoUsuario(db, JUAN.id, JUAN.email, async () =>
        db.query<{ depot: string }>(`select depot from public.operators`),
      );
      expect(rows).toEqual([]);
    } finally {
      await db.query(
        `insert into public.user_roles (user_id, role_id, depot)
         select $1, r.id, $2::public.depot_t from public.roles r where r.slug='jefe_deposito'
         on conflict do nothing`,
        [JUAN.id, JUAN.depot],
      );
    }
  });

  it("profiles.role manipulado a admin no convierte al encargado en staff", async () => {
    // RECORTE POR EL RETIRO DEL AISLAMIENTO. La neutralización del rol legacy
    // sobrevive en is_staff() e is_admin(), que 0246 sigue cerrando para los
    // principales. NO sobrevive en current_role(): esa función se restituyó
    // byte a byte desde 8f538a7 y vuelve a devolver profiles.role tal cual,
    // de modo que con el perfil manipulado devuelve 'admin'.
    //
    // No es una regresión introducida acá: es EXACTAMENTE el comportamiento
    // del baseline 8f538a7, donde current_role() nunca tuvo override. Queda
    // asentado en el informe como consecuencia declarada de la restitución.
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [JORGE.id]);
    try {
      const r = await comoUsuario(db, JORGE.id, JORGE.email, async () =>
        db.query<{ is_admin: boolean; is_staff: boolean }>(
          `select public.is_admin() as is_admin, public.is_staff() as is_staff`,
        ),
      );
      expect(r.rows[0].is_admin).toBe(false);
      expect(r.rows[0].is_staff).toBe(false);
    } finally {
      await db.query(`update public.profiles set role = 'operaciones' where id = $1`, [JORGE.id]);
    }
  });

  it("las capacidades prohibidas siguen denegadas para el encargado", async () => {
    const r = await comoUsuario(db, JORGE.id, JORGE.email, async () =>
      db.query<{ slug: string; ok: boolean }>(
        `select s as slug, public.has_permission(s) as ok
         from unnest(array['compras.view','analytics.view','tesoreria.view','rrhh.view']) as s`,
      ),
    );
    expect(r.rows.every((x) => x.ok === false)).toBe(true);
  });
});
