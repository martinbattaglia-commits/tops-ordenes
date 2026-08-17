/**
 * T-C7-04 · LA POLÍTICA DE LECTURA DEL CERTIFICADO (0254), MEDIDA.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE ESTE ARCHIVO · R-19
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 2-C-2 agregó `0254`, cuya ÚNICA razón de existir es una política de `select`
 * sobre `custody_release_certificates`: la tabla tenía RLS habilitada y ninguna
 * política, así que el `grant select ... to authenticated` de 0250a quedaba por
 * encima de una puerta cerrada y ninguna sesión leía una sola fila.
 *
 * **Y esa política no tenía ni una prueba.** Los `+2` que el bloque sumó al
 * harness son CONTABLES —manifiesto 49→50 y clasificación forward/rollback— y
 * no tocan la política. El único test que lee esa tabla, `t-c5-04`, consulta con
 * `db.query` SIN `set role`, es decir **como dueño del esquema, donde RLS no
 * aplica**: pasa idéntico con la migración y sin ella.
 *
 * La política estaba bien, pero eso se supo por LECTURA, no por MEDICIÓN. Una
 * migración sin control, tapada por un conteo que sube, es peor que una
 * migración ausente: el verde afirma algo que nadie comprobó.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * QUÉ MIDE, Y POR QUÉ ASÍ
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `set role authenticated` es lo que hace que RLS APLIQUE. Sin eso la conexión
 * es dueña del esquema y las políticas ni se evalúan — que es exactamente el
 * agujero que dejó pasar esto. El instrumento no es nuevo: `t-c1-08` y `t-c2-02`
 * ya lo usan, y `asDbRole` está duplicado localmente en cada uno. Se replica el
 * patrón establecido en vez de extraerlo: la extracción es una mejora legítima y
 * no entra en el alcance de esta remediación.
 *
 * El caso DECISIVO es el negativo. Sin él, un test que lee una fila no mide la
 * política: mide que la fila existe.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CÓMO SE LLEGA A TENER UN CERTIFICADO · MEDIDO, NO SUPUESTO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `buildReleasableCase` + `tryRelease` **no** producen certificado: arman un caso
 * de scope `packing_unit` y deciden por `decide_custody_integrity` (v1), y el
 * insert de la fila vive **exclusivamente** en `decide_custody_integrity_v2`
 * (`0250a:2182`, redefinida en `0251:257`), que exige `physical_unit_id not
 * null`. La constraint de la tabla lo confirma: `basis in('vision_policy',
 * 'human_override')` obliga a `physical_unit_id`, `evaluation_attempt_id` y
 * `policy_id`.
 *
 * Por eso el camino que se replica es el de `t-c5-04`: ítem recibido ⇒ 0250a
 * materializa unidad física y caso, par de fotos por el camino productivo,
 * evaluación cerrada server-side, foto de inspección y liberación por v2. La
 * fila del certificado **no se inserta acá**: la escribe la liberación, dentro
 * de la misma transacción que registra la decisión.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createHash } from "node:crypto";
import { Client } from "pg";
import {
  actAs,
  actAsServer,
  actAsWithSession,
  baseScenario,
  createActor,
  createClient as createErpClient,
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

afterAll(async () => {
  await db.end();
});

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

/**
 * Corre `fn` bajo el rol REAL de PostgREST. Duplicado local a propósito: ver el
 * docblock del archivo.
 */
async function asDbRole<T>(role: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.query(`reset role`);
  }
}

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
     values ($1, 'GENERAL', $2, 'Bien de prueba', 'LOT-C7', '2027-08-31', 3, 'recibido', $3)
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

/** Adjunta una foto por el camino productivo: atestación server-side + sesión. */
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

