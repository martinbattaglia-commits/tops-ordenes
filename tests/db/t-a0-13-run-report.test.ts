/**
 * T-A0-13 · La corrida sólo se acepta si está LIMPIA (M-02).
 *
 * Vitest devuelve exit 0 con casos `skip`/`todo`. Sin esta verificación un test
 * silenciado dejaría CI en verde mientras el sentinela emite `_FAIL`. El
 * mutante "test skipped" sobrevivía exactamente por eso.
 *
 * La decisión es una función pura; el script de CI sólo traduce su veredicto a
 * exit code. El resultado global lo siguen fijando exit codes, nunca un grep.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
// @ts-expect-error — módulo .mjs sin tipos, deliberado
import { EXPECTED_TEST_FILES, EXPECTED_TOTAL_TESTS } from "./scripts/expected-suite.mjs";
import {
  NON_PASSING_STATUSES,
  evaluateRunReport,
  isRunClean,
  type RunReport,
} from "./harness/run-report";

const REPO_ROOT = resolve(__dirname, "..", "..");

function report(statuses: string[]): RunReport {
  return {
    testResults: [
      {
        name: "archivo.test.ts",
        assertionResults: statuses.map((status, i) => ({ status, title: `caso ${i}` })),
      },
    ],
  };
}

describe("T-A0-13 · reporte de corrida", () => {
  it("acepta una corrida con todos los casos aprobados", () => {
    const v = evaluateRunReport(report(["passed", "passed", "passed"]));
    expect(v.ok).toBe(true);
    expect(v.total).toBe(3);
    expect(v.passed).toBe(3);
    expect(v.problems).toEqual([]);
  });

  it.each(NON_PASSING_STATUSES)("rechaza una corrida con un caso '%s'", (status) => {
    const v = evaluateRunReport(report(["passed", status]));
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toContain(status);
  });

  it("rechaza un estado desconocido", () => {
    expect(isRunClean(report(["passed", "loquesea"]))).toBe(false);
  });

  it("rechaza una corrida sin casos", () => {
    const v = evaluateRunReport(report([]));
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/no ejecutó ningún caso/);
  });

  it("rechaza un reporte ausente o ilegible", () => {
    expect(isRunClean(null)).toBe(false);
    expect(isRunClean(undefined)).toBe(false);
    expect(isRunClean("no es un reporte" as unknown as RunReport)).toBe(false);
  });

  it("usa los contadores agregados si faltan los detalles", () => {
    expect(evaluateRunReport({ numPendingTests: 2, testResults: [] }).ok).toBe(false);
    expect(evaluateRunReport({ numTodoTests: 1, testResults: [] }).ok).toBe(false);
    expect(evaluateRunReport({ numFailedTests: 1, testResults: [] }).ok).toBe(false);
  });

  it("el script de CI replica la misma lista de estados no aprobados", () => {
    // El script es `.mjs` y no puede importar el módulo TypeScript sin build;
    // esta aserción impide que ambas listas se separen en silencio.
    const src = readFileSync(
      join(REPO_ROOT, "tests", "db", "scripts", "assert-clean-run.mjs"),
      "utf8",
    );
    for (const s of NON_PASSING_STATUSES) {
      expect(src, `el script debe contemplar "${s}"`).toContain(`"${s}"`);
    }
    expect(src).toContain("process.exit(1)");
  });

  it("`test:db` prepara, corre Vitest y verifica, en ese orden", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    const cmd = String(pkg.scripts["test:db"]);
    // prepare-run BORRA el reporte previo; `&&` preserva el exit code de Vitest.
    expect(cmd).toMatch(
      /^node tests\/db\/scripts\/prepare-run\.mjs && vitest run --config vitest\.db\.config\.ts && node tests\/db\/scripts\/assert-clean-run\.mjs && node tests\/db\/scripts\/assert-no-residual-local\.mjs$/,
    );
  });

  // ── H-04: universo exacto y frescura del reporte ──────────────────────

  it("EXPECTED_TEST_FILES coincide con los archivos reales de tests/db", () => {
    const real = readdirSync(join(REPO_ROOT, "tests", "db"))
      .filter((f) => f.endsWith(".test.ts"))
      .sort();
    expect([...EXPECTED_TEST_FILES].sort()).toEqual(real);
  });

  it("el total esperado está fijado y es coherente", () => {
    // Un 0 desactivaría la comprobación de total: debe ser un número real.
    expect(EXPECTED_TOTAL_TESTS).toBeGreaterThan(0);
    expect(EXPECTED_TOTAL_TESTS).toBe(259);
  });

  it("assert-clean-run exige universo exacto, frescura y total", () => {
    const src = readFileSync(
      join(REPO_ROOT, "tests", "db", "scripts", "assert-clean-run.mjs"),
      "utf8",
    );
    // universo
    expect(src).toContain("EXPECTED_TEST_FILES");
    expect(src).toContain("faltaron");
    expect(src).toContain("sobraron");
    // frescura
    expect(src).toContain("STAMP_PATH");
    expect(src).toContain("mtimeMs");
    expect(src).toContain("obsoleto");
    // total
    expect(src).toContain("EXPECTED_TOTAL_TESTS");
  });

  it("prepare-run BORRA el reporte previo y sella un nonce", () => {
    const src = readFileSync(
      join(REPO_ROOT, "tests", "db", "scripts", "prepare-run.mjs"),
      "utf8",
    );
    expect(src).toContain("rmSync(REPORT_PATH");
    expect(src).toContain("randomBytes");
    expect(src).toContain("t0");
  });
});
