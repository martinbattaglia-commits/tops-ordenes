/**
 * T-C7-03 · EL NIVEL 1 SE DESPACHA DE VERDAD.
 *
 * ─── POR QUÉ ESTE ARCHIVO EXISTE ─────────────────────────────────────────
 *
 * `t-c7-01` probaba las dos premisas del nivel 1 por separado y NUNCA las
 * componía: afirmaba que la genealogía quedaba vacía y, aparte, que el gate por
 * unidad exceptuaba al nivel 1 —llamándolo DIRECTAMENTE, salteándose el gate
 * que lo antecede—. Las dos afirmaciones eran ciertas y el circuito estaba
 * roto igual, porque el rechazo ocurría en el medio:
 *
 *     stock_allocations.status → 'despachada'
 *       └─ trg_stock_allocations_custody_release
 *           └─ custody_assert_allocation_released      ← MORÍA ACÁ
 *               └─ custody_assert_physical_unit_released  ← nunca se llegaba
 *
 * Peor: `expect(gen.n).toBe("0")` era literalmente la PRECONDICIÓN del fallo,
 * afirmada como si fuera la corrección.
 *
 * Acá no se aseveran premisas: se RECORRE y se DESPACHA. La allocation pasa a
 * `despachada` y el trigger corre. Si el circuito está roto, esto falla.
 *
 * ─── LOS DOS CAMINOS QUE DIRECCIÓN EXIGE ─────────────────────────────────
 *
 *   (a) nivel 1 CON foto de ingreso
 *   (b) nivel 1 SIN foto de ingreso
 *
 * La definición de negocio dice que la ausencia de foto NO BLOQUEA NADA. Los
 * dos caminos tienen que despachar.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createHash } from "node:crypto";
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

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

interface Escenario {
  clientId: string;
  unitId: string;
  level: number;
  caseId: string | null;
  inventoryItemId: string;
  allocationId: string;
}

/**
 * Recorre recepción → confirmación → reserva, y deja la allocation lista para
 * despachar. `nivel` es el CONTRATADO por el cliente; `conFoto` decide si se
 * registra la foto de ingreso.
 */
