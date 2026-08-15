/**
 * T-A0-10 · Integridad del manifiesto (§11).
 *
 * Valida programáticamente cantidad, duplicados, existencia, orden y —lo más
 * importante— que TODA migración del repositorio esté clasificada: en el
 * manifiesto o en una exclusión documentada. Una migración nueva rompe la
 * validación hasta que alguien decida conscientemente dónde va.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  EXPECTED_MANIFEST_SIZE,
  MANIFEST_EXCLUSIONS,
  MIGRATIONS_DIR,
  ManifestIntegrityError,
  WMS_MIGRATION_MANIFEST,
  migrationSeq,
  validateCanonicalManifest,
  validateManifest,
} from "./harness/manifest";

interface SqlFunctionBlock {
  file: string;
  name: string;
  header: string;
  body: string;
}

const stripSqlComments = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

const stripReadLocks = (sql: string): string => stripSqlComments(sql).replace(
  /\bfor\s+(?:no\s+key\s+)?update(?:\s+of\s+[a-z0-9_.,\s]+)?(?=\s*(?:;|$))/gi,
  " ",
);

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Extrae funciones reales respetando su delimitador dollar-quote. No usa una
 * lista de nombres: una RPC futura dentro de la exclusión declarada de PR66
 * entra automáticamente en el análisis.
 */
function extractSqlFunctions(file: string, sql: string): SqlFunctionBlock[] {
  const blocks: SqlFunctionBlock[] = [];
  const start = /^\s*create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_."]+)\s*\(/gim;
  for (let match = start.exec(sql); match; match = start.exec(sql)) {
    const tail = sql.slice(start.lastIndex);
    const bodyStart = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);
    if (!bodyStart) throw new Error(`SQL_FUNCTION_BODY_NOT_FOUND:${file}:${match[1]}`);
    const delimiter = bodyStart[1];
    const headerEnd = start.lastIndex + bodyStart.index;
    const contentStart = start.lastIndex + bodyStart.index + bodyStart[0].length;
    const contentEnd = sql.indexOf(delimiter, contentStart);
    if (contentEnd < 0) throw new Error(`SQL_FUNCTION_DELIMITER_NOT_CLOSED:${file}:${match[1]}`);
    blocks.push({
      file,
      name: match[1].replaceAll('"', "").toLowerCase(),
      header: sql.slice(match.index, headerEnd),
      body: sql.slice(contentStart, contentEnd),
    });
    start.lastIndex = contentEnd + delimiter.length;
  }
  return blocks;
}

function phaseAForwardSql(): Array<{ file: string; sql: string }> {
  const scope = MANIFEST_EXCLUSIONS.find(
    (entry) => entry.id === "pr66-phase-a-clients-purchase-service-orders",
  );
  if (!scope) throw new Error("PR66_PHASE_A_SCOPE_NOT_DECLARED");
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql") && !file.startsWith("ROLLBACK_") && scope.matches(file))
    .sort()
    .map((file) => ({ file, sql: readFileSync(resolve(MIGRATIONS_DIR, file), "utf8") }));
}

const permissionAuthorizationIsClosed = (body: string): boolean => {
  const clean = stripSqlComments(body);
  const calls = clean.match(/public\.has_permission\s*\([^)]*\)/gi) ?? [];
  const closed = clean.match(
    /public\.has_permission\s*\([^)]*\)\s+is\s+distinct\s+from\s+true/gi,
  ) ?? [];
  return calls.length > 0 && calls.length === closed.length;
};

const dmlTargets = (body: string): string[] =>
  [...stripReadLocks(body).matchAll(
    /\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?)\s+([a-z_][a-z0-9_$]*(?:\.[a-z_][a-z0-9_$]*)?)/gi,
  )].map((match) => match[1]);

