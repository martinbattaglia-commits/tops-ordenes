/**
 * T-FB-06 · Pedidos, reservas y despachos cruzan de nave.
 *
 * La directiva enumera cuatro documentos que el encargado debe poder mover en
 * cualquiera de las dos naves: recepciones, pedidos, RESERVAS y despachos. Las
 * recepciones ya las cubre `t-fb-08`; los otros tres se cubren acá.
 *
 * Los dos primeros casos son la restitución RECORTADA de la versión anterior de
 * este archivo. Verificaban que un rol global reserva cruzando naves, y se
 * borraron por error junto con los casos del aislamiento: su sujeto no había
 * desaparecido, se había vuelto el requisito. Vuelven sin nada de lo que era
 * del aislamiento —los dos casos que medían el rechazo al encargado— porque eso
 * sí dejó de existir.
 *
 * El resto mide al encargado, que es quien tenía el aislamiento encima: crear
 * un pedido, reservar contra las dos naves y despacharlo de punta a punta.
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

async function crearPedido(
  lineas: Array<{ sku: string; qty: number }>,
  actorId: string,
): Promise<string> {
  const o = await db.query<{ id: string }>(
    `insert into public.logistics_orders (client_id, client_name, status, created_by)
     values ($1,'Cliente Cross Nave','pendiente',$2)
     returning id`,
    [clientId, actorId],
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

/** Reservas del pedido, agrupadas por la nave FÍSICA de cada posición. */
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

    // Cada SKU en UNA nave distinta, y uno partido por la mitad para que el
    // FEFO no tenga más remedio que cruzar.
    await stock("SKU-SOLO-LUJ", JORGE.warehouse, 10);
    await stock("SKU-SOLO-MAG", JUAN.warehouse, 10);
    await stock("SKU-PARTIDO", JORGE.warehouse, 5);
    await stock("SKU-PARTIDO", JUAN.warehouse, 5);
    await stock("SKU-DESPACHO", JORGE.warehouse, 4);
    await stock("SKU-DESPACHO", JUAN.warehouse, 4);
  } catch (e) {
    try { await cluster?.teardown?.(); } catch { /* no enmascarar el error real */ }
    throw e;
  }
}, 300_000);

afterAll(async () => {
  try { await db?.end?.(); } catch { /* no enmascarar */ }
  try { await cluster?.teardown?.(); } catch { /* no enmascarar */ }
});

describe("T-FB-06 · RESERVAS · restitución recortada", () => {
  it("un rol global reserva un pedido con SKU de dos naves distintas", async () => {
    await comoUsuario(db, ADMIN.id, ADMIN.email, async () => {
      const orderId = await crearPedido(
        [
          { sku: "SKU-SOLO-LUJ", qty: 2 },
          { sku: "SKU-SOLO-MAG", qty: 3 },
        ],
        ADMIN.id,
      );
      await db.query(`select public.allocate_order($1)`, [orderId]);
      const r = await reservas(orderId);
      expect(r.total).toBe(5);
      expect(r.naves).toEqual([JUAN.warehouse, JORGE.warehouse].sort());
    });
  });

  it("un rol global reserva cuando el requerimiento obliga al FEFO a cruzar", async () => {
    await comoUsuario(db, ADMIN.id, ADMIN.email, async () => {
      // 8 unidades de un SKU con 5 en cada nave: es imposible sin cruzar.
      const orderId = await crearPedido([{ sku: "SKU-PARTIDO", qty: 8 }], ADMIN.id);
      await db.query(`select public.allocate_order($1)`, [orderId]);
      const r = await reservas(orderId);
      expect(r.total).toBe(8);
      expect(r.naves).toHaveLength(2);
    });
  });
});

describe("T-FB-06 · PEDIDOS · el encargado ya no está acotado por nave", () => {
  it("crea un pedido: con current_role() restituida su rol efectivo es operativo", async () => {
    await comoUsuario(db, JORGE.id, JORGE.email, async () => {
      const r = await db.query<{ cr: string }>(`select public.current_role()::text as cr`);
      expect(r.rows[0].cr).toBe("operaciones");
      await expect(
        db.query(
          `insert into public.logistics_orders (client_id, client_name, status, created_by)
           values ($1,'Pedido del encargado','pendiente',$2)`,
          [clientId, JORGE.id],
        ),
      ).resolves.toBeTruthy();
    });
  });

  it("ve los pedidos de las dos naves, no sólo los de la suya", async () => {
    const lujan = await comoUsuario(db, ADMIN.id, ADMIN.email, async () => {
      const id = await crearPedido([{ sku: "SKU-SOLO-LUJ", qty: 1 }], ADMIN.id);
      await db.query(`select public.allocate_order($1)`, [id]);
      return id;
    });
    const magaldi = await comoUsuario(db, ADMIN.id, ADMIN.email, async () => {
      const id = await crearPedido([{ sku: "SKU-SOLO-MAG", qty: 1 }], ADMIN.id);
      await db.query(`select public.allocate_order($1)`, [id]);
      return id;
    });
    expect((await reservas(lujan)).naves).toEqual([JORGE.warehouse]);
    expect((await reservas(magaldi)).naves).toEqual([JUAN.warehouse]);

    const vistos = await comoUsuario(db, JORGE.id, JORGE.email, async () =>
      db.query<{ id: string }>(
        `select id from public.logistics_orders where id = any($1::uuid[])`,
        [[lujan, magaldi]],
      ),
    );
    expect(vistos.rows.map((r) => r.id).sort()).toEqual([lujan, magaldi].sort());
  });
});

describe("T-FB-06 · DESPACHOS · un pedido de dos naves se despacha entero", () => {
  it("el encargado lo lleva de la reserva al despacho, cruzando naves", async () => {
    const orderId = await comoUsuario(db, JORGE.id, JORGE.email, async () => {
      const id = await crearPedido([{ sku: "SKU-DESPACHO", qty: 6 }], JORGE.id);
      await db.query(`select public.allocate_order($1)`, [id]);
      return id;
    });

    // Precondición del caso: sin dos naves reservadas no probaría nada.
    const r = await reservas(orderId);
    expect(r.total).toBe(6);
    expect(r.naves).toHaveLength(2);

    const shipment = await comoUsuario(db, JORGE.id, JORGE.email, async () => {
      await db.query(`select public.confirm_picking_order($1)`, [orderId]);
      const bulto = await db.query<{ create_packing_unit: string }>(
        `select public.create_packing_unit($1,$2,$3)`,
        [orderId, "BULTO-CROSS-1", "caja"],
      );
      const { rows: allocs } = await db.query<{ id: string }>(
        `select sa.id from public.stock_allocations sa
         join public.logistics_order_items oi on oi.id = sa.order_item_id
         where oi.order_id = $1`,
        [orderId],
      );
      for (const a of allocs) {
        await db.query(`select public.pack_allocation($1,$2)`, [
          bulto.rows[0].create_packing_unit,
          a.id,
        ]);
      }
      await db.query(`select public.close_packing_unit($1)`, [bulto.rows[0].create_packing_unit]);
      await db.query(`select public.confirm_packing_order($1)`, [orderId]);
      const s = await db.query<{ confirm_dispatch: string }>(`select public.confirm_dispatch($1)`, [
        orderId,
      ]);
      return s.rows[0].confirm_dispatch;
    });

    expect(shipment).toBeTruthy();
    const { rows } = await db.query<{ status: string }>(
      `select status::text as status from public.shipments where id = $1`,
      [shipment],
    );
    expect(rows[0].status).toBe("despachado");
  });
});