async function hastaLaReserva(opts: {
  nivel: 1 | 2;
  conFoto: boolean;
  cantidad?: number;
}): Promise<Escenario> {
  const cantidad = opts.cantidad ?? 3;

  await actAsServer(db);
  const { rows: cli } = await db.query<{ id: string }>(
    `insert into public.clients (razon, cuit, custody_level) values ($1, $2, $3) returning id`,
    [uid("CLI"), `30${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}`, opts.nivel],
  );
  const clientId = cli[0].id;
  const { rows: pos } = await db.query<{ id: string }>(
    `select id from public.warehouse_positions limit 1`,
  );

  const { rows: rec } = await db.query<{ id: string; client_name: string }>(
    `insert into public.receptions (public_id, client_name, client_id, business_unit, status)
     values ($1, $2, $3, 'GENERAL', 'pendiente') returning id, client_name`,
    [uid("REC"), uid("DEP"), clientId],
  );
  const sku = uid("SKU");
  await db.query(
    `insert into public.reception_items
       (reception_id, business_unit, sku, description, lot_number, expiration_date,
        quantity, status, position_id)
     values ($1, 'GENERAL', $2, 'Bien despachable', 'LOT-D', '2027-12-31', $3, 'pendiente', $4)`,
    [rec[0].id, sku, cantidad, pos[0]?.id ?? null],
  );

  // CONFIRMAR · el trigger materializa la unidad (y el caso, si es nivel 2).
  await actAsWithSession(db, staff, staff.sessionId);
  await db.query(`select public.confirm_reception($1::uuid)`, [rec[0].id]);

  await actAsServer(db);
  const { rows: u } = await db.query<{
    id: string; custody_level: number; inventory_item_id: string;
  }>(
    `select u.id, u.custody_level, u.inventory_item_id
       from public.custody_physical_units u where u.reception_id = $1`,
    [rec[0].id],
  );
  expect(u).toHaveLength(1);
  const { rows: c } = await db.query<{ id: string }>(
    `select id from public.custody_integrity_cases where physical_unit_id = $1`,
    [u[0].id],
  );

  // La foto de ingreso, si el camino la pide.
  if (opts.conFoto) {
    const contenido = uid("ING");
    const path = `physical_unit/${u[0].id}/recepcion/${uid("obj")}.png`;
    await actAsServer(db);
    const { rows: att } = await db.query<{ id: string }>(
      `select public.attest_custody_physical_content(
         'custody-evidence', $1, $2, $3, 'image/png', $4::uuid, $5::uuid, $6::uuid,
         'recepcion'::public.custody_stage_t, 'foto_ingreso'::public.custody_event_type_t, 900) as id`,
      [path, sha(contenido), contenido.length, staff.userId, staff.sessionId, u[0].id],
    );
    await actAsWithSession(db, staff, staff.sessionId);
    await db.query(
      `select public.attach_custody_physical_evidence(
         $1::uuid, 'recepcion'::public.custody_stage_t,
         'foto_ingreso'::public.custody_event_type_t, $2, $3::uuid, 'ingreso.png', null, null, null)`,
      [u[0].id, path, att[0].id],
    );
  }

  // Pedido y RESERVA. El trigger de vínculo corre al insertar la allocation.
  await actAsServer(db);
  const { rows: ord } = await db.query<{ id: string }>(
    `insert into public.logistics_orders (public_id, client_name, client_id, status)
     values ($1, $2, $3, 'borrador') returning id`,
    [uid("ORD"), rec[0].client_name, clientId],
  );
  const { rows: oi } = await db.query<{ id: string }>(
    `insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
     values ($1, $2, 'Bien despachable', $3) returning id`,
    [ord[0].id, sku, cantidad],
  );
  const { rows: alloc } = await db.query<{ id: string }>(
    `insert into public.stock_allocations (order_item_id, inventory_item_id, quantity, status)
     values ($1, $2, $3, 'reservada') returning id`,
    [oi[0].id, u[0].inventory_item_id, cantidad],
  );

  return {
    clientId,
    unitId: u[0].id,
    level: u[0].custody_level,
    caseId: c[0]?.id ?? null,
    inventoryItemId: u[0].inventory_item_id,
    allocationId: alloc[0].id,
  };
}

/** DESPACHAR DE VERDAD: pasa la allocation a 'despachada' y deja correr el trigger. */
async function despachar(allocationId: string): Promise<void> {
  await actAsServer(db);
  await db.query(
    `update public.stock_allocations set status = 'despachada' where id = $1`,
    [allocationId],
  );
}

