/**
 * T-N1B-02 · Proyección determinista de business_unit (ADR-P3-06 §6.a) y
 * anomalías durables multi-BU (ADR-P3-11).
 *
 * Invariantes que estos casos hacen ejecutables:
 *   · la ÚNICA fuente es reception_items.business_unit vía inventory_item_id;
 *   · 1 BU → se proyecta; >1 BU → SIN VALOR + anomalía durable (jamás se
 *     elige una); 0 vínculos → SIN VALOR;
 *   · regla 3: una línea que dejó de ser cierta NO se conserva;
 *   · la anomalía se RESUELVE (resolved_at), no se borra;
 *   · las anomalías no son escribibles por roles de aplicación.
 *
 * Cada caso corre en su propia transacción con ROLLBACK.
 */

import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { Client } from "pg";
import { connectGuarded } from "./harness/cluster";
import { emitSentinelWhenGreen } from "./harness/sentinel";

let client: Client;

beforeAll(async () => {
  client = await connectGuarded(inject("dbUrl"));
});

afterAll(async () => {
  await client?.end();
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
    [`__N1B2_${tag}__`, `N1B2-${tag}`],
  );
  return rows[0].id;
}

async function seedItem(clientId: string, sku: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.inventory_items (sku, description, client_name, client_id)
     values ($1, 'proyección', '__N1B2__', $2) returning id`,
    [sku, clientId],
  );
  return rows[0].id;
}

/** Recepción + una línea; devuelve el id de la LÍNEA (sin vincular aún). */
async function seedReceptionLine(
  clientId: string,
  bu: "ANMAT" | "GENERAL" | "CORPORATE",
  sku: string,
): Promise<{ receptionId: string; lineId: string }> {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.receptions (client_name, client_id, business_unit, status)
     values ('__N1B2__', $1, $2, 'pendiente') returning id`,
    [clientId, bu],
  );
  const receptionId = rows[0].id;
  const { rows: lines } = await client.query<{ id: string }>(
    `insert into public.reception_items
       (reception_id, business_unit, sku, description, quantity, lot_number, expiration_date)
     values ($1, $2, $3, 'línea', 1, 'L-1', '2030-01-01') returning id`,
    [receptionId, bu, sku],
  );
  return { receptionId, lineId: lines[0].id };
}

async function itemBu(itemId: string): Promise<string | null> {
  const { rows } = await client.query<{ business_unit: string | null }>(
    `select business_unit from public.inventory_items where id = $1`,
    [itemId],
  );
  return rows[0].business_unit;
}

async function openAnomalies(itemId: string): Promise<Array<{ business_units: string[] }>> {
  const { rows } = await client.query<{ business_units: string[] }>(
    `select business_units::text[] as business_units
       from public.inventory_bu_anomalies
      where inventory_item_id = $1 and resolved_at is null`,
    [itemId],
  );
  return rows;
}

