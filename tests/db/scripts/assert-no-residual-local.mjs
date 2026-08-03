/**
 * P3-N1A0 · Barrera LOCAL de residuos, FAIL-CLOSED (H-03).
 *
 * Corre al final de `npm run test:db`. El sentinela `P3_N1A0_NO_LOCAL_RESIDUALS`
 * sólo se emite tras demostrar SIMULTÁNEAMENTE: inspector de procesos ejecutado
 * con cero coincidencias E inspección de directorios completada con cero
 * residuos. Cualquier imposibilidad de inspeccionar produce exit no cero.
 */

import { tmpdir } from "node:os";
import { inspectProcesses, inspectDirectories, residualVerdict } from "./residual-inspect.mjs";

const procs = inspectProcesses();
const dirs = inspectDirectories(tmpdir());
const verdict = residualVerdict(procs, dirs);

if (!verdict.ok) {
  console.error("[P3-N1A0] control de residuos FALLÓ (fail-closed):");
  for (const p of verdict.problems) console.error(`  · ${p}`);
  console.error(
    "Sólo 'inspección completada con cero coincidencias' es limpio; " +
      "un inspector que no puede ejecutarse NO se degrada a limpio.",
  );
  process.exit(1);
}

console.log("P3_N1A0_NO_LOCAL_RESIDUALS");
