/**
 * P3-N1A0 · Probe aislada de propagación de cleanup (H-01.3).
 *
 * NO es un `*.test.ts`: la suite oficial no la recoge (evitaría un fallo
 * permanente en la corrida principal). Se ejecuta EXCLUSIVAMENTE desde
 * T-A0-16 en un subproceso Vitest, que afirma su exit ≠ 0.
 *
 * Usa el MISMO `runPendingTeardowns` que T-A0-04/05. Registra un teardown que
 * falla y confía en que el `afterEach` lo propague. Si alguien muta el helper
 * para absorber errores, este probe termina con exit 0 y T-A0-16 se pone rojo.
 */

import { afterEach, it, expect } from "vitest";
import { runPendingTeardowns, type Teardownable } from "../harness/cleanup";

const pending: Teardownable[] = [];

afterEach(async () => {
  await runPendingTeardowns("PROBE", pending);
});

it("registra un teardown que fallará; el afterEach debe propagarlo", () => {
  pending.push({
    teardown: async () => {
      throw new Error("PROBE_TEARDOWN_BOOM");
    },
  });
  // El propio caso PASA; lo que debe fallar es el afterEach. Si el helper
  // absorbe el error, la corrida entera termina en verde: eso es el bug.
  expect(true).toBe(true);
});
