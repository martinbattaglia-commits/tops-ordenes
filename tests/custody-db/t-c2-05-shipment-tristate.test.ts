/**
 * T-C2-05 · W22-TER-B/M5 — COMPATIBILIDAD TRI-STATE CON 0039.
 *
 * 0039 resolvía la integridad de un despacho con
 * `verify_custody_chain(null, shipment_id)`, que sólo mira la cadena DIRECTA
 * del shipment. Como en el modelo de 0036 la evidencia vive en los eventos de
 * las packing units, un despacho íntegro cuyos eventos cuelgan de sus bultos
 * daba `events_checked = 0` y, tras la corrección del DB-C4 —cadena vacía no es
 * válida—, `chain_valid = false`: el POD imprimía «CADENA INVÁLIDA» sobre algo
 * que nadie había roto.
 *
 * Se afirman tres hechos separados y una compatibilidad:
 *   · `verified`      — todas las cadenas requeridas verificables y válidas;
 *   · `invalid`       — alguna realmente rota (mutante construido de verdad);
 *   · `unverifiable`  — sin evidencia suficiente para pronunciarse;
 *   · `chain_valid`   — legacy, `true` EXCLUSIVAMENTE con `verified`.
 *
 * El mutante de cadena rota se construye de forma CONTROLADA: `custody_events`
 * es append-only por trigger, así que se deshabilita ese trigger, se corrompe
 * un `row_hash` y se vuelve a habilitar SIEMPRE en un `finally`. Una prueba que
 * se diera por satisfecha con «no se pudo alterar» no probaría que el sistema
 * detecta la adulteración, sino que la tabla resiste un UPDATE.
 */
