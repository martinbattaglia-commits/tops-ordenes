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
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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

  it("`test:db` encadena la verificación DESPUÉS de Vitest", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    const cmd = String(pkg.scripts["test:db"]);
    // `&&` preserva el exit code de Vitest: si falla, ni siquiera se evalúa.
    expect(cmd).toMatch(/vitest run --config vitest\.db\.config\.ts && node tests\/db\/scripts\/assert-clean-run\.mjs/);
  });
});
