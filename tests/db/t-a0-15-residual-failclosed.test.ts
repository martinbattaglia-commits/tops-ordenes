/**
 * T-A0-15 · El control de residuos es FAIL-CLOSED (H-03).
 *
 * Los inspectores se ejercitan con runners inyectados que simulan cada estado:
 * cero coincidencias, coincidencias, inspector ausente, permisos, error
 * operativo, salida inesperada. Sólo "inspección completada con cero
 * coincidencias" es limpio; cualquier otro estado falla.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectProcesses,
  inspectDirectories,
  residualVerdict,
} from "./scripts/residual-inspect.mjs";

/** Fabrica un resultado de spawnSync sintético. */
function spawnResult(over: Record<string, unknown>) {
  return { status: null, signal: null, stdout: "", stderr: "", error: undefined, ...over };
}

describe("T-A0-15 · control de residuos fail-closed", () => {
  // ── procesos ──────────────────────────────────────────────────────────
  it("pgrep exit 1 (sin coincidencias) → limpio", () => {
    const r = inspectProcesses(() => spawnResult({ status: 1 }));
    expect(r.status).toBe("clean");
  });

  it("pgrep exit 0 con coincidencias → dirty", () => {
    const r = inspectProcesses(() => spawnResult({ status: 0, stdout: "123\n456\n" }));
    expect(r.status).toBe("dirty");
    expect(r.status === "dirty" && r.matches).toEqual(["123", "456"]);
  });

  it("pgrep ausente (ENOENT) → error, NO limpio", () => {
    const err = Object.assign(new Error("not found"), { code: "ENOENT" });
    const r = inspectProcesses(() => spawnResult({ error: err }));
    expect(r.status).toBe("error");
    expect(r.status === "error" && r.reason).toMatch(/no disponible/);
  });

  it("pgrep con error de permisos (EACCES) → error", () => {
    const err = Object.assign(new Error("denied"), { code: "EACCES" });
    const r = inspectProcesses(() => spawnResult({ error: err }));
    expect(r.status).toBe("error");
  });

  it("pgrep error operativo (exit 2) → error", () => {
    const r = inspectProcesses(() => spawnResult({ status: 2, stderr: "bad usage" }));
    expect(r.status).toBe("error");
    expect(r.status === "error" && r.reason).toMatch(/exit 2/);
  });

  it("pgrep terminado por señal (sin exit code) → error", () => {
    const r = inspectProcesses(() => spawnResult({ status: null, signal: "SIGKILL" }));
    expect(r.status).toBe("error");
  });

  it("pgrep exit 0 SIN líneas (estado inesperado) → error", () => {
    const r = inspectProcesses(() => spawnResult({ status: 0, stdout: "   \n" }));
    expect(r.status).toBe("error");
    expect(r.status === "error" && r.reason).toMatch(/inesperado/);
  });

  // ── directorios ─────────────────────────────────────────────────────────
  it("directorio sin residuos → limpio", () => {
    const r = inspectDirectories("/x", () => ["otro", "cosas"]);
    expect(r.status).toBe("clean");
  });

  it("directorio con residuo p3n1a0-* → dirty", () => {
    const r = inspectDirectories("/x", () => ["p3n1a0-abc", "otro"]);
    expect(r.status).toBe("dirty");
    expect(r.status === "dirty" && r.matches).toEqual(["p3n1a0-abc"]);
  });

  it("lectura imposible (throw) → error, NO limpio", () => {
    const r = inspectDirectories("/x", () => {
      throw Object.assign(new Error("nope"), { code: "EACCES" });
    });
    expect(r.status).toBe("error");
    expect(r.status === "error" && r.reason).toMatch(/EACCES/);
  });

  it("ENOENT del tmpdir → error (el tmpdir siempre debe existir)", () => {
    const r = inspectDirectories("/no/existe", () => {
      throw Object.assign(new Error("nope"), { code: "ENOENT" });
    });
    expect(r.status).toBe("error");
  });

  it("lectura que devuelve algo que no es array → error", () => {
    const r = inspectDirectories("/x", () => null as unknown as string[]);
    expect(r.status).toBe("error");
  });

  // ── veredicto combinado ───────────────────────────────────────────────
  it("ÚNICO caso PASS: ambos limpios", () => {
    const v = residualVerdict({ status: "clean", matches: [] }, { status: "clean", matches: [] });
    expect(v.ok).toBe(true);
    expect(v.problems).toEqual([]);
  });

  it.each([
    ["proc error", { status: "error", reason: "x" }, { status: "clean", matches: [] }],
    ["proc dirty", { status: "dirty", matches: ["1"] }, { status: "clean", matches: [] }],
    ["dir error", { status: "clean", matches: [] }, { status: "error", reason: "y" }],
    ["dir dirty", { status: "clean", matches: [] }, { status: "dirty", matches: ["p3n1a0-z"] }],
    ["ambos error", { status: "error", reason: "x" }, { status: "error", reason: "y" }],
  ])("%s ⇒ NO ok", (_label, procs, dirs) => {
    const v = residualVerdict(procs as never, dirs as never);
    expect(v.ok).toBe(false);
    expect(v.problems.length).toBeGreaterThan(0);
  });

  // ── integración real: el tmpdir con un residuo se detecta ──────────────
  it("inspección real: un directorio p3n1a0-* real se detecta como dirty", () => {
    const base = mkdtempSync(join(tmpdir(), "p3n1a0-t15-"));
    try {
      // El propio directorio de esta prueba lleva el prefijo, así que la
      // inspección del tmpdir DEBE encontrarlo.
      const r = inspectDirectories(tmpdir());
      expect(r.status).toBe("dirty");
      expect(r.status === "dirty" && r.matches.some((m: string) => m.startsWith("p3n1a0-"))).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
