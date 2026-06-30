/**
 * F0.5.2 / E2.3 — DTOs del Panel Administrativo de Knowledge (read-only).
 * Espejan las RPC SECDEF de `0140_knowledge_kpis_admin` (snake_case → camelCase).
 * SOLO LECTURA: el panel observa, no muta (D-1).
 */

export type HealthStatus = "healthy" | "degraded" | "critical" | "unknown";

/** Signals crudos de `knowledge_kpi_health()`. */
export interface HealthSignals {
  totalEvents: number;
  deadCount: number;
  stuckCount: number;
  processingCount: number;
  dueNow: number;
  oldestPendingAgeSeconds: number | null;
  lastRunAt: string | null;
  lastNonDryRunAt: string | null;
}

/** Evaluación derivada (pura, testeable) que responde "¿el sistema está sano?" (D-7). */
export interface HealthAssessment {
  status: HealthStatus;
  score: number; // 0–100
  headline: string;
  reasons: string[];
}

/** Estado de la cola + procesamiento — `knowledge_kpi_queue()` (una fila). */
export interface QueueKpis {
  pending: number;
  processing: number;
  failed: number;
  dead: number;
  processed: number;
  total: number;
  dueNow: number;
  stuck: number;
  oldestPendingAgeSeconds: number | null;
}

/** Estado por fuente — `knowledge_kpi_sources()` (N filas). */
export interface SourceKpi {
  sourceTable: string;
  enabled: boolean;
  lastBackfillAt: string | null;
  events: number;
  notes: string | null;
}

/** Telemetría agregada del worker — `knowledge_kpi_worker()` (una fila). */
export interface WorkerKpis {
  runs: number;
  processed: number;
  failedRetried: number;
  failedDead: number;
  avgDurationMs: number | null;
  maxDurationMs: number | null;
  lastRunAt: string | null;
  lastNonDryRunAt: string | null;
  lastDry: boolean | null;
}

/** Eventos muertos/fallidos — `knowledge_kpi_dead_letter()` (N filas). */
export interface DeadLetterEntry {
  seq: number;
  id: string;
  eventType: string;
  sourceTable: string | null;
  status: string;
  retryCount: number;
  error: string | null;
  availableAt: string;
  occurredAt: string;
}

/** Paquete completo del panel (lo arma el data layer en una pasada). */
export interface KnowledgeAdminData {
  health: HealthSignals | null;
  queue: QueueKpis | null;
  worker: WorkerKpis | null;
  sources: SourceKpi[];
  deadLetter: DeadLetterEntry[];
}
