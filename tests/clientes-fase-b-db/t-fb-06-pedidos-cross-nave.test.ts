/**
 * T-FB-06 · B-1 · Un pedido puede tomar stock de las dos naves.
 *
 * `allocate_order` elige candidatos por (cliente canónico, sku) en orden FEFO,
 * sin filtrar por nave: la reserva del WMS es cliente-céntrica. Antes de 0247
 * un pedido con stock repartido entre Luján y Magaldi se reservaba sin
 * problema.
 *
 * El guard de ítem que 0247 instaló abortaba la transacción entera en la
 * primera reserva que cruzara de nave, y lo hacía para CUALQUIER actor. Para
 * un rol global eso no era una restricción de sede: era una pérdida de
 * capacidad, porque `allocate_order` no tiene handler y el pedido quedaba sin
 * ninguna reserva.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE APARTE DE t-fb-03: aquel siembra un SKU por
 * nave y crea pedidos de una línea, de modo que el conjunto de pedidos que su
 * fixture puede construir NO CONTIENE ninguno multi-nave. La garantía era
 * indetectable por diseño del fixture, no por descuido de las aserciones.
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
} from "./harness/chain";

let cluster: EphemeralCluster;
let db: Client;
let clientId: string;

async function stock(sku: string, warehouse: string, cantidad: number): Promise<void> {
  await db.query(
    `insert into public.inventory_items
       (client_id, client_name, sku, description, stock_available, position_id, active)
     values ($1,'Cliente Cross Nave',$2,'Stock cross-nave',$3,$4,true)`,
    [clientId, sku, cantidad, await posicionDe(db, warehouse)],
  );
}

beforeAll(async () => {
  cluster = await startEphemeralCluster();
  try {
    db = await connectGuarded(cluster.url);
    await db.query(readFileSync(BOOTSTRAP, "utf8"));
    await aplicarCadena(db, cadenaHasta(245));
    await seedCanonico(db);
    await seedJerarquiaMagaldi(db);
    for (const f of FASE_B_FORWARDS) await aplicar(db, f);

    const cli = await db.query<{ id: string }>(
      `insert into public.clients (razon, cuit, activo)
       values ('Cliente Cross Nave','30711111111',true)
       on conflict (cuit) do update set razon = excluded.razon
       returning id`,
    );
    clientId = cli.rows[0].id;

    // Caso 1: cada SKU vive en UNA nave distinta.
    await stock("SKU-SOLO-LUJ", JORGE.warehouse, 10);
    await stock("SKU-SOLO-MAG", JUAN.warehouse, 10);
    // Caso 2: el MISMO SKU repartido, para que el FEFO tenga que cruzar
    // cuando el requerimiento excede el stock de una sola nave.
    await stock("SKU-PARTIDO", JORGE.warehouse, 5);
    await stock("SKU-PARTIDO", JUAN.warehouse, 5);
  } catch (e) {
    await cluster.teardown().catch(() => {});
    throw e;
  }
}, 300_000);

afterAll(async () => {
  await db?.end().catch(() => {});
  await cluster?.teardown().catch(() => {});
});

async function crearPedido(lineas: Array<{ sku: string; qty: number }>): Promise<string> {
  const o = await db.query<{ id: string }>(
    `insert into public.logistics_orders (client_id, client_name, status, created_by)
     values ($1,'Cliente Cross Nave','pendiente',$2)
     returning id`,
    [clientId, ADMIN.id],
  );
  for (const l of lineas) {
    await db.query(
      `insert into public.logistics_order_items
         (order_id, sku, description, quantity_requested)
       values ($1,$2,'Linea cross-nave',$3)`,
      [o.rows[0].id, l.sku, l.qty],
    );
  }
  return o.rows[0].id;
}

async function reservas(orderId: string): Promise<{ total: number; naves: string[] }> {
  const { rows } = await db.query<{ code: string; q: string }>(
    `select w.code, sum(sa.quantity)::text as q
     from public.stock_allocations sa
     join public.logistics_order_items oi on oi.id = sa.order_item_id
     join public.inventory_items ii on ii.id = sa.inventory_item_id
     join public.warehouse_positions wp on wp.id = ii.position_id
     join public.warehouse_racks wr on wr.id = wp.rack_id
     join public.warehouse_zones wz on wz.id = wr.zone_id
     join public.warehouse_sectors ws on ws.id = wz.sector_id
     join public.warehouse_floors wf on wf.id = ws.floor_id
     join public.warehouses w on w.id = wf.warehouse_id
     where oi.order_id = $1
     group by w.code order by w.code`,
    [orderId],
  );
  return {
    total: rows.reduce((a, r) => a + Number(r.q), 0),
    naves: rows.map((r) => r.code),
  };
}

describe("T-FB-06 · B-1 · reserva cross-nave", () => {
  it("un rol global reserva un pedido con SKU de dos naves distintas", async () => {
    await comoUsuario(db, ADMIN.id, ADMIN.email, async () => {
      const orderId = await crearPedido([
        { sku: "SKU-SOLO-LUJ", qty: 2 },
        { sku: "SKU-SOLO-MAG", qty: 3 },
      ]);
      await db.query(`select public.allocate_order($1)`, [orderId]);
      const r = await reservas(orderId);
      expect(r.total).toBe(5);
      expect(r.naves).toEqual([JUAN.warehouse, JORGE.warehouse].sort());
    });
  });

  it("un rol global reserva cuando el requerimiento obliga al FEFO a cruzar", async () => {
    await comoUsuario(db, ADMIN.id, ADMIN.email, async () => {
      // 8 unidades de un SKU con 5 en cada nave: es imposible sin cruzar.
      const orderId = await crearPedido([{ sku: "SKU-PARTIDO", qty: 8 }]);
      await db.query(`select public.allocate_order($1)`, [orderId]);
      const r = await reservas(orderId);
      expect(r.total).toBe(8);
      expect(r.naves).toHaveLength(2);
    });
  });

  it("un encargado no reserva pedidos: la RPC lo rechaza antes del guard", async () => {
    const orderId = await comoUsuario(db, ADMIN.id, ADMIN.email, async () =>
      crearPedido([{ sku: "SKU-SOLO-MAG", qty: 1 }]),
    );
    await comoUsuario(db, JORGE.id, JORGE.email, async () => {
      // Defensa en profundidad: `allocate_order` (0220:341-343) exige rol de
      // staff y el principal tiene current_role() = 'cliente', así que ni
      // siquiera llega al guard de ítem. Acotar el guard a principales NO
      // abrió esta puerta: sigue cerrada un nivel más arriba.
      await expect(db.query(`select public.allocate_order($1)`, [orderId])).rejects.toThrow(
        /no autorizado/i,
      );
    });
  });

  it("y el pedido rechazado no queda con reservas a medias", async () => {
    const orderId = await comoUsuario(db, ADMIN.id, ADMIN.email, async () =>
      crearPedido([{ sku: "SKU-SOLO-MAG", qty: 1 }]),
    );
    await comoUsuario(db, JORGE.id, JORGE.email, async () => {
      await db.query(`select public.allocate_order($1)`, [orderId]).catch(() => undefined);
    });
    expect((await reservas(orderId)).total).toBe(0);
  });
});
