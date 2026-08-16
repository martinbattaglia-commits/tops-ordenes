/**
 * T-C5-01 · GENEALOGÍA FÍSICA — allocation multi-lote e ingreso sin recepción.
 *
 * Por qué existe: `allocate_order` dimensiona la reserva con el stock DEL ÍTEM
 * y la estampa con un lote FEFO REPRESENTATIVO (`limit 1`,
 * 0031_pedidos_functions.sql:113-118). `custody_bind_allocation` exigía cubrir
 * la cantidad con unidades de ESE único lote, así que una reserva que abarcaba
 * dos lotes abortaba con CUSTODY_GENEALOGY_MISSING — y como el trigger es
 * AFTER INSERT, se caía la reserva entera. En la ruta ANMAT, donde el lote es
 * obligatorio, ese es el caso normal, no el borde.
 *
 * Decisión de dominio que estas pruebas fijan:
 *   1. la vinculación recorre TODAS las unidades del ítem en orden FEFO
 *      (vencimiento, luego llegada), porque el lote de la allocation es
 *      trazabilidad y no una restricción de pick;
 *   2. una cobertura PARCIAL no rompe la reserva: queda registrada tal cual y
 *      el bloqueo se aplica donde corresponde, al liberar/despachar, que es
 *      donde `custody_assert_allocation_released` ya exige cobertura exacta.
 *      Reservar no es sacar el bien de custodia; despachar sí.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { actAsServer, baseScenario, uid, type Scenario } from "./harness/fixtures";

let db: Client;
let s: Scenario;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
  s = await baseScenario(db);
  await actAsServer(db);
});

afterAll(async () => { await db.end(); });

/** Ítem de inventario con su stock disponible ya cargado. */
async function crearItem(stock: number): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.inventory_items (sku, description, client_name, client_id, stock_available)
     values ($1, 'Bien de prueba', 'DEPOSITANTE', $2, $3) returning id`,
    [uid("SKU"), s.clientId, stock],
  );
  return rows[0].id;
}

/**
 * Recepción confirmada con un ítem por lote. El trigger de 0250a materializa
 * una `custody_physical_units` por cada ítem recibido, que es la genealogía.
 */
async function recibir(
  inventoryItemId: string,
  lotes: Array<{ lote: string | null; cantidad: number; vence: string | null }>,
): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.receptions (public_id, client_name, client_id, status, received_at)
     values ($1, 'DEPOSITANTE', $2, 'recibida', now()) returning id`,
    [uid("REC"), s.clientId],
  );
  const receptionId = rows[0].id;
  for (const l of lotes) {
    await db.query(
      `insert into public.reception_items
         (reception_id, business_unit, sku, description, lot_number, expiration_date,
          quantity, status, inventory_item_id)
       values ($1, 'GENERAL', $2, 'Bien de prueba', $3, $4, $5, 'recibido', $6)`,
      [receptionId, uid("SKU"), l.lote, l.vence, l.cantidad, inventoryItemId],
    );
  }
}

/** Reserva con el lote REPRESENTATIVO que estamparía `allocate_order`. */
async function reservar(
  inventoryItemId: string,
  cantidad: number,
  loteRepresentativo: string | null,
): Promise<string> {
  const { rows: ord } = await db.query<{ id: string }>(
    `insert into public.logistics_orders (public_id, client_name)
     values ($1, 'DEPOSITANTE') returning id`,
    [uid("ORD")],
  );
  const { rows: li } = await db.query<{ id: string }>(
    `insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
     values ($1, $2, 'Bien de prueba', $3) returning id`,
    [ord[0].id, uid("SKU"), cantidad],
  );
  const { rows: al } = await db.query<{ id: string }>(
    `insert into public.stock_allocations (order_item_id, inventory_item_id, lot_number, quantity)
     values ($1, $2, $3, $4) returning id`,
    [li[0].id, inventoryItemId, loteRepresentativo, cantidad],
  );
  return al[0].id;
}

async function cobertura(allocationId: string): Promise<number> {
  const { rows } = await db.query<{ q: string | null }>(
    `select sum(quantity)::text as q from public.custody_allocation_physical_units
      where allocation_id = $1`,
    [allocationId],
  );
  return Number(rows[0].q ?? 0);
}

