/**
 * T-A0-02 · PRUEBA DISCRIMINANTE — el harness observa restricciones REALES.
 *
 * Endurecido tras §9: cada caso corre en su PROPIA transacción con ROLLBACK.
 * Cero estado compartido, cero dependencia de orden, cero fixtures que
 * sobreviven al caso.
 *
 * Ninguna aserción se omite condicionalmente: donde antes había un `if` que
 * saltaba la comprobación si faltaba una posición, ahora hay una PRECONDICIÓN
 * EXPLÍCITA que falla de forma determinista si el esquema no la satisface.
 *
 * Los tests son fotografía del esquema ACTUAL. Los defectos que documentan
 * (identidad con posición nula) corresponden a P3-N1B; acá no se corrigen.
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { emitSentinelWhenGreen } from "./harness/sentinel";
import { Client } from "pg";
import { connectGuarded } from "./harness/cluster";

let client: Client;

beforeAll(async () => {
  client = await connectGuarded(inject("dbUrl"));
});

afterAll(async () => {
  await client?.end();
});

/** Ejecuta el cuerpo en una transacción que SIEMPRE se revierte. */
async function withRollback<T>(fn: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

async function seedReception(bu: "ANMAT" | "GENERAL"): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.receptions (client_name, business_unit, status)
     values ($1, $2, 'pendiente') returning id`,
    [`__A0__${bu}`, bu],
  );
  return rows[0].id;
}

/** Precondición explícita: el esquema debe tener posiciones físicas. */
async function requireWarehousePosition(): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `select id from public.warehouse_positions order by id limit 1`,
  );
  // Sin `if`: si 0023 no sembró posiciones, el caso FALLA, no se salta.
  expect(
    rows.length,
    "precondición: el esquema debe tener al menos una warehouse_position (0023)",
  ).toBe(1);
  return rows[0].id;
}

describe("T-A0-02 · restricciones reales del esquema", () => {
  emitSentinelWhenGreen("P3_N1A0_REAL_CONSTRAINT_DETECTED");

  it("CHECK ANMAT: rechaza una línea ANMAT sin lote ni vencimiento", async () => {
    await withRollback(async () => {
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
  });

  it("CHECK ANMAT: acepta la misma línea con lote y vencimiento (control positivo)", async () => {
    await withRollback(async () => {
      const receptionId = await seedReception("ANMAT");
      const res = await client.query(
        `insert into public.reception_items
           (reception_id, business_unit, sku, description, quantity, lot_number, expiration_date)
         values ($1, 'ANMAT', '__A0__SKU', 'unidad de prueba', 1, 'L-A0-1', '2029-01-01')
         returning id`,
        [receptionId],
      );
      expect(res.rowCount).toBe(1);
    });
  });

  it("CHECK ANMAT: rechaza con lote pero SIN vencimiento", async () => {
    await withRollback(async () => {
      const receptionId = await seedReception("ANMAT");
      await expect(
        client.query(
          `insert into public.reception_items
             (reception_id, business_unit, sku, description, quantity, lot_number)
           values ($1, 'ANMAT', '__A0__SKU', 'x', 1, 'L-1')`,
          [receptionId],
        ),
      ).rejects.toThrow(/reception_items_anmat_lot_chk/);
    });
  });

  it("trigger de business_unit: la línea hereda el BU de la cabecera", async () => {
    await withRollback(async () => {
      const receptionId = await seedReception("GENERAL");
      // Se intenta forzar 'ANMAT' en la línea; el trigger debe sobrescribirlo
      // con el 'GENERAL' de la cabecera. Si no corriera, el CHECK ANMAT
      // rechazaría la fila por falta de lote: el éxito prueba que corrió.
      const res = await client.query<{ business_unit: string }>(
        `insert into public.reception_items
           (reception_id, business_unit, sku, description, quantity)
         values ($1, 'ANMAT', '__A0__SKU2', 'hereda BU', 1)
         returning business_unit`,
        [receptionId],
      );
      expect(res.rows[0].business_unit).toBe("GENERAL");
    });
  });

  it("cascada de business_unit: cambiar la cabecera re-evalúa el CHECK de las líneas", async () => {
    await withRollback(async () => {
      const receptionId = await seedReception("GENERAL");
      await client.query(
        `insert into public.reception_items
           (reception_id, business_unit, sku, description, quantity)
         values ($1, 'GENERAL', '__A0__SKU3', 'sin lote', 1)`,
        [receptionId],
      );
      // Al pasar la cabecera a ANMAT, la línea sin lote debe violar el CHECK.
      await expect(
        client.query(`update public.receptions set business_unit = 'ANMAT' where id = $1`, [
          receptionId,
        ]),
      ).rejects.toThrow(/reception_items_anmat_lot_chk/);
    });
  });

  it("ledger append-only: el trigger rechaza UPDATE", async () => {
    await withRollback(async () => {
      await client.query(
        `insert into public.inventory_movements
           (movement_type, quantity, before_quantity, after_quantity)
         values ('ajuste', 1, 0, 1)`,
      );
      await expect(
        client.query(`update public.inventory_movements set reason = '__A0__hack'`),
      ).rejects.toThrow(/ledger append-only/i);
    });
  });

  it("ledger append-only: el trigger rechaza DELETE", async () => {
    await withRollback(async () => {
      await client.query(
        `insert into public.inventory_movements
           (movement_type, quantity, before_quantity, after_quantity)
         values ('ajuste', 1, 0, 1)`,
      );
      await expect(client.query(`delete from public.inventory_movements`)).rejects.toThrow(
        /ledger append-only/i,
      );
    });
  });

  it("ledger append-only: el guard de statement rechaza TRUNCATE", async () => {
    await withRollback(async () => {
      await expect(client.query(`truncate table public.inventory_movements`)).rejects.toThrow(
        /ledger append-only/i,
      );
    });
  });

  it("identidad: (client_name, sku, position_id) es única con posición NO nula", async () => {
    await withRollback(async () => {
      const positionId = await requireWarehousePosition();
      await client.query(
        `insert into public.inventory_items (sku, description, client_name, position_id)
         values ('__A0__UK', 'primera', '__A0__CLIENTE', $1)`,
        [positionId],
      );
      await expect(
        client.query(
          `insert into public.inventory_items (sku, description, client_name, position_id)
           values ('__A0__UK', 'segunda', '__A0__CLIENTE', $1)`,
          [positionId],
        ),
      ).rejects.toThrow(/inventory_items_identity_uk/);
    });
  });

  it("identidad: con posición NULA el índice NO impide duplicados (defecto M-1 vigente)", async () => {
    await withRollback(async () => {
      await client.query(
        `insert into public.inventory_items (sku, description, client_name, position_id)
         values ('__A0__DUP', 'primera', '__A0__CLIENTE', null)`,
      );
      // El índice no declara NULLS NOT DISTINCT, así que el segundo insert pasa.
      // Fotografía del defecto tal como está HOY; P3-N1B deberá invertir esta
      // expectativa al incorporar NULLS NOT DISTINCT.
      const res = await client.query(
        `insert into public.inventory_items (sku, description, client_name, position_id)
         values ('__A0__DUP', 'segunda', '__A0__CLIENTE', null) returning id`,
      );
      expect(res.rowCount).toBe(1);
    });
  });

  it("autorización de RPC: confirm_reception rechaza a un principal sin rol", async () => {
    await withRollback(async () => {
      const receptionId = await seedReception("GENERAL");
      // Sin `request.jwt.claim.sub`, current_role() devuelve NULL y la RPC debe
      // abortar con insufficient_privilege. Prueba que 0027 se aplicó de verdad.
      await expect(
        client.query(`select public.confirm_reception($1)`, [receptionId]),
      ).rejects.toThrow(/no autorizado/i);
    });
  });

  it("cada caso queda aislado: la transacción anterior no dejó filas", async () => {
    const { rows } = await client.query<{ n: string }>(
      `select count(*)::text as n from public.inventory_items where client_name like '\\_\\_A0\\_\\_%'`,
    );
    expect(rows[0].n).toBe("0");
    const { rows: recs } = await client.query<{ n: string }>(
      `select count(*)::text as n from public.receptions where client_name like '\\_\\_A0\\_\\_%'`,
    );
    expect(recs[0].n).toBe("0");
  });
});