import { describe, expect, inject, it, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import {
  actAs,
  attachEvidence,
  baseScenario,
  createActor,
  createClient as createErpClient,
  createOrder,
  createPackingUnit,
  createShipment,
  expectFailure,
  type Scenario,
} from "./harness/fixtures";
import { REPO_ROOT } from "./harness/manifest";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

interface Summary {
  shipment_id: string;
  events: number;
  evidences: number;
  pod_present: boolean;
  chain_status: "verified" | "invalid" | "unverifiable";
  chain_valid: boolean;
  chain_events_checked: number;
  last_activity: string | null;
}

async function summary(shipmentId: string): Promise<Summary> {
  const { rows } = await db.query<{ r: Summary }>(
    `select public.get_shipment_custody_summary($1) as r`,
    [shipmentId],
  );
  return rows[0].r;
}

/**
 * Despacho vacío. `shipments` tiene unicidad por pedido (`shipments_order_uk`),
 * así que cada despacho nace de su propio pedido del MISMO cliente: la variable
 * bajo prueba es la agregación de cadenas, no la unicidad del despacho.
 */
async function newShipment(s: Scenario): Promise<{ shipmentId: string; orderId: string }> {
  const orderId = await createOrder(db, s.clientId);
  return { shipmentId: await createShipment(db, orderId), orderId };
}

/** Bulto vinculado al despacho, con `n` eventos reales por la RPC productiva. */
async function packingUnitWithEvents(
  orderId: string,
  shipmentId: string,
  n: number,
): Promise<string> {
  const pu = await createPackingUnit(db, orderId, shipmentId);
  const stages = [
    { stage: "packing", eventType: "foto_packing" },
    { stage: "despacho", eventType: "cargado" },
    { stage: "transporte", eventType: "en_transito" },
  ] as const;
  for (let i = 0; i < n; i += 1) {
    const spec = stages[i % stages.length];
    await attachEvidence(db, { packingUnitId: pu, stage: spec.stage, eventType: spec.eventType });
  }
  return pu;
}

/**
 * Corrompe el `row_hash` del último evento de una entidad y devuelve una
 * función que restaura EXACTAMENTE el valor previo. El trigger append-only se
 * deshabilita y se vuelve a habilitar siempre.
 */
async function corruptLastEvent(entityId: string): Promise<() => Promise<void>> {
  const { rows } = await db.query<{ id: string; row_hash: string }>(
    `select id, row_hash from public.custody_events
      where coalesce(packing_unit_id, shipment_id) = $1
      order by chain_seq desc limit 1`,
    [entityId],
  );
  if (rows.length === 0) throw new Error("no hay evento que corromper");
  const { id, row_hash } = rows[0];

  await db.query(`alter table public.custody_events disable trigger trg_custody_events_immutable`);
  try {
    await db.query(
      `update public.custody_events set row_hash = repeat('0', 64) where id = $1`,
      [id],
    );
  } finally {
    await db.query(`alter table public.custody_events enable trigger trg_custody_events_immutable`);
  }

  return async () => {
    await db.query(`alter table public.custody_events disable trigger trg_custody_events_immutable`);
    try {
      await db.query(`update public.custody_events set row_hash = $2 where id = $1`, [id, row_hash]);
    } finally {
      await db.query(`alter table public.custody_events enable trigger trg_custody_events_immutable`);
    }
  };
}

describe("T-C2-05 · M5 · verified", () => {
  it("1 · shipment con cadena PROPIA verificada", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { shipmentId: sh, orderId: sh_ord } = await newShipment(s);
    await attachEvidence(db, { shipmentId: sh, stage: "transporte", eventType: "en_transito" });
    await attachEvidence(db, { shipmentId: sh, stage: "entrega", eventType: "foto_entrega" });

    const r = await summary(sh);
    expect(r.chain_status).toBe("verified");
    expect(r.chain_valid).toBe(true);
    expect(r.chain_events_checked).toBe(2);
  });

  it("2 · EL CASO M5 · shipment con eventos SÓLO en un packing unit", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { shipmentId: sh, orderId: sh_ord } = await newShipment(s);
    await packingUnitWithEvents(sh_ord, sh, 3);

    const r = await summary(sh);
    // Antes de 0225 esto era `false` y el POD imprimía CADENA INVÁLIDA.
    expect(r.chain_status).toBe("verified");
    expect(r.chain_valid).toBe(true);
    expect(r.chain_events_checked).toBe(3);
    expect(r.events).toBe(3);
  });

  it("3 · varios packing units verificados", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { shipmentId: sh, orderId: sh_ord } = await newShipment(s);
    await packingUnitWithEvents(sh_ord, sh, 2);
    await packingUnitWithEvents(sh_ord, sh, 3);

    const r = await summary(sh);
    expect(r.chain_status).toBe("verified");
    expect(r.chain_valid).toBe(true);
    expect(r.chain_events_checked).toBe(5);
  });

  it("4 · mezcla de cadena propia y packing units", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { shipmentId: sh, orderId: sh_ord } = await newShipment(s);
    await attachEvidence(db, { shipmentId: sh, stage: "entrega", eventType: "foto_entrega" });
    await packingUnitWithEvents(sh_ord, sh, 2);

    const r = await summary(sh);
    expect(r.chain_status).toBe("verified");
    expect(r.chain_events_checked).toBe(3);
  });
});

describe("T-C2-05 · M5 · invalid", () => {
  it("5 · un hijo REALMENTE roto ⇒ invalid, y no unverifiable", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { shipmentId: sh, orderId: sh_ord } = await newShipment(s);
    const pu = await packingUnitWithEvents(sh_ord, sh, 3);
    await packingUnitWithEvents(sh_ord, sh, 2);

    expect((await summary(sh)).chain_status).toBe("verified");

    const restore = await corruptLastEvent(pu);
    try {
      const r = await summary(sh);
      expect(r.chain_status).toBe("invalid");
      expect(r.chain_valid).toBe(false);
    } finally {
      await restore();
    }

    // Restaurado: vuelve a ser verificable. Si esto fallara, el mutante habría
    // dejado el escenario sucio y las demás pruebas no significarían nada.
    expect((await summary(sh)).chain_status).toBe("verified");
  });

  it("5.b · invalid gana sobre unverifiable (prioridad)", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { shipmentId: sh, orderId: sh_ord } = await newShipment(s);
    const roto = await packingUnitWithEvents(sh_ord, sh, 2);
    await createPackingUnit(db, sh_ord, sh); // bulto VACÍO ⇒ unverifiable

    const restore = await corruptLastEvent(roto);
    try {
      expect((await summary(sh)).chain_status).toBe("invalid");
    } finally {
      await restore();
    }
  });
});