describe("T-C5-01 · la reserva multi-lote se vincula completa", () => {
  it("1 · una allocation de 15 sobre dos lotes de 10 queda cubierta por ambos", async () => {
    const item = await crearItem(20);
    await recibir(item, [
      { lote: "LOT-A", cantidad: 10, vence: "2027-01-31" },
      { lote: "LOT-B", cantidad: 10, vence: "2027-06-30" },
    ]);

    // `allocate_order` habría estampado LOT-A: el más próximo a vencer.
    const alloc = await reservar(item, 15, "LOT-A");

    expect(await cobertura(alloc)).toBe(15);

    const { rows } = await db.query<{ lot_number: string; q: string }>(
      `select pu.lot_number, g.quantity::text as q
         from public.custody_allocation_physical_units g
         join public.custody_physical_units pu on pu.id = g.physical_unit_id
        where g.allocation_id = $1
        order by pu.expiration_date`,
      [alloc],
    );
    // FEFO real: se consume primero el lote que vence antes.
    expect(rows.map((r) => [r.lot_number, Number(r.q)])).toEqual([
      ["LOT-A", 10],
      ["LOT-B", 5],
    ]);
  });

  it("2 · el orden es FEFO por vencimiento, no por llegada", async () => {
    const item = await crearItem(20);
    // El que llega PRIMERO vence DESPUÉS: si el orden fuera por llegada, se
    // consumiría el equivocado.
    await recibir(item, [{ lote: "TARDE", cantidad: 10, vence: "2028-12-31" }]);
    await recibir(item, [{ lote: "PRONTO", cantidad: 10, vence: "2026-12-31" }]);

    const alloc = await reservar(item, 6, "PRONTO");
    const { rows } = await db.query<{ lot_number: string }>(
      `select pu.lot_number from public.custody_allocation_physical_units g
         join public.custody_physical_units pu on pu.id = g.physical_unit_id
        where g.allocation_id = $1`,
      [alloc],
    );
    expect(rows.map((r) => r.lot_number)).toEqual(["PRONTO"]);
  });
});

describe("T-C5-01 · el stock sin recepción no rompe la reserva, bloquea el despacho", () => {
  it("3 · una allocation sin genealogía suficiente se reserva igual, con cobertura parcial", async () => {
    const item = await crearItem(30);
    // Sólo 10 entraron por recepción; los otros 20, por ajuste de inventario,
    // que no crea `reception_items` y por tanto no tiene unidad física.
    await recibir(item, [{ lote: "LOT-REAL", cantidad: 10, vence: "2027-03-31" }]);

    const alloc = await reservar(item, 25, "LOT-REAL");
    // La reserva NO se cae: reservar no saca el bien de custodia.
    expect(await cobertura(alloc)).toBe(10);
  });

  it("4 · pero liberar esa allocation sigue siendo imposible", async () => {
    const item = await crearItem(30);
    await recibir(item, [{ lote: "LOT-REAL", cantidad: 10, vence: "2027-03-31" }]);
    const alloc = await reservar(item, 25, "LOT-REAL");

    await expect(
      db.query(`select public.custody_assert_allocation_released($1)`, [alloc]),
    ).rejects.toThrow(/CUSTODY_GENEALOGY_MISSING/);
  });

  it("5 · y la cobertura exacta sí habilita el chequeo de liberación", async () => {
    const item = await crearItem(10);
    await recibir(item, [{ lote: "LOT-EXACTO", cantidad: 10, vence: "2027-03-31" }]);
    const alloc = await reservar(item, 10, "LOT-EXACTO");
    expect(await cobertura(alloc)).toBe(10);

    // Ya no falla por genealogía: ahora el bloqueo es el del CASO, que es el
    // control que el contrato pide.
    const msg = await db
      .query(`select public.custody_assert_allocation_released($1)`, [alloc])
      .then(() => "")
      .catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
    expect(msg).not.toMatch(/CUSTODY_GENEALOGY_MISSING/);
  });
});

describe("T-C5-01 · la vinculación es idempotente y no duplica", () => {
  it("6 · re-vincular no agrega cobertura ni rompe", async () => {
    const item = await crearItem(10);
    await recibir(item, [{ lote: "LOT-IDEM", cantidad: 10, vence: "2027-03-31" }]);
    const alloc = await reservar(item, 8, "LOT-IDEM");
    expect(await cobertura(alloc)).toBe(8);

    await db.query(`select public.custody_bind_allocation($1)`, [alloc]);
    expect(await cobertura(alloc)).toBe(8);
  });

  it("7 · una cobertura parcial se completa si después aparece la genealogía", async () => {
    const item = await crearItem(20);
    await recibir(item, [{ lote: "LOT-1", cantidad: 5, vence: "2027-03-31" }]);
    const alloc = await reservar(item, 12, "LOT-1");
    expect(await cobertura(alloc)).toBe(5);

    // Llega el resto por una recepción posterior.
    await recibir(item, [{ lote: "LOT-2", cantidad: 7, vence: "2027-09-30" }]);
    await db.query(`select public.custody_bind_allocation($1)`, [alloc]);
    expect(await cobertura(alloc)).toBe(12);
  });
});
