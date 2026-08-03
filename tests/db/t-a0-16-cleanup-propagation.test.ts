/**
 * T-A0-16 · Discriminante permanente de propagación de cleanup (H-01.3).
 *
 * Ejecuta la probe aislada en un SUBPROCESO Vitest y afirma su exit ≠ 0. La
 * probe usa el mismo `runPendingTeardowns` que T-A0-04/05 y registra un
 * teardown que falla; si el helper propaga (comportamiento correcto), el
 * subproceso termina con exit ≠ 0 y este test pasa. Si un mutante hace que el
 * helper absorba el error, la probe terminaría en verde (exit 0) y este test
 * se pondría ROJO — matando al mutante "cleanup absorbido".
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function runProbe(): { status: number | null; combined: string } {
  const r = spawnSync(
    "npx",
    ["vitest", "run", "--config", "vitest.probe.config.ts", "--reporter=default"],
    { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, CI: "1" }, timeout: 120_000 },
  );
  return { status: r.status, combined: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}

describe("T-A0-16 · propagación de cleanup", () => {
  it("la probe termina con exit ≠ 0 porque el afterEach propaga el fallo", () => {
    const { status, combined } = runProbe();
    // El caso interno pasa, pero el afterEach lanza: el subproceso DEBE fallar.
    expect(status).not.toBe(0);
    // Evidencia de que el fallo es el esperado y no otro (p. ej. un error de arranque).
    expect(combined).toMatch(/PROBE_TEARDOWN_BOOM|cleanup de PROBE falló/);
  }, 130_000);

  it("la probe NO figura en el universo de la suite oficial", async () => {
    // Salvaguarda: si alguien renombrara la probe a `.test.ts`, entraría en la
    // corrida oficial y la haría fallar siempre. Aquí se confirma que el include
    // oficial no la toma.
    const { readFileSync } = await import("node:fs");
    const cfg = readFileSync(resolve(REPO_ROOT, "vitest.db.config.ts"), "utf8");
    expect(cfg).toContain('include: ["tests/db/**/*.test.ts"]');
    const probeCfg = readFileSync(resolve(REPO_ROOT, "vitest.probe.config.ts"), "utf8");
    expect(probeCfg).toContain('tests/db/fixtures/**/*.probe.ts');
  });
});