describe("T-C2-05 · M5 · unverifiable", () => {
  it("6 · un hijo vacío ⇒ unverifiable", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { shipmentId: sh, orderId: sh_ord } = await newShipment(s);
    await packingUnitWithEvents(sh_ord, sh, 3);
    await createPackingUnit(db, sh_ord, sh); // sin eventos

    const r = await summary(sh);
    expect(r.chain_status).toBe("unverifiable");
    expect(r.chain_valid).toBe(false);
    // Los eventos recorridos del hijo sano se siguen informando con honestidad.
    expect(r.chain_events_checked).toBe(3);
  });

  it("7 · shipment totalmente vacío ⇒ unverifiable, nunca válido", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { shipmentId: sh, orderId: sh_ord } = await newShipment(s);

    const r = await summary(sh);
    expect(r.chain_status).toBe("unverifiable");
    expect(r.chain_valid).toBe(false);
    expect(r.chain_events_checked).toBe(0);
    expect(r.events).toBe(0);
  });
});

describe("T-C2-05 · M5 · conteos, compatibilidad y auditoría", () => {
  it("8 · la suma de eventos recorridos es la de todas las cadenas requeridas", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { shipmentId: sh, orderId: sh_ord } = await newShipment(s);
    await attachEvidence(db, { shipmentId: sh, stage: "entrega", eventType: "foto_entrega" });
    await packingUnitWithEvents(sh_ord, sh, 3);
    await packingUnitWithEvents(sh_ord, sh, 2);

    const r = await summary(sh);
    expect(r.chain_events_checked).toBe(6);
    expect(r.events).toBe(6);
  });

  it("9 · chain_valid es true ÚNICAMENTE con verified", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);

    const { shipmentId: vacio } = await newShipment(s);
    expect((await summary(vacio)).chain_valid).toBe(false);

    const { shipmentId: sano, orderId: sano_ord } = await newShipment(s);
    await packingUnitWithEvents(sano_ord, sano, 2);
    expect((await summary(sano)).chain_valid).toBe(true);

    const { shipmentId: roto, orderId: roto_ord } = await newShipment(s);
    const pu = await packingUnitWithEvents(roto_ord, roto, 2);
    const restore = await corruptLastEvent(pu);
    try {
      const r = await summary(roto);
      expect(r.chain_status).toBe("invalid");
      expect(r.chain_valid).toBe(false);
    } finally {
      await restore();
    }
  });

  it("10 · UNA sola auditoría agregada por resumen, sin PII", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { shipmentId: sh, orderId: sh_ord } = await newShipment(s);
    await packingUnitWithEvents(sh_ord, sh, 2);
    await packingUnitWithEvents(sh_ord, sh, 2);

    await db.query(`delete from public.audit_log where entity_id = $1`, [sh]);
    await summary(sh);

    const { rows } = await db.query<{ action: string; payload: Record<string, unknown> }>(
      `select action, payload from public.audit_log where entity_id = $1`,
      [sh],
    );
    // Dos bultos, UNA auditoría: el resumen no se audita por hijo.
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("custody.shipment_summary");
    expect(rows[0].payload.chain_status).toBe("verified");
    expect(rows[0].payload.chains_required).toBe(2);

    // Sin PII: sólo veredicto y conteos.
    const serialized = JSON.stringify(rows[0].payload);
    expect(serialized).not.toMatch(/@|storage_path|sha256|full_name|email/i);
    expect(Object.keys(rows[0].payload).sort()).toEqual([
      "chain_events_checked",
      "chain_status",
      "chain_valid",
      "chains_invalid",
      "chains_required",
      "chains_unverifiable",
      "events",
      "evidences",
    ]);
  });

  it("10.b · el helper de rollup NO es ejecutable por los roles de API", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const { rows } = await db.query<{ ok: boolean }>(
        `select has_function_privilege($1, 'public.custody_shipment_chain_rollup(uuid)', 'EXECUTE') as ok`,
        [role],
      );
      expect(rows[0].ok).toBe(false);
    }
  });

  it("10.c · el gate de rol de 0039 se conserva", async () => {
    const s = await baseScenario(db);
    const { shipmentId: sh, orderId: sh_ord } = await newShipment(s);
    await actAs(db, null); // sin sesión ⇒ current_role() null
    const msg = await expectFailure(() => summary(sh));
    expect(msg).toMatch(/no autorizado/i);
    await actAs(db, s.staff);
  });
});

