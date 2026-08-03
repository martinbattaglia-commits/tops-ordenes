/**
 * P3-N1A0 · Sentinelas PASS/FAIL.
 *
 * Un sentinela que se imprime pase lo que pase no es un sentinela: es ruido.
 * `emitSentinelWhenGreen` registra un `afterAll` que inspecciona el resultado
 * real de todos los casos del archivo y sólo emite la marca si TODOS pasaron.
 * Si alguno falló, emite la marca de fallo con el detalle.
 */

import { afterAll } from "vitest";
import type { Suite, Task } from "vitest";

function collect(tasks: readonly Task[], out: Task[] = []): Task[] {
  for (const t of tasks) {
    if (t.type === "suite") collect(t.tasks, out);
    else out.push(t);
  }
  return out;
}

/**
 * @param name Nombre del sentinela, p. ej. `P3_N1A0_SCHEMA_LOAD_PASS`.
 */
export function emitSentinelWhenGreen(name: string): void {
  afterAll((suite) => {
    const tasks = collect((suite as Suite).tasks ?? []);
    const failed = tasks.filter((t) => t.result?.state === "fail");

    if (failed.length === 0) {
      // eslint-disable-next-line no-console
      console.log(name);
      return;
    }

    // eslint-disable-next-line no-console
    console.log(
      `${name.replace(/_PASS$|_DETECTED$|_REJECTED$/, "")}_FAIL ` +
        `(${failed.length}/${tasks.length} casos fallaron: ` +
        `${failed.map((t) => t.name).join(" · ")})`,
    );
  });
}
