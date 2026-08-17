/**
 * T-C7-02 · TEST DE RECORRIDO · TRAMO 2-A.
 *
 * ─── QUÉ CUBRE HOY, Y DÓNDE ENGANCHA EL BLOQUE SIGUIENTE ─────────────────
 *
 * Directiva de Dirección: el recorrido completo se construye INCREMENTAL. Este
 * archivo nace en 2-A y cubre EXACTAMENTE el tramo que 2-A construye:
 *
 *      recepción con foto  →  confirmación  →  unidad materializada
 *      →  nivel de custodia correcto según el cliente  →  foto ligada a la unidad
 *
 * TERMINA en «unidad con foto de ingreso registrada y caso en PENDING_EVIDENCE».
 *
 *   · 2-B lo EXTIENDE desde ahí con la foto de egreso y la puerta de despacho.
 *   · 2-C lo CIERRA con POD, certificado y firma de quien retira.
 *
 * El punto de enganche es `recorrido2A()`, que devuelve el estado alcanzado:
 * `{ receptionId, unitId, caseId, level }`. 2-B debería partir de ahí en vez de
 * reconstruir el ingreso.
 *
 * ─── POR QUÉ NO USA DOBLES ───────────────────────────────────────────────
 *
 * Corre contra PostgreSQL real y por las RPC productivas: `confirm_reception`
 * es quien dispara el trigger de materialización, y
 * `attest_custody_physical_content` + `attach_custody_physical_evidence` son el
 * único camino autorizado para ligar la foto. Un doble habría probado el doble.
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
  // `confirm_reception` exige rol interno; la captura exige `wms.edit`.
  staff = await createActor(db, "operaciones");
  await grantPermission(db, staff, "wms.edit");
  await grantPermission(db, staff, "wms.view");
});

afterAll(async () => {
  await db.end();
});

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

export interface EstadoRecorrido {
  clientId: string;
  receptionId: string;
  receptionItemId: string;
  unitId: string;
  unitPublicId: string;
  caseId: string | null;
  level: number;
  ingressSha256: string | null;
}

/**
 * Recorre el tramo 2-A completo. Devuelve el estado alcanzado para que el
 * bloque siguiente lo tome como punto de partida.
 */
async function recorrido2A(opts: {
  nivelCliente: 1 | 2;
  reforzada?: boolean;
  conFoto?: boolean;
}): Promise<EstadoRecorrido> {
  const conFoto = opts.conFoto ?? true;

  // ── 1 · el cliente, con su nivel CONTRATADO ────────────────────────────
  await actAsServer(db);
  const { rows: cli } = await db.query<{ id: string }>(
    `insert into public.clients (razon, cuit, custody_level) values ($1, $2, $3) returning id`,
    [uid("CLI"), `30${Math.floor(Math.random() * 1e9).toString().padStart(9, "0")}`, opts.nivelCliente],
  );
  const clientId = cli[0].id;

  const { rows: pos } = await db.query<{ id: string }>(
    `select id from public.warehouse_positions limit 1`,
  );

  // ── 2 · la recepción, con la casilla de custodia reforzada ─────────────
  const { rows: rec } = await db.query<{ id: string }>(
    `insert into public.receptions
       (public_id, client_name, client_id, business_unit, status, custody_reforzada)
     values ($1, 'DEPOSITANTE', $2, 'GENERAL', 'pendiente', $3) returning id`,
    [uid("REC"), clientId, opts.reforzada ?? false],
  );
  const receptionId = rec[0].id;

  const { rows: item } = await db.query<{ id: string }>(
    `insert into public.reception_items
       (reception_id, business_unit, sku, description, lot_number, expiration_date,
        quantity, status, position_id)
     values ($1, 'GENERAL', $2, 'Bien recibido', 'LOT-R', '2027-10-31', 4, 'pendiente', $3)
     returning id`,
    [receptionId, uid("SKU"), pos[0]?.id ?? null],
  );
  const receptionItemId = item[0].id;

  // ── 3 · CONFIRMAR · es lo que dispara el trigger de materialización ────
  await actAsWithSession(db, staff, staff.sessionId);
  await db.query(`select public.confirm_reception($1::uuid)`, [receptionId]);

  // ── 4 · leer lo que el trigger materializó, por la RPC de 0252 ─────────
  const { rows: unidades } = await db.query<{
    physical_unit_id: string;
    reception_item_id: string;
    unit_public_id: string;
    custody_level: number;
    case_id: string | null;
    has_ingress_photo: boolean;
  }>(`select * from public.custody_reception_units($1::uuid)`, [receptionId]);
  expect(unidades).toHaveLength(1);
  const u = unidades[0];
  expect(u.reception_item_id).toBe(receptionItemId);

  // ── 5 · ligar la foto de ingreso a ESA unidad ──────────────────────────
  let ingressSha256: string | null = null;
  if (conFoto) {
    const contenido = uid("ING");
    ingressSha256 = sha(contenido);
    const path = `physical_unit/${u.physical_unit_id}/recepcion/${uid("obj")}.png`;

    await actAsServer(db);
    const { rows: att } = await db.query<{ id: string }>(
      `select public.attest_custody_physical_content(
         'custody-evidence', $1, $2, $3, 'image/png', $4::uuid, $5::uuid, $6::uuid,
         'recepcion'::public.custody_stage_t, 'foto_ingreso'::public.custody_event_type_t, 900) as id`,
      [path, ingressSha256, contenido.length, staff.userId, staff.sessionId, u.physical_unit_id],
    );
    await actAsWithSession(db, staff, staff.sessionId);
    await db.query(
      `select public.attach_custody_physical_evidence(
         $1::uuid, 'recepcion'::public.custody_stage_t,
         'foto_ingreso'::public.custody_event_type_t, $2, $3::uuid, 'ingreso.png', null, null, null)`,
      [u.physical_unit_id, path, att[0].id],
    );
  }

  return {
    clientId,
    receptionId,
    receptionItemId,
    unitId: u.physical_unit_id,
    unitPublicId: u.unit_public_id,
    caseId: u.case_id,
    level: u.custody_level,
    ingressSha256,
  };
}