/** Llega hasta tener un certificado emitido, por el camino que lo escribe. */
async function casoConCertificado(etiqueta: string): Promise<string> {
  const { unitId, caseId } = await unidadFisica();
  const ing = await adjuntar(unitId, "recepcion", "foto_ingreso", `INGRESO-${etiqueta}`);
  const egr = await adjuntar(unitId, "despacho", "foto_egreso", `EGRESO-${etiqueta}`);

  await actAsWithSession(db, s.staff, s.staff.sessionId);
  const { rows: beg } = await db.query<{ attempt_id: string; case_version: number }>(
    `select attempt_id, case_version from public.begin_custody_integrity_evaluation_v2($1, $2)`,
    [caseId, await versionDelCaso(caseId)],
  );

  await actAsServer(db);
  await db.query(
    `select public.complete_custody_integrity_evaluation_v2(
       $1::uuid, $2::uuid, $3, $4, $5,
       '{"identity":98,"packaging":97,"quantity":98,"condition":97}'::jsonb,
       0.95, 'coincide', false, false, false,
       $6, 'gpt-5.4-mini-2026-03-17', $7, $8, $9, '{}'::jsonb)`,
    [
      beg[0].attempt_id, caseId, beg[0].case_version, ing.sha256, egr.sha256,
      `resp-${etiqueta}`, `fp-${etiqueta}`, sha(`req-${etiqueta}`), sha(`res-${etiqueta}`),
    ],
  );

  const insp = await adjuntar(unitId, "despacho", "inspeccion_humana", `INSPECCION-${etiqueta}`);

  await actAs(db, s.decider);
  await actAsWithSession(db, s.decider, s.decider.sessionId);
  await db.query(
    `select public.decide_custody_integrity_v2(
       $1::uuid, $2, 'release',
       'Inspección física completa: la mercadería coincide con la foto de ingreso.',
       null, array[$3::uuid])`,
    [caseId, await versionDelCaso(caseId), insp.evidenceId],
  );
  return caseId;
}

/** Cuántos certificados de este caso ve QUIEN esté actuando. */
async function certificadosVisibles(caseId: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*)::text as n from public.custody_release_certificates where case_id = $1`,
    [caseId],
  );
  return Number.parseInt(rows[0].n, 10);
}

describe("T-C7-04 · el certificado EXISTE y la política es lo único que decide quién lo ve", () => {
  it("la liberación deja el certificado escrito (control del escenario)", async () => {
    const caseId = await casoConCertificado("CTRL");
    // Sin `set role`: dueño del esquema, RLS no aplica. Esto NO mide la
    // política — mide que hay algo que leer. Es el control que impide que los
    // tests de abajo pasen por vacíos.
    expect(await certificadosVisibles(caseId)).toBe(1);
  });
});

describe("T-C7-04 · (a) un rol OPERATIVO lee el certificado de un caso ajeno", () => {
  /**
   * La política dice `current_role() in ('admin','operaciones','supervisor')`
   * **o** tenant propio. Los tres roles operativos ven todo el tenant, y eso es
   * deliberado: son quienes operan el depósito de todos los clientes.
   */
  for (const rol of ["admin", "operaciones", "supervisor"] as const) {
    it(`${rol}, sin ser del cliente del caso, SÍ lo ve`, async () => {
      const caseId = await casoConCertificado(`OP-${rol}`);
      const otroCliente = await createErpClient(db);
      expect(otroCliente).not.toBe(s.clientId);
      const operativo = await createActor(db, rol, otroCliente);

      const visibles = await asDbRole("authenticated", async () => {
        await actAs(db, operativo);
        return certificadosVisibles(caseId);
      });
      expect(visibles).toBe(1);
    });
  }
});

describe("T-C7-04 · (b) un usuario de CLIENTE ve el suyo y NO el de otro", () => {
  it("el cliente DUEÑO del caso lo ve", async () => {
    const caseId = await casoConCertificado("PROPIO");
    const propio = await createActor(db, "cliente", s.clientId);

    const visibles = await asDbRole("authenticated", async () => {
      await actAs(db, propio);
      return certificadosVisibles(caseId);
    });
    expect(visibles).toBe(1);
  });

  /**
   * ⚠ EL CASO DECISIVO. Si este lado no estuviera, el archivo no mediría la
   * política: mediría que la fila existe. El certificado es el documento
   * probatorio de un cliente, y verlo cruzado sería una fuga de tenant sobre el
   * artefacto más sensible del módulo.
   */
  it("un cliente AJENO lee CERO filas", async () => {
    const caseId = await casoConCertificado("AJENO");
    const otroCliente = await createErpClient(db);
    expect(otroCliente).not.toBe(s.clientId);
    const ajeno = await createActor(db, "cliente", otroCliente);

    const visibles = await asDbRole("authenticated", async () => {
      await actAs(db, ajeno);
      return certificadosVisibles(caseId);
    });
    expect(visibles).toBe(0);
  });

  /** Sin sesión tampoco: la ausencia de sesión no puede ser un camino de lectura. */
  it("sin sesión no se lee nada", async () => {
    const caseId = await casoConCertificado("ANON");

    const visibles = await asDbRole("authenticated", async () => {
      await actAs(db, null);
      return certificadosVisibles(caseId);
    });
    expect(visibles).toBe(0);
  });
});
