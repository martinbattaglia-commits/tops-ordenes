/**
 * F0.5.2 / E2.3 — Health Score del Knowledge Engine (D-7).
 *
 * Función PURA (sin IO): toma los signals crudos de `knowledge_kpi_health()` y
 * deriva "¿el sistema está sano?". Testeable unitariamente; la 1ª sección del panel
 * la consume como semáforo. NO toca DB ni componentes congelados.
 *
 * Semántica clave (validada contra prod): el worker emite estado terminal `processed`
 * de forma sincrónica para las fuentes actuales, así que la cola suele estar vacía y
 * el cron puede no haber corrido nunca. Por eso el atraso del worker SOLO degrada la
 * salud cuando hay backlog real para drenar (`dueNow > 0`).
 */
import type { HealthSignals, HealthAssessment, HealthStatus } from "./admin-types";

/** Cron cada 5 minutos → consideramos al worker "atrasado" si su última corrida no-dry supera este umbral. */
export const DEFAULT_WORKER_STALE_SECONDS = 15 * 60;

/** ¿El worker está atrasado? Nunca corrió ⇒ atrasado. */
export function isWorkerStale(
  lastNonDryRunAt: string | null,
  staleSeconds: number = DEFAULT_WORKER_STALE_SECONDS,
  nowMs: number = Date.now(),
): boolean {
  if (!lastNonDryRunAt) return true;
  const t = new Date(lastNonDryRunAt).getTime();
  if (Number.isNaN(t)) return true;
  return (nowMs - t) / 1000 > staleSeconds;
}

export function computeHealth(
  s: HealthSignals,
  opts: { nowMs?: number; workerStaleSeconds?: number } = {},
): HealthAssessment {
  const staleSeconds = opts.workerStaleSeconds ?? DEFAULT_WORKER_STALE_SECONDS;
  const reasons: string[] = [];
  let severity = 0; // 0 = sano · 1 = degradado · 2 = crítico
  let score = 100;

  const workerStale = isWorkerStale(s.lastNonDryRunAt, staleSeconds, opts.nowMs);

  // 1) Dead-letter: requiere intervención humana → crítico.
  if (s.deadCount > 0) {
    severity = Math.max(severity, 2);
    score -= 40;
    reasons.push(`${s.deadCount} evento(s) en dead-letter`);
  }

  // 2) Atascados (lease vencido): el worker los recupera, pero hay que vigilar → degradado.
  if (s.stuckCount > 0) {
    severity = Math.max(severity, 1);
    score -= 20;
    reasons.push(`${s.stuckCount} evento(s) atascado(s) (lease vencido)`);
  }

  // 3) Backlog: sólo es crítico si además el worker está atrasado (no drena).
  if (s.dueNow > 0) {
    if (workerStale) {
      severity = Math.max(severity, 2);
      score -= 30;
      reasons.push(`${s.dueNow} evento(s) en cola sin drenar (worker atrasado)`);
    } else {
      severity = Math.max(severity, 1);
      score -= 15;
      reasons.push(`${s.dueNow} evento(s) pendientes de drenar`);
    }
  }

  score = Math.max(0, Math.min(100, score));

  if (reasons.length === 0) {
    reasons.push("Cola drenada, sin eventos muertos ni atascados");
  }

  const status: HealthStatus = severity === 2 ? "critical" : severity === 1 ? "degraded" : "healthy";
  const headline =
    status === "critical"
      ? "Sistema en estado crítico"
      : status === "degraded"
        ? "Sistema degradado"
        : "Sistema sano";

  return { status, score, headline, reasons };
}
