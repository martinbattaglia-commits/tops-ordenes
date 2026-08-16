/**
 * T-C6-01 · AUTORIDAD DE DECISIÓN TRAS 0251 (S1-1 · los tres actos).
 *
 * Las CUATRO pruebas que el mandato exige, contra PostgreSQL real y por el
 * camino productivo completo —recepción, unidad física, par de fotos,
 * evaluación v2 y decisión—, no contra dobles.
 *
 *   1. `operaciones` pasa el gate de decidir; sin el permiso, no.
 *   2. `gerencia_comercial` NO pasa el gate.
 *   3. `operaciones` puede cuarentenar y NO puede liberar.
 *   4. `cliente` NO puede cuarentenar, ni sobre su propio `client_id`.
 *
 * ─── DOS COSAS QUE NO SON LO MISMO Y ACÁ IMPORTAN ────────────────────────
 *
 * `profiles.role` alimenta `current_role()`, que es el rol que se GRABA en la
 * cadena de custodia y el que miran las listas de autoridad. `user_roles` +
 * `role_permissions` alimentan `has_permission()`, que es el gate del permiso.
 * Son dos ejes distintos: 0251 concede `wms.custody.decide` al ROL DE CATÁLOGO
 * `operaciones`, así que sólo lo recibe quien esté atado a ese rol en
 * `user_roles`. Las pruebas de abajo atan el rol de catálogo REAL, no un
 * `test-role-…` ad hoc, porque si no probarían el harness en vez de 0251.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createHash } from "node:crypto";
import { Client } from "pg";
import {
  actAsServer,
  actAsWithSession,
  baseScenario,
  createActor,
  expectFailure,
  uid,
  type Actor,
  type Role,
  type Scenario,
} from "./harness/fixtures";

let db: Client;
let s: Scenario;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
  s = await baseScenario(db);
});

afterAll(async () => {
  await db.end();
});

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

/** Ata al usuario a un ROL DE CATÁLOGO real (no a un `test-role-…`). */
async function atarRolDeCatalogo(actor: Actor, slug: string): Promise<void> {
  await actAsServer(db);
  const { rows } = await db.query<{ id: string }>(
    `insert into public.roles (slug, name) values ($1, $1)
     on conflict (slug) do update set name = excluded.name returning id`,
    [slug],
  );
  await db.query(
    `insert into public.user_roles (user_id, role_id) values ($1, $2) on conflict do nothing`,
    [actor.userId, rows[0].id],
  );
}

/**
 * Actor con `profiles.role` dado y atado —o no— a un rol de catálogo.
 * `admin` se evita a propósito donde se quiere probar el permiso: 0009 hace
 * que `has_permission` devuelva true para admin por otra rama.
 */
async function actorConRol(
  perfil: Role,
  catalogo: string | null,
  clientId: string | null = null,
): Promise<Actor> {
  const a = await createActor(db, perfil, clientId);
  if (catalogo !== null) await atarRolDeCatalogo(a, catalogo);
  return a;
}

/** Ítem recibido ⇒ 0250a materializa unidad física y caso obligatorio. */
async function unidadFisica(clientId: string = s.clientId): Promise<{
  unitId: string;
  caseId: string;
}> {
  await actAsServer(db);
  const { rows: inv } = await db.query<{ id: string }>(
    `insert into public.inventory_items (sku, description, client_name, client_id, stock_available)
     values ($1, 'Bien de prueba', 'DEPOSITANTE', $2, 3) returning id`,
    [uid("SKU"), clientId],
  );
  const { rows: rec } = await db.query<{ id: string }>(
    `insert into public.receptions (public_id, client_name, client_id, status, received_at)
     values ($1, 'DEPOSITANTE', $2, 'recibida', now()) returning id`,
    [uid("REC"), clientId],
  );
  const { rows: item } = await db.query<{ id: string }>(
    `insert into public.reception_items
       (reception_id, business_unit, sku, description, lot_number, expiration_date,
        quantity, status, inventory_item_id)
     values ($1, 'GENERAL', $2, 'Bien de prueba', 'LOT-A1', '2027-08-31', 3, 'recibido', $3)
     returning id`,
    [rec[0].id, uid("SKU"), inv[0].id],
  );
  const { rows: pu } = await db.query<{ id: string }>(
    `select id from public.custody_physical_units where reception_item_id = $1`,
    [item[0].id],
  );
  const { rows: c } = await db.query<{ id: string }>(
    `select id from public.custody_integrity_cases where physical_unit_id = $1`,
    [pu[0].id],
  );
  return { unitId: pu[0].id, caseId: c[0].id };
}

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

