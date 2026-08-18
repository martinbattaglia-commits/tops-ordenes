/**
 * T-CLI-A3-01 · LA PERILLA DE CONTRATACIÓN · 0255 + 0256, CONTRA SQL REAL.
 *
 * ─── LO QUE ESTE ARCHIVO FIJA ────────────────────────────────────────────
 *
 * Que dar de baja la custodia de un cliente NO desarma la mercadería que ya
 * entró bajo custodia. `clients.custody_level` es lo CONTRATADO;
 * `custody_physical_units.custody_level` es el RÉGIMEN CON EL QUE LA UNIDAD
 * INGRESÓ (0252:126-131), y son columnas distintas a propósito: el cliente
 * puede cambiar de plan entre el ingreso y la salida, y el bien tiene que
 * salir bajo el régimen con el que entró.
 *
 * El docblock de 0256 lo AFIRMA. Acá se MIDE: se materializa una unidad en
 * nivel 2, se baja el cliente a 1 con la RPC real, y se comprueba que la
 * unidad sigue en 2.
 *
 * ─── POR QUÉ ACÁ Y NO EN EL ARNÉS DE CUSTODIA ────────────────────────────
 *
 * 0256 exige el maestro nativo de clientes: escribe `client_events` (0241) y
 * respeta el patrón atómico de 0242. El arnés de custodia no lo lleva. Las
 * precondiciones del lado custodia vienen de `CIERRE_CUSTODIA`, vigilado
 * contra 0252 por `assertCierreAlDia()`; el SUJETO —0255 y 0256— se aplica
 * tal cual está en disco.
 */
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Client } from "pg";
import { createWaSandbox, type WaSandbox } from "./harness/wa-sandbox";
import { CIERRE_ACOTADO } from "./harness/clientes-closure";
import { CIERRE_CUSTODIA, assertCierreAlDia } from "./harness/custodia-closure";
import { MIGRATIONS_DIR } from "./harness/manifest";

const sql = (f: string) => readFileSync(resolve(MIGRATIONS_DIR, f), "utf8");

const ADMIN = "11111111-1111-4111-8111-111111111111";
const SIN_PERMISO = "22222222-2222-4222-8222-222222222222";

let sb: WaSandbox;
let db: Client;

/**
 * Ejecuta como el observador dado y con rol `authenticated`.
 *
 * SIN transacción envolvente, a propósito: 0242 le quita a `authenticated` la
 * escritura directa sobre `clients` —ésa es su tesis— así que los fixtures se
 * arman como DUEÑO y sólo la llamada a la RPC baja de rol. El aislamiento es
 * POR DATOS: cada caso crea su propio cliente con razón social aleatoria.
 */
async function como<T>(uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('test.observer', $1, false)", [uid ?? ""]);
  await db.query("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.query("reset role");
    await db.query("select set_config('test.observer', '', false)");
  }
}

/**
 * Mensaje de error de una sentencia, o null si no falló.
 *
 * Sin SAVEPOINT: estas pruebas no corren dentro de una transacción envolvente
 * —ver `como()`— y en PostgreSQL un savepoint fuera de un bloque es un error
 * en sí mismo.
 */
