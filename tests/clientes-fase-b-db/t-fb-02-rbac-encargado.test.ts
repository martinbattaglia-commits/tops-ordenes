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
  it("el encargado canónico queda AUTORIZADO con su sede exacta", async () => {
    for (const p of [JORGE, JUAN]) {
      const scope = await comoUsuario(db, p.id, p.email, async () =>
        db.query<{ is_principal: boolean; is_authorized: boolean; depot: string; warehouse_code: string }>(
          `select * from public.nexus_depot_manager_scope()`,
        ),
      );
      expect(scope.rows[0].is_principal).toBe(true);
      expect(scope.rows[0].is_authorized).toBe(true);
      expect(scope.rows[0].depot).toBe(p.depot);
      expect(scope.rows[0].warehouse_code).toBe(p.warehouse);
    }
  });

  it("R-2 · el encargado VÁLIDO lee los operadores de su sede", async () => {
    const { rows } = await comoUsuario(db, JORGE.id, JORGE.email, async () =>
      db.query<{ depot: string }>(`select depot from public.operators`),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.depot === JORGE.depot)).toBe(true);
  });

  it("R-2 · y no ve ni una fila de la otra sede", async () => {
    const { rows } = await comoUsuario(db, JUAN.id, JUAN.email, async () =>
      db.query<{ depot: string }>(`select depot from public.operators where depot = 'LUJAN'`),
    );
    expect(rows).toEqual([]);
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

  it("profiles.role manipulado a admin no concede privilegios", async () => {
    await db.query(`update public.profiles set role = 'admin' where id = $1`, [JORGE.id]);
    try {
      const r = await comoUsuario(db, JORGE.id, JORGE.email, async () =>
        db.query<{ is_admin: boolean; is_staff: boolean; current_role: string }>(
          `select public.is_admin() as is_admin, public.is_staff() as is_staff,
                  public.current_role() as current_role`,
        ),
      );
      expect(r.rows[0].is_admin).toBe(false);
      expect(r.rows[0].is_staff).toBe(false);
      expect(r.rows[0].current_role).toBe("cliente");
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