describe("T-C7-02 · recorrido 2-A · NIVEL 2 (cliente con custodia contratada)", () => {
  it("recepción → confirmación → unidad con caso → foto de ingreso ligada", async () => {
    const e = await recorrido2A({ nivelCliente: 2 });

    // La unidad nació del acto de confirmar, con su identificador legible.
    expect(e.unitPublicId).toMatch(/^CPU-\d{4}-\d{6}$/);
    expect(e.level).toBe(2);

    // El caso existe y es de nivel 2.
    expect(e.caseId).not.toBeNull();

    await actAsServer(db);
    const { rows: caso } = await db.query<{ state: string; hold_reasons: string[]; public_id: string }>(
      `select state, hold_reasons, public_id from public.custody_integrity_cases where id = $1`,
      [e.caseId],
    );
    expect(caso[0].public_id).toMatch(/^CINT-\d{4}-\d{4}$/);
    // Con la foto de ingreso puesta y la de egreso pendiente, sigue faltando
    // evidencia: es el estado correcto al terminar 2-A.
    expect(caso[0].state).toBe("PENDING_EVIDENCE");
    expect(caso[0].hold_reasons).toEqual(["EVIDENCE_MISSING"]);

    // La foto quedó LIGADA a la unidad, en su cadena, con su digest.
    const { rows: ev } = await db.query<{ n: string; sha: string }>(
      `select count(*)::text as n, max(evidence_sha256) as sha
         from public.custody_events
        where physical_unit_id = $1 and event_type = 'foto_ingreso'`,
      [e.unitId],
    );
    expect(ev[0].n).toBe("1");
    expect(ev[0].sha).toBe(e.ingressSha256);

    // Y el caso la reconoce como su evidencia de ingreso.
    const { rows: link } = await db.query<{ n: string }>(
      `select count(*)::text as n
         from public.custody_integrity_cases c
         join public.custody_evidence e on e.id = c.ingress_evidence_id
         join public.custody_events ev on ev.id = e.event_id
        where c.id = $1 and ev.physical_unit_id = $2 and ev.event_type = 'foto_ingreso'`,
      [e.caseId, e.unitId],
    );
    expect(link[0].n).toBe("1");
  });

  it("la RPC de lectura informa la foto ya registrada", async () => {
    const e = await recorrido2A({ nivelCliente: 2 });
    await actAsWithSession(db, staff, staff.sessionId);
    const { rows } = await db.query<{ has_ingress_photo: boolean; custody_level: number }>(
      `select * from public.custody_reception_units($1::uuid)`,
      [e.receptionId],
    );
    expect(rows[0].has_ingress_photo).toBe(true);
    expect(rows[0].custody_level).toBe(2);
  });
});

describe("T-C7-02 · recorrido 2-A · NIVEL 1 (cliente sin custodia contratada)", () => {
  it("recepción → confirmación → unidad SIN caso → foto de ingreso igual ligada", async () => {
    const e = await recorrido2A({ nivelCliente: 1 });

    expect(e.level).toBe(1);
    // Nivel 1: sin caso. La evidencia defensiva no necesita aparato.
    expect(e.caseId).toBeNull();

    // Pero la foto SÍ se registró: es la mitad universal del contrato.
    await actAsServer(db);
    const { rows: ev } = await db.query<{ n: string; sha: string }>(
      `select count(*)::text as n, max(evidence_sha256) as sha
         from public.custody_events
        where physical_unit_id = $1 and event_type = 'foto_ingreso'`,
      [e.unitId],
    );
    expect(ev[0].n).toBe("1");
    expect(ev[0].sha).toBe(e.ingressSha256);
  });
});

describe("T-C7-02 · recorrido 2-A · la casilla de la recepción eleva el ingreso", () => {
  it("cliente nivel 1 + casilla marcada ⇒ unidad de nivel 2 con caso", async () => {
    const e = await recorrido2A({ nivelCliente: 1, reforzada: true });
    expect(e.level).toBe(2);
    expect(e.caseId).not.toBeNull();
  });
});

describe("T-C7-02 · recorrido 2-A · sin foto el circuito queda declarado, no roto", () => {
  it("la unidad existe y el caso dice que falta la evidencia", async () => {
    const e = await recorrido2A({ nivelCliente: 2, conFoto: false });
    expect(e.caseId).not.toBeNull();
    await actAsWithSession(db, staff, staff.sessionId);
    const { rows } = await db.query<{ has_ingress_photo: boolean }>(
      `select * from public.custody_reception_units($1::uuid)`,
      [e.receptionId],
    );
    // La pantalla puede decirle al operario exactamente qué le falta.
    expect(rows[0].has_ingress_photo).toBe(false);
  });
});
