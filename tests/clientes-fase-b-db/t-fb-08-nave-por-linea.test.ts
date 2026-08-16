/**
 * T-FB-08 · La nave sigue saliendo de la jerarquía física.
 *
 * Retirado el aislamiento por sede, 0247 se llevó la columna `warehouse_id` de
 * `receptions` y `logistics_orders`. Esa columna era un ARTEFACTO DE PERMISO,
 * no un dato de negocio: la nave de cada línea siempre estuvo en la jerarquía
 * posición → rack → zona → sector → piso → depósito, y sigue estando.
 *
 * Este test existe para que esa afirmación no quede en el informe sino en el
 * gate. Comprueba tres cosas:
 *
 *   1. que la cabecera efectivamente ya no lleva la nave;
 *   2. que la nave por línea se deriva igual, y coincide con la nave sembrada;
 *   3. que un documento MULTI-NAVE es representable y contable —que es la
 *      operatoria normal entre Magaldi y Luján, no un caso borde—, y que un
 *      encargado puede cargar en la nave que no es la suya.
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
  posicionDe,
  seedCanonico,
  seedJerarquiaMagaldi,
} from "./harness/chain";

let cluster: EphemeralCluster;
let db: Client;
let clientId: string;
let posLujan: string;
let posMagaldi: string;

/** El derivador de nave, tal como queda sin la columna de cabecera. */
const NAVE_POR_LINEA = `
  select w.code
  from public.warehouse_positions wp
  join public.warehouse_racks wr on wr.id = wp.rack_id
  join public.warehouse_zones wz on wz.id = wr.zone_id
  join public.warehouse_sectors ws on ws.id = wz.sector_id
  join public.warehouse_floors wf on wf.id = ws.floor_id
  join public.warehouses w on w.id = wf.warehouse_id
  where wp.id = $1`;

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
       values ('Cliente Nave Por Linea','30711111111',true)
       on conflict (cuit) do update set razon = excluded.razon
       returning id`,
    );
    clientId = cli.rows[0].id;
    posLujan = await posicionDe(db, JORGE.warehouse);
    posMagaldi = await posicionDe(db, JUAN.warehouse);
  } catch (e) {
    try { await cluster?.teardown?.(); } catch { /* no enmascarar el error real */ }
    throw e;
  }
}, 300_000);

afterAll(async () => {
  try { await db?.end?.(); } catch { /* no enmascarar */ }
  try { await cluster?.teardown?.(); } catch { /* no enmascarar */ }
});

async function crearRecepcion(actorId: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into public.receptions
       (client_id, client_name, business_unit, status, created_by)
     values ($1,'Cliente Nave Por Linea','GENERAL','borrador',$2)
     returning id`,
    [clientId, actorId],
  );
  return r.rows[0].id;
}

describe("T-FB-08 · la nave se deriva de la jerarquía física", () => {
  it("la cabecera ya no lleva la nave: la columna de permiso no volvió", async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.columns
       where table_schema='public' and column_name='warehouse_id'
         and table_name in ('receptions','logistics_orders')`,
    );
    expect(rows).toEqual([]);
  });

  it("cada posición resuelve su nave por el camino de seis saltos", async () => {
    const luj = await db.query<{ code: string }>(NAVE_POR_LINEA, [posLujan]);
    const mag = await db.query<{ code: string }>(NAVE_POR_LINEA, [posMagaldi]);
    expect(luj.rows[0].code).toBe(JORGE.warehouse);
    expect(mag.rows[0].code).toBe(JUAN.warehouse);
  });

  it("el encargado de Luján carga una línea en Magaldi: es operatoria normal", async () => {
    const recepcion = await comoUsuario(db, JORGE.id, JORGE.email, async () => crearRecepcion(JORGE.id));
    await expect(
      db.query(
        `insert into public.reception_items
           (reception_id, sku, description, quantity, position_id, status)
         values ($1,'SKU-CRUZADO','Linea de la otra nave',3,$2,'pendiente')`,
        [recepcion, posMagaldi],
      ),
    ).resolves.toBeTruthy();
  });

  it("una recepción con líneas en las dos naves deriva las dos, sin error", async () => {
    const recepcion = await crearRecepcion(JORGE.id);
    for (const [sku, pos] of [
      ["SKU-MULTI-LUJ", posLujan],
      ["SKU-MULTI-MAG", posMagaldi],
    ] as const) {
      await db.query(
        `insert into public.reception_items
           (reception_id, sku, description, quantity, position_id, status)
         values ($1,$2,'Linea multi-nave',5,$3,'pendiente')`,
        [recepcion, sku, pos],
      );
    }

    const { rows } = await db.query<{ code: string; n: string }>(
      `select w.code, count(*)::text as n
       from public.reception_items ri
       join public.warehouse_positions wp on wp.id = ri.position_id
       join public.warehouse_racks wr on wr.id = wp.rack_id
       join public.warehouse_zones wz on wz.id = wr.zone_id
       join public.warehouse_sectors ws on ws.id = wz.sector_id
       join public.warehouse_floors wf on wf.id = ws.floor_id
       join public.warehouses w on w.id = wf.warehouse_id
       where ri.reception_id = $1
       group by w.code order by w.code`,
      [recepcion],
    );
    expect(rows.map((r) => r.code).sort()).toEqual([JUAN.warehouse, JORGE.warehouse].sort());
    expect(rows.every((r) => Number(r.n) === 1)).toBe(true);
  });

  it("el stock por depósito se sigue contando bien sin la columna de cabecera", async () => {
    await db.query(
      `insert into public.inventory_items
         (client_id, client_name, sku, description, stock_available, position_id, active)
       values ($1,'Cliente Nave Por Linea','SKU-STOCK-LUJ','Stock Lujan',7,$2,true),
              ($1,'Cliente Nave Por Linea','SKU-STOCK-MAG','Stock Magaldi',4,$3,true)`,
      [clientId, posLujan, posMagaldi],
    );

    const { rows } = await db.query<{ code: string; total: string }>(
      `select w.code, sum(ii.stock_available)::text as total
       from public.inventory_items ii
       join public.warehouse_positions wp on wp.id = ii.position_id
       join public.warehouse_racks wr on wr.id = wp.rack_id
       join public.warehouse_zones wz on wz.id = wr.zone_id
       join public.warehouse_sectors ws on ws.id = wz.sector_id
       join public.warehouse_floors wf on wf.id = ws.floor_id
       join public.warehouses w on w.id = wf.warehouse_id
       where ii.sku in ('SKU-STOCK-LUJ','SKU-STOCK-MAG')
       group by w.code`,
      [],
    );
    const porNave = Object.fromEntries(rows.map((r) => [r.code, Number(r.total)]));
    expect(porNave[JORGE.warehouse]).toBe(7);
    expect(porNave[JUAN.warehouse]).toBe(4);
  });
});