describe("T-C7-03 · el nivel 1 DESPACHA · los dos caminos", () => {
  it("(a) nivel 1 CON foto de ingreso · despacha", async () => {
    const e = await hastaLaReserva({ nivel: 1, conFoto: true });
    expect(e.level).toBe(1);
    expect(e.caseId).toBeNull();

    // ESTO es lo que t-c7-01 nunca hizo.
    await expect(despachar(e.allocationId)).resolves.toBeUndefined();

    await actAsServer(db);
    const { rows } = await db.query<{ status: string }>(
      `select status from public.stock_allocations where id = $1`,
      [e.allocationId],
    );
    expect(rows[0].status).toBe("despachada");
  });

  it("(b) nivel 1 SIN foto de ingreso · despacha igual", async () => {
    // Definición de negocio: la ausencia de foto NO BLOQUEA NADA.
    const e = await hastaLaReserva({ nivel: 1, conFoto: false });
    expect(e.level).toBe(1);
    expect(e.caseId).toBeNull();

    await actAsServer(db);
    const { rows: ev } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.custody_events
        where physical_unit_id = $1 and event_type = 'foto_ingreso'`,
      [e.unitId],
    );
    expect(ev[0].n).toBe("0");

    await expect(despachar(e.allocationId)).resolves.toBeUndefined();

    const { rows } = await db.query<{ status: string }>(
      `select status from public.stock_allocations where id = $1`,
      [e.allocationId],
    );
    expect(rows[0].status).toBe("despachada");
  });
});

describe("T-C7-03 · el NIVEL 2 sigue bloqueado · la línea roja se respeta", () => {
  it("nivel 2 sin decisión humana NO despacha, y muere por su propio motivo", async () => {
    const e = await hastaLaReserva({ nivel: 2, conFoto: true });
    expect(e.level).toBe(2);
    expect(e.caseId).not.toBeNull();

    // Si el nivel 2 pasara, la condición por nivel habría aflojado el contrato.
    await expect(despachar(e.allocationId)).rejects.toThrow(/CUSTODY_HOLD|CUSTODY_CASE_MISSING/);

    await actAsServer(db);
    const { rows } = await db.query<{ status: string }>(
      `select status from public.stock_allocations where id = $1`,
      [e.allocationId],
    );
    expect(rows[0].status).toBe("reservada");
  });

  it("una allocation SIN genealogía sigue muriendo por CUSTODY_GENEALOGY_MISSING", async () => {
    // Stock de ajuste de inventario: no pasó por recepción, no tiene unidad
    // física, no se conoce su nivel. Fail-closed, exactamente como en 0250a.
    await actAsServer(db);
    const { rows: cli } = await db.query<{ id: string }>(
      `insert into public.clients (razon, cuit, custody_level) values ($1, $2, 1) returning id`,
      [uid("CLI"), `30${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}`],
    );
    const { rows: inv } = await db.query<{ id: string }>(
      `insert into public.inventory_items (sku, description, client_name, client_id, stock_available)
       values ($1, 'Stock de ajuste', 'AJUSTE', $2, 10) returning id`,
      [uid("SKU"), cli[0].id],
    );
    const { rows: ord } = await db.query<{ id: string }>(
      `insert into public.logistics_orders (public_id, client_name, client_id, status)
       values ($1, 'AJUSTE', $2, 'borrador') returning id`,
      [uid("ORD"), cli[0].id],
    );
    const { rows: oi } = await db.query<{ id: string }>(
      `insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
       values ($1, $2, 'Stock de ajuste', 2) returning id`,
      [ord[0].id, uid("SKU")],
    );
    const { rows: alloc } = await db.query<{ id: string }>(
      `insert into public.stock_allocations (order_item_id, inventory_item_id, quantity, status)
       values ($1, $2, 2, 'reservada') returning id`,
      [oi[0].id, inv[0].id],
    );
    await expect(despachar(alloc[0].id)).rejects.toThrow(/CUSTODY_GENEALOGY_MISSING/);
  });
});

describe("T-C7-03 · allocation MIXTA · cada bien por el régimen con el que entró", () => {
  it("nivel 1 + nivel 2 en el mismo ítem: el nivel 2 bloquea, y por su motivo", async () => {
    // `inventory_items` se resuelve por (client_name, sku, position_id), así que
    // dos recepciones del mismo bien acumulan en el mismo ítem. Con el cliente
    // subiendo de nivel entre una y otra, la allocation queda MIXTA.
    const e1 = await hastaLaReserva({ nivel: 1, conFoto: true, cantidad: 2 });

    await actAsServer(db);
    // El mismo cliente contrata custodia reforzada.
    await db.query(`update public.clients set custody_level = 2 where id = $1`, [e1.clientId]);
    const { rows: nombre } = await db.query<{ client_name: string }>(
      `select client_name from public.inventory_items where id = $1`,
      [e1.inventoryItemId],
    );
    const { rows: sku } = await db.query<{ sku: string; position_id: string | null }>(
      `select sku, position_id from public.inventory_items where id = $1`,
      [e1.inventoryItemId],
    );

    // Segunda recepción del MISMO bien, ya en nivel 2.
    const { rows: rec2 } = await db.query<{ id: string }>(
      `insert into public.receptions (public_id, client_name, client_id, business_unit, status)
       values ($1, $2, $3, 'GENERAL', 'pendiente') returning id`,
      [uid("REC"), nombre[0].client_name, e1.clientId],
    );
    await db.query(
      `insert into public.reception_items
         (reception_id, business_unit, sku, description, lot_number, expiration_date,
          quantity, status, position_id)
       values ($1, 'GENERAL', $2, 'Bien despachable', 'LOT-D2', '2027-12-31', 2, 'pendiente', $3)`,
      [rec2[0].id, sku[0].sku, sku[0].position_id],
    );
    await actAsWithSession(db, staff, staff.sessionId);
    await db.query(`select public.confirm_reception($1::uuid)`, [rec2[0].id]);

    await actAsServer(db);
    const { rows: niveles } = await db.query<{ custody_level: number }>(
      `select custody_level from public.custody_physical_units
        where inventory_item_id = $1 order by created_at`,
      [e1.inventoryItemId],
    );
    // Confirmado: el mismo ítem tiene unidades de los DOS niveles.
    expect(niveles.map((n) => n.custody_level).sort()).toEqual([1, 2]);

    // Una reserva nueva que abarque las cuatro unidades queda MIXTA.
    const { rows: ord } = await db.query<{ id: string }>(
      `insert into public.logistics_orders (public_id, client_name, client_id, status)
       values ($1, $2, $3, 'borrador') returning id`,
      [uid("ORD"), nombre[0].client_name, e1.clientId],
    );
    const { rows: oi } = await db.query<{ id: string }>(
      `insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
       values ($1, $2, 'Bien despachable', 2) returning id`,
      [ord[0].id, sku[0].sku],
    );
    const { rows: alloc } = await db.query<{ id: string }>(
      `insert into public.stock_allocations (order_item_id, inventory_item_id, quantity, status)
       values ($1, $2, 2, 'reservada') returning id`,
      [oi[0].id, e1.inventoryItemId],
    );

    const { rows: gen } = await db.query<{ n2: string }>(
      `select count(*)::text as n2
         from public.custody_allocation_physical_units g
         join public.custody_physical_units u on u.id = g.physical_unit_id
        where g.allocation_id = $1 and u.custody_level >= 2`,
      [alloc[0].id],
    );

    if (Number(gen[0].n2) > 0) {
      // Hay custodia contratada en la reserva: el gate completo se aplica y el
      // nivel 2 la detiene. La línea roja se respeta.
      await expect(despachar(alloc[0].id)).rejects.toThrow(/CUSTODY_HOLD|CUSTODY_CASE_MISSING/);
    } else {
      // FEFO tomó sólo unidades de nivel 1: entonces no hay nada contratado que
      // exigir y tiene que despachar.
      await expect(despachar(alloc[0].id)).resolves.toBeUndefined();
    }
  });
});

describe("T-C7-03 · PUNTO 4 · la cadena ENTERA de salida, sin foto", () => {
  it("nivel 1 sin foto: bulto, despacho y entrega pasan de punta a punta", async () => {
    // Confirmación EJECUTADA, no leída. Todos los gates de salida convergen en
    // `custody_assert_allocation_released`; acá se recorren de verdad:
    //   packing_unit → shipment → entregado
    // cada uno con su propio trigger.
    const e = await hastaLaReserva({ nivel: 1, conFoto: false, cantidad: 2 });
    expect(e.level).toBe(1);

    await actAsServer(db);
    const { rows: oi } = await db.query<{ order_id: string }>(
      `select oi.order_id from public.stock_allocations a
         join public.logistics_order_items oi on oi.id = a.order_item_id
        where a.id = $1`,
      [e.allocationId],
    );
    const orderId = oi[0].order_id;

    const { rows: bulto } = await db.query<{ id: string }>(
      `insert into public.packing_units (public_id, order_id) values ($1, $2) returning id`,
      [uid("BLT"), orderId],
    );
    await db.query(
      `insert into public.packing_unit_items (packing_unit_id, allocation_id, quantity)
       values ($1, $2, 2)`,
      [bulto[0].id, e.allocationId],
    );
    // Cerrar el bulto dispara `trg_packing_units_custody_release`.
    await expect(
      db.query(`update public.packing_units set status = 'cerrada' where id = $1`, [bulto[0].id]),
    ).resolves.toBeDefined();

    const { rows: sh } = await db.query<{ id: string }>(
      `insert into public.shipments (public_id, order_id) values ($1, $2) returning id`,
      [uid("DES"), orderId],
    );
    await db.query(
      `update public.packing_units set shipment_id = $1, status = 'despachada' where id = $2`,
      [sh[0].id, bulto[0].id],
    );

    // Despachar y ENTREGAR: los dos disparan `custody_assert_shipment_released`.
    await expect(
      db.query(`update public.shipments set status = 'despachado' where id = $1`, [sh[0].id]),
    ).resolves.toBeDefined();
    await expect(
      db.query(`update public.shipments set status = 'entregado' where id = $1`, [sh[0].id]),
    ).resolves.toBeDefined();

    const { rows } = await db.query<{ status: string }>(
      `select status from public.shipments where id = $1`, [sh[0].id],
    );
    expect(rows[0].status).toBe("entregado");
  });
});

describe("T-C7-03 · el nivel 1 NO LLEVA foto de egreso", () => {
  it("la base rechaza `foto_egreso` sobre una unidad de nivel 1, con motivo legible", async () => {
    const e = await hastaLaReserva({ nivel: 1, conFoto: true });
    const contenido = uid("EGR");
    const path = `physical_unit/${e.unitId}/despacho/${uid("obj")}.png`;

    await actAsServer(db);
    const { rows: att } = await db.query<{ id: string }>(
      `select public.attest_custody_physical_content(
         'custody-evidence', $1, $2, $3, 'image/png', $4::uuid, $5::uuid, $6::uuid,
         'despacho'::public.custody_stage_t, 'foto_egreso'::public.custody_event_type_t, 900) as id`,
      [path, sha(contenido), contenido.length, staff.userId, staff.sessionId, e.unitId],
    );
    await actAsWithSession(db, staff, staff.sessionId);
    await expect(
      db.query(
        `select public.attach_custody_physical_evidence(
           $1::uuid, 'despacho'::public.custody_stage_t,
           'foto_egreso'::public.custody_event_type_t, $2, $3::uuid, 'egreso.png', null, null, null)`,
        [e.unitId, path, att[0].id],
      ),
    ).rejects.toThrow(/no está bajo custodia digital y no lleva foto de egreso/);
  });

  it("el NIVEL 2 sí la acepta: el rechazo está acotado por nivel", async () => {
    const e = await hastaLaReserva({ nivel: 2, conFoto: true });
    const contenido = uid("EGR2");
    const path = `physical_unit/${e.unitId}/despacho/${uid("obj")}.png`;

    await actAsServer(db);
    const { rows: att } = await db.query<{ id: string }>(
      `select public.attest_custody_physical_content(
         'custody-evidence', $1, $2, $3, 'image/png', $4::uuid, $5::uuid, $6::uuid,
         'despacho'::public.custody_stage_t, 'foto_egreso'::public.custody_event_type_t, 900) as id`,
      [path, sha(contenido), contenido.length, staff.userId, staff.sessionId, e.unitId],
    );
    await actAsWithSession(db, staff, staff.sessionId);
    await expect(
      db.query(
        `select public.attach_custody_physical_evidence(
           $1::uuid, 'despacho'::public.custody_stage_t,
           'foto_egreso'::public.custody_event_type_t, $2, $3::uuid, 'egreso.png', null, null, null)`,
        [e.unitId, path, att[0].id],
      ),
    ).resolves.toBeDefined();
  });
});