describe("T-C2-05 · M5 · la superficie no se amplió", () => {
  it("15 · un usuario client-bound AJENO no obtiene el resumen", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { shipmentId: sh, orderId: sh_ord } = await newShipment(s);
    await packingUnitWithEvents(sh_ord, sh, 2);

    // `get_shipment_custody_summary` conserva el gate canónico de 0039: sólo
    // los roles internos. Un rol 'cliente' —aunque fuera el dueño— no pasa, y
    // 0225 no lo relajó para «que la UI del cliente vea el estado».
    const otherClientId = await createErpClient(db);
    const intruder = await createActor(db, "cliente", otherClientId);
    await actAs(db, intruder);
    const msg = await expectFailure(() => summary(sh));
    expect(msg).toMatch(/no autorizado/i);

    // Tampoco el rol de la propia empresa del despacho, si es 'cliente'.
    const own = await createActor(db, "cliente", s.clientId);
    await actAs(db, own);
    const msg2 = await expectFailure(() => summary(sh));
    expect(msg2).toMatch(/no autorizado/i);

    await actAs(db, s.staff);
  });

  it("15.b · los grants de la RPC son EXACTAMENTE los de 0039", async () => {
    const { rows } = await db.query<{ role: string; ok: boolean }>(
      `select r.rolname as role,
              has_function_privilege(r.rolname, 'public.get_shipment_custody_summary(uuid)', 'EXECUTE') as ok
         from pg_roles r where r.rolname in ('anon','authenticated','service_role')
        order by r.rolname`,
    );
    const map = Object.fromEntries(rows.map((r) => [r.role, r.ok]));
    expect(map).toEqual({ anon: false, authenticated: true, service_role: true });
  });

  it("16 · el helper interno no es ejecutable por ningún rol de API", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const { rows } = await db.query<{ ok: boolean }>(
        `select has_function_privilege($1, 'public.custody_shipment_chain_rollup(uuid)', 'EXECUTE') as ok`,
        [role],
      );
      expect(rows[0].ok, role).toBe(false);
    }
  });

  it("10 · 0225 no agregó policies RLS ni tablas nuevas", async () => {
    // El diff de 0225 es de funciones. Si alguna vez agrega una policy o una
    // tabla, esta prueba lo hace visible antes que un C4.
    const sql = readFileSync(
      join(REPO_ROOT, "supabase", "migrations", "0225_custody_0039_tristate_compat.sql"),
      "utf8",
    );
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql).not.toMatch(/alter\s+table[\s\S]{0,80}enable\s+row\s+level\s+security/i);
    expect(sql).not.toMatch(/create\s+table/i);
    expect(sql).not.toMatch(/grant[^\n]*\bto\b[^\n]*\banon\b/i);
    // Y no toca 0039 ni las migraciones ya cerradas.
    expect(sql).not.toMatch(/drop\s+function\s+public\.(generate_delivery_pod|get_custody_timeline|get_custody_by_token)/i);
  });
});

/**
 * 0250a angostó dos gates de contenedor para que el despacho vacío —y el bulto
 * vacío ya vinculado— sigan siendo representables: sin eso, el caso 7 de este
 * mismo archivo («vacío ⇒ unverifiable, nunca válido») quedaba fuera del
 * modelo. Ese angostamiento sólo es legítimo si lo que protege el contrato
 * sigue cerrado, así que se afirma acá: el contenedor vacío no puede entregarse,
 * no puede emitir POD y no puede llenarse después.
 */
