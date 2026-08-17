/**
 * T-C7-01 · LOS DOS NIVELES DE CUSTODIA (D3 · bloque 2-A · Punto 1).
 *
 * Hasta 0252 el trigger de materialización era INCONDICIONAL respecto del
 * cliente: cada ítem recibido abría unidad física Y caso de integridad para
 * todo el mundo. La Adenda contrata custodia reforzada por cliente.
 *
 *   NIVEL 1 · universal. Unidad física con su foto de ingreso, y nada más.
 *   NIVEL 2 · contratado. Caso, IA, inspección, certificado y gate.
 *
 * ─── LO QUE ESTE ARCHIVO PRUEBA Y POR QUÉ IMPORTA ────────────────────────
 *
 * Este archivo prueba las PREMISAS del nivel 1 por separado: que no abre caso,
 * que el gate por unidad lo exceptúa, que el régimen queda estampado.
 *
 * ⚠ LAS PREMISAS NO ALCANZAN, Y ESTE ARCHIVO ES LA PRUEBA DE ELLO.
 *
 * Una versión anterior afirmaba acá que la genealogía quedaba VACÍA para el
 * nivel 1 —`expect(gen.n).toBe("0")`— y lo presentaba como corrección. Era la
 * PRECONDICIÓN DEL FALLO: con la tabla vacía,
 * `custody_assert_allocation_released` entra por la rama `v_n=0` y levanta
 * `CUSTODY_GENEALOGY_MISSING` antes de llegar al gate por unidad. El nivel 1
 * quedaba indespachable y estos tests seguían en verde.
 *
 * La composición —recorrer hasta DESPACHAR de verdad— vive en `t-c7-03`. Este
 * archivo se queda con lo que sí sabe probar, y lo dice.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { Client } from "pg";
import { actAsServer, createActor, uid, type Actor } from "./harness/fixtures";

let db: Client;
let staff: Actor;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
  staff = await createActor(db, "operaciones");
});

afterAll(async () => {
  await db.end();
});

/** Cliente con el nivel de custodia CONTRATADO que se le indique. */
async function cliente(nivel: 1 | 2): Promise<string> {
  await actAsServer(db);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.clients (razon, cuit, custody_level) values ($1, $2, $3) returning id`,
    [uid("CLI"), `30${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}`, nivel],
  );
  return rows[0].id;
}

interface Materializado {
  unitId: string | null;
  caseId: string | null;
  level: number | null;
  receptionId: string;
}

/**
 * Recibe un ítem para ese cliente y devuelve lo que el trigger materializó.
 * `reforzada` es la casilla por recepción que ELEVA un ingreso puntual.
 */
async function recibir(clientId: string, reforzada = false): Promise<Materializado> {
  await actAsServer(db);
  const { rows: inv } = await db.query<{ id: string }>(
    `insert into public.inventory_items (sku, description, client_name, client_id, stock_available)
     values ($1, 'Bien de prueba', 'DEPOSITANTE', $2, 5) returning id`,
    [uid("SKU"), clientId],
  );
  const { rows: rec } = await db.query<{ id: string }>(
    `insert into public.receptions (public_id, client_name, client_id, status, received_at, custody_reforzada)
     values ($1, 'DEPOSITANTE', $2, 'recibida', now(), $3) returning id`,
    [uid("REC"), clientId, reforzada],
  );
  const { rows: item } = await db.query<{ id: string }>(
    `insert into public.reception_items
       (reception_id, business_unit, sku, description, lot_number, expiration_date,
        quantity, status, inventory_item_id)
     values ($1, 'GENERAL', $2, 'Bien de prueba', 'LOT-N', '2027-08-31', 5, 'recibido', $3)
     returning id`,
    [rec[0].id, uid("SKU"), inv[0].id],
  );
  const { rows: u } = await db.query<{ id: string; custody_level: number }>(
    `select id, custody_level from public.custody_physical_units where reception_item_id = $1`,
    [item[0].id],
  );
  const unitId = u[0]?.id ?? null;
  const { rows: c } = unitId
    ? await db.query<{ id: string }>(
        `select id from public.custody_integrity_cases where physical_unit_id = $1`,
        [unitId],
      )
    : { rows: [] as Array<{ id: string }> };
  return {
    unitId,
    caseId: c[0]?.id ?? null,
    level: u[0]?.custody_level ?? null,
    receptionId: rec[0].id,
  };
}

describe("T-C7-01 · el trigger dejó de ser incondicional", () => {
  it("NIVEL 1 · el cliente sin custodia contratada recibe unidad física y NINGÚN caso", async () => {
    const m = await recibir(await cliente(1));
    // La unidad SÍ se crea: es lo que sostiene la foto de ingreso, que el
    // nivel 1 también exige. Lo que no se crea es el aparato de nivel 2.
    expect(m.unitId).not.toBeNull();
    expect(m.level).toBe(1);
    expect(m.caseId).toBeNull();
  });

  it("NIVEL 2 · el cliente contratado recibe unidad Y caso, como antes de 0252", async () => {
    const m = await recibir(await cliente(2));
    expect(m.unitId).not.toBeNull();
    expect(m.level).toBe(2);
    expect(m.caseId).not.toBeNull();
  });

  it("la casilla de la recepción ELEVA un ingreso puntual de un cliente nivel 1", async () => {
    const m = await recibir(await cliente(1), true);
    expect(m.level).toBe(2);
    expect(m.caseId).not.toBeNull();
  });

  it("la casilla NUNCA degrada: un cliente nivel 2 sigue en 2 sin marcarla", async () => {
    const m = await recibir(await cliente(2), false);
    expect(m.level).toBe(2);
    expect(m.caseId).not.toBeNull();
  });

  it("el nivel por defecto de un cliente es 1: la custodia reforzada se contrata", async () => {
    await actAsServer(db);
    const { rows } = await db.query<{ custody_level: number }>(
      `insert into public.clients (razon, cuit) values ($1, $2) returning custody_level`,
      [uid("CLI"), `30${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}`],
    );
    expect(rows[0].custody_level).toBe(1);
  });
});

describe("T-C7-01 · premisas del nivel 1 · la composición está en t-c7-03", () => {
  it("SÍ entra a la genealogía, como cualquier unidad: el nivel se juzga en el gate", async () => {
    // Excluirlo del vínculo fue el blocker: destruía la información que el gate
    // necesita para distinguir «no hay custodia contratada» de «falta cobertura».
    const clientId = await cliente(1);
    const m = await recibir(clientId);
    expect(m.caseId).toBeNull();

    await actAsServer(db);
    const { rows: item } = await db.query<{ inventory_item_id: string }>(
      `select inventory_item_id from public.custody_physical_units where id = $1`,
      [m.unitId],
    );
    const { rows: ord } = await db.query<{ id: string }>(
      `insert into public.logistics_orders (public_id, client_name, client_id, status)
       values ($1, 'DEPOSITANTE', $2, 'borrador') returning id`,
      [uid("ORD"), clientId],
    );
    const { rows: oi } = await db.query<{ id: string }>(
      `insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
       values ($1, $2, 'Bien de prueba', 1) returning id`,
      [ord[0].id, uid("SKU")],
    );
    const { rows: alloc } = await db.query<{ id: string }>(
      `insert into public.stock_allocations (order_item_id, inventory_item_id, quantity, status)
       values ($1, $2, 1, 'reservada') returning id`,
      [oi[0].id, item[0].inventory_item_id],
    );

    // El trigger `trg_custody_bind_stock_allocation` ya corrió al insertar.
    const { rows: gen } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.custody_allocation_physical_units
        where allocation_id = $1`,
      [alloc[0].id],
    );
    // La fila EXISTE. Que exista es lo que permite a
    // `custody_assert_allocation_released` ver que todas las unidades que
    // cubren la allocation son de nivel 1 y no exigir nada.
    expect(gen[0].n).toBe("1");
  });

  it("el gate POR UNIDAD exceptúa al nivel 1 · premisa, no composición", async () => {
    const m = await recibir(await cliente(1));
    await actAsServer(db);
    // OJO: esto invoca la función DIRECTAMENTE y se saltea
    // `custody_assert_allocation_released`, que es quien la antecede en el
    // camino real. Es una premisa útil y NO prueba que el nivel 1 despache:
    // eso lo prueba `t-c7-03`, que pasa la allocation a 'despachada'.
    await expect(
      db.query(`select public.custody_assert_physical_unit_released($1::uuid)`, [m.unitId]),
    ).resolves.toBeDefined();
  });

  it("el nivel 2 SIGUE bloqueado por el gate: la excepción no abrió la puerta", async () => {
    const m = await recibir(await cliente(2));
    await actAsServer(db);
    // Sin decisión ni certificado, el nivel 2 tiene que seguir fallando.
    await expect(
      db.query(`select public.custody_assert_physical_unit_released($1::uuid)`, [m.unitId]),
    ).rejects.toThrow(/CUSTODY_HOLD|CUSTODY_CASE_MISSING/);
  });

  it("una unidad inexistente sigue siendo un error, no un permiso tácito", async () => {
    await actAsServer(db);
    await expect(
      db.query(
        `select public.custody_assert_physical_unit_released('00000000-0000-4000-8000-000000000000'::uuid)`,
      ),
    ).rejects.toThrow(/unidad física inexistente/);
  });
});

