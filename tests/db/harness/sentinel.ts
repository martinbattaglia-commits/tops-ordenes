/**
 * P3-N1A0 · Sentinelas PASS/FAIL.
 *
 * Endurecido tras M-02: la versión anterior emitía `_PASS` con casos `skip`,
 * `todo` o sin resultado, y la decisión vivía enredada en el `afterAll`, sin
 * forma de probarla. Ahora la decisión es una función PURA (`shouldEmitPass`)
 * y el reporter depende exclusivamente de ella.
 *
 * Regla: `_PASS` sólo se emite cuando hay al menos un caso aplicable y TODOS
 * tienen estado exacto `pass`. Cualquier `fail`, `skip`, `todo`, `pending`,
 * estado desconocido, resultado ausente o suite incompleta lo impide.
 *
 * El sentinela NUNCA decide el resultado de CI: ese lo fija el exit code real
 * de Vitest. El sentinela es evidencia, no compuerta.
 */

import { afterAll } from "vitest";
import type { Suite, Task } from "vitest";

/** Estados que un caso puede presentar, incluido el ausente. */
export type TaskState = string | null | undefined;

/** Único estado que cuenta como aprobado. */
const PASSING = "pass";

/**
 * Decide si corresponde emitir `_PASS`. Función pura y total: cualquier
 * entrada produce un booleano sin efectos ni excepciones.
 *
 * @param states Estado de cada caso aplicable, en cualquier orden.
 * @param suiteComplete `false` si la suite se abortó o no terminó de correr.
 */
export function shouldEmitPass(
  states: readonly TaskState[],
  suiteComplete = true,
): boolean {
  if (!suiteComplete) return false;
  if (!Array.isArray(states)) return false;
  if (states.length === 0) return false; // sin casos aplicables no hay evidencia
  return states.every((s) => s === PASSING);
}

/** Resumen legible de los estados no aprobados, para el mensaje `_FAIL`. */
export function summarizeNonPassing(
  entries: ReadonlyArray<{ name: string; state: TaskState }>,
): string {
  const bad = entries.filter((e) => e.state !== PASSING);
  if (bad.length === 0) return "sin casos aplicables";
  return bad.map((e) => `${e.name} [${e.state ?? "sin resultado"}]`).join(" · ");
}

/** Aplana la jerarquía de suites a la lista de casos hoja. */
export function collectTasks(tasks: readonly Task[], out: Task[] = []): Task[] {
  for (const t of tasks) {
    if (t.type === "suite") collectTasks(t.tasks, out);
    else out.push(t);
  }
  return out;
}

/**
 * Registra un `afterAll` que emite el sentinela según `shouldEmitPass`.
 *
 * @param name Nombre del sentinela, p. ej. `P3_N1A0_SCHEMA_LOAD_PASS`.
 */
export function emitSentinelWhenGreen(name: string): void {
  afterAll((suite) => {
    const tasks = collectTasks((suite as Suite).tasks ?? []);
    const entries = tasks.map((t) => ({ name: t.name, state: t.result?.state }));
    const states = entries.map((e) => e.state);

    if (shouldEmitPass(states)) {
      // eslint-disable-next-line no-console
      console.log(name);
      return;
    }

    // eslint-disable-next-line no-console
    console.log(
      `${name.replace(/_(PASS|DETECTED|REJECTED)$/, "")}_FAIL ` +
        `(${summarizeNonPassing(entries)})`,
    );
  });
}
