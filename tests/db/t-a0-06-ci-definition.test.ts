/**
 * T-A0-06 · La definición de CI respeta el alcance del expediente.
 *
 * Vive acá y no como paso del propio workflow: un paso que hiciera `grep` de su
 * archivo se auto-marcaría, porque el patrón tendría que contener los mismos
 * literales que prohíbe. Al vivir en un `.ts`, los literales están fuera del
 * YAML y la verificación es honesta.
 *
 * Corre con `npm run test:db`, tanto en local como dentro del propio CI.
 */

import { describe, expect, it } from "vitest";
import { emitSentinelWhenGreen } from "./harness/sentinel";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const WORKFLOW = join(REPO_ROOT, ".github", "workflows", "p3-n1a0-db-harness.yml");

/** Directivas del YAML, sin líneas de comentario. */
function directives(): string {
  return readFileSync(WORKFLOW, "utf8")
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

describe("T-A0-06 · definición de CI", () => {
  emitSentinelWhenGreen("P3_N1A0_CI_DEFINITION_PASS");

  it("el workflow existe", () => {
    expect(() => readFileSync(WORKFLOW, "utf8")).not.toThrow();
  });

  it("no consume credenciales del repositorio", () => {
    expect(directives()).not.toMatch(/\$\{\{[^}]*secrets\./);
  });

  it("no despliega ni toca infraestructura remota", () => {
    const d = directives();
    for (const forbidden of [/netlify/i, /supabase\s+(link|db)/i, /\bdeploy\b/i]) {
      expect(d).not.toMatch(forbidden);
    }
  });

  it("no se dispara por cron", () => {
    expect(directives()).not.toMatch(/^\s*schedule:/m);
  });

  it("no ejecuta migraciones remotas", () => {
    const d = directives();
    expect(d).not.toMatch(/db\s+push/i);
    expect(d).not.toMatch(/apply_migration/i);
  });

  it("usa PostgreSQL 17 y apunta el harness a loopback con base de test", () => {
    const d = directives();
    expect(d).toMatch(/image:\s*postgres:17/);
    expect(d).toMatch(/P3N1A0_TEST_PG_URL:\s*postgresql:\/\/[^@\s]*@127\.0\.0\.1:/);
  });

  it("instala desde lockfile y ejecuta la suite", () => {
    const d = directives();
    expect(d).toMatch(/npm ci/);
    expect(d).toMatch(/npm run test:db/);
  });
});