describe("T-A0-10 · manifiesto", () => {
  it("el manifiesto vigente es íntegro (estructura y cobertura)", () => {
    expect(() => validateManifest()).not.toThrow();
    expect(() => validateCanonicalManifest()).not.toThrow();
  });

  it("tiene exactamente la cantidad esperada", () => {
    expect(WMS_MIGRATION_MANIFEST).toHaveLength(EXPECTED_MANIFEST_SIZE);
    // 29 de A0 + 0219/0220 de P3-N1B (decisión consciente, visible en el diff).
    // 0240/0241 NO entran: T-C1-05 del harness de Custodia exige que este
    // manifiesto permanezca invariante, y esas dos migraciones no pertenecen
    // al cierre WMS. Van a una exclusión documentada y se verifican en su
    // propio cierre acotado.
    expect(EXPECTED_MANIFEST_SIZE).toBe(31);
  });

  it("no tiene duplicados", () => {
    expect(new Set(WMS_MIGRATION_MANIFEST).size).toBe(WMS_MIGRATION_MANIFEST.length);
  });

  it("está en orden estrictamente creciente", () => {
    const seqs = WMS_MIGRATION_MANIFEST.map(migrationSeq);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
  });

  it("el orden semántico coincide con el lexicográfico", () => {
    expect([...WMS_MIGRATION_MANIFEST].sort()).toEqual([...WMS_MIGRATION_MANIFEST]);
  });

  it("toda migración del repositorio está clasificada", () => {
    const onDisk = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    const inManifest = new Set(WMS_MIGRATION_MANIFEST);
    const unclassified = onDisk.filter(
      (f) => !inManifest.has(f) && !MANIFEST_EXCLUSIONS.some((e) => e.matches(f)),
    );
    expect(unclassified).toEqual([]);
  });

  // ── H-05: una migración FUTURA no puede clasificarse sola ──────────────

  it("MUTANTE PERMANENTE: una migración WMS futura queda SIN CLASIFICAR", () => {
    // La exclusión anterior era `migrationSeq(f) >= 36`, que habría absorbido
    // en silencio a `9999_wms_required.sql`. Con exclusiones por filename
    // exacto, una migración nueva NO está en el snapshot congelado y por tanto
    // no queda clasificada: rompe la suite hasta una decisión consciente.
    const futura = "9999_wms_required.sql";
    expect(WMS_MIGRATION_MANIFEST).not.toContain(futura);
    expect(MANIFEST_EXCLUSIONS.some((e) => e.matches(futura))).toBe(false);
  });

  it.each([
    "0036_custody_core.sql",
    "0126_knowledge_core.sql",
    "0194_treasury_beneficiaries.sql",
    "0016_tracking_foundation.sql",
  ])("la migración existente %s SÍ está clasificada por filename exacto", (f) => {
    expect(MANIFEST_EXCLUSIONS.some((e) => e.matches(f))).toBe(true);
  });

  it("las exclusiones NO usan un rango numérico abierto", () => {
    // Cualquier número por encima del máximo conocido debe quedar fuera.
    for (const f of ["0500_futura.sql", "9999_wms_required.sql", "0999_lo_que_sea.sql"]) {
      expect(MANIFEST_EXCLUSIONS.some((e) => e.matches(f))).toBe(false);
    }
  });

  it("clasifica la migración con sufijo de letra (0061a)", () => {
    // El repositorio tiene `0061a_rrhh_modalidad_real.sql`. La validación la
    // detectó como no clasificada al construirse; el parser ahora la reconoce.
    expect(migrationSeq("0061a_rrhh_modalidad_real.sql")).toBe(61);
    expect(
      MANIFEST_EXCLUSIONS.some((e) => e.matches("0061a_rrhh_modalidad_real.sql")),
    ).toBe(true);
  });

  it("un manifiesto PARCIAL pasa la validación estructural pero no la de cobertura", () => {
    // Distinción necesaria: T-A0-05 usa manifiestos parciales a propósito, y
    // confundir ambas reglas enmascararía el fallo que esa prueba busca.
    const parcial = WMS_MIGRATION_MANIFEST.slice(0, 5);
    expect(() => validateManifest(parcial)).not.toThrow();
  });

  it("rechaza un manifiesto con archivos inexistentes", () => {
    expect(() => validateManifest(["0001_init.sql", "9999_no_existe.sql"])).toThrow(
      ManifestIntegrityError,
    );
    expect(() => validateManifest(["0001_init.sql", "9999_no_existe.sql"])).toThrow(
      /archivos inexistentes/,
    );
  });

  it("rechaza duplicados", () => {
    expect(() => validateManifest(["0001_init.sql", "0001_init.sql"])).toThrow(/duplicadas/);
  });

  it("rechaza orden no creciente", () => {
    expect(() => validateManifest(["0009_rbac.sql", "0001_init.sql"])).toThrow(
      /no estrictamente creciente/,
    );
  });

  it("rechaza entradas sin prefijo numérico", () => {
    expect(() => validateManifest(["README.sql"])).toThrow(/prefijo numérico/);
  });

  it("toda exclusión tiene justificación sustantiva", () => {
    for (const e of MANIFEST_EXCLUSIONS) {
      expect(e.reason.trim().length).toBeGreaterThanOrEqual(20);
    }
  });

  it("la exclusión de 0036 documenta HONESTAMENTE que toca objetos del WMS", () => {
    const rule = MANIFEST_EXCLUSIONS.find((e) => e.matches("0036_custody_core.sql"));
    expect(rule).toBeDefined();
    // No basta con decir "es posterior": 0036 modifica packing_units y shipments.
    expect(rule!.reason).toMatch(/packing_units/);
    expect(rule!.reason).toMatch(/shipments/);
    expect(rule!.reason).toMatch(/PostGIS/i);
    // Y debe advertir contra la afirmación falsa opuesta.
    expect(rule!.reason).toMatch(/NO debe afirmarse/);
  });

  it("las exclusiones de tracking citan PostGIS y el dominio ajeno", () => {
    const r16 = MANIFEST_EXCLUSIONS.find((e) => e.matches("0016_tracking_foundation.sql"));
    expect(r16!.reason).toMatch(/postgis/i);
    const r18 = MANIFEST_EXCLUSIONS.find((e) => e.matches("0018_tracking_events.sql"));
    expect(r18!.reason).toMatch(/Tracking/);
  });

  it("migrationSeq extrae el número de secuencia", () => {
    expect(migrationSeq("0025_wms_receptions.sql")).toBe(25);
    expect(migrationSeq("0001_init.sql")).toBe(1);
    expect(Number.isNaN(migrationSeq("sin-prefijo.sql"))).toBe(true);
  });
});