/** Caso físico llevado a HOLD por banderas de daño. Es el estado decidible. */
async function casoEnHold(clientId: string = s.clientId): Promise<{
  caseId: string;
  version: number;
}> {
  const { unitId, caseId } = await unidadFisica(clientId);
  const ing = await adjuntar(unitId, "recepcion", "foto_ingreso", uid("ING"));
  const egr = await adjuntar(unitId, "despacho", "foto_egreso", uid("EGR"));

  await actAsWithSession(db, s.staff, s.staff.sessionId);
  const { rows: beg } = await db.query<{ attempt_id: string; case_version: number }>(
    `select attempt_id, case_version from public.begin_custody_integrity_evaluation_v2($1, $2)`,
    [caseId, await versionDelCaso(caseId)],
  );
  await actAsServer(db);
  await db.query(
    `select public.complete_custody_integrity_evaluation_v2(
       $1::uuid, $2::uuid, $3, $4, $5,
       '{"identity":97,"packaging":95,"quantity":96,"condition":94}'::jsonb,
       0.93, 'posible_dano', false, false, true,
       'resp-a', 'gpt-5.4-mini-2026-03-17', 'fp-a', $6, $7, '{}'::jsonb)`,
    [beg[0].attempt_id, caseId, beg[0].case_version, ing.sha256, egr.sha256, sha(uid("req")), sha(uid("res"))],
  );
  const { rows } = await db.query<{ state: string }>(
    `select state from public.custody_integrity_cases where id = $1`,
    [caseId],
  );
  expect(rows[0].state).toBe("HOLD");
  return { caseId, version: await versionDelCaso(caseId) };
}

