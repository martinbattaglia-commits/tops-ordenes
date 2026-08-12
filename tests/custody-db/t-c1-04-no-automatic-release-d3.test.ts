/**
 * T-C1-04 · D3 — NO_AUTOMATIC_RELEASE.
 *
 * La afirmación fuerte del expediente: NINGUNA ruta lleva a 'RELEASED' sin una
 * decisión humana autenticada, autorizada, auditada y bajo CAS. Se prueba por
 * agotamiento de vías: escritura directa, estado derivado, inyección de hechos,
 * RBAC, tenant ajeno y concurrencia.
 *
 * Además: NINGÚN umbral numérico. El «90 %» nunca existió como regla y no se
 * introdujo acá.
 */
import { describe, expect, inject, it, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import {
  actAs,
  actAsWithSession,
  baseScenario,
  createActor,
  createClient as createErpClient,
  createOrder,
  createPackingUnit,
  expectFailure,
  grantPermission,
} from "./harness/fixtures";
import { buildReleasableCase, tryRelease } from "./harness/scenario";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

describe("T-C1-04 · D3: imposibilidad de liberación automática", () => {
  it("ni `authenticated` ni `service_role` tienen INSERT/UPDATE/DELETE sobre las tablas de custodia", async () => {
    // §2 · `service_role` entra en la aserción a propósito: el bootstrap de
    // Supabase le concede ALL por ALTER DEFAULT PRIVILEGES, y si esa concesión
    // sobreviviera, el rol de servidor podría escribir la evaluación SIN
    // intento previo y todo el flujo de procedencia sería decorativo.
    const tables = [
      "custody_integrity_cases",
      "custody_integrity_decisions",
      "custody_integrity_inspection_evidence",
      "custody_integrity_evaluation_attempts",
    ];
    for (const grantee of ["authenticated", "service_role"]) {
      const { rows } = await db.query<{ table_name: string; privilege_type: string }>(
        `select table_name, privilege_type from information_schema.role_table_grants
          where grantee = $1 and table_schema = 'public' and table_name = any($2)`,
        [grantee, tables],
      );
      const writes = rows.filter((r: { privilege_type: string }) => r.privilege_type !== "SELECT");
      expect(writes, `${grantee} no debe poder escribir`).toEqual([]);
      // Y sí puede leer: la lectura no es el problema.
      expect(
        rows.filter((r: { privilege_type: string }) => r.privilege_type === "SELECT").length,
        `${grantee} debe conservar SELECT`,
      ).toBe(tables.length);
    }
  });

  it("no existe estado terminal sin fila de decisión: lo impide un CHECK", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);

    // Intento de saltar la decisión escribiendo el estado directamente (como
    // superusuario del harness, el escenario MÁS favorable al atacante).
    const msg = await expectFailure(() =>
      db.query(`update public.custody_integrity_cases set state = 'RELEASED' where id = $1`, [
        c.caseId,
      ]),
    );
    expect(msg).toMatch(/custody_integrity_cases_terminal_needs_decision_chk/);
  });

  it("la RPC de assessment RECHAZA producir un estado terminal", async () => {
    const s = await baseScenario(db);
    await actAs(db, s.staff);
    const pu = await createPackingUnit(db, s.orderId);

    for (const state of ["RELEASED", "QUARANTINED"]) {
      const msg = await expectFailure(() =>
        db.query(
          `select public.upsert_custody_integrity_assessment(
             'packing_unit', $1, null, null, null, $2, '{}'::text[])`,
          [pu, state],
        ),
      );
      expect(msg).toMatch(/estado no derivable/);
    }
  });

  it("una evaluación 'perfecta' NO libera por sí sola: sigue haciendo falta el humano", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s, { modelConfidence: 1.0 });

    const { rows } = await db.query<{ state: string; decision_id: string | null }>(
      `select state, decision_id from public.custody_integrity_cases where id = $1`,
      [c.caseId],
    );
    // Confianza máxima, veredicto 'coincide', cadena verificada... y sigue
    // esperando a una persona.
    expect(rows[0].state).toBe("REVIEW_REQUIRED");
    expect(rows[0].decision_id).toBeNull();
  });

  it("NO hay umbral numérico: confianza baja no bloquea, veredicto adverso sí", async () => {
    // Confianza 0.01 con veredicto 'coincide' → libera. Si existiera un corte
    // tipo 90 %, esto fallaría.
    const s1 = await baseScenario(db);
    const low = await buildReleasableCase(db, s1, { modelConfidence: 0.01 });
    await expect(tryRelease(db, low)).resolves.toBeTruthy();

    // Veredicto adverso con confianza altísima → bloquea. La regla es el
    // VEREDICTO, no la magnitud.
    const s2 = await baseScenario(db);
    const bad = await buildReleasableCase(db, s2, {
      verdict: "posible_dano",
      modelConfidence: 0.99,
    });
    const msg = await expectFailure(() => tryRelease(db, bad));
    expect(msg).toMatch(/evaluación no apta/);
  });

  it("evaluación no apta en cualquiera de sus formas bloquea la liberación", async () => {
    const variants = [
      { name: "modo simulado", opts: { executionMode: "mock" } },
      { name: "proveedor caído", opts: { outcome: "unavailable", verdict: null, modelConfidence: null } },
      { name: "sin confianza", opts: { modelConfidence: null } },
    ];
    for (const v of variants) {
      const s = await baseScenario(db);
      const c = await buildReleasableCase(db, s, v.opts);
      const msg = await expectFailure(() => tryRelease(db, c));
      expect(msg, v.name).toMatch(/evaluación no apta/);
    }
  });

  it("retenciones distintas de NO_CALIBRATED_THRESHOLD bloquean", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s, {
      holdReasons: ["NO_CALIBRATED_THRESHOLD", "EVIDENCE_MISSING"],
    });
    const msg = await expectFailure(() => tryRelease(db, c));
    expect(msg).toMatch(/retenciones distintas/);
  });

  it("INYECCIÓN: la firma de la RPC no admite actor, tenant ni timestamps", async () => {
    const { rows } = await db.query<{ args: string }>(
      `select pg_get_function_arguments(p.oid) as args from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'decide_custody_integrity'`,
    );
    const args = rows[0].args;
    for (const forbidden of ["actor", "user_id", "session", "client_id", "decided_at", "role"]) {
      expect(args, `parámetro prohibido: ${forbidden}`).not.toMatch(new RegExp(forbidden, "i"));
    }
  });

  it("INYECCIÓN: actor y sesión salen del token, no de lo que diga el llamador", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);
    const decisionId = await tryRelease(db, c);

    const { rows } = await db.query<{ actor_user_id: string; actor_session_id: string; decided_at: string }>(
      `select actor_user_id, actor_session_id, decided_at
         from public.custody_integrity_decisions where id = $1`,
      [decisionId],
    );
    expect(rows[0].actor_user_id).toBe(s.decider.userId);
    expect(rows[0].actor_session_id).toBe(s.decider.sessionId);
    // El instante lo puso el servidor: está en el pasado inmediato.
    const delta = Date.now() - new Date(rows[0].decided_at).getTime();
    expect(delta).toBeGreaterThanOrEqual(0);
    expect(delta).toBeLessThan(120_000);
  });

  it("SESIÓN: sin session_id acreditado, o con uno ajeno, no se decide", async () => {
    const s = await baseScenario(db);

    // Sin session_id en el token.
    const c1 = await buildReleasableCase(db, s);
    await actAsWithSession(db, s.decider, null);
    const msgMissing = await expectFailure(() => tryRelease(db, c1, undefined, undefined, "keep"));
    expect(msgMissing).toMatch(/sesión no acreditada/);

    // session_id inventado, no presente en auth.sessions.
    const s2 = await baseScenario(db);
    const c2 = await buildReleasableCase(db, s2);
    await actAsWithSession(db, s2.decider, "11111111-2222-3333-4444-555555555555");
    const msgForeign = await expectFailure(() => tryRelease(db, c2, undefined, undefined, "keep"));
    expect(msgForeign).toMatch(/sesión inválida para el usuario/);
  });

  it("ANÓNIMO: sin sesión no se decide", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);

    await actAs(db, null);
    const msg = await expectFailure(() => tryRelease(db, c, undefined, undefined, "keep"));
    expect(msg).toMatch(/sesión inexistente|no autorizado/);
  });

  it("RBAC: sin el permiso wms.custody.decide no se decide", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);

    // Actor con wms.edit pero SIN wms.custody.decide, y rol no admin.
    const weak = await createActor(db, "operaciones");
    await grantPermission(db, weak, "wms.edit");
    await actAs(db, weak);

    const msg = await expectFailure(() => tryRelease(db, c, undefined, undefined, "keep"));
    expect(msg).toMatch(/no autorizado/);
  });

  it("RBAC NULL-SAFE: un usuario sin perfil no pasa el guard en silencio", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);

    // Usuario SIN fila en profiles: current_role() es NULL y has_permission()
    // devuelve NULL. Sin coalesce, `if not NULL` no dispararía y la
    // autorización pasaría en silencio (hallazgo 0009:164).
    //
    // Hay que BORRAR el perfil: 0001 instala `handle_new_user()` AFTER INSERT
    // sobre auth.users, que crea el profile con rol 'operaciones' por defecto.
    // Sin este delete el usuario tendría rol y la prueba no tocaría el hazard.
    const { rows: u } = await db.query<{ id: string }>(
      `insert into auth.users (email) values ($1) returning id`,
      [`sin-perfil-${Date.now()}@test.local`],
    );
    await db.query(`delete from public.profiles where id = $1`, [u[0].id]);
    const { rows: sess } = await db.query<{ id: string }>(
      `insert into auth.sessions (user_id) values ($1) returning id`,
      [u[0].id],
    );
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [u[0].id]);
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: u[0].id, role: "authenticated", session_id: sess[0].id }),
    ]);

    const { rows: hp } = await db.query<{ hp: boolean | null }>(
      `select public.has_permission('wms.custody.decide') as hp`,
    );
    // Se documenta el hazard: la función NO es null-safe por sí misma.
    expect(hp[0].hp).toBeNull();

    const msg = await expectFailure(() => tryRelease(db, c, undefined, undefined, "keep"));
    expect(msg).toMatch(/no autorizado/);
  });

  it("CROSS-CLIENT: un cliente ajeno no decide sobre el caso de otro", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);

    const otherClientId = await createErpClient(db);
    const intruder = await createActor(db, "cliente", otherClientId);
    await grantPermission(db, intruder, "wms.custody.decide");
    await actAs(db, intruder);

    const msg = await expectFailure(() => tryRelease(db, c, undefined, undefined, "keep"));
    // El acotamiento por tenant se comprueba ANTES que el rol: un intruso no
    // recibe la pista de que además le faltaría ser admin.
    expect(msg).toMatch(/cliente ajeno/);
  });

  it("CROSS-CLIENT: RLS no muestra el caso de otro cliente", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);

    const otherClientId = await createErpClient(db);
    const outsider = await createActor(db, "cliente", otherClientId);

    // Se evalúa la expresión de la policy con el actor ajeno y con el propio.
    await actAs(db, outsider);
    const { rows: no } = await db.query<{ visible: boolean }>(
      `select (coalesce(public.current_role() in ('admin','operaciones','supervisor'), false)
               or c.client_id = public.current_client_id()) as visible
         from public.custody_integrity_cases c where c.id = $1`,
      [c.caseId],
    );
    expect(no[0].visible).toBe(false);

    const owner = await createActor(db, "cliente", s.clientId);
    await actAs(db, owner);
    const { rows: yes } = await db.query<{ visible: boolean }>(
      `select (coalesce(public.current_role() in ('admin','operaciones','supervisor'), false)
               or c.client_id = public.current_client_id()) as visible
         from public.custody_integrity_cases c where c.id = $1`,
      [c.caseId],
    );
    expect(yes[0].visible).toBe(true);
  });

  it("TENANT: una entidad sin client_id resuelto no genera caso (fail-closed)", async () => {
    const s = await baseScenario(db);
    // 0219 dejó `logistics_orders.client_id` anulable, «SIN BACKFILL».
    const orphanOrder = await createOrder(db, null);
    const orphanPu = await createPackingUnit(db, orphanOrder);

    await actAs(db, s.staff);
    const msg = await expectFailure(() =>
      db.query(
        `select public.upsert_custody_integrity_assessment(
           'packing_unit', $1, null, null, null, 'PENDING_EVIDENCE', '{}'::text[])`,
        [orphanPu],
      ),
    );
    expect(msg).toMatch(/sin client_id resuelto/);
  });

  it("CAS: dos decisiones concurrentes sobre el mismo caso — sólo una gana", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);

    const url = inject("custodyDbUrl");
    const a = new Client({ connectionString: url });
    const b = new Client({ connectionString: url });
    await a.connect();
    await b.connect();

    try {
      for (const conn of [a, b]) {
        await conn.query(`select set_config('request.jwt.claim.sub', $1, false)`, [
          s.decider.userId,
        ]);
        await conn.query(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
        await conn.query(`select set_config('request.jwt.claims', $1, false)`, [
          JSON.stringify({
            sub: s.decider.userId,
            role: "authenticated",
            session_id: s.decider.sessionId,
          }),
        ]);
      }

      const call = (conn: Client) =>
        conn.query(
          `select public.decide_custody_integrity(
             $1, $2, 'release', 'Decisión concurrente bajo prueba', null, $3::uuid[])`,
          [c.caseId, c.version, [c.inspectionEvidenceId]],
        );

      const results = await Promise.allSettled([call(a), call(b)]);
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      expect(ok).toBe(1);
      expect(failed).toBe(1);

      // Y en la base quedó UNA sola decisión.
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from public.custody_integrity_decisions where case_id = $1`,
        [c.caseId],
      );
      expect(rows[0].n).toBe("1");
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("CAS: una versión esperada desactualizada o inválida se rechaza", async () => {
    const s = await baseScenario(db);
    const c = await buildReleasableCase(db, s);

    for (const bad of [0, -1]) {
      const msg = await expectFailure(() => tryRelease(db, c, [c.inspectionEvidenceId], bad));
      expect(msg).toMatch(/versión esperada inválida/);
    }
    const stale = await expectFailure(() =>
      tryRelease(db, c, [c.inspectionEvidenceId], c.version + 7),
    );
    expect(stale).toMatch(/conflicto de versión/);
  });
});
