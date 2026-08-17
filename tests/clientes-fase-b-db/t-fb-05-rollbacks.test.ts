/**
 * T-FB-05 · A-9 · Las dos inversas son ejecutables de verdad.
 *
 * `FASE_B_ROLLBACKS` estaba declarado en el harness y no lo usaba nadie,
 * mientras el manifiesto insistía en inversas exactas. Una promesa de
 * reversibilidad que ningún test ejerce vale lo mismo que ninguna: la primera
 * vez que se necesite, se descubre si era cierta.
 *
 * Retirado el aislamiento por sede quedan dos: ROLLBACK_0249 y ROLLBACK_0246.
 * Se aplican en orden inverso sobre el mismo cluster donde acaban de aplicarse
 * los forwards, y se comprueba que los objetos que introdujeron desaparecen y
 * que los que reemplazaron vuelven.
 *
 * ROLLBACK_0249 aborta si `service_order_price_audit` tiene una sola fila —no
 * destruye evidencia firmada—, de modo que esta corrida es válida sólo antes
 * del primer uso. Es una limitación del propio artefacto, y el test la
 * ejercita en la ventana en que es aplicable.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { connectGuarded, startEphemeralCluster, type EphemeralCluster } from "../db/harness/cluster";
import {
  BOOTSTRAP,
  FASE_B_FORWARDS,
  FASE_B_ROLLBACKS,
  aplicar,
  aplicarCadena,
  cadenaHasta,
  seedCanonico,
} from "./harness/chain";

let cluster: EphemeralCluster;
let db: Client;

async function existeFuncion(nombre: string): Promise<boolean> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*)::text as n from pg_proc p
     join pg_namespace nsp on nsp.oid = p.pronamespace
     where nsp.nspname='public' and p.proname=$1`,
    [nombre],
  );
  return Number(rows[0].n) > 0;
}

async function existeColumna(tabla: string, columna: string): Promise<boolean> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*)::text as n from information_schema.columns
     where table_schema='public' and table_name=$1 and column_name=$2`,
    [tabla, columna],
  );
  return Number(rows[0].n) > 0;
}

beforeAll(async () => {
  cluster = await startEphemeralCluster();
  try {
    db = await connectGuarded(cluster.url);
    await db.query(readFileSync(BOOTSTRAP, "utf8"));
    await aplicarCadena(db, cadenaHasta(245));
    await seedCanonico(db);
    for (const f of FASE_B_FORWARDS) await aplicar(db, f);
  } catch (e) {
    await cluster.teardown().catch(() => {});
    throw e;
  }
}, 300_000);

afterAll(async () => {
  await db?.end().catch(() => {});
  await cluster?.teardown().catch(() => {});
});

describe("T-FB-05 · A-9 · reversibilidad de FASE B", () => {
  it("antes de revertir, los objetos de FASE B están presentes", async () => {
    expect(await existeFuncion("nexus_is_depot_manager_principal")).toBe(true);
    expect(await existeFuncion("nexus_depot_manager_scope")).toBe(true);
    expect(await existeFuncion("nexus_depot_manager_valid")).toBe(true);
    expect(await existeFuncion("service_order_issue_0244")).toBe(true);
  });

  it("retirado el aislamiento, tampoco están los objetos de 0247/0248", async () => {
    // El forward ya no los crea. Se afirma acá para que una reaparición —por
    // un merge o un archivo revivido— ponga el harness en rojo.
    expect(await existeFuncion("nexus_wms_position_warehouse")).toBe(false);
    expect(await existeFuncion("nexus_wms_begin_scope")).toBe(false);
    expect(await existeFuncion("nexus_wms_scope_active")).toBe(false);
    expect(await existeColumna("receptions", "warehouse_id")).toBe(false);
    expect(await existeColumna("logistics_orders", "warehouse_id")).toBe(false);
  });

  it("las dos inversas se aplican en orden 0249→0246 sin error", async () => {
    // Sin try/catch: si alguna falla, el test cae con su error de PostgreSQL,
    // que es exactamente lo que hay que saber.
    expect([...FASE_B_ROLLBACKS]).toEqual([
      "ROLLBACK_0249_clientes_fase_b_service_pricing_redaction.sql",
      "ROLLBACK_0246_clientes_fase_b_principals_capabilities.sql",
    ]);
    for (const f of FASE_B_ROLLBACKS) await aplicar(db, f);
  });

  it("después de revertir, los objetos netos de FASE B ya no existen", async () => {
    expect(await existeFuncion("nexus_is_depot_manager_principal")).toBe(false);
    expect(await existeFuncion("nexus_depot_manager_scope")).toBe(false);
    expect(await existeFuncion("nexus_depot_manager_valid")).toBe(false);
  });

  it("y las funciones que FASE B había renombrado vuelven a su nombre", async () => {
    // 0249 renombró service_order_issue. Si la reversa no lo devolviera, el
    // sistema quedaría sin su camino de escritura de órdenes de servicio.
    expect(await existeFuncion("service_order_issue")).toBe(true);
    expect(await existeFuncion("service_order_issue_0244")).toBe(false);
  });
});
