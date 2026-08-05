/**
 * T-N1B-05 · confirm_reception v2 — materialización por identidad canónica.
 *
 * Discriminantes permanentes:
 *   · el find-or-create fusiona por (client_id, sku, position): dos
 *     recepciones del MISMO cliente con client_name escrito distinto van al
 *     MISMO ítem (el mutante «match por client_name» separa y pone esto en
 *     rojo), y dos clientes HOMÓNIMOS jamás se fusionan;
 *   · recepción sin client_id ⇒ fail-closed, sin efectos parciales;
 *   · el ítem creado hereda client_id y su BU llega por la PROYECCIÓN (0219),
 *     no por código duplicado en la RPC;
 *   · cuarentena y guardas de autorización idénticas a v1;
 *   · concurrencia: dos confirmaciones que crearían la misma identidad no
 *     duplican — la segunda falla cerrada por la unicidad canónica.
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { Client } from "pg";
import { connectGuarded } from "./harness/cluster";
import { emitSentinelWhenGreen } from "./harness/sentinel";

let client: Client;

beforeAll(async () => {
  client = await connectGuarded(inject("dbUrl"));
});

afterAll(async () => {
  await client?.end();
});

async function withRollback<T>(fn: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

async function asAdmin(c: Client, tag: string): Promise<void> {
  const { rows } = await c.query<{ id: string }>(
    `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
    [`__n1b5_${tag}__@test.local`],
  );
  // `handle_new_user` (0001) ya creó el profile al insertar el usuario:
  // sólo se eleva el rol de la sesión simulada.
  await c.query(`update public.profiles set role = 'admin' where id = $1`, [rows[0].id]);
  await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [rows[0].id]);
}

async function seedClient(c: Client, tag: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `insert into public.clients (razon, cuit) values ($1, $2) returning id`,
    [`__N1B5_${tag}__`, `N1B5-${tag}`],
  );
  return rows[0].id;
}

async function seedReception(
  c: Client,
  opts: {
    clientId: string | null;
    clientName: string;
    bu: "ANMAT" | "GENERAL";
    sku: string;
    qty: number;
    quarantine?: boolean;
  },
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `insert into public.receptions (client_name, client_id, business_unit, status, requires_quarantine)
     values ($1,$2,$3,'pendiente',$4) returning id`,
    [opts.clientName, opts.clientId, opts.bu, opts.quarantine ?? false],
  );
  const receptionId = rows[0].id;
  await c.query(
    `insert into public.reception_items
       (reception_id, business_unit, sku, description, quantity, lot_number, expiration_date)
     values ($1,$2,$3,'línea N1B5',$4,'L-N1B5','2030-06-01')`,
    [receptionId, opts.bu, opts.sku, opts.qty],
  );
  return receptionId;
}

describe("T-N1B-05 · confirm_reception canónico", () => {
  emitSentinelWhenGreen("P3_N1B_CONFIRM_RECEPTION_CANONICAL_VERIFIED");

  it("confirmar crea el ítem con client_id y la BU llega por PROYECCIÓN", async () => {
    await withRollback(async () => {
      await asAdmin(client, "crea");
      const c = await seedClient(client, "CREA");
      const rec = await seedReception(client, {
        clientId: c, clientName: "__N1B5_CREA__", bu: "GENERAL", sku: "__N1B5_SKU_C__", qty: 7,
      });
      await client.query(`select public.confirm_reception($1)`, [rec]);
      const { rows } = await client.query<{
        client_id: string;
        client_name: string;
        business_unit: string;
        stock_available: string;
      }>(
        `select client_id, client_name, business_unit::text, stock_available::text
           from public.inventory_items where sku = '__N1B5_SKU_C__'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].client_id).toBe(c);
      expect(rows[0].client_name).toBe("__N1B5_CREA__"); // descriptivo, conservado
      // La BU del ítem NO la escribió la RPC: la proyectó el trigger de 0219
      // al vincularse reception_items.inventory_item_id.
      expect(rows[0].business_unit).toBe("GENERAL");
      expect(rows[0].stock_available).toBe("7.000");
    });
  });

  it("fail-closed: recepción sin client_id no confirma y no deja efectos parciales", async () => {
    await withRollback(async () => {
      await asAdmin(client, "sinid");
      const rec = await seedReception(client, {
        clientId: null, clientName: "__N1B5_SINID__", bu: "GENERAL",
        sku: "__N1B5_SKU_S__", qty: 3,
      });
      await expect(client.query(`select public.confirm_reception($1)`, [rec])).rejects.toThrow(
        /sin identidad canónica/,
      );
      // La transacción quedó abortada por el raise: verificar tras reabrir.
      await client.query("rollback");
      await client.query("begin");
      const { rows } = await client.query(
        `select 1 from public.inventory_items where sku = '__N1B5_SKU_S__'`,
      );
      expect(rows).toHaveLength(0);
      const { rows: recRows } = await client.query<{ status: string }>(
        `select status::text from public.receptions where client_name = '__N1B5_SINID__'`,
      );
      expect(recRows).toHaveLength(0); // el rollback también revirtió el seed: cero residuo
    });
  });

  it("MERGE canónico: el mismo cliente con client_name escrito distinto acumula en el MISMO ítem", async () => {
    await withRollback(async () => {
      await asAdmin(client, "merge");
      const c = await seedClient(client, "MERGE");
      const rec1 = await seedReception(client, {
        clientId: c, clientName: "Alfa", bu: "GENERAL", sku: "__N1B5_SKU_M__", qty: 4,
      });
      await client.query(`select public.confirm_reception($1)`, [rec1]);
      // Variante de tipeo del MISMO cliente: la identidad es la clave, no el texto.
      const rec2 = await seedReception(client, {
        clientId: c, clientName: "Alfa S.A.", bu: "GENERAL", sku: "__N1B5_SKU_M__", qty: 6,
      });
      await client.query(`select public.confirm_reception($1)`, [rec2]);

      const { rows } = await client.query<{ stock_available: string }>(
        `select stock_available::text from public.inventory_items where sku = '__N1B5_SKU_M__'`,
      );
      expect(rows).toHaveLength(1); // UN ítem, no dos
      expect(rows[0].stock_available).toBe("10.000");
    });
  });

  it("HOMÓNIMOS: dos clientes distintos con el mismo client_name jamás se fusionan", async () => {
    await withRollback(async () => {
      await asAdmin(client, "homo");
      const a = await seedClient(client, "HOMO_A");
      const b = await seedClient(client, "HOMO_B");
      const rec1 = await seedReception(client, {
        clientId: a, clientName: "__N1B5_MISMO__", bu: "GENERAL", sku: "__N1B5_SKU_H__", qty: 2,
      });
      const rec2 = await seedReception(client, {
        clientId: b, clientName: "__N1B5_MISMO__", bu: "GENERAL", sku: "__N1B5_SKU_H__", qty: 3,
      });
      await client.query(`select public.confirm_reception($1)`, [rec1]);
      await client.query(`select public.confirm_reception($1)`, [rec2]);
      const { rows } = await client.query<{ client_id: string; stock_available: string }>(
        `select client_id, stock_available::text from public.inventory_items
          where sku = '__N1B5_SKU_H__' order by stock_available`,
      );
      expect(rows).toHaveLength(2); // DOS ítems: la identidad separa lo que el nombre confunde
      expect(new Set(rows.map((r) => r.client_id))).toEqual(new Set([a, b]));
    });
  });

  it("cuarentena intacta: requires_quarantine=true ingresa a stock_reserved", async () => {
    await withRollback(async () => {
      await asAdmin(client, "cuar");
      const c = await seedClient(client, "CUAR");
      const rec = await seedReception(client, {
        clientId: c, clientName: "__N1B5_CUAR__", bu: "ANMAT",
        sku: "__N1B5_SKU_Q__", qty: 5, quarantine: true,
      });
      await client.query(`select public.confirm_reception($1)`, [rec]);
      const { rows } = await client.query<{ available: string; reserved: string }>(
        `select stock_available::text as available, stock_reserved::text as reserved
           from public.inventory_items where sku = '__N1B5_SKU_Q__'`,
      );
      expect(rows[0]).toEqual({ available: "0.000", reserved: "5.000" });
      const { rows: st } = await client.query<{ status: string }>(
        `select status::text from public.receptions where id = $1`,
        [rec],
      );
      expect(st[0].status).toBe("cuarentena");
    });
  });

  it("la autorización se evalúa ANTES que la identidad (sin sesión ⇒ 'no autorizado')", async () => {
    await withRollback(async () => {
      const rec = await seedReception(client, {
        clientId: null, clientName: "__N1B5_NOAUTH__", bu: "GENERAL",
        sku: "__N1B5_SKU_N__", qty: 1,
      });
      await expect(client.query(`select public.confirm_reception($1)`, [rec])).rejects.toThrow(
        /no autorizado/i,
      );
    });
  });

  it("CONCURRENCIA: dos confirmaciones que crearían la MISMA identidad no duplican — la segunda falla cerrada", async () => {
    const second = await connectGuarded(inject("dbUrl"));
    try {
      await client.query("begin");
      await asAdmin(client, "conc-seed");
      const c = await seedClient(client, "CONC");
      const rec1 = await seedReception(client, {
        clientId: c, clientName: "__N1B5_CONC__", bu: "GENERAL", sku: "__N1B5_SKU_CC__", qty: 1,
      });
      const rec2 = await seedReception(client, {
        clientId: c, clientName: "__N1B5_CONC__", bu: "GENERAL", sku: "__N1B5_SKU_CC__", qty: 1,
      });
      await client.query("commit");

      // A confirma y retiene la transacción: el ítem nuevo aún no es visible.
      await client.query("begin");
      await asAdmin(client, "conc-a");
      await client.query(`select public.confirm_reception($1)`, [rec1]);

      // B no ve el ítem de A (find devuelve nada), intenta CREAR la misma
      // identidad y queda esperando el índice único canónico.
      await second.query("begin");
      await asAdmin(second, "conc-b");
      const bPromise = second.query(`select public.confirm_reception($1)`, [rec2]).then(
        () => null,
        (e: unknown) => e as Error,
      );
      await new Promise((r) => setTimeout(r, 250));
      await client.query("commit");
      const bErr = await bPromise;
      await second.query("rollback").catch(() => undefined);

      // Falla CERRADA por unicidad canónica: jamás un duplicado silencioso.
      expect(bErr).not.toBeNull();
      expect(bErr!.message).toMatch(/inventory_items_canonical_identity_uk|duplicate key/i);
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from public.inventory_items where sku = '__N1B5_SKU_CC__'`,
      );
      expect(rows[0].n).toBe("1");
    } finally {
      await second.end();
      await client.query("rollback").catch(() => undefined);
      // Lo committeado queda namespaced en la base efímera; las recepciones
      // confirmadas generaron ledger inmutable que NO debe borrarse (G10).
    }
  });
});
