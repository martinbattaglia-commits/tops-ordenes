/**
 * T-C5-06 · 0250a SE APLICA SOBRE UNA BASE CON RECEPCIONES REALES.
 *
 * ─── LA CLASE DE DEFECTO QUE ESTE ARCHIVO CUBRE ───────────────────────────
 *
 * 0250a trae un backfill que materializa una unidad física y su caso
 * obligatorio por cada `reception_item` ya confirmado. Todo el resto del
 * harness aplica la migración sobre una base VACÍA: el bucle da cero vueltas,
 * no inserta nada, y el backfill nunca se ejercita. Por eso ninguna suite pudo
 * ver que, con filas reales, la migración fallaba entera:
 *
 *   ERROR 55006: cannot ALTER TABLE "custody_integrity_cases"
 *                because it has pending trigger events
 *
 * `trg_custody_integrity_case_coherence` (0222) es un CONSTRAINT TRIGGER
 * DEFERRABLE INITIALLY DEFERRED sobre `custody_integrity_cases`. Cada inserto
 * del backfill encola un evento que sólo dispararía en el COMMIT, y PostgreSQL
 * rechaza cualquier ALTER TABLE sobre una tabla con eventos pendientes. El
 * backfill corría ANTES de tres ALTER sobre esa misma tabla.
 *
 * La corrección fue mover el bloque después de todo ese DDL. Esta prueba es su
 * rojo→verde, y sobre todo es la que impide que la próxima migración con
 * backfill repita el error sin que nadie lo note: acá el backfill SÍ tiene
 * datos que procesar.
 *
 * Levanta su PROPIO cluster porque necesita el momento intermedio que el
 * `globalSetup` no puede ofrecer: el esquema cargado hasta 0250, la siembra, y
 * recién entonces 0250a.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";
import { connectGuarded, startEphemeralCluster, type EphemeralCluster } from "../db/harness/cluster";
import { loadSchema } from "../db/harness/schema-loader";
import {
  CUSTODY_BOOTSTRAP_DIR,
  CUSTODY_MIGRATION_MANIFEST,
  REPO_ROOT,
} from "./harness/manifest";

/**
 * El manifiesto completo MENOS el núcleo, que se aplica a mano y al final.
 *
 * También se excluyen las migraciones POSTERIORES que dependen de él: 0251
 * redefine funciones que 0250a crea y 0252 hace DDL sobre
 * `custody_physical_units`, que 0250a es quien la crea. Aplicarlas antes que su
 * dependencia no reproduce ningún escenario real; sólo rompe el arranque.
 *
 * Este escenario mide el BACKFILL de 0250a con datos productivos, así que lo
 * que importa es que 0250a entre última respecto de su base y primera respecto
 * de sus dependientes.
 */
const DEPENDIENTES_DE_0250A = [
  "0250a_custody_productive_vision.sql",
  "0251_custody_decide_authority.sql",
  "0252_custody_two_levels.sql",
  // 2-B · la puerta de egreso redefine `custody_assert_physical_unit_released`
  // y lee `custody_release_certificates`: sin 0250a esas tablas no existen.
  "0253_custody_egress_gate.sql",
  "0254_custody_certificate_read.sql",
];

const MANIFIESTO_SIN_0250A = CUSTODY_MIGRATION_MANIFEST.filter(
  (m) => !DEPENDIENTES_DE_0250A.includes(m),
);

const SQL_0250A = readFileSync(
  join(REPO_ROOT, "supabase", "migrations", "0250a_custody_productive_vision.sql"),
  "utf8",
);

let cluster: EphemeralCluster | null = null;
let db: Client;

beforeAll(async () => {
  cluster = await startEphemeralCluster();
  db = await connectGuarded(cluster.url);
  await loadSchema(db, MANIFIESTO_SIN_0250A);
  // Mismo bootstrap que el harness dedicado (auth.sessions y demás).
  await db.query(readFileSync(join(CUSTODY_BOOTSTRAP_DIR, "01-custody-extra.sql"), "utf8"));
}, 300_000);

afterAll(async () => {
  await db?.end();
  const c = cluster;
  cluster = null;
  await c?.teardown();
});