describe("T-A0-10 · SECURITY DEFINER FASE A fail-closed", () => {
  it("descubre todas las funciones del alcance y cierra autorización, identidad y ACL", () => {
    const sources = phaseAForwardSql();
    const functions = sources.flatMap(({ file, sql }) => extractSqlFunctions(file, sql));
    const definers = functions.filter((fn) => /\bsecurity\s+definer\b/i.test(fn.header));

    expect(sources.length).toBeGreaterThan(0);
    expect(definers.length).toBeGreaterThan(0);

    for (const fn of definers) {
      const source = sources.find((candidate) => candidate.file === fn.file)!.sql;
      const clean = stripSqlComments(fn.body);
      const mutationBody = stripReadLocks(fn.body);
      const targets = dmlTargets(mutationBody);
      const mutates = targets.length > 0;
      const trigger = /\breturns\s+trigger\b/i.test(fn.header);
      const permissionCalls = clean.match(/public\.has_permission\s*\([^)]*\)/gi) ?? [];
      const serviceOnly = /auth\.role\s*\(\s*\)\s+is\s+distinct\s+from\s+'service_role'/i.test(clean);
      const label = `${fn.file}:${fn.name}`;

      expect(fn.header, `${label}: search_path fijo`).toMatch(/\bset\s+search_path\s*=/i);

      const escapedName = escapeRegex(fn.name);
      const revoke = new RegExp(
        `revoke\\s+(?:all|execute)\\s+on\\s+function\\s+${escapedName}\\s*\\([^;]*\\)\\s+from\\s+([^;]+);`,
        "i",
      ).exec(source);
      expect(revoke, `${label}: REVOKE explícito`).not.toBeNull();
      const revoked = new Set(
        revoke![1].toLowerCase().split(",").map((role) => role.trim()).filter(Boolean),
      );
      for (const role of ["public", "anon", "authenticated", "service_role"]) {
        expect(revoked.has(role), `${label}: revoca ${role}`).toBe(true);
      }

      const grantPattern = new RegExp(
        `grant\\s+execute\\s+on\\s+function\\s+${escapedName}\\s*\\([^;]*\\)\\s+to\\s+([^;]+);`,
        "gi",
      );
      const granted = new Set<string>();
      for (const grant of source.matchAll(grantPattern)) {
        for (const role of grant[1].toLowerCase().split(",").map((value) => value.trim())) {
          if (role) granted.add(role);
        }
      }
      const expectedGrants = trigger ? [] : permissionCalls.length > 0
        ? ["authenticated"]
        : serviceOnly ? ["service_role"] : [];
      expect([...granted].sort(), `${label}: grants mínimos`).toEqual(expectedGrants.sort());

      if (!mutates) continue;
      expect(targets.every((target) => target.includes(".")), `${label}: DML calificado`).toBe(true);

      if (trigger) continue;
      const firstDml = mutationBody.search(
        /\b(?:insert\s+into|update|delete\s+from|truncate(?:\s+table)?)\s+[a-z_]/i,
      );
      const beforeEffect = mutationBody.slice(0, firstDml);

      if (permissionCalls.length > 0) {
        expect(permissionAuthorizationIsClosed(clean), `${label}: permiso no nullable`).toBe(true);
        expect(beforeEffect, `${label}: actor de servidor`).toMatch(
          /v_actor\s+uuid\s*:=\s*auth\.uid\s*\(\s*\)/i,
        );
        expect(beforeEffect, `${label}: auth.uid NULL rechazado`).toMatch(/v_actor\s+is\s+null/i);
        expect(beforeEffect, `${label}: perfil activo requerido`).toMatch(
          /public\.profiles[\s\S]*\.active/i,
        );
        expect(beforeEffect, `${label}: denegación antes del efecto`).toMatch(/raise\s+exception/i);
        expect(beforeEffect.match(/public\.has_permission\s*\([^)]*\)/gi) ?? [],
          `${label}: toda autorización precede al efecto`).toHaveLength(permissionCalls.length);
        expect(fn.header, `${label}: actor no parametrizable`).not.toMatch(
          /\bp_(?:actor|authorized_by|created_by|updated_by|user_id|uid)\b/i,
        );
      } else {
        expect(serviceOnly, `${label}: mutador técnico sin frontera service_role`).toBe(true);
        expect(beforeEffect, `${label}: service_role se valida antes del efecto`).toMatch(
          /auth\.role\s*\(\s*\)\s+is\s+distinct\s+from\s+'service_role'/i,
        );
      }
    }
  });

  it("MUTANTES PERMANENTES: rechaza variantes booleanas UNKNOWN y acepta IS DISTINCT FROM TRUE", () => {
    const unsafe = [
      "if not public.has_permission('x') then raise exception 'no'; end if;",
      "if public.has_permission('x') = false then raise exception 'no'; end if;",
      "if public.has_permission('x') <> true then raise exception 'no'; end if;",
      "if public.has_permission('x') then insert into public.t values (1); else raise exception 'no'; end if;",
    ];
    for (const body of unsafe) expect(permissionAuthorizationIsClosed(body)).toBe(false);
    expect(permissionAuthorizationIsClosed(
      "if public.has_permission('x') is distinct from true then raise exception 'no'; end if;",
    )).toBe(true);
  });
});