async function fallo(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

beforeAll(async () => {
  // Antes que nada: que el andamio siga describiendo lo que 0252 dice hoy.
  assertCierreAlDia();

  sb = await createWaSandbox(inject("dbUrl"));
  db = sb.client;
  await db.query(CIERRE_ACOTADO);
  await db.query(sql("0240_clientes_permission_module.sql"));
  await db.query(sql("0241_clients_native_master.sql"));
  await db.query(sql("0242_clients_atomic_mutations.sql"));
  await db.query(CIERRE_CUSTODIA);
  // El SUJETO. 0255 va en su propia sentencia: PostgreSQL prohíbe usar un valor
  // de enum nuevo en la misma transacción que lo crea, que es justamente el
  // motivo por el que la migración está partida en dos archivos.
  await db.query(sql("0255_clients_custody_action_enum.sql"));
  await db.query(sql("0256_clients_custody_level_rpc.sql"));

  await db.query("insert into auth.users (id) values ($1),($2)", [ADMIN, SIN_PERMISO]);
  await db.query(
    "insert into public.profiles (id, role) values ($1,'supervisor'),($2,'operaciones')",
    [ADMIN, SIN_PERMISO],
  );
  await db.query(
    "insert into public.roles (slug, name) values ('contrata','Contrata custodia'),('pelado','Sin permisos')",
  );
  await db.query(`
    insert into public.role_permissions (role_id, permission_id)
    select r.id, p.id from public.roles r, public.permissions p
     where r.slug = 'contrata' and p.slug = 'clientes.custody.contract'
  `);
  await db.query(
    "insert into public.user_roles (user_id, role_id) select $1, id from public.roles where slug='contrata'",
    [ADMIN],
  );
  await db.query(
    "insert into public.user_roles (user_id, role_id) select $1, id from public.roles where slug='pelado'",
    [SIN_PERMISO],
  );
});

afterAll(async () => {
  await sb?.destroy();
});

let seq = 0;

/**
 * CUIT con dígito verificador REAL. 0241 lo valida por constraint
 * (`clients_cuit_checksum_ck`), así que un número al azar no entra: se calcula
 * con la ponderación oficial 5-4-3-2-7-6-5-4-3-2 sobre los diez primeros.
 */
function cuitValido(n: number): string {
  const base = `30${String(70_000_000 + n).padStart(8, "0")}`;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, w, i) => acc + w * Number(base[i]), 0);
  const resto = suma % 11;
  const dv = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto;
  return `${base.slice(0, 2)}-${base.slice(2)}-${dv}`;
}

/** Cliente con nivel contratado, y su token de versión. */
async function cliente(nivel: 1 | 2): Promise<{ id: string; updatedAt: string }> {
  const { rows } = await db.query<{ id: string; updated_at: string }>(
    `insert into public.clients (razon, cuit, custody_level)
     values ($1, $2, $3) returning id, updated_at::text as updated_at`,
    [`CLI-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}`, cuitValido(seq), nivel],
  );
  return { id: rows[0].id, updatedAt: rows[0].updated_at };
}

/** Unidad física YA MATERIALIZADA con el régimen con el que ingresó. */
async function unidadMaterializada(nivel: 1 | 2): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.custody_physical_units (custody_level) values ($1) returning id`,
    [nivel],
  );
  return rows[0].id;
}

async function eventos(clientId: string): Promise<string> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*) n from public.client_events where client_id = $1`, [clientId]);
  return rows[0].n;
}

