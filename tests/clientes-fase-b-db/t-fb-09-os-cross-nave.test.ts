/**
 * T-FB-09 · Las Órdenes de Servicio cruzan de nave.
 *
 * El aislamiento por sede no vivía sólo en `warehouse_id`. En 0249 estaba
 * escrito como `depot` —el mismo enum de dos naves de 0001:9— y sobrevivió
 * entero al primer retiro porque nadie lo buscó con ese nombre: ocho compuertas
 * que comparaban la nave de la orden, del operador o del payload contra la nave
 * del encargado.
 *
 * Este archivo las mide una por una desde el uso real: Jorge, encargado de
 * Luján, operando sobre Magaldi. Contra el candidato anterior estos casos están
 * en ROJO; contra el retiro completo, en verde.
 *
 * Lo que NO se toca y este archivo no debe volver verde: la restricción por
 * MÓDULO. Los precios siguen redactados para el encargado y los buckets de
 * firmas, PDF y adjuntos siguen cerrados, mire la nave que mire.
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
  seedJerarquiaMagaldi,
} from "./harness/chain";

let cluster: EphemeralCluster;
let db: Client;
let clientId: string;
let opLujan: string;
let opMagaldi: string;

/** PNG 1×1 real: el validador de 0244 exige cabecera, chunks y CRC válidos. */
const FIRMA =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function ordenPara(depot: string, operatorId: string) {
  return {
    client_id: clientId,
    operator_id: operatorId,
    depot,
    h_start: "08:00",
    h_end: "16:00",
    hours: "8",
    pallets: "4",
    units: "20",
    km: "35",
    observ: "Cobertura entre naves",
    signed_by: "Jorge Merino",
    signature_data_url: FIRMA,
    // Una OS de encargado nace con precios redactados, es decir incompleta:
    // 0249 exige que el total venga explícitamente en null, no ausente.
    client_total: null,
  };
}

const LINEAS = [{ pricing_kind: "catalog", service_slug: "estiba", qty_requested: 4 }];

/** `service_order_issue` devuelve el recibo JSONB de la emisión, no un uuid. */
interface ReciboOs {
  id: string;
  public_id: string;
  pricing_complete: boolean;
}

async function emitirComo(
  quien: { id: string; email: string },
  depot: string,
  operatorId: string,
  firmante: string,
): Promise<ReciboOs> {
  return comoUsuario(db, quien.id, quien.email, async () => {
    const r = await db.query<{ service_order_issue: ReciboOs }>(
      `select public.service_order_issue($1::jsonb,$2::jsonb)`,
      [
        JSON.stringify({ ...ordenPara(depot, operatorId), signed_by: firmante }),
        JSON.stringify(LINEAS),
      ],
    );
    return r.rows[0].service_order_issue;
  });
}

