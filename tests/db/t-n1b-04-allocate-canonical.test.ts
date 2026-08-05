/**
 * T-N1B-04 · allocate_order v2 — identidad canónica + business_unit (0220).
 *
 * Discriminantes permanentes (matan a los mutantes de reintroducción):
 *   · client_name DUPLICADO entre clientes distintos: la reserva del pedido de
 *     A no puede tocar stock de B aunque compartan nombre (el mutante
 *     «asignación por client_name» pone este caso en rojo);
 *   · pedido sin client_id ⇒ fail-closed;
 *   · FEFO intacto (vencimiento más próximo primero);
 *   · pedido con business_unit declarada: SOLO stock de esa línea; el stock
 *     sin clasificar (NULL) NO es elegible; la reserva registra la BU
 *     (el mutante «pérdida de business_unit» pone esto en rojo);
 *   · idempotencia y reserva parcial idénticas a v1;
 *   · concurrencia: dos allocate_order sobre el mismo stock no sobrevenden.
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

/** Sesión admin simulada, LOCAL a la transacción actual de `c`. */
async function asAdmin(c: Client, tag: string): Promise<void> {
  const { rows } = await c.query<{ id: string }>(
    `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
    [`__n1b4_${tag}__@test.local`],
  );
  // `handle_new_user` (0001) ya creó el profile al insertar el usuario:
  // sólo se eleva el rol de la sesión simulada.
  await c.query(`update public.profiles set role = 'admin' where id = $1`, [rows[0].id]);
  await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [rows[0].id]);
}

async function seedClient(c: Client, tag: string, razon = `__N1B4_${Math.random()}`): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `insert into public.clients (razon, cuit) values ($1, $2) returning id`,
    [razon, `N1B4-${tag}`],
  );
  return rows[0].id;
}

async function seedItem(
  c: Client,
  opts: {
    clientId: string;
    clientName: string;
    sku: string;
    stock: number;
    positionId?: string | null;
    bu?: "ANMAT" | "GENERAL" | "CORPORATE" | null;
    lot?: { number: string; expiration: string };
    /**
     * B-02: id EXPLÍCITO para que el desempate FEFO (`order by fefo_date, ii.id`)
     * sea reproducible corrida a corrida. Sin fijarlo, un empate de vencimiento
     * se ordenaría por uuids aleatorios y la prueba dependería del azar.
     */
    id?: string;
  },
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `insert into public.inventory_items
       (id, sku, description, client_name, client_id, position_id, stock_available, business_unit)
     values (coalesce($7::uuid, gen_random_uuid()),$1,'fixture N1B4',$2,$3,$4,$5,$6) returning id`,
    [opts.sku, opts.clientName, opts.clientId, opts.positionId ?? null, opts.stock, opts.bu ?? null, opts.id ?? null],
  );
  const itemId = rows[0].id;
  if (opts.lot) {
    await c.query(
      `insert into public.inventory_lots (inventory_item_id, lot_number, expiration_date, quantity)
       values ($1,$2,$3,$4)`,
      [itemId, opts.lot.number, opts.lot.expiration, opts.stock],
    );
  }
  return itemId;
}

async function seedOrder(
  c: Client,
  opts: { clientId: string | null; clientName: string; sku: string; qty: number; bu?: string | null },
): Promise<string> {
  const { rows } = await c.query<{ id: string }>(
    `insert into public.logistics_orders (client_name, client_id, business_unit, status)
     values ($1,$2,$3,'pendiente') returning id`,
    [opts.clientName, opts.clientId, opts.bu ?? null],
  );
  const orderId = rows[0].id;
  await c.query(
    `insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
     values ($1,$2,'línea N1B4',$3)`,
    [orderId, opts.sku, opts.qty],
  );
  return orderId;
}

async function positions(n: number): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `select id from public.warehouse_positions order by id limit $1`,
    [n],
  );
  expect(rows.length, `precondición: se necesitan ${n} posiciones (0023)`).toBe(n);
  return rows.map((r) => r.id);
}

async function itemState(c: Client, id: string): Promise<{ available: string; reserved: string }> {
  const { rows } = await c.query<{ available: string; reserved: string }>(
    `select stock_available::text as available, stock_reserved::text as reserved
       from public.inventory_items where id = $1`,
    [id],
  );
  return rows[0];
}

describe("T-N1B-04 · allocate_order canónico", () => {
  emitSentinelWhenGreen("P3_N1B_ALLOCATE_CANONICAL_VERIFIED");

  it.each(["correcto-primero", "homónimo-primero"] as const)(
    "DISCRIMINANTE: si sólo el homónimo incorrecto tiene stock (%s), jamás se reserva",
    async (insertionOrder) => {
      await withRollback(async () => {
        const tag = insertionOrder === "correcto-primero" ? "CF" : "HF";
        await asAdmin(client, `dup_${tag}`);
        const [p1, p2] = await positions(2);
        const sharedName = `__N1B4_HOMONIMO_${tag}__`;
        const sku = `__N1B4_SKU_DUP_${tag}__`;
        const clientA = await seedClient(client, `A_${tag}`, sharedName);
        const clientB = await seedClient(client, `B_${tag}`, sharedName);
        let itemA = "";
        let itemB = "";

        const seedCorrect = async () => {
          itemA = await seedItem(client, {
            clientId: clientA,
            clientName: sharedName,
            sku,
            stock: 0,
            positionId: p1,
          });
        };
        const seedWrongHomonym = async () => {
          itemB = await seedItem(client, {
            clientId: clientB,
            clientName: sharedName,
            sku,
            stock: 10,
            positionId: p2,
          });
        };
        if (insertionOrder === "correcto-primero") {
          await seedCorrect();
          await seedWrongHomonym();
        } else {
          await seedWrongHomonym();
          await seedCorrect();
        }

        const order = await seedOrder(client, {
          clientId: clientA,
          clientName: sharedName,
          sku,
          qty: 5,
        });

        await client.query(`select public.allocate_order($1)`, [order]);

        // A no tiene disponibilidad. La abundancia de B no es elegible y el
        // resultado no depende de qué homónimo se insertó primero.
        expect(await itemState(client, itemA)).toEqual({
          available: "0.000",
          reserved: "0.000",
        });
        expect(await itemState(client, itemB)).toEqual({
          available: "10.000",
          reserved: "0.000",
        });
        const { rows: allocations } = await client.query<{ inventory_item_id: string }>(
          `select sa.inventory_item_id
             from public.stock_allocations sa
             join public.logistics_order_items li on li.id = sa.order_item_id
            where li.order_id = $1`,
          [order],
        );
        expect(allocations).toHaveLength(0);

        const { rows: state } = await client.query<{
          order_status: string;
          line_status: string;
        }>(
          `select o.status::text as order_status, li.status::text as line_status
             from public.logistics_orders o
             join public.logistics_order_items li on li.order_id = o.id
            where o.id = $1`,
          [order],
        );
        expect(state).toEqual([{ order_status: "pendiente", line_status: "pendiente" }]);
      });
    },
  );

  it("fail-closed: un pedido sin client_id no reserva nada", async () => {
    await withRollback(async () => {
      await asAdmin(client, "noid");
      const c = await seedClient(client, "NOID");
      await seedItem(client, {
        clientId: c, clientName: "__N1B4_NOID__", sku: "__N1B4_SKU_NOID__", stock: 10,
      });
      const order = await seedOrder(client, {
        clientId: null, clientName: "__N1B4_NOID__", sku: "__N1B4_SKU_NOID__", qty: 1,
      });
      await expect(client.query(`select public.allocate_order($1)`, [order])).rejects.toThrow(
        /sin identidad canónica/,
      );
    });
  });

  it("la autorización sigue evaluándose ANTES que la identidad (orden de guardas intacto)", async () => {
    await withRollback(async () => {
      const c = await seedClient(client, "AUTH");
      const order = await seedOrder(client, {
        clientId: null, clientName: "__N1B4_AUTH__", sku: "__N1B4_SKU_AUTH__", qty: 1,
      });
      void c;
      // Sin sesión: 'no autorizado', NUNCA el error de identidad.
      await expect(client.query(`select public.allocate_order($1)`, [order])).rejects.toThrow(
        /no autorizado/i,
      );
    });
  });

  it("B-03 · FEFO determinista con fixture NO degenerado: el orden por UUID contradice al orden por vencimiento", async () => {
    // Hallazgo B-03 del Guardian: en la versión anterior los UUID ascendían en
    // el MISMO orden que FEFO, así que `order by ii.id` a secas dejaba la
    // suite verde. Acá la relación UUID ↔ vencimiento es ADVERSARIAL:
    //
    //   id …0001 → D · SIN lote        (fefo_date NULL ⇒ FEFO lo toca ÚLTIMO)
    //   id …0002 → B · 2028-06-15      (empate con C; B gana por id menor)
    //   id …0003 → C · 2028-06-15
    //   id …0004 → A · 2027-03-01      (vence PRIMERO con el id MÁS ALTO)
    //
    // Secuencia FEFO esperada: A → B → C → D. Cualquier orden por id (asc o
    // desc) o un `nulls first` produce OTRA asignación observable:
    //   · `order by ii.id`      ⇒ empieza por D (sin lote) — distinto;
    //   · `order by ii.id desc` ⇒ tras A seguiría C antes que B — la primera
    //     orden corta DENTRO del empate 2028 y lo delata;
    //   · `nulls first`         ⇒ D primero — distinto.
    await withRollback(async () => {
      await asAdmin(client, "fefo");
      const [p1, p2, p3, p4] = await positions(4);
      const c = await seedClient(client, "FEFO");
      const ID_D = "aaaaaaaa-0000-4000-8000-000000000001"; // sin lote · id MÁS BAJO
      const ID_B = "aaaaaaaa-0000-4000-8000-000000000002"; // 2028 · gana el empate
      const ID_C = "aaaaaaaa-0000-4000-8000-000000000003"; // 2028 · pierde el empate
      const ID_A = "aaaaaaaa-0000-4000-8000-000000000004"; // 2027 · id MÁS ALTO

      await seedItem(client, {
        id: ID_D, clientId: c, clientName: "__N1B4_FEFO__", sku: "__N1B4_SKU_FEFO__",
        stock: 2, positionId: p1,
      });
      await seedItem(client, {
        id: ID_B, clientId: c, clientName: "__N1B4_FEFO__", sku: "__N1B4_SKU_FEFO__",
        stock: 3, positionId: p2, lot: { number: "L-B-2028", expiration: "2028-06-15" },
      });
      await seedItem(client, {
        id: ID_C, clientId: c, clientName: "__N1B4_FEFO__", sku: "__N1B4_SKU_FEFO__",
        stock: 2, positionId: p3, lot: { number: "L-C-2028", expiration: "2028-06-15" },
      });
      await seedItem(client, {
        id: ID_A, clientId: c, clientName: "__N1B4_FEFO__", sku: "__N1B4_SKU_FEFO__",
        stock: 2, positionId: p4, lot: { number: "L-A-2027", expiration: "2027-03-01" },
      });

      // ── Fase 1: qty 4 ⇒ FEFO asigna A(2) y B(2). La frontera cae DENTRO
      // del empate 2028: B queda parcial y C intacto — un desempate por id
      // invertido asignaría C acá y se pondría en rojo.
      const orden1 = await seedOrder(client, {
        clientId: c, clientName: "__N1B4_FEFO__", sku: "__N1B4_SKU_FEFO__", qty: 4,
      });
      await client.query(`select public.allocate_order($1)`, [orden1]);

      expect(await itemState(client, ID_A)).toEqual({ available: "0.000", reserved: "2.000" });
      expect(await itemState(client, ID_B)).toEqual({ available: "1.000", reserved: "2.000" });
      expect(await itemState(client, ID_C)).toEqual({ available: "2.000", reserved: "0.000" });
      expect(await itemState(client, ID_D)).toEqual({ available: "2.000", reserved: "0.000" });

      const { rows: r1 } = await client.query<{
        inventory_item_id: string; lot_number: string | null; quantity: string;
      }>(
        `select sa.inventory_item_id, sa.lot_number, sa.quantity::text as quantity
           from public.stock_allocations sa
           join public.logistics_order_items li on li.id = sa.order_item_id
          where li.order_id = $1
          order by sa.inventory_item_id`,
        [orden1],
      );
      expect(r1).toEqual([
        { inventory_item_id: ID_B, lot_number: "L-B-2028", quantity: "2.000" },
        { inventory_item_id: ID_A, lot_number: "L-A-2027", quantity: "2.000" },
      ]);

      // ── Fase 2: qty 4 ⇒ FEFO continúa B(1 remanente), C(2) y recién
      // entonces D(1) — `nulls last` ejercitado de verdad.
      const orden2 = await seedOrder(client, {
        clientId: c, clientName: "__N1B4_FEFO__", sku: "__N1B4_SKU_FEFO__", qty: 4,
      });
      await client.query(`select public.allocate_order($1)`, [orden2]);

      expect(await itemState(client, ID_A)).toEqual({ available: "0.000", reserved: "2.000" });
      expect(await itemState(client, ID_B)).toEqual({ available: "0.000", reserved: "3.000" });
      expect(await itemState(client, ID_C)).toEqual({ available: "0.000", reserved: "2.000" });
      expect(await itemState(client, ID_D)).toEqual({ available: "1.000", reserved: "1.000" });

      const { rows: r2 } = await client.query<{
        inventory_item_id: string; lot_number: string | null; quantity: string;
      }>(
        `select sa.inventory_item_id, sa.lot_number, sa.quantity::text as quantity
           from public.stock_allocations sa
           join public.logistics_order_items li on li.id = sa.order_item_id
          where li.order_id = $1
          order by sa.inventory_item_id`,
        [orden2],
      );
      expect(r2).toEqual([
        { inventory_item_id: ID_D, lot_number: null, quantity: "1.000" },
        { inventory_item_id: ID_B, lot_number: "L-B-2028", quantity: "1.000" },
        { inventory_item_id: ID_C, lot_number: "L-C-2028", quantity: "2.000" },
      ]);

      // Ambas líneas cubiertas al 100 %: estado final sin ambigüedad.
      const { rows: lines } = await client.query<{ status: string }>(
        `select li.status::text from public.logistics_order_items li
          where li.order_id in ($1, $2) order by li.created_at`,
        [orden1, orden2],
      );
      expect(lines).toEqual([{ status: "reservado" }, { status: "reservado" }]);
    });
  });

  it("BU declarada: sólo asigna stock de ESA línea; ANMAT y sin-clasificar quedan intactos; la reserva registra la BU", async () => {
    await withRollback(async () => {
      await asAdmin(client, "bu");
      const [p1, p2, p3] = await positions(3);
      const c = await seedClient(client, "BU");
      const general = await seedItem(client, {
        clientId: c, clientName: "__N1B4_BU__", sku: "__N1B4_SKU_BU__",
        stock: 5, positionId: p1, bu: "GENERAL",
      });
      const anmat = await seedItem(client, {
        clientId: c, clientName: "__N1B4_BU__", sku: "__N1B4_SKU_BU__",
        stock: 5, positionId: p2, bu: "ANMAT",
      });
      const sinClasificar = await seedItem(client, {
        clientId: c, clientName: "__N1B4_BU__", sku: "__N1B4_SKU_BU__",
        stock: 5, positionId: p3, bu: null,
      });
      const order = await seedOrder(client, {
        clientId: c, clientName: "__N1B4_BU__", sku: "__N1B4_SKU_BU__", qty: 12, bu: "GENERAL",
      });

      await client.query(`select public.allocate_order($1)`, [order]);

      // Sólo los 5 GENERAL. Asignar lo sin clasificar afirmaría una
      // clasificación que nadie hizo; asignar ANMAT cruzaría de línea.
      expect(await itemState(client, general)).toEqual({ available: "0.000", reserved: "5.000" });
      expect(await itemState(client, anmat)).toEqual({ available: "5.000", reserved: "0.000" });
      expect(await itemState(client, sinClasificar)).toEqual({
        available: "5.000",
        reserved: "0.000",
      });
      const { rows: line } = await client.query<{ status: string }>(
        `select status::text from public.logistics_order_items where order_id = $1`,
        [order],
      );
      expect(line[0].status).toBe("reservado_parcial");
      const { rows: allocs } = await client.query<{ business_unit: string }>(
        `select sa.business_unit::text
           from public.stock_allocations sa
           join public.logistics_order_items li on li.id = sa.order_item_id
          where li.order_id = $1`,
        [order],
      );
      expect(allocs).toEqual([{ business_unit: "GENERAL" }]);
    });
  });

  it("pedido SIN restricción de BU: elegibilidad legacy (incluye stock sin clasificar) y la foto registra NULL honesto", async () => {
    await withRollback(async () => {
      await asAdmin(client, "nobu");
      const c = await seedClient(client, "NOBU");
      await seedItem(client, {
        clientId: c, clientName: "__N1B4_NOBU__", sku: "__N1B4_SKU_NOBU__", stock: 3, bu: null,
      });
      const order = await seedOrder(client, {
        clientId: c, clientName: "__N1B4_NOBU__", sku: "__N1B4_SKU_NOBU__", qty: 3,
      });
      await client.query(`select public.allocate_order($1)`, [order]);
      const { rows } = await client.query<{ business_unit: string | null; quantity: string }>(
        `select sa.business_unit::text, sa.quantity::text as quantity
           from public.stock_allocations sa
           join public.logistics_order_items li on li.id = sa.order_item_id
          where li.order_id = $1`,
        [order],
      );
      expect(rows).toEqual([{ business_unit: null, quantity: "3.000" }]);
    });
  });

  it("idempotencia intacta: reejecutar allocate_order no duplica reservas", async () => {
    await withRollback(async () => {
      await asAdmin(client, "idem");
      const c = await seedClient(client, "IDEM");
      const item = await seedItem(client, {
        clientId: c, clientName: "__N1B4_IDEM__", sku: "__N1B4_SKU_IDEM__", stock: 10,
      });
      const order = await seedOrder(client, {
        clientId: c, clientName: "__N1B4_IDEM__", sku: "__N1B4_SKU_IDEM__", qty: 4,
      });
      await client.query(`select public.allocate_order($1)`, [order]);
      await client.query(`select public.allocate_order($1)`, [order]);
      expect(await itemState(client, item)).toEqual({ available: "6.000", reserved: "4.000" });
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from public.stock_allocations sa
           join public.logistics_order_items li on li.id = sa.order_item_id
          where li.order_id = $1 and sa.status = 'reservada'`,
        [order],
      );
      expect(rows[0].n).toBe("1");
    });
  });

  it("CONCURRENCIA: dos allocate_order simultáneos sobre el mismo stock no sobrevenden", async () => {
    const second = await connectGuarded(inject("dbUrl"));
    const cleanupIds: { clientId?: string } = {};
    try {
      // Datos COMMITTEADOS: la concurrencia real exige dos transacciones vivas.
      await client.query("begin");
      await asAdmin(client, "conc-seed");
      const c = await seedClient(client, "CONC");
      cleanupIds.clientId = c;
      const item = await seedItem(client, {
        clientId: c, clientName: "__N1B4_CONC__", sku: "__N1B4_SKU_CONC__", stock: 10,
      });
      const order1 = await seedOrder(client, {
        clientId: c, clientName: "__N1B4_CONC__", sku: "__N1B4_SKU_CONC__", qty: 8,
      });
      const order2 = await seedOrder(client, {
        clientId: c, clientName: "__N1B4_CONC__", sku: "__N1B4_SKU_CONC__", qty: 8,
      });
      await client.query("commit");

      // Sesión A reserva y RETIENE la transacción (locks FOR UPDATE tomados).
      await client.query("begin");
      await asAdmin(client, "conc-a");
      await client.query(`select public.allocate_order($1)`, [order1]);

      // Sesión B intenta reservar el MISMO stock: queda bloqueada en el lock.
      await second.query("begin");
      await asAdmin(second, "conc-b");
      const bPromise = second.query(`select public.allocate_order($1)`, [order2]);
      // A commitea; B despierta y sólo puede tomar el remanente.
      await new Promise((r) => setTimeout(r, 250));
      await client.query("commit");
      await bPromise;
      await second.query("commit");

      const state = await itemState(client, item);
      // 8 + 2: jamás 16. El total reservado NUNCA excede el stock físico.
      expect(state).toEqual({ available: "0.000", reserved: "10.000" });
      const { rows } = await client.query<{ total: string }>(
        `select coalesce(sum(sa.quantity),0)::text as total
           from public.stock_allocations sa
           join public.logistics_order_items li on li.id = sa.order_item_id
          where li.order_id in ($1,$2) and sa.status='reservada'`,
        [order1, order2],
      );
      expect(rows[0].total).toBe("10.000");
      const { rows: l2 } = await client.query<{ status: string }>(
        `select status::text from public.logistics_order_items where order_id = $1`,
        [order2],
      );
      expect(l2[0].status).toBe("reservado_parcial");
    } finally {
      await second.query("rollback").catch(() => undefined);
      await second.end();
      // Si algo falló a mitad de camino, el cliente principal puede haber
      // quedado en transacción: cerrarla antes de limpiar.
      await client.query("rollback").catch(() => undefined);
      // Limpieza de lo committeado (namespaced): allocations → orders → item → cliente.
      await client.query(
        `delete from public.stock_allocations where order_item_id in (
           select li.id from public.logistics_order_items li
             join public.logistics_orders lo on lo.id = li.order_id
            where lo.client_name = '__N1B4_CONC__')`,
      );
      await client.query(`delete from public.logistics_orders where client_name = '__N1B4_CONC__'`);
      await client.query(`delete from public.inventory_items where client_name = '__N1B4_CONC__'`);
      if (cleanupIds.clientId) {
        await client.query(`delete from public.clients where id = $1`, [cleanupIds.clientId]);
      }
    }
  });
});
