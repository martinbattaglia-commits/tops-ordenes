/**
 * T-FB-03 · R-1 · La otra mitad: pedidos.
 *
 * 0247 instala `nexus_allocation_site_guard` y el default de sede por
 * identidad sobre `logistics_orders`, y hasta este archivo ningún test
 * insertaba un pedido ni ejecutaba una reserva: la lógica nueva de ese cambio
 * nunca se ejecutaba. La única mención era un chequeo de information_schema,
 * que prueba que la columna existe, no que funcione.
 *
 * Un pedido no tiene sede derivable en su alta —sus ítems son sku y cantidad,
 * sin posición— así que se materializa en la PRIMERA reserva, cuando se elige
 * el stock concreto.
 *
 * DOS CAMINOS QUE EL PRODUCTO IMPONE, y que este archivo respeta en vez de
 * esquivar:
 *  · Las reservas se crean por RPC, nunca por INSERT: 0030:166 declara sus
 *    policies PROVISIONALES y 0031:38-40 las elimina para dejar
 *    `stock_allocations` en lockdown solo-RPC. Un test que insertara a mano
 *    mediría un camino que el producto no usa y que la base rechaza.
 *  · Un encargado NO crea pedidos: 0246 hace que su `current_role()` sea
 *    'cliente', y la policy de insert de 0030:141 exige rol de staff. Su
 *    frontera en pedidos es de lectura acotada por sede.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { connectGuarded, startEphemeralCluster, type EphemeralCluster } from "../db/harness/cluster";
import {
  ADMIN,
  BOOTSTRAP,
  FASE_B_FORWARDS,
  JORGE,
  JUAN,
  aplicar,
  aplicarCadena,
  cadenaHasta,
  comoUsuario,
  posicionDe,
  seedCanonico,
  seedJerarquiaMagaldi,
  verificarOmisiones,
} from "./harness/chain";

let cluster: EphemeralCluster;
let db: Client;
let clientId: string;
let omitidas: Array<{ file: string; error: string }> = [];

async function inventarioEn(position: string, sku: string): Promise<void> {
  await db.query(
    `insert into public.inventory_items
       (client_id, client_name, sku, description, stock_available, position_id, active)
     values ($1,'Cliente Pedidos Harness',$2,'Stock de harness',10,$3,true)`,
    [clientId, sku, position],
  );
}

beforeAll(async () => {
  cluster = await startEphemeralCluster();
  try {
    db = await connectGuarded(cluster.url);
    await db.query(readFileSync(BOOTSTRAP, "utf8"));
    const res = await aplicarCadena(db, cadenaHasta(245));
    omitidas = res.omitidas;
    await seedCanonico(db);
    await seedJerarquiaMagaldi(db);
    for (const f of FASE_B_FORWARDS) await aplicar(db, f);

    const cli = await db.query<{ id: string }>(
      `insert into public.clients (razon, cuit, activo)
       values ('Cliente Pedidos Harness','30711111111',true)
       on conflict (cuit) do update set razon = excluded.razon
       returning id`,
    );
    clientId = cli.rows[0].id;

    await inventarioEn(await posicionDe(db, JORGE.warehouse), "SKU-LUJ");
    await inventarioEn(await posicionDe(db, JUAN.warehouse), "SKU-MAG");
  } catch (e) {
    await cluster.teardown().catch(() => {});
    throw e;
  }
}, 300_000);

afterAll(async () => {
  await db?.end().catch(() => {});
  await cluster?.teardown().catch(() => {});
});

/** Alta de pedido tal como la hace el producto: SIN warehouse_id. */
async function crearPedido(sku: string): Promise<string> {
  const o = await db.query<{ id: string }>(
    `insert into public.logistics_orders (client_id, client_name, status, created_by)
     values ($1,'Cliente Pedidos Harness','pendiente',$2)
     returning id`,
    [clientId, ADMIN.id],
  );
  await db.query(
    `insert into public.logistics_order_items
       (order_id, sku, description, quantity_requested)
     values ($1,$2,'Pedido de harness',1)`,
    [o.rows[0].id, sku],
  );
  return o.rows[0].id;
}

async function sedeDePedido(orderId: string): Promise<string | null> {
  const { rows } = await db.query<{ code: string | null }>(
    `select w.code from public.logistics_orders o
     left join public.warehouses w on w.id = o.warehouse_id
     where o.id = $1`,
    [orderId],
  );
  return rows[0]?.code ?? null;
}

async function reservasDe(orderId: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*)::text as n from public.stock_allocations sa
     join public.logistics_order_items oi on oi.id = sa.order_item_id
     where oi.order_id = $1`,
    [orderId],
  );
  return Number(rows[0].n);
}

describe("T-FB-03 · R-1 · sede en el alta de pedidos", () => {
  it("A-4 · el conjunto de migraciones omitidas es EXACTAMENTE el declarado", () => {
    const { inesperadas, yaNoOmitidas } = verificarOmisiones(omitidas);
    expect(inesperadas).toEqual([]);
    expect(yaNoOmitidas).toEqual([]);
  });

  it("un pedido nace sin sede y la primera reserva se la fija", async () => {
    await comoUsuario(db, ADMIN.id, ADMIN.email, async () => {
      const orderId = await crearPedido("SKU-LUJ");
      expect(await sedeDePedido(orderId)).toBeNull();

      await db.query(`select public.allocate_order($1)`, [orderId]);

      // La reserva tiene que haber ocurrido de verdad: sin esto, una sede que
      // sigue en NULL podría confundirse con "no había stock".
      expect(await reservasDe(orderId)).toBeGreaterThan(0);
      expect(await sedeDePedido(orderId)).toBe(JORGE.warehouse);
    });
  });

  it("la sede estampada es la del stock efectivamente reservado", async () => {
    await comoUsuario(db, ADMIN.id, ADMIN.email, async () => {
      const orderId = await crearPedido("SKU-MAG");
      await db.query(`select public.allocate_order($1)`, [orderId]);
      expect(await reservasDe(orderId)).toBeGreaterThan(0);
      expect(await sedeDePedido(orderId)).toBe(JUAN.warehouse);
    });
  });

  it("un encargado no puede crear pedidos: su rol efectivo no es de staff", async () => {
    await comoUsuario(db, JORGE.id, JORGE.email, async () => {
      const r = await db.query<{ cr: string }>(`select public.current_role()::text as cr`);
      expect(r.rows[0].cr).toBe("cliente");
      await expect(
        db.query(
          `insert into public.logistics_orders (client_id, client_name, status, created_by)
           values ($1,'Intento del encargado','borrador',$2)`,
          [clientId, JORGE.id],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("un encargado sólo ve los pedidos de su sede", async () => {
    const lujan = await comoUsuario(db, ADMIN.id, ADMIN.email, async () => {
      const id = await crearPedido("SKU-LUJ");
      await db.query(`select public.allocate_order($1)`, [id]);
      return id;
    });
    const magaldi = await comoUsuario(db, ADMIN.id, ADMIN.email, async () => {
      const id = await crearPedido("SKU-MAG");
      await db.query(`select public.allocate_order($1)`, [id]);
      return id;
    });
    expect(await sedeDePedido(lujan)).toBe(JORGE.warehouse);
    expect(await sedeDePedido(magaldi)).toBe(JUAN.warehouse);

    const vistos = await comoUsuario(db, JORGE.id, JORGE.email, async () =>
      db.query<{ id: string }>(
        `select id from public.logistics_orders where id = any($1::uuid[])`,
        [[lujan, magaldi]],
      ),
    );
    expect(vistos.rows.map((r) => r.id)).toEqual([lujan]);
  });
});
