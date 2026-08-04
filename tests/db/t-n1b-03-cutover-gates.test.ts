/**
 * T-N1B-03 · Gates fail-closed del corte 0220 y preflight de perfilado.
 *
 * Usa un cluster PROPIO cargado con el manifiesto SIN 0220 (estado 0219):
 * el único estado desde el cual tiene sentido probar que el corte se niega a
 * aplicarse con cobertura < 100 %. Cada intento corre dentro de una
 * transacción revertida: el estado pre-corte se conserva entre casos.
 *
 * Discriminantes:
 *   · cobertura incompleta en CUALQUIERA de las tres tablas ⇒ la migración
 *     entera aborta con el gate nombrado (G-1/G-2/G-3);
 *   · identidad canónica duplicada ⇒ G-4;
 *   · un índice homónimo no unique o con claves incorrectas ⇒ G-5, sin
 *     retirar la barrera legacy;
 *   · si faltan ambas barreras, G-5 aborta antes del corte;
 *   · cobertura 100 % ⇒ el corte aplica y deja unicidad canónica + NOT NULL;
 *   · los mensajes de gate NO exponen datos comerciales (sólo conteos);
 *   · el preflight de perfilado corre íntegro en una transacción READ ONLY.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "pg";
import { connectGuarded, startEphemeralCluster, type EphemeralCluster } from "./harness/cluster";
import { loadSchema } from "./harness/schema-loader";
import { WMS_MIGRATION_MANIFEST, MIGRATIONS_DIR } from "./harness/manifest";
import { emitSentinelWhenGreen } from "./harness/sentinel";

const CUTOVER_FILE = "0220_wms_canonical_identity_cutover.sql";
const CUTOVER_SQL = readFileSync(join(MIGRATIONS_DIR, CUTOVER_FILE), "utf8");
const PREFLIGHT_SQL = readFileSync(
  resolve(__dirname, "fixtures", "p3-n1b-preflight-profiling.sql"),
  "utf8",
);

let cluster: EphemeralCluster | null = null;
let client: Client;

beforeAll(async () => {
  cluster = await startEphemeralCluster();
  client = await connectGuarded(cluster.url);
  const manifest = WMS_MIGRATION_MANIFEST.filter((m) => m !== CUTOVER_FILE);
  // Estado 0219: fundación aplicada, corte pendiente.
  await loadSchema(client, manifest);
});

afterAll(async () => {
  await client?.end();
  // Propaga: una limpieza fallida pone la corrida en rojo (doctrina A0).
  if (cluster) await cluster.teardown();
});

async function withRollback<T>(fn: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

async function seedClient(tag: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.clients (razon, cuit) values ($1, $2) returning id`,
    [`__N1B3_${tag}__`, `N1B3-${tag}`],
  );
  return rows[0].id;
}

/** Intenta aplicar 0220 y devuelve el error (o null si aplicó). */
async function tryCutover(): Promise<Error | null> {
  return client.query(CUTOVER_SQL).then(
    () => null,
    (e: unknown) => e as Error,
  );
}

/** Intenta el corte y restaura sólo ese intento para poder inspeccionar G-5. */
async function tryCutoverAtSavepoint(): Promise<Error | null> {
  await client.query("savepoint n1b_cutover_attempt");
  const err = await tryCutover();
  if (err) {
    await client.query("rollback to savepoint n1b_cutover_attempt");
  } else {
    await client.query("release savepoint n1b_cutover_attempt");
  }
  return err;
}