describe("T-C2-05 · M5 · el contenedor vacío existe pero no libera nada", () => {
  it("12 · un despacho sin bultos NO puede pasar a entregado", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { shipmentId: sh } = await newShipment(s);

    const msg = await expectFailure(() =>
      db.query(`update public.shipments set status = 'entregado' where id = $1`, [sh]),
    );
    expect(msg).toMatch(/CUSTODY_ZERO_APPLICABLE_CASES/);

    const { rows } = await db.query<{ status: string }>(
      `select status::text as status from public.shipments where id = $1`,
      [sh],
    );
    expect(rows[0].status).toBe("despachado");
  });

  it("13 · un bulto vinculado vacío no puede recibir contenido después", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { shipmentId: sh, orderId: ord } = await newShipment(s);
    const pu = await createPackingUnit(db, ord, sh);

    const msg = await expectFailure(() =>
      db.query(
        `insert into public.packing_unit_items (packing_unit_id, allocation_id, quantity)
         values ($1, gen_random_uuid(), 1)`,
        [pu],
      ),
    );
    expect(msg).toMatch(/CUSTODY_PACKING_CONTENT_FROZEN/);

    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.packing_unit_items where packing_unit_id = $1`,
      [pu],
    );
    expect(rows[0].n).toBe("0");
  });
});

describe("T-C2-05 · M5 · las cuatro RPC de 0039 siguen operativas", () => {
  it("11 · generate_delivery_pod · get_custody_timeline · get_custody_by_token · get_shipment_custody_summary", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const { shipmentId: sh, orderId: sh_ord } = await newShipment(s);
    await packingUnitWithEvents(sh_ord, sh, 2);
    const firmaLegacy = await expectFailure(() =>
      attachEvidence(db, { shipmentId: sh, stage: "entrega", eventType: "firmado" }),
    );
    expect(firmaLegacy).toMatch(/firma POD sólo por attach_custody_pod_signature/);
    await attachEvidence(db, { shipmentId: sh, stage: "entrega", eventType: "foto_entrega" });

    // 1) La superficie legacy quedó retirada por 0263: no puede emitir un POD
    // sin operation/snapshot. Las lecturas históricas de 0039 sí permanecen.
    const pod = await expectFailure(() =>
      db.query(
        `select public.generate_delivery_pod($1, 'Receptor Sintético', 'DNI', '00000000', null, null, null) as r`,
        [sh],
      ),
    );
    expect(pod).toMatch(/generate_delivery_pod.*does not exist/i);

    // 2) get_custody_timeline
    const { rows: tl } = await db.query<{ r: { nodes: unknown[] } }>(
      `select public.get_custody_timeline(null, $1) as r`,
      [sh],
    );
    expect(Array.isArray(tl[0].r.nodes)).toBe(true);

    // 3) get_custody_by_token
    const { rows: tok } = await db.query<{ t: string | null }>(
      `select custody_token::text as t from public.shipments where id = $1`,
      [sh],
    );
    if (tok[0].t) {
      const { rows: byToken } = await db.query<{ r: { scope: string; public_id: string } }>(
        `select public.get_custody_by_token($1::uuid) as r`,
        [tok[0].t],
      );
      expect(byToken[0].r.scope).toBe("shipment");
      expect(byToken[0].r.public_id).toBeTruthy();
    }

    // 4) get_shipment_custody_summary — claves de 0039 + chain_status.
    const r = await summary(sh);
    for (const k of [
      "shipment_id",
      "events",
      "evidences",
      "pod_present",
      "chain_valid",
      "chain_events_checked",
      "last_activity",
      "chain_status",
    ]) {
      expect(Object.keys(r)).toContain(k);
    }
    // Coherente con el gate de arriba: si el POD no pudo emitirse antes de la
    // entrega, el resumen tampoco puede declararlo presente. `pod_present`
    // sigue siendo un dato real del resumen, no un literal.
    expect(r.pod_present).toBe(false);
  });
});
