/**
 * T-C0-01 · El harness dedicado arranca: PostGIS REAL, manifiesto completo y
 * cierre de custodia aplicado. Es la barrera: si esto falla, ninguna afirmación
 * posterior sobre custodia significa nada.
 */
import { describe, expect, inject, it, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import {
  CUSTODY_CLOSURE_SIZE,
  CUSTODY_MIGRATION_MANIFEST,
  EXPECTED_CUSTODY_MANIFEST_SIZE,
  validateCustodyManifest,
} from "./harness/manifest";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: inject("custodyDbUrl") });
  await db.connect();
});

afterAll(async () => {
  await db.end();
});

describe("T-C0-01 · arranque del harness de custodia", () => {
  it("el manifiesto es válido y tiene el tamaño declarado", () => {
    expect(() => validateCustodyManifest()).not.toThrow();
    expect(CUSTODY_MIGRATION_MANIFEST.length).toBe(EXPECTED_CUSTODY_MANIFEST_SIZE);
  });

  it("el cierre de custodia son 36 archivos + 14 migraciones gobernadas", () => {
    const custodyForwards = CUSTODY_MIGRATION_MANIFEST.filter((m) =>
      /^(?:02(?:2[1-6]|3[12])|0250a?|025[1234])_/.test(m),
    );
    expect(custodyForwards).toEqual([
      "0221_custody_integrity_enums.sql",
      "0222_custody_integrity_foundation.sql",
      "0223_custody_integrity_decision.sql",
      "0224_custody_integrity_authority_hardening.sql",
      "0225_custody_0039_tristate_compat.sql",
      "0226_custody_content_attestation.sql",
      "0231_custody_read_tenant_scope.sql",
      "0232_custody_evaluation_lease_exclusive.sql",
      "0250_custody_physical_scope_enums.sql",
      "0250a_custody_productive_vision.sql",
      "0251_custody_decide_authority.sql",
      "0252_custody_two_levels.sql",
      // 2-B · la puerta de egreso (Adenda §4.2).
      "0253_custody_egress_gate.sql",
      // 2-C-2 · la politica de lectura del certificado.
      "0254_custody_certificate_read.sql",
    ]);
    expect(CUSTODY_MIGRATION_MANIFEST.length - custodyForwards.length).toBe(CUSTODY_CLOSURE_SIZE);
  });

  it("corre sobre PostgreSQL 17", async () => {
    // `show` no admite alias: la columna se llama como el parámetro.
    const { rows } = await db.query<{ v: string }>(
      "select current_setting('server_version_num') as v",
    );
    expect(Number.parseInt(rows[0].v, 10)).toBeGreaterThanOrEqual(170000);
    expect(Number.parseInt(rows[0].v, 10)).toBeLessThan(180000);
  });

  it("PostGIS está INSTALADO y es funcional, no simulado", async () => {
    const { rows } = await db.query<{ extname: string; schema: string }>(
      `select e.extname, n.nspname as schema from pg_extension e
        join pg_namespace n on n.oid = e.extnamespace where e.extname = 'postgis'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].schema).toBe("extensions");

    // Operación espacial real: si PostGIS estuviera stubbeado, esto fallaría.
    const { rows: geo } = await db.query<{ srid: number; wkt: string }>(
      `select extensions.ST_SRID(p) as srid, extensions.ST_AsText(p) as wkt
         from (select extensions.ST_SetSRID(extensions.ST_MakePoint(-58.3816, -34.6037), 4326) as p) s`,
    );
    expect(geo[0].srid).toBe(4326);
    expect(geo[0].wkt).toBe("POINT(-58.3816 -34.6037)");
  });

  it("custody_events tiene la columna geom de PostGIS con índice GiST", async () => {
    // 0036:98 declara `extensions.geometry(Point, 4326)` (patrón Tracking 0016).
    const { rows } = await db.query<{ udt_name: string }>(
      `select udt_name from information_schema.columns
        where table_schema = 'public' and table_name = 'custody_events' and column_name = 'geom'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].udt_name).toBe("geometry");

    // El índice GiST sólo existe si PostGIS aportó la clase de operadores.
    const { rows: idx } = await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
        where schemaname = 'public' and indexname = 'custody_events_geom_gix'`,
    );
    expect(idx).toHaveLength(1);
    expect(idx[0].indexdef).toContain("gist");
  });

  it("D1/0250 · los enums admiten inspección humana y evidencia física", async () => {
    const { rows } = await db.query<{ enumlabel: string }>(
      `select e.enumlabel from pg_type t join pg_enum e on e.enumtypid = t.oid
        where t.typname = 'custody_event_type_t' order by e.enumsortorder`,
    );
    const labels = rows.map((r: { enumlabel: string }) => r.enumlabel);
    expect(labels).toContain("inspeccion_humana");
    expect(labels).toContain("foto_ingreso");
    expect(labels).toContain("foto_egreso");
    // No se retiró ninguno de los originales.
    expect(labels).toEqual(
      expect.arrayContaining(["foto_packing", "cargado", "en_transito", "foto_entrega", "firmado", "pod"]),
    );
  });

  it("0250 · el stage físico de recepción existe", async () => {
    const { rows } = await db.query<{ enumlabel: string }>(
      `select e.enumlabel from pg_type t join pg_enum e on e.enumtypid = t.oid
        where t.typname = 'custody_stage_t' order by e.enumsortorder`,
    );
    expect(rows.map((r) => r.enumlabel)).toContain("recepcion");
  });

  it("D1 · el CHECK admite (despacho, inspeccion_humana) y sigue rechazando pares inválidos", async () => {
    const { rows } = await db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conname = 'custody_events_stage_type_chk'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toContain("inspeccion_humana");
    // El par inspección debe estar atado a 'despacho', no suelto.
    expect(rows[0].def).toMatch(/despacho/);
    // No se abrió la etapa 'packing' a la inspección.
    expect(rows[0].def).toMatch(/packing.*foto_packing/s);
  });

  it("§2 · la RPC declarativa de evaluación YA NO EXISTE", async () => {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'record_custody_integrity_evaluation'`,
    );
    expect(rows[0].n).toBe("0");
  });

  it("0250a · el flujo v2 existe, el legacy queda revocado y EXECUTE se reparte", async () => {
    const { rows } = await db.query<{ proname: string; acl: string | null }>(
      `select p.proname, array_to_string(p.proacl::text[], ' ') as acl
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('begin_custody_integrity_evaluation_v2',
                            'complete_custody_integrity_evaluation_v2',
                            'fail_custody_integrity_evaluation_v2')`,
    );
    expect(rows).toHaveLength(3);

    const begin = rows.find((r) => r.proname === "begin_custody_integrity_evaluation_v2")!;
    expect(begin.acl ?? "").toMatch(/authenticated=X/);

    for (const name of [
      "complete_custody_integrity_evaluation_v2",
      "fail_custody_integrity_evaluation_v2",
    ]) {
      const serverOnly = rows.find((r) => r.proname === name)!;
      expect(serverOnly.acl ?? "").toMatch(/service_role=X/);
      expect(serverOnly.acl ?? "").not.toMatch(/(^|\s)authenticated=X/);
      expect(serverOnly.acl ?? "").not.toMatch(/(^|\s)anon=X/);
      expect(serverOnly.acl ?? "").not.toMatch(/(^|\s)=X/);
    }

    const { rows: legacy } = await db.query<{ proname: string; acl: string | null }>(
      `select p.proname, array_to_string(p.proacl::text[], ' ') as acl
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('begin_custody_integrity_evaluation',
                            'complete_custody_integrity_evaluation')`,
    );
    expect(legacy).toHaveLength(2);
    for (const rpc of legacy) {
      expect(rpc.acl ?? "").not.toMatch(/authenticated=X|service_role=X|anon=X|(^|\s)=X/);
    }
  });
});