async function nivelUnidad(id: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select custody_level as n from public.custody_physical_units where id = $1`,
    [id],
  );
  return Number(rows[0].n);
}

describe("T-CLI-A3-01 · ⚠ LO YA MATERIALIZADO NO SE DEGRADA", () => {
  it("bajar el cliente de 2 a 1 NO baja la unidad que ya ingresó en 2", async () => {
    const c = await cliente(2);
    const unidad = await unidadMaterializada(2);

    const nivelContratado = await como(ADMIN, async () => {
      const { rows } = await db.query<{ custody_level: number }>(
        `select * from public.client_set_custody_level($1, $2::smallint, $3, $4::timestamptz)`,
        [c.id, 1, "El cliente rescindió la custodia digital reforzada", c.updatedAt],
      );
      return Number(rows[0].custody_level);
    });

    // El CONTRATO bajó…
    expect(nivelContratado).toBe(1);
    // …y el RÉGIMEN DE LA MERCADERÍA no se movió.
    expect(await nivelUnidad(unidad)).toBe(2);
  });

  it("tampoco las degrada en masa: varias unidades, todas intactas", async () => {
    const c = await cliente(2);
    const unidades = [
      await unidadMaterializada(2),
      await unidadMaterializada(2),
      await unidadMaterializada(1),
    ];

    await como(ADMIN, () =>
      db.query(`select public.client_set_custody_level($1, 1::smallint, $2, $3::timestamptz)`,
        [c.id, "Baja del servicio", c.updatedAt]),
    );

    expect(await nivelUnidad(unidades[0])).toBe(2);
    expect(await nivelUnidad(unidades[1])).toBe(2);
    // La que entró en 1 tampoco se toca: la RPC no escribe esta tabla.
    expect(await nivelUnidad(unidades[2])).toBe(1);
  });

  it("subir el cliente de 1 a 2 tampoco reescribe lo ya materializado", async () => {
    const c = await cliente(1);
    const unidad = await unidadMaterializada(1);

    await como(ADMIN, () =>
      db.query(`select public.client_set_custody_level($1, 2::smallint, null, $2::timestamptz)`,
        [c.id, c.updatedAt]),
    );

    // Contratar no reabre casos sobre bienes que ya entraron sin aparato.
    expect(await nivelUnidad(unidad)).toBe(1);
  });
});

describe("T-CLI-A3-01 · la puerta de la perilla", () => {
  it("sin el permiso, la RPC deniega", async () => {
    const c = await cliente(1);
    const msg = await como(SIN_PERMISO, () =>
      fallo(() =>
        db.query(`select public.client_set_custody_level($1, 2::smallint, null, $2::timestamptz)`,
          [c.id, c.updatedAt])),
    );
    expect(msg).toMatch(/CLIENT_DENEGADO/);
  });

  it("la BAJA exige motivo; la suba no", async () => {
    const baja = await cliente(2);
    const suba = await cliente(1);

    const conMotivoVacio = await como(ADMIN, () =>
      fallo(() =>
        db.query(`select public.client_set_custody_level($1, 1::smallint, $2, $3::timestamptz)`,
          [baja.id, "   ", baja.updatedAt])),
    );
    expect(conMotivoVacio).toMatch(/CLIENT_MOTIVO_REQUERIDO/);

    const subiendo = await como(ADMIN, () =>
      fallo(() =>
        db.query(`select public.client_set_custody_level($1, 2::smallint, null, $2::timestamptz)`,
          [suba.id, suba.updatedAt])),
    );
    expect(subiendo).toBeNull();
  });

  it("sin token de versión no se puede pisar una contratación", async () => {
    const c = await cliente(1);
    const msg = await como(ADMIN, () =>
      fallo(() =>
        db.query(`select public.client_set_custody_level($1, 2::smallint, null, null)`, [c.id])),
    );
    expect(msg).toMatch(/CLIENT_CONFLICTO_CONCURRENTE/);
  });

  it("repetir el mismo nivel es idempotente y no fabrica un evento", async () => {
    const c = await cliente(2);
    const antes = await eventos(c.id);
    await como(ADMIN, () =>
      db.query(`select public.client_set_custody_level($1, 2::smallint, null, $2::timestamptz)`,
        [c.id, c.updatedAt]),
    );
    expect(await eventos(c.id)).toBe(antes);
  });

  it("la baja deja el motivo asentado en la auditoría", async () => {
    const c = await cliente(2);
    await como(ADMIN, () =>
      db.query(`select public.client_set_custody_level($1, 1::smallint, $2, $3::timestamptz)`,
        [c.id, "Rescisión pedida por el cliente", c.updatedAt]),
    );
    const { rows } = await db.query<{ motivo: string; before: unknown; after: unknown }>(
      `select motivo, before, after from public.client_events
        where client_id = $1 order by ts desc, id desc limit 1`, [c.id]);
    expect(rows[0].motivo).toBe("Rescisión pedida por el cliente");
    expect(rows[0].before).toMatchObject({ custody_level: 2 });
    expect(rows[0].after).toMatchObject({ custody_level: 1 });
  });
});
