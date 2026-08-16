/**
 * T-FB-01 · R-1 · La sede tiene que existir en el ALTA, no sólo en la lectura.
 *
 * 0247 agrega `warehouse_id` a `receptions` y `logistics_orders` sin default,
 * backfillea únicamente las filas históricas con sede demostrable, y planta
 * guardias que abortan cuando la sede es NULL. Ningún camino de escritura
 * poblaba esa columna en filas nuevas, así que ninguna recepción ni pedido
 * creado después admitía líneas: el WMS quedaba sin altas para TODOS los
 * roles, no sólo para los encargados.
 *
 * Ningún caso de este archivo puede saltearse. Si falta una precondición
 * —por ejemplo, una posición en la otra nave— el helper FALLA: un test que se
 * auto-exime reporta verde sin haber probado nada, que es precisamente el
 * defecto que este expediente combate.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { connectGuarded, startEphemeralCluster, type EphemeralCluster } from "../db/harness/cluster";
import {
  ADMIN,
  BOOTSTRAP,
  FASE_B_FORWARDS,
  JORGE,
  JUAN,
  aplicar,
  aplicarCadena,
  cadenaHasta,
  comoUsuario,
  posicionDe,
  seedCanonico,
  seedJerarquiaMagaldi,
  verificarOmisiones,
} from "./harness/chain";

let cluster: EphemeralCluster;
let db: Client;
let clientId: string;
let posLujan: string;
let posMagaldi: string;
let omitidas: Array<{ file: string; error: string }> = [];

beforeAll(async () => {
  cluster = await startEphemeralCluster();
  try {
    db = await connectGuarded(cluster.url);
    await db.query(readFileSync(BOOTSTRAP, "utf8"));
    const res = await aplicarCadena(db, cadenaHasta(245));
    omitidas = res.omitidas;
    await seedCanonico(db);
    await seedJerarquiaMagaldi(db);
    for (const f of FASE_B_FORWARDS) await aplicar(db, f);

    const cli = await db.query<{ id: string }>(
      `insert into public.clients (razon, cuit, activo)
       values ('Cliente Harness FASE B','30711111111',true)
       on conflict (cuit) do update set razon = excluded.razon
       returning id`,
    );
    clientId = cli.rows[0].id;
    posLujan = await posicionDe(db, JORGE.warehouse);
    posMagaldi = await posicionDe(db, JUAN.warehouse);
  } catch (e) {
    await cluster.teardown().catch(() => {});
    throw e;
  }
}, 300_000);

afterAll(async () => {
  await db?.end().catch(() => {});
  await cluster?.teardown().catch(() => {});
});

/** Alta de cabecera tal como la hace el producto: SIN warehouse_id. */
async function crearRecepcion(actorId: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into public.receptions
       (client_id, client_name, business_unit, status, created_by)
     values ($1,'Cliente Harness FASE B','GENERAL','borrador',$2)
     returning id`,
    [clientId, actorId],
  );
  return r.rows[0].id;
}

async function sedeDe(receptionId: string): Promise<string | null> {
  const { rows } = await db.query<{ code: string | null }>(
    `select w.code from public.receptions r
     left join public.warehouses w on w.id = r.warehouse_id
     where r.id = $1`,
    [receptionId],
  );
  return rows[0]?.code ?? null;
}

describe("T-FB-01 · R-1 · sede en el alta de recepciones", () => {
  it("A-4 · el conjunto de migraciones omitidas es EXACTAMENTE el declarado", () => {
    const { inesperadas, yaNoOmitidas } = verificarOmisiones(omitidas);
    expect(inesperadas).toEqual([]);
    expect(yaNoOmitidas).toEqual([]);
  });

  it("un encargado crea la recepción YA con su sede, y no puede elegirla", async () => {
    await comoUsuario(db, JORGE.id, JORGE.email, async () => {
      // El payload intenta imponer la nave ajena; la identidad manda.
      const r = await db.query<{ id: string }>(
        `insert into public.receptions
           (client_id, client_name, business_unit, status, created_by, warehouse_id)
         values ($1,'Cliente Harness FASE B','GENERAL','borrador',$2,
                 (select id from public.warehouses where code = 'MAGALDI_1765'))
         returning id`,
        [clientId, JORGE.id],
      );
      expect(await sedeDe(r.rows[0].id)).toBe(JORGE.warehouse);
    });
  });

  it("un encargado no puede cargar en una posición de otra sede", async () => {
    await comoUsuario(db, JORGE.id, JORGE.email, async () => {
      const receptionId = await crearRecepcion(JORGE.id);
      await expect(
        db.query(
          `insert into public.reception_items
             (reception_id, sku, description, quantity, position_id, status)
           values ($1,'SKU-X','Item ajeno',1,$2,'pendiente')`,
          [receptionId, posMagaldi],
        ),
      ).rejects.toThrow(/no corresponde a tu sede/);
    });
  });

  it("cargar el primer ítem de una recepción nueva funciona", async () => {
    await comoUsuario(db, ADMIN.id, ADMIN.email, async () => {
      const receptionId = await crearRecepcion(ADMIN.id);
      await expect(
        db.query(
          `insert into public.reception_items
             (reception_id, sku, description, quantity, position_id, status)
           values ($1,'SKU-1','Item de harness',1,$2,'pendiente')`,
          [receptionId, posLujan],
        ),
      ).resolves.toBeTruthy();
    });
  });

  it("la sede derivada coincide con la nave de la posición del ítem", async () => {
    await comoUsuario(db, ADMIN.id, ADMIN.email, async () => {
      const receptionId = await crearRecepcion(ADMIN.id);
      await db.query(
        `insert into public.reception_items
           (reception_id, sku, description, quantity, position_id, status)
         values ($1,'SKU-2','Item de harness',1,$2,'pendiente')`,
        [receptionId, posLujan],
      );
      expect(await sedeDe(receptionId)).toBe(JORGE.warehouse);
    });
  });

  it("B-1 · un encargado no puede sumar una línea de otra nave a su recepción", async () => {
    // La restricción de sede es del ENCARGADO y sigue intacta: acotar el guard
    // a principales no la relajó.
    await comoUsuario(db, JORGE.id, JORGE.email, async () => {
      const receptionId = await crearRecepcion(JORGE.id);
      await db.query(
        `insert into public.reception_items
           (reception_id, sku, description, quantity, position_id, status)
         values ($1,'SKU-3','Primera',1,$2,'pendiente')`,
        [receptionId, posLujan],
      );
      await expect(
        db.query(
          `insert into public.reception_items
             (reception_id, sku, description, quantity, position_id, status)
           values ($1,'SKU-4','Segunda, otra nave',1,$2,'pendiente')`,
          [receptionId, posMagaldi],
        ),
      ).rejects.toThrow(/no corresponde a tu sede/);
      expect(await sedeDe(receptionId)).toBe(JORGE.warehouse);
    });
  });

  it("B-1 · un rol global recupera el comportamiento previo a 0247", async () => {
    // Antes de 0247 una recepción podía tener líneas de más de una nave. El
    // guard incondicional se lo había quitado a admin/operaciones/supervisor
    // sin que eso fuera una decisión: era alcance colateral.
    //
    // CONSECUENCIA DECLARADA: la cabecera conserva la sede que fijó su primera
    // línea, de modo que una recepción así queda en el mismo estado que las
    // históricas multi-nave de A-7. Es el precio de no perder la capacidad, y
    // queda explícito acá en vez de descubrirse en producción.
    await comoUsuario(db, ADMIN.id, ADMIN.email, async () => {
      const receptionId = await crearRecepcion(ADMIN.id);
      await db.query(
        `insert into public.reception_items
           (reception_id, sku, description, quantity, position_id, status)
         values ($1,'SKU-G1','Primera',1,$2,'pendiente')`,
        [receptionId, posLujan],
      );
      await expect(
        db.query(
          `insert into public.reception_items
             (reception_id, sku, description, quantity, position_id, status)
           values ($1,'SKU-G2','Segunda, otra nave',1,$2,'pendiente')`,
          [receptionId, posMagaldi],
        ),
      ).resolves.toBeTruthy();
      expect(await sedeDe(receptionId)).toBe(JORGE.warehouse);
    });
  });

  it("A-7 · una recepción histórica multi-sede queda bloqueada, y se documenta", async () => {
    // El backfill de 0247:10-23 deja en NULL, a propósito, las recepciones
    // cuyos ítems abarcan más de una nave: no hay sede demostrable y elegir
    // una sería falsear el dato. La consecuencia es que ya no admiten líneas
    // nuevas, porque el estampado fijaría una sede que el guard de cabecera
    // rechaza por conflicto con los ítems preexistentes.
    //
    // Es una decisión REGISTRADA, no un defecto silencioso: una recepción
    // repartida entre dos naves es un estado que el modelo nuevo no admite, y
    // repararla exige una decisión de negocio —partirla, o elegir una sede—
    // que excede este expediente. La recepción histórica sigue siendo legible.
    const receptionId = await comoUsuario(db, ADMIN.id, ADMIN.email, async () =>
      crearRecepcion(ADMIN.id),
    );
    // Se fabrica el estado histórico: dos líneas de naves distintas, saltando
    // el guard igual que lo haría una fila anterior a 0247.
    await db.query("alter table public.reception_items disable trigger trg_nexus_reception_site_guard");
    try {
      await db.query(
        `insert into public.reception_items
           (reception_id, sku, description, quantity, position_id, status)
         values ($1,'SKU-H1','Historica Lujan',1,$2,'pendiente'),
                ($1,'SKU-H2','Historica Magaldi',1,$3,'pendiente')`,
        [receptionId, posLujan, posMagaldi],
      );
    } finally {
      await db.query("alter table public.reception_items enable trigger trg_nexus_reception_site_guard");
    }
    expect(await sedeDe(receptionId)).toBeNull();

    // Una línea nueva ya no entra: el estampado choca con la otra nave.
    await comoUsuario(db, ADMIN.id, ADMIN.email, async () => {
      await expect(
        db.query(
          `insert into public.reception_items
             (reception_id, sku, description, quantity, position_id, status)
           values ($1,'SKU-H3','Tercera',1,$2,'pendiente')`,
          [receptionId, posLujan],
        ),
      ).rejects.toThrow(/sede WMS no autorizada/);
    });
    // Pero sigue siendo legible: el bloqueo es de escritura, no de consulta.
    const { rows } = await db.query(
      `select count(*)::text as n from public.reception_items where reception_id=$1`,
      [receptionId],
    );
    expect(Number((rows[0] as { n: string }).n)).toBe(2);
  });

  it("A-5 · un encargado no se apropia de una recepción ajena sin sede", async () => {
    // Una cabecera creada por administración nace sin sede. Si un encargado
    // pudiera insertarle la primera línea, la reclamaría para su nave y la
    // volvería visible y editable bajo las policies de sede.
    const receptionId = await comoUsuario(db, ADMIN.id, ADMIN.email, async () =>
      crearRecepcion(ADMIN.id),
    );
    expect(await sedeDe(receptionId)).toBeNull();

    let apropiada = false;
    await comoUsuario(db, JORGE.id, JORGE.email, async () => {
      try {
        await db.query(
          `insert into public.reception_items
             (reception_id, sku, description, quantity, position_id, status)
           values ($1,'SKU-APROP','Apropiación',1,$2,'pendiente')`,
          [receptionId, posLujan],
        );
        apropiada = true;
      } catch {
        apropiada = false;
      }
    });

    // El resultado se fija como garantía explícita, cualquiera sea: si la
    // apropiación es posible, este test lo deja documentado en rojo.
    expect(apropiada).toBe(false);
    expect(await sedeDe(receptionId)).toBeNull();
  });
});