describe("T-N1B-03 · gates del corte 0220", () => {
  emitSentinelWhenGreen("P3_N1B_CUTOVER_GATES_VERIFIED");

  it("precondición: el cluster está en estado 0219 (sin corte)", async () => {
    const { rows } = await client.query(
      `select indexname from pg_indexes
        where schemaname='public' and indexname='inventory_items_canonical_identity_uk'`,
    );
    expect(rows).toHaveLength(0);
    const { rows: legacy } = await client.query(
      `select indexname from pg_indexes
        where schemaname='public' and indexname='inventory_items_identity_uk'`,
    );
    expect(legacy).toHaveLength(1);
  });

  it("G-1: un inventory_item sin client_id bloquea el corte entero", async () => {
    await withRollback(async () => {
      await client.query(
        `insert into public.inventory_items (sku, description, client_name)
         values ('__N1B3_G1__','sin identidad','__N1B3_SECRETO_COMERCIAL__')`,
      );
      const err = await tryCutover();
      expect(err).not.toBeNull();
      expect(err!.message).toMatch(/\[P3-N1B GATE G-1\]/);
      expect(err!.message).toMatch(/cobertura incompleta/i);
      // Fail-closed Y discreto: el mensaje cuenta filas, no expone depositantes.
      expect(err!.message).not.toMatch(/SECRETO_COMERCIAL/);
      // La transacción quedó abortada: el corte NO dejó efectos parciales.
      await client.query("rollback");
      await client.query("begin");
      const { rows } = await client.query(
        `select indexname from pg_indexes
          where schemaname='public' and indexname='inventory_items_canonical_identity_uk'`,
      );
      expect(rows).toHaveLength(0);
    });
  });

  it("G-2: una recepción sin client_id bloquea el corte", async () => {
    await withRollback(async () => {
      await client.query(
        `insert into public.receptions (client_name, business_unit, status)
         values ('__N1B3_G2__','GENERAL','borrador')`,
      );
      const err = await tryCutover();
      expect(err).not.toBeNull();
      expect(err!.message).toMatch(/\[P3-N1B GATE G-2\]/);
    });
  });

  it("G-3: un pedido sin client_id bloquea el corte", async () => {
    await withRollback(async () => {
      await client.query(
        `insert into public.logistics_orders (client_name, status)
         values ('__N1B3_G3__','borrador')`,
      );
      const err = await tryCutover();
      expect(err).not.toBeNull();
      expect(err!.message).toMatch(/\[P3-N1B GATE G-3\]/);
    });
  });

  it("G-4: dos ítems con la MISMA identidad canónica (posición NULL incluida) bloquean el corte", async () => {
    await withRollback(async () => {
      const c = await seedClient("G4");
      // Pre-corte la unicidad legacy por nombre no lo impide si los nombres
      // difieren: exactamente el duplicado que el corte no debe absorber.
      await client.query(
        `insert into public.inventory_items (sku, description, client_name, client_id) values
           ('__N1B3_DUP__','variante 1','__N1B3_NOMBRE_A__',$1),
           ('__N1B3_DUP__','variante 2','__N1B3_NOMBRE_B__',$1)`,
        [c],
      );
      const err = await tryCutover();
      expect(err).not.toBeNull();
      expect(err!.message).toMatch(/\[P3-N1B GATE G-4\]/);
      expect(err!.message).toMatch(/NO fusiona filas/);
    });
  });

  it.each([
    {
      label: "no unique aunque tenga las claves correctas",
      ddl: `create index inventory_items_canonical_identity_uk
              on public.inventory_items (client_id, sku, position_id)`,
      expected: /CREATE INDEX/i,
    },
    {
      label: "unique pero con definición de claves incorrecta",
      ddl: `create unique index inventory_items_canonical_identity_uk
              on public.inventory_items (client_id, sku)`,
      expected: /client_id, sku\)/i,
    },
  ])("G-5: rechaza un índice homónimo $label y conserva legacy", async ({ ddl, expected }) => {
    await withRollback(async () => {
      await client.query(ddl);

      const err = await tryCutoverAtSavepoint();
      expect(err).not.toBeNull();
      expect(err!.message).toMatch(/\[P3-N1B GATE G-5\]/);

      const { rows } = await client.query<{ canonical: string | null; legacy: string | null; definition: string }>(
        `select
           to_regclass('public.inventory_items_canonical_identity_uk')::text as canonical,
           to_regclass('public.inventory_items_identity_uk')::text as legacy,
           pg_get_indexdef('public.inventory_items_canonical_identity_uk'::regclass) as definition`,
      );
      expect(rows[0].canonical).toBe("inventory_items_canonical_identity_uk");
      expect(rows[0].legacy).toBe("inventory_items_identity_uk");
      expect(rows[0].definition).toMatch(expected);
    });
  });

  it("G-5: acepta un índice canónico preexistente sólo si su catálogo es exacto", async () => {
    await withRollback(async () => {
      await client.query(
        `create unique index inventory_items_canonical_identity_uk
           on public.inventory_items (client_id, sku, position_id) nulls not distinct`,
      );

      expect(await tryCutover()).toBeNull();
      const { rows } = await client.query<{ canonical: string | null; legacy: string | null }>(
        `select
           to_regclass('public.inventory_items_canonical_identity_uk')::text as canonical,
           to_regclass('public.inventory_items_identity_uk')::text as legacy`,
      );
      expect(rows[0].canonical).toBe("inventory_items_canonical_identity_uk");
      expect(rows[0].legacy).toBeNull();
    });
  });

  it("G-5: si faltan simultáneamente el índice canónico y la barrera legacy, aborta", async () => {
    await withRollback(async () => {
      await client.query(`drop index public.inventory_items_identity_uk`);

      const err = await tryCutoverAtSavepoint();
      expect(err).not.toBeNull();
      expect(err!.message).toMatch(/\[P3-N1B GATE G-5\]/);
      expect(err!.message).toMatch(/faltan simultáneamente/i);

      const { rows } = await client.query<{ canonical: string | null; legacy: string | null }>(
        `select
           to_regclass('public.inventory_items_canonical_identity_uk')::text as canonical,
           to_regclass('public.inventory_items_identity_uk')::text as legacy`,
      );
      expect(rows[0].canonical).toBeNull();
      expect(rows[0].legacy).toBeNull();
    });
  });

  it("cobertura 100 % ⇒ el corte aplica: NOT NULL + unicidad canónica, legacy retirada", async () => {
    await withRollback(async () => {
      const c = await seedClient("OK");
      await client.query(
        `insert into public.inventory_items (sku, description, client_name, client_id)
         values ('__N1B3_OK__','cubierta','__N1B3__',$1)`,
        [c],
      );
      await client.query(
        `insert into public.receptions (client_name, client_id, business_unit, status)
         values ('__N1B3__', $1, 'GENERAL', 'borrador')`,
        [c],
      );
      await client.query(
        `insert into public.logistics_orders (client_name, client_id, status)
         values ('__N1B3__', $1, 'borrador')`,
        [c],
      );

      const err = await tryCutover();
      expect(err).toBeNull();

      const { rows: notnull } = await client.query<{ attnotnull: boolean }>(
        `select attnotnull from pg_attribute
          where attrelid = 'public.inventory_items'::regclass and attname = 'client_id'`,
      );
      expect(notnull[0].attnotnull).toBe(true);

      const { rows: canonical } = await client.query<{ indexdef: string }>(
        `select indexdef from pg_indexes
          where schemaname='public' and indexname='inventory_items_canonical_identity_uk'`,
      );
      expect(canonical).toHaveLength(1);
      expect(canonical[0].indexdef).toMatch(/NULLS NOT DISTINCT/);
      expect(canonical[0].indexdef).toMatch(/client_id, sku, position_id/);

      const { rows: legacy } = await client.query(
        `select 1 from pg_indexes
          where schemaname='public' and indexname='inventory_items_identity_uk'`,
      );
      expect(legacy).toHaveLength(0);

      // Las RPC quedaron en v2: deciden por client_id, no por client_name.
      const { rows: fns } = await client.query<{ proname: string; src: string }>(
        `select proname, prosrc as src from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='public' and proname in ('allocate_order','confirm_reception')`,
      );
      expect(fns).toHaveLength(2);
      for (const f of fns) {
        expect(f.src).toMatch(/client_id = v_(order|rec)\.client_id/);
        expect(f.src).not.toMatch(/client_name = v_(order|rec)\.client_name/);
        expect(f.src).toMatch(/sin identidad canónica/);
      }
    });
  });

  it("el corte es idempotente: aplicarlo dos veces no falla ni duplica objetos", async () => {
    await withRollback(async () => {
      expect(await tryCutover()).toBeNull();
      expect(await tryCutover()).toBeNull();
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from pg_indexes
          where schemaname='public' and indexname='inventory_items_canonical_identity_uk'`,
      );
      expect(rows[0].n).toBe("1");
    });
  });

  it("el preflight de perfilado corre ÍNTEGRO en una transacción READ ONLY (cero escrituras)", async () => {
    await client.query("begin");
    try {
      await client.query("set transaction read only");
      const res = await client.query(PREFLIGHT_SQL);
      expect(res.rows).toHaveLength(1);
      const row = res.rows[0] as Record<string, string>;
      // Esquema del reporte: todas las métricas presentes, todas agregadas.
      for (const col of [
        "items_total",
        "items_sin_client_id",
        "recepciones_sin_client_id",
        "pedidos_sin_client_id",
        "identidades_duplicadas",
        "nombres_compartidos_por_varios_clientes",
        "items_con_linea_proyectada",
        "anomalias_multi_bu_abiertas",
        "general_declarado",
        "general_por_omision",
        "general_no_demostrable",
      ]) {
        expect(row).toHaveProperty(col);
      }
    } finally {
      await client.query("rollback");
    }
  });

  it("el preflight predice los gates: sus métricas en cero ⇔ el corte aplica", async () => {
    await withRollback(async () => {
      await client.query(
        `insert into public.inventory_items (sku, description, client_name)
         values ('__N1B3_PRED__','sin resolver','__N1B3__')`,
      );
      const { rows } = await client.query<{ items_sin_client_id: string }>(PREFLIGHT_SQL);
      expect(Number(rows[0].items_sin_client_id)).toBeGreaterThan(0);
      const err = await tryCutover();
      expect(err).not.toBeNull();
      expect(err!.message).toMatch(/GATE G-1/);
    });
  });
});
