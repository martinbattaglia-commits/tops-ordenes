/**
 * T-A0-07 · Decisión de sentinela (M-02).
 *
 * La decisión vive en una función PURA para poder probarla. Incluye un MUTANTE
 * PERMANENTE —una implementación que fuerza PASS— y la demostración de que los
 * mismos casos la ponen en rojo.
 */

import { describe, expect, it } from "vitest";
import { shouldEmitPass, summarizeNonPassing, type TaskState } from "./harness/sentinel";

/** Mutante permanente: siempre aprueba. Debe fallar los mismos casos. */
function shouldEmitPassMUTANT(_states: readonly TaskState[], _complete = true): boolean {
  return true;
}

/** Casos que definen el contrato. `expected` es el veredicto correcto. */
const CASES: ReadonlyArray<{
  label: string;
  states: TaskState[];
  complete?: boolean;
  expected: boolean;
}> = [
  { label: "todos pass", states: ["pass", "pass", "pass"], expected: true },
  { label: "un solo pass", states: ["pass"], expected: true },
  { label: "pass + fail", states: ["pass", "fail"], expected: false },
  { label: "pass + skip", states: ["pass", "skip"], expected: false },
  { label: "pass + todo", states: ["pass", "todo"], expected: false },
  { label: "pass + pending", states: ["pass", "pending"], expected: false },
  { label: "pass + unknown", states: ["pass", "loquesea"], expected: false },
  { label: "lista vacía", states: [], expected: false },
  { label: "resultado ausente (undefined)", states: ["pass", undefined], expected: false },
  { label: "resultado ausente (null)", states: ["pass", null], expected: false },
  { label: "suite abortada", states: ["pass", "pass"], complete: false, expected: false },
];

describe("T-A0-07 · shouldEmitPass", () => {
  it.each(CASES)("$label → $expected", ({ states, complete, expected }) => {
    expect(shouldEmitPass(states, complete ?? true)).toBe(expected);
  });

  it("MUTANTE PERMANENTE: una implementación que fuerza PASS falla el contrato", () => {
    const divergentes = CASES.filter(
      (c) => shouldEmitPassMUTANT(c.states, c.complete ?? true) !== c.expected,
    );
    // Si alguien "simplificara" shouldEmitPass a `return true`, estos casos
    // dejarían de distinguirse y este test lo delata.
    expect(divergentes.length).toBeGreaterThan(0);
    expect(divergentes.map((c) => c.label)).toContain("pass + skip");
    expect(divergentes.map((c) => c.label)).toContain("lista vacía");
  });

  it("es total: no lanza ante entradas degeneradas", () => {
    expect(() => shouldEmitPass(undefined as unknown as TaskState[])).not.toThrow();
    expect(shouldEmitPass(undefined as unknown as TaskState[])).toBe(false);
  });

  it("summarizeNonPassing describe los casos no aprobados", () => {
    const s = summarizeNonPassing([
      { name: "a", state: "pass" },
      { name: "b", state: "skip" },
      { name: "c", state: undefined },
    ]);
    expect(s).toContain("b [skip]");
    expect(s).toContain("c [sin resultado]");
    expect(s).not.toContain("a [");
  });

  it("summarizeNonPassing informa cuando no hay casos", () => {
    expect(summarizeNonPassing([])).toBe("sin casos aplicables");
  });
});
