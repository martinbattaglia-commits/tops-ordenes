/**
 * T-C5-05 · EL CAMINO FELIZ COMPLETO, HASTA EL POD.
 *
 * Por qué existe: al agregar el gate «POD sólo post-entrega», la única prueba
 * que invocaba `generate_delivery_pod` pasó a afirmar su RECHAZO. El árbol
 * quedó sin ninguna cobertura de la emisión exitosa: una regresión que volviera
 * imposible emitir un POD —que es el entregable final del contrato— habría
 * viajado en verde. Las dos afirmaciones tienen que convivir: el POD se niega
 * antes de la entrega y se emite después.
 *
 * De paso, esto es lo único que recorre la cláusula entera de la Adenda §4.2 de
 * punta a punta contra PostgreSQL: recepción → unidad física con su QR → foto
 * de ingreso → reserva con genealogía → foto de egreso → evaluación → decisión
 * humana → bulto → despacho → entrega → POD.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createHash } from "node:crypto";
import { Client } from "pg";
import {
  actAs,
  actAsServer,
  actAsWithSession,
  baseScenario,
  grantPermission,
  uid,
  type Scenario,
} from "./harness/fixtures";

let db: Client;
let s: Scenario;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
  s = await baseScenario(db);
});

afterAll(async () => { await db.end(); });

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

async function adjuntar(
  unitId: string,
  stage: "recepcion" | "despacho",
  eventType: "foto_ingreso" | "foto_egreso" | "inspeccion_humana",
  contenido: string,
): Promise<{ evidenceId: string; sha256: string }> {
  const digest = sha(contenido);
  const path = `physical_unit/${unitId}/${stage}/${uid("obj")}.png`;
  await actAsServer(db);
  const { rows: att } = await db.query<{ id: string }>(
    `select public.attest_custody_physical_content(
       'custody-evidence', $1, $2, $3, 'image/png', $4::uuid, $5::uuid, $6::uuid,
       $7::public.custody_stage_t, $8::public.custody_event_type_t, 900) as id`,
    [path, digest, contenido.length, s.staff.userId, s.staff.sessionId, unitId, stage, eventType],
  );
  await actAsWithSession(db, s.staff, s.staff.sessionId);
  const { rows: at } = await db.query<{ r: { evidence_id: string } }>(
    `select public.attach_custody_physical_evidence(
       $1::uuid, $2::public.custody_stage_t, $3::public.custody_event_type_t,
       $4, $5::uuid, 'foto.png', null, null, null) as r`,
    [unitId, stage, eventType, path, att[0].id],
  );
  return { evidenceId: at[0].r.evidence_id, sha256: digest };
}

async function version(caseId: string): Promise<number> {
  const { rows } = await db.query<{ version: number }>(
    `select version from public.custody_integrity_cases where id = $1`, [caseId],
  );
  return rows[0].version;
}

/** Recorre TODO: de la recepción a un despacho entregado, con su POD. */
async function despachoEntregado(): Promise<{ shipmentId: string; caseId: string; unitId: string }> {
  await actAsServer(db);
  const { rows: inv } = await db.query<{ id: string }>(
    `insert into public.inventory_items (sku, description, client_name, client_id, stock_available)
     values ($1, 'Bien', 'DEPOSITANTE', $2, 4) returning id`,
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
     values ($1, 'GENERAL', $2, 'Bien', 'LOT-POD', '2027-10-31', 4, 'recibido', $3) returning id`,
    [rec[0].id, uid("SKU"), inv[0].id],
  );
  const { rows: pu } = await db.query<{ id: string }>(
    `select id from public.custody_physical_units where reception_item_id = $1`, [it[0].id],
  );
  const { rows: cs } = await db.query<{ id: string }>(
    `select id from public.custody_integrity_cases where physical_unit_id = $1`, [pu[0].id],
  );
  const unitId = pu[0].id, caseId = cs[0].id;

  // Las dos fotos del contrato.
  const ing = await adjuntar(unitId, "recepcion", "foto_ingreso", `ING-${unitId}`);
  const egr = await adjuntar(unitId, "despacho", "foto_egreso", `EGR-${unitId}`);

  // La IA compara y no encuentra nada: liberación limpia por `vision_policy`.
  await actAsWithSession(db, s.staff, s.staff.sessionId);
  const { rows: beg } = await db.query<{ attempt_id: string; case_version: number }>(
    `select attempt_id, case_version from public.begin_custody_integrity_evaluation_v2($1, $2)`,
    [caseId, await version(caseId)],
  );
  await actAsServer(db);
  await db.query(
    `select public.complete_custody_integrity_evaluation_v2(
       $1::uuid, $2::uuid, $3, $4, $5,
       '{"identity":99,"packaging":98,"quantity":99,"condition":97}'::jsonb,
       0.98, 'coincide', false, false, false,
       'resp', 'gpt-5.4-mini-2026-03-17', 'fp', $6, $7, '{}'::jsonb)`,
    [beg[0].attempt_id, caseId, beg[0].case_version, ing.sha256, egr.sha256, sha("rq"), sha("rs")],
  );

  const insp = await adjuntar(unitId, "despacho", "inspeccion_humana", `INSP-${unitId}`);
  await actAs(db, s.decider);
  await actAsWithSession(db, s.decider, s.decider.sessionId);
  await db.query(
    `select public.decide_custody_integrity_v2(
       $1::uuid, $2, 'release',
       'Inspección física conforme: identidad y embalaje coinciden con el ingreso.',
       null, array[$3::uuid])`,
    [caseId, await version(caseId), insp.evidenceId],
  );

  // Reserva (la genealogía se vincula sola) y bulto con contenido.
  await actAsServer(db);
  const { rows: ord } = await db.query<{ id: string }>(
    `insert into public.logistics_orders (public_id, client_name, client_id)
     values ($1, 'DEPOSITANTE', $2) returning id`, [uid("ORD"), s.clientId],
  );
  const { rows: li } = await db.query<{ id: string }>(
    `insert into public.logistics_order_items (order_id, sku, description, quantity_requested)
     values ($1, $2, 'Bien', 4) returning id`, [ord[0].id, uid("SKU")],
  );
  const { rows: al } = await db.query<{ id: string }>(
    `insert into public.stock_allocations (order_item_id, inventory_item_id, lot_number, quantity)
     values ($1, $2, 'LOT-POD', 4) returning id`, [li[0].id, inv[0].id],
  );
  const { rows: bulto } = await db.query<{ id: string }>(
    `insert into public.packing_units (public_id, order_id) values ($1, $2) returning id`,
    [uid("PU"), ord[0].id],
  );
  await db.query(
    `insert into public.packing_unit_items (packing_unit_id, allocation_id, quantity)
     values ($1, $2, 4)`, [bulto[0].id, al[0].id],
  );
  await db.query(`update public.packing_units set status = 'cerrada' where id = $1`, [bulto[0].id]);

  // Despacho: vincular el bulto exige que todo lo que lleva esté liberado.
  const { rows: sh } = await db.query<{ id: string }>(
    `insert into public.shipments (public_id, order_id) values ($1, $2) returning id`,
    [uid("SHP"), ord[0].id],
  );
  await db.query(
    `update public.packing_units set shipment_id = $1, status = 'despachada' where id = $2`,
    [sh[0].id, bulto[0].id],
  );
  await db.query(`update public.stock_allocations set status = 'despachada' where id = $1`, [al[0].id]);

  // Entrega.
  await db.query(`update public.shipments set status = 'entregado' where id = $1`, [sh[0].id]);
  return { shipmentId: sh[0].id, caseId, unitId };
}

describe("T-C5-05 · el POD se emite cuando corresponde", () => {
  it("1 · un despacho ENTREGADO y liberado emite su POD", async () => {
    const { shipmentId } = await despachoEntregado();

    await actAs(db, s.staff);
    const { rows } = await db.query<{ r: Record<string, unknown> }>(
      `select public.generate_delivery_pod(
         $1, 'Receptor Sintético', 'DNI', '00000000', null, null, null) as r`,
      [shipmentId],
    );
    expect(rows[0].r).toBeTruthy();

    // Y el resumen de 0039 lo refleja: `pod_present` es un dato real.
    const { rows: sum } = await db.query<{ r: { pod_present: boolean } }>(
      `select public.get_shipment_custody_summary($1) as r`, [shipmentId],
    );
    expect(sum[0].r.pod_present).toBe(true);
  });

  it("2 · el mismo despacho, ANTES de la entrega, no puede emitirlo", async () => {
    // La contraparte del caso 11 de T-C2-05: ambas afirmaciones conviven.
    const { shipmentId } = await despachoEntregado();
    await actAsServer(db);
    await db.query(`update public.shipments set status = 'despachado' where id = $1`, [shipmentId]);

    await actAs(db, s.staff);
    await expect(
      db.query(
        `select public.generate_delivery_pod(
           $1, 'Receptor Sintético', 'DNI', '00000000', null, null, null) as r`,
        [shipmentId],
      ),
    ).rejects.toThrow(/CUSTODY_POD_REQUIRES_DELIVERED_SHIPMENT/);
  });
});

/**
 * Z-2 · El QR de una unidad física NO afirma nada sobre el POD.
 *
 * Hubo dos intentos y los dos eran insostenibles: el literal `false` negaba el
 * POD de una unidad realmente entregada, y la derivación que lo reemplazó lo
 * afirmaba para toda la unidad cuando una sola de sus allocations llegaba a un
 * despacho entregado —una unidad física puede repartirse entre varias—. En la
 * pantalla que la Adenda §4.2 designa como artefacto de identidad del bien, una
 * afirmación positiva falsa es peor que el silencio.
 *
 * Esta prueba fija el silencio: si alguien vuelve a agregar la clave sin una
 * definición con noción de cantidad, cae en rojo.
 */
describe("T-C5-05 · el QR de la unidad no afirma POD", () => {
  it("3 · la resolución por token no informa pod_present, ni antes ni después", async () => {
    const { shipmentId, unitId } = await despachoEntregado();

    await actAsServer(db);
    const { rows: tok } = await db.query<{ t: string }>(
      `select custody_token::text as t from public.custody_physical_units where id = $1`,
      [unitId],
    );

    // `get_custody_physical_by_token` exige `wms.view`; el escenario base sólo
    // otorga `wms.edit`. Se concede explícitamente en vez de ampliar el
    // escenario compartido.
    await actAsServer(db);
    await grantPermission(db, s.staff, "wms.view");
    await actAs(db, s.staff);
    const leer = async () => {
      const { rows } = await db.query<{ r: { scope: string; status: string } }>(
        `select public.get_custody_physical_by_token($1::uuid) as r`, [tok[0].t],
      );
      return rows[0].r;
    };

    const antes = await leer();
    expect(antes.scope).toBe("physical_unit");
    expect("pod_present" in antes).toBe(false);

    await db.query(
      `select public.generate_delivery_pod(
         $1, 'Receptor Sintético', 'DNI', '00000000', null, null, null)`,
      [shipmentId],
    );

    // Tampoco después: la vista no pasa a afirmar lo contrario, calla en ambos
    // casos. Lo que sí sigue informando es el estado del caso.
    const despues = await leer();
    expect("pod_present" in despues).toBe(false);
    expect(despues.status).toBe("RELEASED");
  });
});
