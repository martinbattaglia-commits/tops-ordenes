/**
 * P3-N1A0 · Falla la corrida si algún caso quedó silenciado.
 *
 * Vitest devuelve exit 0 con casos `skip`/`todo`. Sin esta verificación, un
 * test silenciado dejaría CI en verde con el sentinela emitiendo `_FAIL`.
 *
 * Corre DESPUÉS de Vitest y sólo si Vitest pasó: el exit code de Vitest manda
 * primero, éste añade la condición que a Vitest le falta. No hay grep de por
 * medio; se lee el reporte JSON estructurado de la propia corrida.
 */

import { readFileSync, existsSync } from "node:fs";
import { REPORT_PATH } from "./report-path.mjs";

// Se replica la lógica pura de tests/db/harness/run-report.ts, que está en
// TypeScript y no puede importarse desde un .mjs sin build. La equivalencia
// está cubierta por t-a0-13-run-report.test.ts, que prueba ambos contratos.
const NON_PASSING = new Set(["failed", "pending", "skipped", "todo", "disabled"]);

if (!existsSync(REPORT_PATH)) {
  console.error(`[P3-N1A0] no se encontró el reporte de la corrida en ${REPORT_PATH}.`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));
} catch (e) {
  console.error(`[P3-N1A0] el reporte de la corrida no es JSON válido: ${e.message}`);
  process.exit(1);
}

const problems = [];
let total = 0;
for (const file of report.testResults ?? []) {
  for (const a of file.assertionResults ?? []) {
    total += 1;
    const status = String(a.status ?? "unknown");
    if (status !== "passed") {
      problems.push(`${a.fullName ?? a.title ?? "<sin nombre>"} [${status}]`);
    }
    if (NON_PASSING.has(status) === false && status !== "passed") {
      problems.push(`estado desconocido: ${status}`);
    }
  }
}

if (total === 0) problems.push("la corrida no ejecutó ningún caso");

if (problems.length > 0) {
  console.error(`[P3-N1A0] la corrida NO está limpia (${problems.length} problema/s):`);
  for (const p of problems) console.error(`  · ${p}`);
  console.error(
    "Un caso silenciado deja CI en verde sin haber probado nada: se rechaza la corrida.",
  );
  process.exit(1);
}

console.log(`P3_N1A0_CLEAN_RUN (${total} casos, todos aprobados)`);
