/**
 * T-C7-06 · LA PUERTA DE EGRESO SIGUE CERRADA · PROBADO POR EJECUCIÓN.
 *
 * ─── POR QUÉ ESTE ARCHIVO EXISTE ─────────────────────────────────────────
 *
 * La ventana POD-Y-FIRMA (fila 11b) destrabó el POD de la unidad física en la
 * capa de presentación. La línea que no se cruza: ese destrabe NO puede
 * aflojar la puerta de egreso. La cadena
 *
 *     stock_allocations.status → 'despachada'
 *       └─ trg (enforce_custody_allocation_dispatch)
 *           └─ custody_assert_allocation_released
 *               └─ custody_assert_physical_unit_released
 *                   └─ custody_assert_egress_evidence      ← 0253 · Adenda §4.2
 *
 * está enganchada en producción y una unidad de NIVEL 2 sin foto de egreso no
 * se despacha. `t-c7-03` prueba que el nivel 1 SÍ despacha; nadie ejecutaba el
 * camino del RECHAZO. Acá no se lee código: se intenta despachar de verdad y
 * se exige que la base lo rechace con el motivo de la foto.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import {
  actAsServer,
  actAsWithSession,
  createActor,
  grantPermission,
  uid,
  type Actor,
} from "./harness/fixtures";

let db: Client;
let staff: Actor;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
  staff = await createActor(db, "operaciones");
  await grantPermission(db, staff, "wms.edit");
  await grantPermission(db, staff, "wms.view");
});

afterAll(async () => {
  await db.end();
});

/** Recepción confirmada de un cliente NIVEL 2, sin ninguna foto. */
async function unidadNivel2SinFotos(): Promise<{ unitId: string; allocationId: string; caseId: string }> {
  await actAsServer(db);
  const clientName = uid("DEP");
  const sku = uid("SKU");
  const { rows: cli } = await db.query<{ id: string }>(
    `insert into public.clients (razon, cuit, custody_level) values ($1, $2, 2) returning id`,
    [uid("CLI"), `30${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}`],
  );
  const { rows: rec } = await db.query<{ id: string }>(
    `insert into public.receptions (public_id, client_name, client_id, business_unit, status)
     values ($1, $2, $3, 'GENERAL', 'pendiente') returning id`,
    [uid("REC"), clientName, cli[0].id],
  );
  const { rows: pos } = await db.query<{ id: string }>(
    `select id from public.warehouse_positions limit 1`,
  );
  await db.query(
    `insert into public.reception_items
       (reception_id, business_unit, sku, description, lot_number, expiration_date,
        quantity, status, position_id)
     values ($1, 'GENERAL', $2, 'Bien retenible', 'LOT-E', '2027-12-31', 2, 'pendiente', $3)`,
    [rec[0].id, sku, pos[0]?.id ?? null],
  );

  await actAsWithSession(db, staff, staff.sessionId);
  await db.query(`select public.confirm_reception($1::uuid)`, [rec[0].id]);

  await actAsServer(db);
  const { rows: u } = await db.query<{ id: string; custody_level: number; inventory_item_id: string }>(
    `select id, custody_level, inventory_item_id from public.custody_physical_units where reception_id = $1`,
    [rec[0].id],
  );
  expect(u).toHaveLength(1);
  expect(u[0].custody_level).toBe(2);
  const { rows: c } = await db.query<{ id: string }>(
    `select id from public.custody_integrity_cases where physical_unit_id = $1`,
    [u[0].id],
  );
  expect(c).toHaveLength(1);

  const { rows: ord } = await db.query<{ id: string }>(
    `insert into public.logistics_orders (public_id, client_name, client_id, status)
     values ($1, $2, $3, 'borrador') returning id`,
    [uid("ORD"), clientName, cli[0].id],
  );
  const { rows: oi } = await db.query<{ id: string }>(
    `insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
     values ($1, $2, 'Bien retenible', 2) returning id`,
    [ord[0].id, sku],
  );
  const { rows: alloc } = await db.query<{ id: string }>(
    `insert into public.stock_allocations (order_item_id, inventory_item_id, quantity, status)
     values ($1, $2, 2, 'reservada') returning id`,
    [oi[0].id, u[0].inventory_item_id],
  );
  return { unitId: u[0].id, allocationId: alloc[0].id, caseId: c[0].id };
}

describe("T-C7-06 · nivel 2 sin foto de egreso NO despacha (ejecutado, no leído)", () => {
  it("el despacho REBOTA en custody_assert_egress_evidence con el motivo de la foto", async () => {
    const e = await unidadNivel2SinFotos();

    // La genealogía ligó la unidad a la allocation: la puerta aplica.
    await actAsServer(db);
    const { rows: gen } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.custody_allocation_physical_units where allocation_id = $1`,
      [e.allocationId],
    );
    expect(Number(gen[0].n)).toBeGreaterThan(0);

    // DESPACHAR DE VERDAD: el trigger corre y la base tiene que rechazar.
    await actAsServer(db);
    await expect(
      db.query(`update public.stock_allocations set status = 'despachada' where id = $1`, [e.allocationId]),
    ).rejects.toThrow(/CUSTODY_EGRESS_PHOTO_MISSING/);

    // Y la allocation quedó como estaba: la puerta retiene, no rompe.
    const { rows } = await db.query<{ status: string }>(
      `select status from public.stock_allocations where id = $1`,
      [e.allocationId],
    );
    expect(rows[0].status).toBe("reservada");
  });
});
