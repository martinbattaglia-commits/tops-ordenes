/**
 * T-A0-14 · Paridad de las guardas de los scripts .mjs (MEDIUM de la 2ª C4).
 *
 * `assert-no-residual-databases.mjs` no puede importar los módulos TypeScript
 * sin un build, así que usa una réplica en `scripts/guard.mjs`. La revisión
 * encontró que la versión anterior aplicaba una guarda REDUCIDA y divergente.
 *
 * Este test ejecuta los MISMOS vectores contra ambas implementaciones —la de
 * producción (`guard.ts`) y la de los scripts (`guard.mjs`)— y exige veredictos
 * idénticos. Si alguien afloja una y no la otra, esto lo delata.
 */

import { describe, expect, it } from "vitest";
import * as mjs from "./scripts/guard.mjs";
import {
  assertLocalMaintenanceUrl as tsMaint,
  assertLocalTestUrl as tsUrl,
  assertNoProductionEnv as tsEnv,
  TEST_DB_PREFIX,
} from "./harness/guard";
import { parseAndCheckServerVersion as tsVer } from "./harness/version-gate";

const OK = `postgresql://postgres@127.0.0.1:55432/${TEST_DB_PREFIX}abc`;

/** ¿Lanza? Devuelve true/false para poder comparar veredictos. */
function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const URL_VECTORS: string[] = [
  OK, // válida
  `${OK}?host=example.invalid`, // query override
  `${OK}?sslmode=require`,
  "postgresql://postgres@localhost:5432/p3n1a0_test_x",
  "postgresql://postgres@[::1]:5432/p3n1a0_test_x",
  "postgresql://u@db.example.com:5432/p3n1a0_test_x",
  "postgresql://postgres@127.0.0.1:5432/postgres", // sin prefijo
  "postgresql://%61rsksytgdnzukbmfgkju@127.0.0.1:5432/p3n1a0_test_x", // ref encoded
  "postgresql://u:x%2Esupabase%2Eco@127.0.0.1:5432/p3n1a0_test_x",
  "https://127.0.0.1:5432/p3n1a0_test_x", // protocolo
  "no-es-url",
  "",
];

const MAINT_VECTORS: string[] = [
  "postgresql://u@127.0.0.1:5432/postgres", // válida
  "postgresql://u@127.0.0.1:5432/otra", // base incorrecta
  "postgresql://u@localhost:5432/postgres", // host
  "postgresql://u@127.0.0.1:5432/postgres?host=x", // query
];

const ENV_VECTORS: Array<Record<string, string>> = [
  {},
  { PGHOST: "example.invalid" },
  { PGPORT: "5432" },
  { SUPABASE_SERVICE_ROLE_KEY: "x" },
  { PGSERVICE: "prod" },
  { PGHOST: "   " }, // vacía → no dispara
];

const VER_VECTORS: unknown[] = ["170000", "179999", "160009", "180000", "17.10", "", null, undefined];

describe("T-A0-14 · paridad guard.mjs ↔ guard.ts", () => {
  it.each(URL_VECTORS)("assertLocalTestUrl coincide para %s", (v) => {
    expect(throws(() => mjs.assertLocalTestUrl(v))).toBe(throws(() => tsUrl(v)));
  });

  it.each(MAINT_VECTORS)("assertLocalMaintenanceUrl coincide para %s", (v) => {
    expect(throws(() => mjs.assertLocalMaintenanceUrl(v))).toBe(throws(() => tsMaint(v)));
  });

  it.each(ENV_VECTORS)("assertNoProductionEnv coincide para %o", (env) => {
    expect(throws(() => mjs.assertNoProductionEnv(env))).toBe(throws(() => tsEnv(env)));
  });

  it.each(VER_VECTORS)("parseAndCheckServerVersion coincide para %s", (v) => {
    const mjsThrows = throws(() => mjs.parseAndCheckServerVersion(v));
    const tsThrows = throws(() => tsVer(v));
    expect(mjsThrows).toBe(tsThrows);
    if (!mjsThrows) {
      expect(mjs.parseAndCheckServerVersion(v)).toBe(tsVer(v));
    }
  });

  it("la lista de variables prohibidas de guard.mjs cubre las de destino libpq", () => {
    for (const k of ["PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGSERVICE", "PGOPTIONS"]) {
      expect(mjs.FORBIDDEN_ENV_VARS).toContain(k);
    }
  });

  it("ambas guardas comparten el mismo host y prefijo", () => {
    expect(mjs.ONLY_ALLOWED_HOST).toBe("127.0.0.1");
    expect(mjs.TEST_DB_PREFIX).toBe(TEST_DB_PREFIX);
  });
});