/** Siembra recepciones confirmadas: lo que el backfill tiene que encontrar. */
async function sembrarRecepciones(n: number): Promise<string[]> {
  const { rows: cli } = await db.query<{ id: string }>(
    `insert into public.clients (razon, cuit) values ('DEPOSITANTE BACKFILL', '30111111110')
     returning id`,
  );
  const clientId = cli[0].id;
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const { rows: inv } = await db.query<{ id: string }>(
      `insert into public.inventory_items (sku, description, client_name, client_id, stock_available)
       values ($1, 'Bien sembrado', 'DEPOSITANTE BACKFILL', $2, 10) returning id`,
      [`SKU-BF-${i}`, clientId],
    );
    const { rows: rec } = await db.query<{ id: string }>(
      `insert into public.receptions (public_id, client_name, client_id, status, received_at)
       values ($1, 'DEPOSITANTE BACKFILL', $2, 'recibida', now()) returning id`,
      [`REC-BF-${i}`, clientId],
    );
    const { rows: it } = await db.query<{ id: string }>(
      `insert into public.reception_items
         (reception_id, business_unit, sku, description, lot_number, expiration_date,
          quantity, status, inventory_item_id)
       values ($1, 'GENERAL', $2, 'Bien sembrado', $3, '2027-12-31', 10,
               $4::public.reception_item_status_t, $5)
       returning id`,
      [rec[0].id, `SKU-BF-${i}`, `LOT-BF-${i}`, i % 2 === 0 ? "recibido" : "cuarentena", inv[0].id],
    );
    ids.push(it[0].id);
  }
  return ids;
}

describe("T-C5-06 · el backfill de 0250a con filas reales", () => {
  it("1 · la migración aplica sin error sobre una base CON reception_items", async () => {
    const sembrados = await sembrarRecepciones(3);
    expect(sembrados).toHaveLength(3);

    // Sin la corrección de orden esto revienta con 55006, porque el backfill
    // deja eventos de trigger pendientes y después vienen tres ALTER TABLE
    // sobre `custody_integrity_cases`.
    await expect(db.query(SQL_0250A)).resolves.toBeDefined();
  }, 300_000);

  it("2 · materializó una unidad física y un caso por cada ítem recibido", async () => {
    const { rows } = await db.query<{ unidades: string; casos: string }>(
      `select
         (select count(*) from public.custody_physical_units)::text as unidades,
         (select count(*) from public.custody_integrity_cases
           where physical_unit_id is not null)::text as casos`,
    );
    expect(Number(rows[0].unidades)).toBe(3);
    expect(Number(rows[0].casos)).toBe(3);
  });

  it("3 · los casos nacen en PENDING_EVIDENCE con la evidencia faltante", async () => {
    const { rows } = await db.query<{ state: string; hold_reasons: string[] }>(
      `select state, hold_reasons from public.custody_integrity_cases
        where physical_unit_id is not null`,
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.state).toBe("PENDING_EVIDENCE");
      expect(r.hold_reasons).toContain("EVIDENCE_MISSING");
    }
  });

  it("4 · la unidad física conserva la identidad del ítem recibido", async () => {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n
         from public.custody_physical_units u
         join public.reception_items ri on ri.id = u.reception_item_id
        where u.sku = ri.sku and u.quantity = ri.quantity
          and u.lot_number is not distinct from ri.lot_number
          and u.inventory_item_id = ri.inventory_item_id`,
    );
    expect(Number(rows[0].n)).toBe(3);
  });

  it("5 · el backfill es idempotente: reaplicar no duplica", async () => {
    await db.query(SQL_0250A);
    const { rows } = await db.query<{ unidades: string; casos: string }>(
      `select
         (select count(*) from public.custody_physical_units)::text as unidades,
         (select count(*) from public.custody_integrity_cases
           where physical_unit_id is not null)::text as casos`,
    );
    expect(Number(rows[0].unidades)).toBe(3);
    expect(Number(rows[0].casos)).toBe(3);
  }, 300_000);

  it("6 · el backfill corre DESPUÉS de todo el DDL sobre custody_integrity_cases", () => {
    // La invariante estructural, afirmada sobre el archivo: si alguien vuelve a
    // colocar el bloque antes de un ALTER de esa tabla, esto cae en rojo aunque
    // la base de la prueba estuviera vacía.
    const posBackfill = SQL_0250A.indexOf("-- Backfill idempotente");
    expect(posBackfill).toBeGreaterThan(-1);
    const ultimoAlter = SQL_0250A.lastIndexOf("alter table public.custody_integrity_cases");
    expect(ultimoAlter).toBeGreaterThan(-1);
    expect(posBackfill).toBeGreaterThan(ultimoAlter);
  });
});
