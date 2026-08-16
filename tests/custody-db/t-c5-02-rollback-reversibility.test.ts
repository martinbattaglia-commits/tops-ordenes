/**
 * T-C5-02 · REVERSIBILIDAD REAL DEL ROLLBACK LÓGICO DE 0250/0250a.
 *
 * El rollback es la vía de escape documentada, y su encabezado promete que
 * «retira las superficies/gates nuevos». No alcanzaba con leerlo: dejaba armado
 * `trg_custody_lock_reception_identity`, que 0250a instala sobre
 * `reception_items` —tabla central del WMS— y que bloquea DELETE y todo UPDATE
 * de identidad para cualquier ítem con unidad física. Como el backfill
 * materializa una unidad por CADA ítem recibido, ejecutar el rollback dejaba el
 * histórico completo de recepciones permanentemente incorregible, sin ningún
 * código vivo que explicara por qué.
 *
 * El rollback se ejecuta DE VERDAD contra la base del harness, dentro de una
 * transacción que se descarta al final: el DDL en PostgreSQL es transaccional,
 * así que la reversibilidad se comprueba sin contaminar al resto de la suite.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { actAsServer, baseScenario, uid, type Scenario } from "./harness/fixtures";
import { REPO_ROOT } from "./harness/manifest";

const ROLLBACK_SQL = readFileSync(
  join(REPO_ROOT, "supabase", "migrations", "ROLLBACK_0250a_custody_productive_vision.sql"),
  "utf8",
);

let db: Client;
let s: Scenario;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
  s = await baseScenario(db);
  await actAsServer(db);
});

afterAll(async () => { await db.end(); });

/** Ítem recibido con su unidad física ya materializada por 0250a. */
async function itemRecibido(): Promise<string> {
  const { rows: inv } = await db.query<{ id: string }>(
    `insert into public.inventory_items (sku, description, client_name, client_id, stock_available)
     values ($1, 'Bien de prueba', 'DEPOSITANTE', $2, 5) returning id`,
    [uid("SKU"), s.clientId],
  );
  const { rows: rec } = await db.query<{ id: string }>(
    `insert into public.receptions (public_id, client_name, client_id, status, received_at)
     values ($1, 'DEPOSITANTE', $2, 'recibida', now()) returning id`,
    [uid("REC"), s.clientId],
  );
  const { rows: it } = await db.query<{ id: string }>(
    `insert into public.reception_items
       (reception_id, business_unit, sku, description, lot_number, expiration_date,
        quantity, status, inventory_item_id)
     values ($1, 'GENERAL', $2, 'Bien de prueba', 'LOT-RB', '2027-05-31', 5, 'recibido', $3)
     returning id`,
    [rec[0].id, uid("SKU"), inv[0].id],
  );
  return it[0].id;
}

async function triggerExiste(nombre: string): Promise<boolean> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*)::text as n from pg_trigger where tgname = $1 and not tgisinternal`,
    [nombre],
  );
  return rows[0].n !== "0";
}

describe("T-C5-02 · el gate de identidad de recepción existe y muerde", () => {
  it("1 · con 0250a aplicado, el ítem recibido no se puede corregir ni borrar", async () => {
    const item = await itemRecibido();

    await expect(
      db.query(`update public.reception_items set quantity = 4 where id = $1`, [item]),
    ).rejects.toThrow();
    await expect(
      db.query(`delete from public.reception_items where id = $1`, [item]),
    ).rejects.toThrow();
  });
});

describe("T-C5-02 · el rollback lógico devuelve reception_items a su estado previo", () => {
  it("2 · tras ejecutar el rollback, el ítem histórico vuelve a ser corregible", async () => {
    const item = await itemRecibido();
    expect(await triggerExiste("trg_custody_lock_reception_identity")).toBe(true);

    await db.query("begin");
    try {
      await db.query(ROLLBACK_SQL);

      // La promesa del encabezado, comprobada: ningún gate nuevo queda armado.
      for (const t of [
        "trg_custody_lock_reception_identity",
        "trg_custody_materialize_reception_item",
        "trg_custody_bind_stock_allocation",
        "trg_stock_allocations_custody_release",
        "trg_packing_units_custody_release",
        "trg_shipments_custody_release",
        "trg_shipments_custody_final_state",
        "trg_delivery_pods_custody_release",
        "trg_packing_unit_items_custody_freeze",
      ]) {
        expect(await triggerExiste(t), t).toBe(false);
      }

      // Y la tabla del WMS vuelve a comportarse como antes de 0250a.
      await db.query(`update public.reception_items set quantity = 4 where id = $1`, [item]);
      const { rows } = await db.query<{ q: string }>(
        `select quantity::text as q from public.reception_items where id = $1`,
        [item],
      );
      expect(Number(rows[0].q)).toBe(4);

      // La evidencia NO se destruye: la unidad física sigue ahí.
      const { rows: pu } = await db.query<{ n: string }>(
        `select count(*)::text as n from public.custody_physical_units where reception_item_id = $1`,
        [item],
      );
      expect(pu[0].n).toBe("1");
    } finally {
      await db.query("rollback");
    }

    // Fuera de la transacción el esquema quedó intacto para el resto de la suite.
    expect(await triggerExiste("trg_custody_lock_reception_identity")).toBe(true);
  });

  it("3 · el rollback es idempotente: ejecutarlo dos veces no falla", async () => {
    await db.query("begin");
    try {
      await db.query(ROLLBACK_SQL);
      await db.query(ROLLBACK_SQL);
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from public.custody_integrity_policy_activations
          where enabled = false`,
      );
      // La desactivación se registra una sola vez: la segunda pasada no repite.
      expect(Number(rows[0].n)).toBe(1);
    } finally {
      await db.query("rollback");
    }
  });
});
