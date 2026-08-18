/**
 * T-C7-05 · «ELEVA, NUNCA DEGRADA» · MEDIDO CONTRA SQL REAL.
 *
 * 0252:72-74 declara la regla en un comentario:
 *
 *   «Sólo eleva. No existe la operación inversa: un cliente con nivel 2
 *    contratado no puede degradarse por recepción, porque eso dejaría bienes
 *    contratados fuera del aparato probatorio sin decisión escrita.»
 *
 * ─── POR QUÉ ESTE ARCHIVO EXISTE ─────────────────────────────────────────
 *
 * La comprobación previa de esa regla era ESTÁTICA: leía el .sql y afirmaba
 * que `custody_reforzada` no aparecía en ninguna rama descendente. Eso mide el
 * TEXTO, no el COMPORTAMIENTO — y el texto puede ser correcto mientras la
 * función compuesta hace otra cosa. Acá se ejecuta `custody_reception_level`
 * contra PostgreSQL con 0252 aplicada y se recorre su tabla de verdad entera.
 *
 * Va en el arnés de CUSTODIA y no en el vanilla porque 0252 sólo aplica donde
 * está su cadena: referencia `custody_integrity_cases`, `custody_events`,
 * `custody_chain_lock` y una decena más de objetos del cierre histórico. En
 * `tests/db` la migración no puede aplicarse, así que ahí la regla no es
 * medible contra SQL real; acá sí.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { actAsServer, uid } from "./harness/fixtures";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

/** Cliente con el nivel CONTRATADO indicado. */
async function cliente(nivel: 1 | 2): Promise<string> {
  await actAsServer(db);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.clients (razon, cuit, custody_level) values ($1, $2, $3) returning id`,
    [uid("CLI"), `30${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}`, nivel],
  );
  return rows[0].id;
}

/** Recepción de ese cliente, con la casilla en el estado indicado. */
async function recepcion(clientId: string, reforzada: boolean): Promise<string> {
  await actAsServer(db);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.receptions (public_id, client_name, client_id, status, received_at, custody_reforzada)
     values ($1, 'DEPOSITANTE', $2, 'recibida', now(), $3) returning id`,
    [uid("REC"), clientId, reforzada],
  );
  return rows[0].id;
}

/** El nivel EFECTIVO que 0252 resuelve para esa recepción. */
async function nivelEfectivo(receptionId: string): Promise<number> {
  await actAsServer(db);
  const { rows } = await db.query<{ n: number }>(
    `select public.custody_reception_level($1) as n`,
    [receptionId],
  );
  return Number(rows[0].n);
}

describe("T-C7-05 · la casilla de la recepción ELEVA y NUNCA DEGRADA", () => {
  /**
   * La tabla de verdad COMPLETA. Las cuatro combinaciones, no dos: la regla se
   * afirma sobre el cruce, y probar sólo la que eleva dejaría sin medir
   * justamente la que no debe degradar.
   */
  it("nivel 1 + casilla marcada ⇒ ELEVA a 2", async () => {
    const c = await cliente(1);
    expect(await nivelEfectivo(await recepcion(c, true))).toBe(2);
  });

  it("nivel 1 + casilla sin marcar ⇒ queda en 1", async () => {
    const c = await cliente(1);
    expect(await nivelEfectivo(await recepcion(c, false))).toBe(1);
  });

  it("⚠ nivel 2 + casilla SIN marcar ⇒ SIGUE EN 2 · no degrada", async () => {
    // El corazón de la regla: no marcar la casilla NO es pedir nivel 1. Un
    // cliente con custodia contratada entra por el aparato completo aunque el
    // operario de recepción no toque nada.
    const c = await cliente(2);
    expect(await nivelEfectivo(await recepcion(c, false))).toBe(2);
  });

  it("nivel 2 + casilla marcada ⇒ 2 · elevar lo ya elevado es inocuo", async () => {
    const c = await cliente(2);
    expect(await nivelEfectivo(await recepcion(c, true))).toBe(2);
  });

  /**
   * No existe la operación inversa: la casilla es booleana y su rama `true`
   * devuelve 2 fijo. Ningún valor de la casilla puede producir un resultado
   * MENOR que el nivel contratado del cliente. Se mide sobre las dos ramas.
   */
  it("ningún valor de la casilla devuelve menos que el nivel contratado", async () => {
    for (const nivel of [1, 2] as const) {
      const c = await cliente(nivel);
      for (const marcada of [false, true]) {
        const efectivo = await nivelEfectivo(await recepcion(c, marcada));
        expect(efectivo, `cliente nivel ${nivel}, casilla ${marcada}`).toBeGreaterThanOrEqual(nivel);
      }
    }
  });

  /**
   * Y el caso que la función tiene que resolver sin romperse: una recepción sin
   * cliente. `coalesce(c.custody_level, 1)` la manda a nivel 1 —el universal—,
   * no a null ni a 2.
   */
  it("recepción sin cliente ⇒ 1 · el universal, no un nulo", async () => {
    await actAsServer(db);
    const { rows } = await db.query<{ id: string }>(
      `insert into public.receptions (public_id, client_name, client_id, status, received_at, custody_reforzada)
       values ($1, 'SIN CLIENTE', null, 'recibida', now(), false) returning id`,
      [uid("REC")],
    );
    expect(await nivelEfectivo(rows[0].id)).toBe(1);
  });
});
