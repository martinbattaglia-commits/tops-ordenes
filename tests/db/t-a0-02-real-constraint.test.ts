/**
 * T-A0-02 · PRUEBA DISCRIMINANTE — el harness observa restricciones REALES.
 *
 * Demuestra que el harness no es decorativo. Cada caso ejercita una defensa
 * que existe en el esquema productivo y que fallaría si:
 *   · el loader no aplicó la migración correcta;
 *   · el constraint fue omitido del manifiesto;
 *   · el trigger no se creó;
 *   · la conexión apunta a una base incorrecta o vacía.
 *
 * Los tests pasan PORQUE el intento inválido fue rechazado. No hay ningún
 * caso permanentemente rojo, y no se alteró ningún archivo del candidato para
 * fabricar la discriminación.
 *
 * Fixtures efímeras: cada caso crea sus filas y las deja marcadas con un
 * prefijo `__A0__`. Nunca se tocan datos productivos — el harness corre sobre
 * un cluster propio que se destruye al terminar.
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { emitSentinelWhenGreen } from "./harness/sentinel";
import { Client } from "pg";

let client: Client;

/** Sujeto de prueba: usuario, recepción ANMAT y recepción GENERAL. */
async function seedReception(bu: "ANMAT" | "GENERAL"): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.receptions (client_name, business_unit, status)
     values ($1, $2, 'pendiente') returning id`,
    [`__A0__${bu}`, bu],
  );
  return rows[0].id;
}

beforeAll(async () => {
  client = new Client({ connectionString: inject("dbUrl") });
  await client.connect();
});

afterAll(async () => {
  await client?.end();
});

describe("T-A0-02 · restricciones reales del esquema", () => {
  emitSentinelWhenGreen("P3_N1A0_REAL_CONSTRAINT_DETECTED");

  it("CHECK ANMAT: rechaza una línea ANMAT sin lote ni vencimiento", async () => {
    const receptionId = await seedReception("ANMAT");

    await expect(
      client.query(
        `insert into public.reception_items
           (reception_id, business_unit, sku, description, quantity)
         values ($1, 'ANMAT', '__A0__SKU', 'unidad de prueba', 1)`,
        [receptionId],
      ),
    ).rejects.toThrow(/reception_items_anmat_lot_chk/);
  });

  it("CHECK ANMAT: acepta la MISMA línea con lote y vencimiento (control positivo)", async () => {
    const { rows } = await client.query<{ id: string }>(
      `select id from public.receptions where client_name = '__A0__ANMAT' limit 1`,
    );
    const res = await client.query(
      `insert into public.reception_items
         (reception_id, business_unit, sku, description, quantity, lot_number, expiration_date)
       values ($1, 'ANMAT', '__A0__SKU', 'unidad de prueba', 1, 'L-A0-1', '2029-01-01')
       returning id`,
      [rows[0].id],
    );
    expect(res.rowCount).toBe(1);
  });

  it("trigger de business_unit: la línea hereda el BU de la cabecera", async () => {
    const receptionId = await seedReception("GENERAL");
    // Se intenta forzar 'ANMAT' en la línea; el trigger debe sobrescribirlo
    // con el 'GENERAL' de la cabecera. Si no lo hiciera, el CHECK ANMAT
    // rechazaría esta fila por falta de lote — así que el éxito del insert
    // prueba que el trigger corrió.
    const res = await client.query<{ business_unit: string }>(
      `insert into public.reception_items
         (reception_id, business_unit, sku, description, quantity)
       values ($1, 'ANMAT', '__A0__SKU2', 'hereda BU', 1)
       returning business_unit`,
      [receptionId],
    );
    expect(res.rows[0].business_unit).toBe("GENERAL");
  });

  it("ledger append-only: el trigger rechaza UPDATE sobre inventory_movements", async () => {
    await client.query(
      `insert into public.inventory_movements
         (movement_type, quantity, before_quantity, after_quantity)
       values ('ajuste', 1, 0, 1)`,
    );

    await expect(
      client.query(`update public.inventory_movements set reason = '__A0__hack'`),
    ).rejects.toThrow(/ledger append-only/i);
  });

  it("ledger append-only: el trigger rechaza DELETE sobre inventory_movements", async () => {
    await expect(
      client.query(`delete from public.inventory_movements`),
    ).rejects.toThrow(/ledger append-only/i);
  });

  it("ledger append-only: el guard de statement rechaza TRUNCATE", async () => {
    await expect(
      client.query(`truncate table public.inventory_movements`),
    ).rejects.toThrow(/ledger append-only/i);
  });

  it("identidad de inventario: (client_name, sku, position_id) es única", async () => {
    await client.query(
      `insert into public.inventory_items (sku, description, client_name, position_id)
       values ('__A0__DUP', 'primera', '__A0__CLIENTE', null)`,
    );
    // position_id NULL: el índice actual NO usa NULLS NOT DISTINCT, por lo que
    // este segundo insert NO viola la unicidad. Se documenta el defecto M-1
    // tal como está hoy; P3-N1B deberá invertir esta expectativa.
    const res = await client.query(
      `insert into public.inventory_items (sku, description, client_name, position_id)
       values ('__A0__DUP', 'segunda', '__A0__CLIENTE', null) returning id`,
    );
    expect(res.rowCount).toBe(1);

    // Con posición NO nula, en cambio, la unicidad sí se aplica.
    const { rows: pos } = await client.query<{ id: string }>(
      `select id from public.warehouse_positions limit 1`,
    );
    if (pos.length > 0) {
      await client.query(
        `insert into public.inventory_items (sku, description, client_name, position_id)
         values ('__A0__UK', 'primera', '__A0__CLIENTE', $1)`,
        [pos[0].id],
      );
      await expect(
        client.query(
          `insert into public.inventory_items (sku, description, client_name, position_id)
           values ('__A0__UK', 'segunda', '__A0__CLIENTE', $1)`,
          [pos[0].id],
        ),
      ).rejects.toThrow(/inventory_items_identity_uk/);
    }
  });

  it("autorización de RPC: confirm_reception rechaza a un principal sin rol", async () => {
    const receptionId = await seedReception("GENERAL");
    // Sin `request.jwt.claim.sub`, current_role() devuelve NULL y la RPC debe
    // abortar con insufficient_privilege. Prueba que 0027 se aplicó de verdad.
    await expect(
      client.query(`select public.confirm_reception($1)`, [receptionId]),
    ).rejects.toThrow(/no autorizado/i);
  });

});