async function emitirComoJorge(depot: string, operatorId: string): Promise<ReciboOs> {
  return emitirComo(JORGE, depot, operatorId, "Jorge Merino");
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
       values ('Cliente Cross Nave OS','30711111111',true)
       on conflict (cuit) do update set razon=excluded.razon returning id`,
    );
    clientId = cli.rows[0].id;

    const ops = await db.query<{ id: string; depot: string }>(
      `insert into public.operators (full_name, role, depot, active)
       values ('Operario Lujan','estibador','LUJAN',true),
              ('Operario Magaldi','estibador','MAGALDI',true)
       returning id, depot::text as depot`,
    );
    opLujan = ops.rows.find((r) => r.depot === "LUJAN")!.id;
    opMagaldi = ops.rows.find((r) => r.depot === "MAGALDI")!.id;

    // El tarifario vigente ya viene sembrado por la cadena: se usa ése, no se
    // inventa otro (`service_tariff_one_active_uk` sólo admite uno activo).
    const ver = await db.query<{ id: string }>(
      `select id from public.service_tariff_versions
       where status in ('active','superseded') and effective_from <= now()
         and (effective_to is null or effective_to > now())
       limit 1`,
    );
    if (ver.rows.length === 0) throw new Error("precondición: no hay tarifario vigente en la cadena");
    await db.query(
      `insert into public.service_tariff_rates
         (version_id, service_slug, label, category, unit, rate, requires_quote)
       values ($1,'estiba','Estiba','operacion','hs',1000.00,false)
       on conflict (version_id, service_slug)
       do update set rate=excluded.rate, requires_quote=false, unit=excluded.unit`,
      [ver.rows[0].id],
    );
  } catch (e) {
    try { await cluster?.teardown?.(); } catch { /* no enmascarar el error real */ }
    throw e;
  }
}, 300_000);

afterAll(async () => {
  try { await db?.end?.(); } catch { /* no enmascarar */ }
  try { await cluster?.teardown?.(); } catch { /* no enmascarar */ }
});

describe("T-FB-09 · el encargado de Luján opera Órdenes de Servicio de Magaldi", () => {
  it("EMITE una OS de la otra nave, con un responsable de esa nave", async () => {
    // Caen a la vez tres compuertas: la del depot del payload, la del operador
    // fuera de sede y el estampado forzado a la sede del encargado.
    const os = await emitirComoJorge("MAGALDI", opMagaldi);
    expect(os.id).toBeTruthy();

    const { rows } = await db.query<{ depot: string }>(
      `select depot::text as depot from public.orders where id=$1`,
      [os.id],
    );
    expect(rows[0].depot).toBe("MAGALDI");
  });

  it("LISTA las órdenes de las dos naves, y el conteo las suma", async () => {
    await emitirComoJorge("LUJAN", opLujan);
    await emitirComoJorge("MAGALDI", opMagaldi);

    const listado = await comoUsuario(db, JORGE.id, JORGE.email, async () => {
      const r = await db.query<{ res: { rows: Array<{ depot: string }>; total: number } }>(
        `select public.nexus_depot_manager_orders(null,null,50,0) as res`,
      );
      return r.rows[0].res;
    });
    const naves = new Set(listado.rows.map((o) => o.depot));
    expect(naves.has("LUJAN")).toBe(true);
    expect(naves.has("MAGALDI")).toBe(true);
    expect(listado.total).toBe(listado.rows.length);
  });

  it("ABRE por public_id una orden de la otra nave", async () => {
    const os = await emitirComoJorge("MAGALDI", opMagaldi);

    const detalle = await comoUsuario(db, JORGE.id, JORGE.email, async () => {
      const r = await db.query<{ res: { id: string; depot: string } | null }>(
        `select public.nexus_depot_manager_order($1) as res`,
        [os.public_id],
      );
      return r.rows[0].res;
    });
    expect(detalle).not.toBeNull();
    expect(detalle!.depot).toBe("MAGALDI");
  });

  it("REGISTRA CUMPLIMIENTO sobre una línea de la otra nave", async () => {
    const os = await emitirComoJorge("MAGALDI", opMagaldi);
    const linea = (
      await db.query<{ id: string }>(
        `select id from public.order_services where order_id=$1 limit 1`,
        [os.id],
      )
    ).rows[0].id;

    await comoUsuario(db, JORGE.id, JORGE.email, async () => {
      await db.query(`select public.service_order_record_fulfillment($1,$2,$3)`, [
        linea,
        3,
        "Cubriendo Magaldi",
      ]);
    });

    const { rows } = await db.query<{ qty_provided: string }>(
      `select qty_provided::text from public.order_services where id=$1`,
      [linea],
    );
    expect(Number(rows[0].qty_provided)).toBe(3);
  });

  it("VE a los operadores de las dos naves", async () => {
    const { rows } = await comoUsuario(db, JORGE.id, JORGE.email, async () =>
      db.query<{ depot: string }>(`select distinct depot::text as depot from public.operators`),
    );
    const naves = new Set(rows.map((r) => r.depot));
    expect(naves.has("LUJAN")).toBe(true);
    expect(naves.has("MAGALDI")).toBe(true);
  });
});

describe("T-FB-09 · la restricción por MÓDULO no se movió", () => {
  it("los precios siguen redactados: la OS emitida no expone tarifas", async () => {
    const os = await emitirComoJorge("MAGALDI", opMagaldi);
    const detalle = await comoUsuario(db, JORGE.id, JORGE.email, async () => {
      const r = await db.query<{ res: { prices_hidden: boolean; total: number | null } }>(
        `select public.nexus_depot_manager_order($1) as res`,
        [os.public_id],
      );
      return r.rows[0].res;
    });
    expect(detalle.prices_hidden).toBe(true);
    expect(detalle.total).toBeNull();
  });

  it("el catálogo de servicios sigue cerrado para el encargado", async () => {
    const { rows } = await comoUsuario(db, JORGE.id, JORGE.email, async () =>
      db.query(`select id from public.services_catalog`),
    );
    expect(rows).toEqual([]);
  });

  it("el encargado sigue sin poder fijar precios a mano", async () => {
    await expect(
      comoUsuario(db, JORGE.id, JORGE.email, async () =>
        db.query(`select public.service_order_issue($1::jsonb,$2::jsonb)`, [
          JSON.stringify(ordenPara("MAGALDI", opMagaldi)),
          JSON.stringify([
            { pricing_kind: "manual", service_slug: "estiba", qty_requested: 1, manual_rate: 99 },
          ]),
        ]),
      ),
    ).rejects.toThrow(/no autorizado/);
  });

  it("Juan Carlos, el otro encargado, también cruza: no es un privilegio de uno", async () => {
    const os = await emitirComo(JUAN, "LUJAN", opLujan, "Juan Carlos Reynoso");
    const { rows } = await db.query<{ depot: string }>(
      `select depot::text as depot from public.orders where id=$1`,
      [os.id],
    );
    expect(rows[0].depot).toBe("LUJAN");
  });
});
