/**
 * T-C7-05 · HN-1 · LA CREADORA HEREDADA DEJA DE SER ALCANZABLE.
 *
 * ─── QUÉ SE ESTÁ MIDIENDO, Y POR QUÉ ASÍ ─────────────────────────────────
 *
 * `0257` revoca `EXECUTE` a `authenticated` sobre
 * `upsert_custody_integrity_assessment`. R-19 dice que una revocación entra
 * con una prueba que la EJERCITA, y que en una revocación el lado que prueba
 * es el POSITIVO: que el rol YA NO PUEDE, y que lo que debía seguir
 * funcionando sigue funcionando idéntico.
 *
 * Un test que sólo leyera `pg_proc.proacl` mediría el catálogo, no el
 * privilegio. Acá se LLAMA la función con `set role authenticated`, que es
 * exactamente el rol de base de datos con el que PostgREST atiende a una
 * sesión de navegador, y se exige `permission denied`. Si alguien reconcede
 * el grant —o si `0257` deja de cargarse— esta prueba cae en rojo.
 *
 * El resto del archivo es la otra mitad de R-19: la superficie que NO se tocó
 * se afirma explícitamente, para que una ampliación de alcance por descuido
 * tampoco pase en silencio.
 *
 * Datos SINTÉTICOS. Sin red, sin fotos reales, sin proveedor.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { inject } from "vitest";
import { baseScenario, expectFailure, type Scenario } from "./harness/fixtures";
import { buildReleasableCase } from "./harness/scenario";

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

/** Firma completa: es lo que identifica la función en el catálogo de ACL. */
const CREADORA = "public.upsert_custody_integrity_assessment(text,uuid,int,uuid,uuid,text,text[])";
const DECIDE_V1 = "public.decide_custody_integrity(uuid,int,text,text,text,uuid[])";
const DECIDE_V2 = "public.decide_custody_integrity_v2(uuid,int,text,text,text,uuid[])";
const CANDIDATES_V1 = "public.custody_inspection_candidates(uuid)";

async function asRole<T>(role: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.query(`reset role`);
  }
}

async function puedeEjecutar(role: string, firma: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `select has_function_privilege($1, $2, 'EXECUTE') as ok`,
    [role, firma],
  );
  return rows[0].ok;
}

// ---------------------------------------------------------------------------
// EL LADO POSITIVO DE LA REVOCACIÓN: authenticated YA NO PUEDE
// ---------------------------------------------------------------------------

describe("T-C7-05 · HN-1 · `authenticated` ya no alcanza la creadora heredada", () => {
  it("la llamada REAL con `set role authenticated` es denegada por privilegio", async () => {
    // Este es el test que decide si el bloque entra. No lee el catálogo:
    // ejecuta la RPC con el rol con el que PostgREST atiende al navegador.
    const msg = await expectFailure(() =>
      asRole("authenticated", () =>
        db.query(
          `select public.upsert_custody_integrity_assessment(
             'packing_unit', $1, null, null, null, 'PENDING_EVIDENCE', '{}'::text[])`,
          [s.packingUnitId],
        ),
      ),
    );
    expect(msg).toMatch(/permission denied|permiso denegado/i);
    // Y el motivo es el privilegio, no un rechazo del cuerpo: la función es
    // SECURITY DEFINER y el chequeo de EXECUTE ocurre ANTES de entrar. Si
    // fallara por `scope inválido` o por `assert_custody_access`, el grant
    // seguiría vivo y esta prueba estaría midiendo otra cosa.
    expect(msg).toMatch(/upsert_custody_integrity_assessment/i);
  });

  it("`anon` tampoco, igual que antes: nada se ensanchó", async () => {
    const msg = await expectFailure(() =>
      asRole("anon", () =>
        db.query(
          `select public.upsert_custody_integrity_assessment(
             'packing_unit', $1, null, null, null, 'PENDING_EVIDENCE', '{}'::text[])`,
          [s.packingUnitId],
        ),
      ),
    );
    expect(msg).toMatch(/permission denied|permiso denegado/i);
  });

  it("el catálogo lo confirma: `authenticated` sin EXECUTE", async () => {
    expect(await puedeEjecutar("authenticated", CREADORA)).toBe(false);
    expect(await puedeEjecutar("anon", CREADORA)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LO QUE 0257 NO TOCÓ, Y SE AFIRMA PARA QUE NO SE TOQUE DE PASO
// ---------------------------------------------------------------------------

describe("T-C7-05 · HN-1 · el alcance es exactamente `authenticated`", () => {
  it("`service_role` CONSERVA EXECUTE sobre la creadora", async () => {
    // Deliberado: es el rol interno de servidor, no una sesión de navegador.
    // El master acota la revocación a `authenticated`; ampliarla de paso
    // habría sido decidir por cuenta propia.
    expect(await puedeEjecutar("service_role", CREADORA)).toBe(true);
  });

  it("la función SIGUE EXISTIENDO: no se eliminó, se le retiró el camino", async () => {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'upsert_custody_integrity_assessment'`,
    );
    expect(rows[0].n).toBe("1");
  });

  it("y sigue funcionando idéntica bajo el dueño del esquema", async () => {
    // Es el ingreso que sostiene la cobertura D1–D3 de 0221–0224. Si 0257
    // hubiera alterado el cuerpo o la firma, esto se cae acá y no dentro de
    // una batería ajena.
    const c = await buildReleasableCase(db, s);
    expect(c.caseId).toBeTruthy();
    const { rows } = await db.query<{ packing_unit_id: string | null; state: string }>(
      `select packing_unit_id, state from public.custody_integrity_cases where id = $1`,
      [c.caseId],
    );
    expect(rows[0].packing_unit_id).toBe(s.packingUnitId);
  });
});

// ---------------------------------------------------------------------------
// EL CIRCUITO FÍSICO SIGUE IDÉNTICO
// ---------------------------------------------------------------------------

describe("T-C7-05 · HN-1 · el circuito físico no se movió", () => {
  it("`authenticated` conserva EXECUTE sobre la decisión v2", async () => {
    expect(await puedeEjecutar("authenticated", DECIDE_V2)).toBe(true);
  });

  it("`authenticated` conserva EXECUTE sobre `custody_inspection_candidates`", async () => {
    // La superficie v1 que `0224:313` mantiene concedida y que NO está rota.
    // El master la marcó explícitamente como intocable: se afirma para que
    // una revocación futura «por simetría» tenga que romper este test.
    expect(await puedeEjecutar("authenticated", CANDIDATES_V1)).toBe(true);
  });

  it("`decide_custody_integrity` (v1) sigue revocada, y 0257 no la reconcedió", async () => {
    expect(await puedeEjecutar("authenticated", DECIDE_V1)).toBe(false);
    expect(await puedeEjecutar("anon", DECIDE_V1)).toBe(false);
  });
});
