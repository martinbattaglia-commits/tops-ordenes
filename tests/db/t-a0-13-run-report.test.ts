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
import {
  EXPECTED_TEST_FILES,
  EXPECTED_TOTAL_TESTS,
  EXPECTED_TESTS_PER_FILE,
  suiteCoherenceProblems,
} from "./scripts/expected-suite.mjs";
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

  it("`test:db` delega en el corredor de gates, no en un encadenamiento `&&`", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    const cmd = String(pkg.scripts["test:db"]);
    // WA-8R9 · el `&&` SALTEABA el guard de residuos justo cuando más importa:
    // una corrida fallida es la que más chance tiene de dejar basura viva.
    expect(cmd).toBe("node tests/db/scripts/run-db-gates.mjs");
    expect(cmd).not.toContain("&&");
  });

  it("el corredor ejecuta el guard de residuos INCONDICIONALMENTE", () => {
    const src = readFileSync(
      join(REPO_ROOT, "tests", "db", "scripts", "run-db-gates.mjs"), "utf8",
    );
    // Las cuatro etapas, en orden, y la última marcada como incondicional.
    for (const etapa of [
      "prepare-run", "vitest", "assert-clean-run", "assert-no-residual-local",
    ]) {
      expect(src).toContain(etapa);
    }
    expect(src).toMatch(/siempre:\s*true/);
    // Y el exit preserva el PRIMER fallo, no el último.
    expect(src).toMatch(/primerFallo/);
    expect(src).toContain("process.exit(primerFallo.code)");
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
    // WA-8R9 · el total ya NO es un número escrito a mano: se DERIVA de
    // `EXPECTED_TESTS_PER_FILE`, así que no puede quedar desfasado en silencio
    // (que es exactamente lo que pasó con el 350 contra 454 reales).
    const derivado = Object.values(EXPECTED_TESTS_PER_FILE).reduce((a, b) => a + b, 0);
    expect(EXPECTED_TOTAL_TESTS).toBe(derivado);
    // 519 + 53 (a1-01) + 16 (a1-03) de FASE A + 21 (b1-01, frontera de canal)
    // + 41 (b1-02, cierre estructural, Realtime autenticado, el teléfono del
    // contacto y el hallazgo abierto de connect_participants)
    // + 44 (b2-01, ciclo de vida de la subida y ACL 0239a fail-closed)
    // + 34 (h1-01, cierre de H1: entorno C5 con esquema real derivado de
    // main) de NEXUS-LINK-NOTIFICATIONS-MEDIA-001 = 728; +2 guardas
    // estructurales fail-closed en T-A0-10 = 730; +121 de PR #66 FASE A
    // (Clientes 38+10+47, OC 7 y ciclo integral OC/OS 19) = 851; +8 de
    // CUSTODIA-NIVEL-CONTRATADO (t-cli-a3-01: lo ya materializado no se degrada
    // cuando el cliente da de baja la custodia, y la puerta de la RPC) = 859;
    // + 9 de remediación 0261 (desambiguación connect_archive_conversation) y precursora 0261a (enums RBAC Finanzas) = 868;
    // + 7 de remediación 0262a (alineación canónica dual-state del esquema de Finanzas) = 875.
    expect(EXPECTED_TOTAL_TESTS).toBe(875);
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

// ══ WA-8R9 CLOSEOUT · HIGH-1 · el gate de la suite DB, en sus cinco escenarios ══
/**
 * Se ejercita el CORREDOR real (`run-db-gates.mjs`) como proceso, con etapas
 * sustituidas por scripts sintéticos. Probar la lógica de encadenamiento
 * leyendo su texto no serviría: lo que hay que demostrar es el comportamiento
 * —qué se saltea, qué corre igual y qué exit code sale— y eso sólo se ve
 * ejecutándolo.
 */
describe("T-A0-13 · HIGH-1 · gate DB: conteo, fallo y residuos", () => {
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  const { mkdtempSync, writeFileSync, rmSync, mkdirSync } =
    require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");

  /**
   * Copia el corredor a un sandbox donde las cuatro etapas son scripts que
   * devuelven el exit code pedido. El corredor bajo prueba es el REAL.
   */
  function correrGates(codes: {
    prepare?: number; vitest?: number; clean?: number; residual?: number;
  }) {
    const dir = mkdtempSync(join(tmpdir(), "wa-r9-gates-"));
    mkdirSync(join(dir, "tests", "db", "scripts"), { recursive: true });

    const etapa = (nombre: string, code: number) =>
      writeFileSync(
        join(dir, "tests", "db", "scripts", `${nombre}.mjs`),
        `console.log("[stub] ${nombre}");process.exit(${code});`,
      );
    etapa("prepare-run", codes.prepare ?? 0);
    etapa("assert-clean-run", codes.clean ?? 0);
    etapa("assert-no-residual-local", codes.residual ?? 0);

    // `npx vitest` se sustituye por un `npx` falso en el PATH del sandbox.
    const bin = join(dir, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "npx"),
      `#!/bin/sh\necho "[stub] vitest"\nexit ${codes.vitest ?? 0}\n`,
      { mode: 0o755 },
    );

    const runner = readFileSync(
      join(REPO_ROOT, "tests", "db", "scripts", "run-db-gates.mjs"), "utf8",
    );
    writeFileSync(join(dir, "tests", "db", "scripts", "run-db-gates.mjs"), runner);

    const r = spawnSync("node", ["tests/db/scripts/run-db-gates.mjs"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    });
    rmSync(dir, { recursive: true, force: true });
    return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  }

  it("1 · todo verde ⇒ exit 0 y ambas verificaciones ejecutadas", () => {
    const r = correrGates({});
    expect(r.code).toBe(0);
    expect(r.out).toContain("assert-clean-run: OK");
    expect(r.out).toContain("assert-no-residual-local: OK");
  });

  it("2 · conteo incorrecto (assert-clean-run falla) ⇒ exit 1 y residuos IGUAL se verifica", () => {
    const r = correrGates({ clean: 1 });
    expect(r.code).toBe(1);
    expect(r.out).toContain("assert-clean-run: FALLO");
    // Lo que el `&&` impedía: el guard corre de todas formas.
    expect(r.out).toContain("assert-no-residual-local: OK");
  });

  it("3 · suite fallida ⇒ clean-run se saltea pero el guard de residuos NO", () => {
    const r = correrGates({ vitest: 1 });
    expect(r.code).toBe(1);
    expect(r.out).toContain("vitest: FALLO");
    expect(r.out).toContain("assert-clean-run: SALTEADA");
    expect(r.out).toContain("assert-no-residual-local: OK");
  });

  it("4 · residual presente con suite verde ⇒ exit del guard de residuos", () => {
    const r = correrGates({ residual: 3 });
    expect(r.code).toBe(3);
    expect(r.out).toContain("assert-no-residual-local: FALLO");
  });

  it("5 · ambos fallos ⇒ exit del PRIMERO, y el segundo se reporta igual", () => {
    const r = correrGates({ vitest: 1, residual: 3 });
    // El exit conserva la CAUSA (la suite), no el fallo posterior de limpieza.
    expect(r.code).toBe(1);
    expect(r.out).toContain("vitest: FALLO");
    expect(r.out).toContain("assert-no-residual-local: FALLO");
    expect(r.out).toContain("Causa: vitest");
  });

  it("un fallo en prepare-run tampoco impide verificar residuos", () => {
    const r = correrGates({ prepare: 2 });
    expect(r.code).toBe(2);
    expect(r.out).toContain("assert-no-residual-local: OK");
  });
});

// ══ WA-8R9 · la guarda de coherencia del universo declarado ════════════════
describe("T-A0-13 · HIGH-1 · coherencia archivos ↔ conteos", () => {
  it("el universo declarado es internamente coherente", () => {
    expect(suiteCoherenceProblems()).toEqual([]);
  });

  it("cada archivo esperado tiene su conteo, y viceversa", () => {
    expect([...EXPECTED_TEST_FILES].sort()).toEqual(
      Object.keys(EXPECTED_TESTS_PER_FILE).sort(),
    );
  });

  it("ningún conteo es cero o negativo: eso desactivaría la comprobación", () => {
    for (const [f, n] of Object.entries(EXPECTED_TESTS_PER_FILE)) {
      expect(Number.isInteger(n), `${f}`).toBe(true);
      expect(n, `${f}`).toBeGreaterThan(0);
    }
  });

  it("assert-clean-run consulta la guarda ANTES de mirar la corrida", () => {
    const src = readFileSync(
      join(REPO_ROOT, "tests", "db", "scripts", "assert-clean-run.mjs"), "utf8",
    );
    expect(src).toContain("suiteCoherenceProblems");
    // La coherencia se evalúa antes de exigir el reporte.
    expect(src.indexOf("suiteCoherenceProblems()")).toBeLessThan(src.indexOf("existsSync(REPORT_PATH)"));
    // Y el desglose por archivo existe: dice DÓNDE está la diferencia.
    expect(src).toContain("EXPECTED_TESTS_PER_FILE");
  });
});
