/**
 * P3-N1A0 · Evaluación del reporte de corrida (M-02).
 *
 * Vitest termina con exit code 0 cuando hay casos `skip` o `todo`. Un test
 * silenciado dejaría la corrida verde y el sentinela emitiría `_FAIL` sin que
 * nadie lo notara: el mutante "test skipped" sobrevivía.
 *
 * Este módulo evalúa el reporte JSON de la corrida. La decisión es una función
 * PURA para poder probarla; el script que corre en CI sólo la invoca y traduce
 * el veredicto a exit code. El resultado de CI lo sigue determinando el exit
 * code real —el de Vitest primero, el de esta verificación después—, nunca un grep.
 */

/** Forma mínima del reporte JSON de Vitest que necesitamos. */
export interface RunReport {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  numTodoTests?: number;
  testResults?: Array<{
    name?: string;
    assertionResults?: Array<{ status?: string; fullName?: string; title?: string }>;
  }>;
}

export interface RunVerdict {
  ok: boolean;
  total: number;
  passed: number;
  problems: string[];
}

/** Estados que NO cuentan como aprobado. */
const NON_PASSING = new Set(["failed", "pending", "skipped", "todo", "disabled"]);

/**
 * Evalúa un reporte. `ok` sólo es `true` si hay al menos un caso y TODOS
 * pasaron: cero fallidos, cero silenciados, cero pendientes.
 */
export function evaluateRunReport(report: RunReport | null | undefined): RunVerdict {
  if (!report || typeof report !== "object") {
    return { ok: false, total: 0, passed: 0, problems: ["reporte ausente o ilegible"] };
  }

  const problems: string[] = [];
  const results = Array.isArray(report.testResults) ? report.testResults : [];

  let total = 0;
  let passed = 0;
  for (const file of results) {
    for (const a of file.assertionResults ?? []) {
      total += 1;
      const status = String(a.status ?? "unknown");
      if (status === "passed") {
        passed += 1;
      } else {
        const label = a.fullName ?? a.title ?? "<sin nombre>";
        problems.push(`${label} [${status}]`);
      }
    }
  }

  // Contadores agregados, por si el reporte los trae y los detalles no.
  const pending = Number(report.numPendingTests ?? 0);
  const todo = Number(report.numTodoTests ?? 0);
  const failed = Number(report.numFailedTests ?? 0);
  if (problems.length === 0) {
    if (failed > 0) problems.push(`${failed} caso(s) fallido(s) según el agregado`);
    if (pending > 0) problems.push(`${pending} caso(s) silenciado(s) según el agregado`);
    if (todo > 0) problems.push(`${todo} caso(s) todo según el agregado`);
  }

  if (total === 0) problems.push("la corrida no ejecutó ningún caso");

  return { ok: problems.length === 0, total, passed, problems };
}

/** Verdad simple para el script de CI. */
export function isRunClean(report: RunReport | null | undefined): boolean {
  return evaluateRunReport(report).ok;
}

/** Estados considerados no aprobados; expuesto para las pruebas. */
export const NON_PASSING_STATUSES: readonly string[] = [...NON_PASSING];