async function cuarentenar(caseId: string, version: number): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select public.decide_custody_integrity_v2(
       $1, $2, 'quarantine', 'Se detectan diferencias en el embalaje frontal', null, '{}'::uuid[]) as id`,
    [caseId, version],
  );
  return rows[0].id;
}

// =========================================================================
// 1 · el permiso, por el rol de catálogo
// =========================================================================

describe("T-C6-01 · 1 · el gate de decidir", () => {
  it("un usuario `operaciones` atado al rol de catálogo PASA el gate", async () => {
    const a = await actorConRol("operaciones", "operaciones");
    await actAsWithSession(db, a, a.sessionId);
    const { rows } = await db.query<{ actor_role: string }>(
      `select actor_role from public.assert_custody_access('wms.custody.decide')`,
    );
    expect(rows[0].actor_role).toBe("operaciones");
  });

  it("un usuario `operaciones` SIN rol de catálogo NO pasa el gate", async () => {
    // Mismo perfil, misma sesión acreditada: lo único que falta es el permiso.
    const a = await actorConRol("operaciones", null);
    await actAsWithSession(db, a, a.sessionId);
    const msg = await expectFailure(() =>
      db.query(`select actor_role from public.assert_custody_access('wms.custody.decide')`),
    );
    expect(msg).toMatch(/no autorizado/i);
  });
});

// =========================================================================
// 2 · el comodín no alcanza a comercial ni a finanzas
// =========================================================================

describe("T-C6-01 · 2 · gerencia_comercial y administracion_finanzas", () => {
  it.each(["gerencia_comercial", "administracion_finanzas"])(
    "un usuario de `%s` NO pasa el gate de decidir",
    async (slug) => {
      const a = await actorConRol("operaciones", slug);
      // Se reproduce el cross join del comodín 20260811230310 TAL CUAL, con su
      // `on conflict do nothing`: es el escenario real de una base
      // reconstruida, donde el comodín ordena DESPUÉS de 0251 por nombre de
      // archivo. La guarda tiene que dejarlo terminar y quedarse con el
      // permiso afuera.
      await actAsServer(db);
      await db.query(
        `insert into public.role_permissions (role_id, permission_id)
         select r.id, p.id from public.roles r cross join public.permissions p
          where r.slug = $1 and p.slug not like 'sistema.%'
            and p.slug <> 'rrhh.documentacion.view'
         on conflict do nothing`,
        [slug],
      );

      await actAsWithSession(db, a, a.sessionId);
      const msg = await expectFailure(() =>
        db.query(`select actor_role from public.assert_custody_access('wms.custody.decide')`),
      );
      expect(msg).toMatch(/no autorizado/i);
    },
  );
});

// =========================================================================
// 3 · operaciones cuarentena, operaciones no libera
// =========================================================================

describe("T-C6-01 · 3 · el reparto de autoridad: la operación retiene, la Dirección libera", () => {
  it("un usuario `operaciones` PUEDE cuarentenar", async () => {
    const { caseId, version } = await casoEnHold();
    const a = await actorConRol("operaciones", "operaciones");
    await actAsWithSession(db, a, a.sessionId);

    const decisionId = await cuarentenar(caseId, version);
    expect(decisionId).toMatch(/^[0-9a-f-]{36}$/);

    await actAsServer(db);
    const { rows } = await db.query<{ state: string; actor_role: string }>(
      `select c.state, d.actor_role
         from public.custody_integrity_cases c
         join public.custody_integrity_decisions d on d.id = c.decision_id
        where c.id = $1`,
      [caseId],
    );
    expect(rows[0].state).toBe("QUARANTINED");
    // Lo que se graba en la cadena es `operaciones`, que es verdadero.
    expect(rows[0].actor_role).toBe("operaciones");
  });

  it("ese mismo usuario `operaciones` NO puede liberar", async () => {
    const { caseId, version } = await casoEnHold();
    const a = await actorConRol("operaciones", "operaciones");
    await actAsWithSession(db, a, a.sessionId);

    const msg = await expectFailure(() =>
      db.query(
        `select public.decide_custody_integrity_v2(
           $1, $2, 'release', 'Motivo reforzado suficientemente largo para el override de HOLD',
           null, '{}'::uuid[])`,
        [caseId, version],
      ),
    );
    expect(msg).toMatch(/liberación reservada a admin/i);

    await actAsServer(db);
    const { rows } = await db.query<{ state: string }>(
      `select state from public.custody_integrity_cases where id = $1`,
      [caseId],
    );
    expect(rows[0].state).toBe("HOLD");
  });
});

// =========================================================================
// 4 · el depositante informa; TOPS decide
// =========================================================================

describe("T-C6-01 · 4 · `cliente` no cuarentena", () => {
  it("un usuario `cliente` NO puede cuarentenar ni sobre su propio client_id", async () => {
    const { caseId, version } = await casoEnHold();
    // Se le da TODO lo que podría faltarle salvo la autoridad: el permiso por
    // rol de catálogo, y el tenant correcto —es su propia mercadería—. Lo
    // único que lo detiene es la lista de roles que 0251 agregó.
    const a = await actorConRol("cliente", "operaciones", s.clientId);
    await actAsWithSession(db, a, a.sessionId);

    const msg = await expectFailure(() => cuarentenar(caseId, version));
    expect(msg).toMatch(/cuarentena reservada a admin, operaciones y supervisor/i);

    await actAsServer(db);
    const { rows } = await db.query<{ state: string; decision_id: string | null }>(
      `select state, decision_id from public.custody_integrity_cases where id = $1`,
      [caseId],
    );
    expect(rows[0].state).toBe("HOLD");
    expect(rows[0].decision_id).toBeNull();
  });
});

// =========================================================================
// 5 · S1-4 · el adjunto deja de declarar evidencia faltante
// =========================================================================

describe("T-C6-01 · 5 · con las dos fotos cargadas el caso ya no dice que falta una", () => {
  it("tras la SEGUNDA foto el caso retiene por análisis pendiente, no por evidencia", async () => {
    const { unitId, caseId } = await unidadFisica();

    await adjuntar(unitId, "recepcion", "foto_ingreso", uid("ING"));
    await actAsServer(db);
    const { rows: uno } = await db.query<{ hold_reasons: string[] }>(
      `select hold_reasons from public.custody_integrity_cases where id = $1`,
      [caseId],
    );
    // Con una sola foto la retención sigue siendo la correcta.
    expect(uno[0].hold_reasons).toEqual(["EVIDENCE_MISSING"]);

    await adjuntar(unitId, "despacho", "foto_egreso", uid("EGR"));
    await actAsServer(db);
    const { rows: dos } = await db.query<{
      state: string;
      hold_reasons: string[];
      ingress_evidence_id: string | null;
      egress_evidence_id: string | null;
    }>(
      `select state, hold_reasons, ingress_evidence_id, egress_evidence_id
         from public.custody_integrity_cases where id = $1`,
      [caseId],
    );
    expect(dos[0].ingress_evidence_id).not.toBeNull();
    expect(dos[0].egress_evidence_id).not.toBeNull();
    // ESTE es el defecto que 0251 cierra: antes decía EVIDENCE_MISSING con las
    // dos fotos cargadas, y el checklist del operario mentía.
    expect(dos[0].hold_reasons).toEqual(["PROVIDER_NOT_EXECUTED"]);
    // El estado sigue siendo PENDING_EVIDENCE: sin análisis no es revisable.
    expect(dos[0].state).toBe("PENDING_EVIDENCE");
  });
});
