/**
 * T-C5-04 · EL OVERRIDE HUMANO SOBRE UNA UNIDAD MARCADA POR LA IA.
 *
 * Cláusula en juego (Adenda N.º 2 §4.2): «la IA alerta, no decide». Si una
 * unidad que el modelo marca con banderas de daño no pudiera liberarse nunca,
 * la cuarentena sería una decisión de la IA por omisión — exactamente lo
 * prohibido.
 *
 * La base ya lo resolvía bien: `decide_custody_integrity_v2` distingue dos
 * ramas, `vision_policy` para la liberación limpia y `human_override` para el
 * caso retenido, y la segunda NUNCA exigió `verdict='coincide'`; pide admin,
 * motivo reforzado de 20 caracteres, un intento productivo cerrado y evidencia
 * de inspección humana. La capa de aplicación era más estricta que esa
 * autoridad auditada y volvía el override inalcanzable.
 *
 * Esta prueba NO usa dobles: recorre el camino productivo completo contra
 * PostgreSQL —recepción, unidad física, foto de ingreso, foto de egreso,
 * evaluación v2 con banderas de daño, inspección humana y decisión— porque el
 * estado que hay que alcanzar (HOLD con `verdict <> 'coincide'`) sólo lo
 * produce la propia base: 0250a declara incompatibles `coincide` y cualquier
 * bandera de daño.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createHash } from "node:crypto";
import { Client } from "pg";
import {
  actAs,
  actAsServer,
  actAsWithSession,
  baseScenario,
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

/** Ítem recibido ⇒ 0250a materializa unidad física y caso obligatorio. */
async function unidadFisica(): Promise<{ unitId: string; caseId: string }> {
  await actAsServer(db);
  const { rows: inv } = await db.query<{ id: string }>(
    `insert into public.inventory_items (sku, description, client_name, client_id, stock_available)
     values ($1, 'Bien de prueba', 'DEPOSITANTE', $2, 3) returning id`,
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
     values ($1, 'GENERAL', $2, 'Bien de prueba', 'LOT-OV', '2027-08-31', 3, 'recibido', $3)
     returning id`,
    [rec[0].id, uid("SKU"), inv[0].id],
  );
  const { rows: pu } = await db.query<{ id: string }>(
    `select id from public.custody_physical_units where reception_item_id = $1`,
    [it[0].id],
  );
  const { rows: c } = await db.query<{ id: string }>(
    `select id from public.custody_integrity_cases where physical_unit_id = $1`,
    [pu[0].id],
  );
  return { unitId: pu[0].id, caseId: c[0].id };
}

/**
 * Adjunta una foto por el camino productivo: atestación server-side ligada a
 * actor y sesión, y consumo desde la sesión del operario.
 */
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

async function versionDelCaso(caseId: string): Promise<number> {
  const { rows } = await db.query<{ version: number }>(
    `select version from public.custody_integrity_cases where id = $1`,
    [caseId],
  );
  return rows[0].version;
}

describe("T-C5-04 · una unidad marcada por la IA llega a HOLD, no a liberación", () => {
  it("1 · con banderas de daño el caso queda retenido y el veredicto no es 'coincide'", async () => {
    const { unitId, caseId } = await unidadFisica();
    const ing = await adjuntar(unitId, "recepcion", "foto_ingreso", "INGRESO-1");
    const egr = await adjuntar(unitId, "despacho", "foto_egreso", "EGRESO-1");

    await actAsWithSession(db, s.staff, s.staff.sessionId);
    const { rows: beg } = await db.query<{ attempt_id: string; disposition: string; case_version: number }>(
      `select attempt_id, disposition, case_version
         from public.begin_custody_integrity_evaluation_v2($1, $2)`,
      [caseId, await versionDelCaso(caseId)],
    );
    expect(beg[0].disposition).toBe("opened");

    // El servidor cierra el intento con banderas de daño: es la ruta que la
    // base admite, y la que fuerza `verdict='posible_dano'`.
    await actAsServer(db);
    await db.query(
      `select public.complete_custody_integrity_evaluation_v2(
         $1::uuid, $2::uuid, $3, $4, $5,
         '{"identity":97,"packaging":95,"quantity":96,"condition":94}'::jsonb,
         0.93, 'posible_dano', false, false, true,
         'resp-1', 'gpt-5.4-mini-2026-03-17', 'fp-1', $6, $7, '{}'::jsonb)`,
      [beg[0].attempt_id, caseId, beg[0].case_version, ing.sha256, egr.sha256, sha("req"), sha("res")],
    );

    const { rows } = await db.query<{
      state: string; verdict: string; damage_suspected: boolean; hold_reasons: string[];
    }>(
      `select state, verdict, damage_suspected, hold_reasons
         from public.custody_integrity_cases where id = $1`,
      [caseId],
    );
    expect(rows[0].state).toBe("HOLD");
    expect(rows[0].verdict).not.toBe("coincide");
    expect(rows[0].damage_suspected).toBe(true);
    expect(rows[0].hold_reasons).toContain("VERDICT_POSSIBLE_DAMAGE");
  });
});

describe("T-C5-04 · el inspector PUEDE liberar esa unidad, y queda auditado como override", () => {
  it("2 · admin con motivo reforzado e inspección libera por human_override", async () => {
    const { unitId, caseId } = await unidadFisica();
    const ing = await adjuntar(unitId, "recepcion", "foto_ingreso", "INGRESO-2");
    const egr = await adjuntar(unitId, "despacho", "foto_egreso", "EGRESO-2");

    await actAsWithSession(db, s.staff, s.staff.sessionId);
    const { rows: beg } = await db.query<{ attempt_id: string; case_version: number }>(
      `select attempt_id, case_version from public.begin_custody_integrity_evaluation_v2($1, $2)`,
      [caseId, await versionDelCaso(caseId)],
    );
    await actAsServer(db);
    await db.query(
      `select public.complete_custody_integrity_evaluation_v2(
         $1::uuid, $2::uuid, $3, $4, $5,
         '{"identity":96,"packaging":90,"quantity":95,"condition":88}'::jsonb,
         0.9, 'posible_dano', false, false, true,
         'resp-2', 'gpt-5.4-mini-2026-03-17', 'fp-2', $6, $7, '{}'::jsonb)`,
      [beg[0].attempt_id, caseId, beg[0].case_version, ing.sha256, egr.sha256, sha("req2"), sha("res2")],
    );

    // El inspector va, mira el bien y saca su fotografía.
    const insp = await adjuntar(unitId, "despacho", "inspeccion_humana", "INSPECCION-2");

    // Y libera. Esto es lo que antes era imposible desde el producto.
    await actAs(db, s.decider);
    await actAsWithSession(db, s.decider, s.decider.sessionId);
    await db.query(
      `select public.decide_custody_integrity_v2(
         $1::uuid, $2, 'release',
         'Inspección física realizada: el precinto estaba recolocado por el transportista, contenido íntegro.',
         null, array[$3::uuid])`,
      [caseId, await versionDelCaso(caseId), insp.evidenceId],
    );

    const { rows } = await db.query<{ state: string; decision_id: string | null }>(
      `select state, decision_id from public.custody_integrity_cases where id = $1`,
      [caseId],
    );
    expect(rows[0].state).toBe("RELEASED");
    expect(rows[0].decision_id).not.toBeNull();

    // Y queda AUDITADO como override, distinguible de una liberación limpia.
    const { rows: cert } = await db.query<{ basis: string }>(
      `select basis from public.custody_release_certificates where case_id = $1`,
      [caseId],
    );
    expect(cert.map((r) => r.basis)).toEqual(["human_override"]);

    const { rows: dec } = await db.query<{ actor_role: string; reason: string }>(
      `select actor_role, reason from public.custody_integrity_decisions where case_id = $1`,
      [caseId],
    );
    expect(dec[0].actor_role).toBe("admin");
    expect(dec[0].reason.length).toBeGreaterThanOrEqual(20);
  });

  it("3 · el override sigue exigiendo motivo reforzado: 19 caracteres no alcanzan", async () => {
    const { unitId, caseId } = await unidadFisica();
    const ing = await adjuntar(unitId, "recepcion", "foto_ingreso", "INGRESO-3");
    const egr = await adjuntar(unitId, "despacho", "foto_egreso", "EGRESO-3");

    await actAsWithSession(db, s.staff, s.staff.sessionId);
    const { rows: beg } = await db.query<{ attempt_id: string; case_version: number }>(
      `select attempt_id, case_version from public.begin_custody_integrity_evaluation_v2($1, $2)`,
      [caseId, await versionDelCaso(caseId)],
    );
    await actAsServer(db);
    await db.query(
      `select public.complete_custody_integrity_evaluation_v2(
         $1::uuid, $2::uuid, $3, $4, $5,
         '{"identity":96,"packaging":90,"quantity":95,"condition":88}'::jsonb,
         0.9, 'posible_dano', false, false, true,
         'resp-3', 'gpt-5.4-mini-2026-03-17', 'fp-3', $6, $7, '{}'::jsonb)`,
      [beg[0].attempt_id, caseId, beg[0].case_version, ing.sha256, egr.sha256, sha("req3"), sha("res3")],
    );
    const insp = await adjuntar(unitId, "despacho", "inspeccion_humana", "INSPECCION-3");

    await actAs(db, s.decider);
    await actAsWithSession(db, s.decider, s.decider.sessionId);
    await expect(
      db.query(
        `select public.decide_custody_integrity_v2(
           $1::uuid, $2, 'release', 'diecinueve caracte', null, array[$3::uuid])`,
        [caseId, await versionDelCaso(caseId), insp.evidenceId],
      ),
    ).rejects.toThrow(/motivo reforzado/);
  });
});
