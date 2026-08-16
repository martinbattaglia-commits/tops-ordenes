/**
 * T-FB-00 · El harness arranca de verdad.
 *
 * Antes de afirmar nada sobre RBAC hay que probar que las dos migraciones
 * supervivientes de FASE B —0246 recortada y 0249 entera— APLICAN sobre la
 * cadena productiva real. Si el guard de precondición de 0246 aborta, todo lo
 * que viniera después mediría un esquema que no existe: un verde vacío, que es
 * exactamente lo que este expediente vino a corregir.
 *
 * Retirado el aislamiento por sede, dos casos cambian de signo: la ausencia de
 * `warehouse_id` en las cabeceras y la ausencia del mecanismo de elevación
 * pasan a ser el contrato, no su violación.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { connectGuarded, startEphemeralCluster, type EphemeralCluster } from "../db/harness/cluster";
import {
  BOOTSTRAP,
  FASE_B_FORWARDS,
  aplicar,
  aplicarCadena,
  cadenaHasta,
  seedCanonico,
  verificarOmisiones,
} from "./harness/chain";

let cluster: EphemeralCluster;
let db: Client;
let omitidas: Array<{ file: string; error: string }> = [];

beforeAll(async () => {
  cluster = await startEphemeralCluster();
  try {
  db = await connectGuarded(cluster.url);
  await db.query(readFileSync(BOOTSTRAP, "utf8"));

  const base = cadenaHasta(245);
  const res = await aplicarCadena(db, base);
  omitidas = res.omitidas;
  console.log(
    `[FASE B harness] cadena: ${res.aplicadas.length} aplicadas · ${omitidas.length} omitidas`,
  );
  for (const o of omitidas) console.log(`[FASE B harness]   omitida ${o.file} — ${o.error}`);

  await seedCanonico(db);
  for (const f of FASE_B_FORWARDS) await aplicar(db, f);
  } catch (e) {
    // Sin esto un fallo de carga deja el cluster vivo y el guard de residuos
    // del harness vanilla se pone en rojo por un motivo ajeno a su suite.
    await cluster.teardown().catch(() => {});
    throw e;
  }
}, 300_000);

afterAll(async () => {
  await db?.end().catch(() => {});
  await cluster?.teardown().catch(() => {});
});

describe("T-FB-00 · arranque del harness de FASE B", () => {
  it("las dos migraciones de FASE B están aplicadas y sus objetos existen", async () => {
    const { rows } = await db.query<{ proname: string }>(
      `select proname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and proname in (
         'nexus_is_depot_manager_principal','nexus_depot_manager_scope',
         'nexus_depot_manager_valid'
       )`,
    );
    const nombres = rows.map((r) => r.proname).sort();
    expect(nombres).toContain("nexus_is_depot_manager_principal");
    expect(nombres).toContain("nexus_depot_manager_scope");
    expect(nombres).toContain("nexus_depot_manager_valid");
  });

  it("retirado el aislamiento, la sede NO vive en la cabecera del WMS", async () => {
    // La columna `warehouse_id` de 0247 era un artefacto de permiso. Su
    // ausencia es ahora parte del contrato: si reapareciera, algo estaría
    // volviendo a acotar por nave.
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.columns
       where table_schema='public' and column_name='warehouse_id'
         and table_name in ('receptions','logistics_orders')
       order by table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });

  it("el mecanismo de elevación transaccional ya no existe", async () => {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from pg_proc p
       join pg_namespace nsp on nsp.oid = p.pronamespace
       where nsp.nspname='public'
         and p.proname in ('nexus_wms_row_allowed','nexus_wms_begin_scope','nexus_wms_scope_active')`,
    );
    expect(Number(rows[0].n)).toBe(0);
    const { rows: tablas } = await db.query<{ n: string }>(
      `select count(*)::text as n from information_schema.tables
       where table_schema='public' and table_name='nexus_wms_scope_grants'`,
    );
    expect(Number(tablas[0].n)).toBe(0);
  });

  it("A-4 · el conjunto de migraciones omitidas es EXACTAMENTE el declarado", () => {
    // No se exige cadena completa: se exige que lo omitido sea VISIBLE y
    // ESTABLE. Un gate que pasa por exclusión y no por ejecución no es
    // cobertura, y una omisión nueva tiene que poner el harness en rojo.
    const { inesperadas, yaNoOmitidas } = verificarOmisiones(omitidas);
    expect(inesperadas).toEqual([]);
    expect(yaNoOmitidas).toEqual([]);
  });

  it("A-8 · las dos migraciones de FASE B se aplicaron SIN red de contención", async () => {
    // El test anterior filtraba 0246-0249 sobre `omitidas`, que proviene de
    // cadenaHasta(245) y por definición no puede contenerlas: la garantía se
    // declaraba sin ejercerse. La garantía real es que `aplicar` no atrapa
    // excepciones, y se comprueba contra el estado del cluster: si alguna no
    // hubiera aplicado, sus objetos no existirían.
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from pg_proc p
       join pg_namespace nsp on nsp.oid = p.pronamespace
       where nsp.nspname='public' and p.proname in (
         'nexus_depot_manager_scope',        -- 0246
         'service_order_issue_0244'          -- 0249 (el rename es su huella)
       )`,
    );
    expect(Number(rows[0].n)).toBe(2);
  });
});