describe("T-N1B-02 · proyección de business_unit", () => {
  emitSentinelWhenGreen("P3_N1B_BU_PROJECTION_VERIFIED");

  it("un ítem sin vínculos de recepción queda SIN línea (nada se infiere)", async () => {
    await withRollback(async () => {
      const c = await seedClient("SIN");
      const item = await seedItem(c, "__N1B2_SKU_SIN__");
      expect(await itemBu(item)).toBeNull();
    });
  });

  it("un vínculo de UNA sola BU proyecta esa BU al ítem", async () => {
    await withRollback(async () => {
      const c = await seedClient("UNA");
      const item = await seedItem(c, "__N1B2_SKU_UNA__");
      const { lineId } = await seedReceptionLine(c, "ANMAT", "__N1B2_SKU_UNA__");
      await client.query(
        `update public.reception_items set inventory_item_id = $1 where id = $2`,
        [item, lineId],
      );
      expect(await itemBu(item)).toBe("ANMAT");
      expect(await openAnomalies(item)).toHaveLength(0);
    });
  });

  it("multi-BU ⇒ SIN VALOR + anomalía durable con ambas BU (jamás se elige una)", async () => {
    await withRollback(async () => {
      const c = await seedClient("MULTI");
      const item = await seedItem(c, "__N1B2_SKU_M__");
      const a = await seedReceptionLine(c, "GENERAL", "__N1B2_SKU_M__");
      await client.query(
        `update public.reception_items set inventory_item_id = $1 where id = $2`,
        [item, a.lineId],
      );
      // Regla 3 en acción: el ítem TENÍA 'GENERAL' (cierta hasta acá)…
      expect(await itemBu(item)).toBe("GENERAL");

      const b = await seedReceptionLine(c, "ANMAT", "__N1B2_SKU_M__");
      await client.query(
        `update public.reception_items set inventory_item_id = $1 where id = $2`,
        [item, b.lineId],
      );
      // …y al dejar de ser cierta NO se conserva: sin valor + anomalía.
      expect(await itemBu(item)).toBeNull();
      const anomalies = await openAnomalies(item);
      expect(anomalies).toHaveLength(1);
      expect(anomalies[0].business_units).toEqual(["ANMAT", "GENERAL"]);
    });
  });

  it("reconvergencia: al desvincular la BU discordante, la línea vuelve y la anomalía se RESUELVE (no se borra)", async () => {
    await withRollback(async () => {
      const c = await seedClient("RECONV");
      const item = await seedItem(c, "__N1B2_SKU_R__");
      const a = await seedReceptionLine(c, "GENERAL", "__N1B2_SKU_R__");
      const b = await seedReceptionLine(c, "ANMAT", "__N1B2_SKU_R__");
      await client.query(
        `update public.reception_items set inventory_item_id = $1 where id in ($2, $3)`,
        [item, a.lineId, b.lineId],
      );
      expect(await itemBu(item)).toBeNull();
      expect(await openAnomalies(item)).toHaveLength(1);

      await client.query(
        `update public.reception_items set inventory_item_id = null where id = $1`,
        [b.lineId],
      );
      expect(await itemBu(item)).toBe("GENERAL");
      expect(await openAnomalies(item)).toHaveLength(0);
      // Durabilidad: la anomalía sigue existiendo, resuelta — es historia, no ruido.
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from public.inventory_bu_anomalies
          where inventory_item_id = $1 and resolved_at is not null`,
        [item],
      );
      expect(rows[0].n).toBe("1");
    });
  });

  it("borrar la línea de recepción también recomputa (DELETE cubierto)", async () => {
    await withRollback(async () => {
      const c = await seedClient("DEL");
      const item = await seedItem(c, "__N1B2_SKU_D__");
      const a = await seedReceptionLine(c, "GENERAL", "__N1B2_SKU_D__");
      const b = await seedReceptionLine(c, "ANMAT", "__N1B2_SKU_D__");
      await client.query(
        `update public.reception_items set inventory_item_id = $1 where id in ($2, $3)`,
        [item, a.lineId, b.lineId],
      );
      expect(await itemBu(item)).toBeNull();

      await client.query(`delete from public.reception_items where id = $1`, [a.lineId]);
      expect(await itemBu(item)).toBe("ANMAT");
      expect(await openAnomalies(item)).toHaveLength(0);
    });
  });

  it("B-01 · eliminar TODOS los vínculos LIMPIA la BU anterior (sin fuente ⇒ sin valor)", async () => {
    // Discriminante del Guardian externo: la regla 3 no es sólo «no elegir» —
    // una línea que se quedó SIN fuente de proyección tampoco puede
    // conservarse. Un mutante que preserve el valor previo ante cero vínculos
    // pone este caso en rojo.
    await withRollback(async () => {
      const c = await seedClient("B01A");
      const item = await seedItem(c, "__N1B2_SKU_B01A__");
      const a = await seedReceptionLine(c, "GENERAL", "__N1B2_SKU_B01A__");
      const b = await seedReceptionLine(c, "GENERAL", "__N1B2_SKU_B01A__");
      await client.query(
        `update public.reception_items set inventory_item_id = $1 where id in ($2, $3)`,
        [item, a.lineId, b.lineId],
      );
      // Precondición: la BU quedó proyectada desde la única fuente legítima.
      expect(await itemBu(item)).toBe("GENERAL");

      // Se eliminan TODOS los vínculos (borrado físico de ambas líneas).
      await client.query(`delete from public.reception_items where id in ($1, $2)`, [
        a.lineId,
        b.lineId,
      ]);
      // Sin vínculos no hay fuente: la BU anterior NO sobrevive.
      expect(await itemBu(item)).toBeNull();
      expect(await openAnomalies(item)).toHaveLength(0);
    });
  });

  it("B-01 · desvincular TODOS los vínculos también limpia y RESUELVE la anomalía abierta", async () => {
    await withRollback(async () => {
      const c = await seedClient("B01B");
      const item = await seedItem(c, "__N1B2_SKU_B01B__");
      const a = await seedReceptionLine(c, "GENERAL", "__N1B2_SKU_B01B__");
      const b = await seedReceptionLine(c, "ANMAT", "__N1B2_SKU_B01B__");
      await client.query(
        `update public.reception_items set inventory_item_id = $1 where id in ($2, $3)`,
        [item, a.lineId, b.lineId],
      );
      // Precondición: multi-BU ⇒ sin valor + anomalía ABIERTA.
      expect(await itemBu(item)).toBeNull();
      expect(await openAnomalies(item)).toHaveLength(1);

      // Desvinculación (update a NULL) de TODOS los vínculos, no borrado.
      await client.query(
        `update public.reception_items set inventory_item_id = null where id in ($1, $2)`,
        [a.lineId, b.lineId],
      );
      expect(await itemBu(item)).toBeNull();
      expect(await openAnomalies(item)).toHaveLength(0);
      // Durable y trazable: la anomalía quedó RESUELTA con el motivo correcto.
      const { rows } = await client.query<{ notes: string | null }>(
        `select notes from public.inventory_bu_anomalies
          where inventory_item_id = $1 and resolved_at is not null`,
        [item],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].notes).toMatch(/sin vínculos de recepción/);
    });
  });

  it("cambiar la BU de la cabecera cascadea a la línea y re-proyecta el ítem", async () => {
    await withRollback(async () => {
      const c = await seedClient("CASC");
      const item = await seedItem(c, "__N1B2_SKU_C__");
      const a = await seedReceptionLine(c, "ANMAT", "__N1B2_SKU_C__");
      await client.query(
        `update public.reception_items set inventory_item_id = $1 where id = $2`,
        [item, a.lineId],
      );
      expect(await itemBu(item)).toBe("ANMAT");
      // 0025 cascadea receptions.business_unit → reception_items; el trigger de
      // 0219 escucha UPDATE OF business_unit y re-proyecta.
      await client.query(
        `update public.receptions set business_unit = 'CORPORATE'
          where id = (select reception_id from public.reception_items where id = $1)`,
        [a.lineId],
      );
      expect(await itemBu(item)).toBe("CORPORATE");
    });
  });

  it("CORPORATE se proyecta tal cual: NO se traduce a GENERAL ni a ANMAT (ADR-P3-12)", async () => {
    await withRollback(async () => {
      const c = await seedClient("CORP");
      const item = await seedItem(c, "__N1B2_SKU_CO__");
      const a = await seedReceptionLine(c, "CORPORATE", "__N1B2_SKU_CO__");
      await client.query(
        `update public.reception_items set inventory_item_id = $1 where id = $2`,
        [item, a.lineId],
      );
      expect(await itemBu(item)).toBe("CORPORATE");
    });
  });

  it("los roles de aplicación NO pueden escribir anomalías (sin policy de escritura)", async () => {
    await withRollback(async () => {
      const c = await seedClient("RLSA");
      const item = await seedItem(c, "__N1B2_SKU_RLS__");
      await client.query(`select set_config('request.jwt.claim.role','authenticated',true)`);
      await client.query(`set local row_security = on`);
      await client.query(`set local role authenticated`);
      await expect(
        client.query(
          `insert into public.inventory_bu_anomalies (inventory_item_id, business_units)
           values ($1, array['GENERAL']::business_unit_t[])`,
          [item],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("a lo sumo UNA anomalía abierta por ítem (unicidad parcial), actualizada en el lugar", async () => {
    await withRollback(async () => {
      const c = await seedClient("UK");
      const item = await seedItem(c, "__N1B2_SKU_UK__");
      const a = await seedReceptionLine(c, "GENERAL", "__N1B2_SKU_UK__");
      const b = await seedReceptionLine(c, "ANMAT", "__N1B2_SKU_UK__");
      const d = await seedReceptionLine(c, "CORPORATE", "__N1B2_SKU_UK__");
      await client.query(
        `update public.reception_items set inventory_item_id = $1 where id in ($2, $3)`,
        [item, a.lineId, b.lineId],
      );
      expect(await openAnomalies(item)).toHaveLength(1);
      // Tercera BU: la MISMA anomalía abierta se actualiza, no se duplica.
      await client.query(
        `update public.reception_items set inventory_item_id = $1 where id = $2`,
        [item, d.lineId],
      );
      const anomalies = await openAnomalies(item);
      expect(anomalies).toHaveLength(1);
      expect(anomalies[0].business_units).toEqual(["ANMAT", "GENERAL", "CORPORATE"]);
    });
  });
});