describe("T-C7-01 · el régimen de ingreso queda ESTAMPADO", () => {
  it("el nivel de la unidad no se re-deriva si el cliente cambia de plan después", async () => {
    const clientId = await cliente(1);
    const m = await recibir(clientId);
    expect(m.level).toBe(1);

    // El cliente contrata nivel 2 más tarde.
    await actAsServer(db);
    await db.query(`update public.clients set custody_level = 2 where id = $1`, [clientId]);

    // La unidad que ya entró conserva su régimen: el bien tiene que salir bajo
    // el mismo con el que entró.
    const { rows } = await db.query<{ custody_level: number }>(
      `select custody_level from public.custody_physical_units where id = $1`,
      [m.unitId],
    );
    expect(rows[0].custody_level).toBe(1);
  });

  it("`custody_client_level` informa el nivel sin exponer el maestro de clientes", async () => {
    const clientId = await cliente(2);
    const { actAsWithSession, grantPermission } = await import("./harness/fixtures");
    await grantPermission(db, staff, "wms.view");
    await actAsWithSession(db, staff, staff.sessionId);
    const { rows } = await db.query<{ custody_client_level: number }>(
      `select public.custody_client_level($1::uuid)`,
      [clientId],
    );
    expect(rows[0].custody_client_level).toBe(2);
  });
});
