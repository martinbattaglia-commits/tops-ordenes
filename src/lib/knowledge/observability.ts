/**
 * EOL (D20/ADR-ENG-1) — CANAL TÉCNICO SEPARADO.
 * Estos tipos/eventos NUNCA se escriben en knowledge_events.
 * `version` = engine@version del componente emisor (dato de canal, no columna funcional).
 * La app setea la GUC `knowledge.correlation_id` con set_config(name, value, true) en la tx;
 * el trigger/backfill SQL la leen (R-C).
 * Sin infra ni dashboards: solo contratos.
 */

import type { ActorKind } from "./types";

// ─── Tipos base ──────────────────────────────────────────────────────────────

export type LogStatus = "ok" | "error" | "skipped";

export interface StructuredLogEvent {
  timestamp: string;
  component: string;
  operation: string;
  correlationId: string | null;
  durationMs: number | null;
  status: LogStatus;
  actor: {
    kind: ActorKind;
    id: string | null;
    label: string | null;
  };
  entity: string | null;
  entityId: string | null;
  version: string;
  error: {
    code: string;
    message: string;
    detail?: string;
  } | null;
}

export interface MetricContract {
  name: string;
  kind: "counter" | "gauge" | "histogram";
  labels: string[];
  unit: string;
}

// ─── Constantes de eventos técnicos (canal separado) ─────────────────────────

export const KNOWLEDGE_TECH_EVENTS = {
  ProjectionStarted: "KnowledgeProjectionStarted",
  ProjectionFinished: "KnowledgeProjectionFinished",
  ProjectionFailed: "KnowledgeProjectionFailed",
  BackfillStarted: "KnowledgeBackfillStarted",
  BackfillCompleted: "KnowledgeBackfillCompleted",
} as const;

// ─── Contratos de métricas preparados (sin emisión real) ─────────────────────

export const KNOWLEDGE_METRICS: MetricContract[] = [
  {
    name: "knowledge_events_projected_total",
    kind: "counter",
    labels: ["source_table", "status"],
    unit: "events",
  },
  {
    name: "knowledge_backfill_duration_ms",
    kind: "histogram",
    labels: ["source_table"],
    unit: "ms",
  },
];

// ─── GUC de correlation_id (R-C) ─────────────────────────────────────────────

export const KNOWLEDGE_CORRELATION_GUC = "knowledge.correlation_id";

/**
 * Devuelve el par [name, value] para set_config(name, value, true) del lado app.
 * El trigger/backfill SQL lo lee via current_setting(KNOWLEDGE_CORRELATION_GUC, true).
 */
export function withKnowledgeCorrelation(
  id: string
): readonly [string, string] {
  return [KNOWLEDGE_CORRELATION_GUC, id] as const;
}

// ─── Builder puro ─────────────────────────────────────────────────────────────

const DEFAULT_VERSION = "knowledge@f0.5.1";

/**
 * Construye un StructuredLogEvent completo a partir de un input parcial.
 * Determinístico salvo `timestamp` cuando no se provee (usa new Date().toISOString()).
 * Inyectar `timestamp` en tests para resultados reproducibles.
 */
export function structuredLog(
  input: Partial<StructuredLogEvent> &
    Pick<StructuredLogEvent, "component" | "operation" | "status">
): StructuredLogEvent {
  return {
    timestamp: input.timestamp ?? new Date().toISOString(),
    component: input.component,
    operation: input.operation,
    correlationId: input.correlationId ?? null,
    durationMs: input.durationMs ?? null,
    status: input.status,
    actor: input.actor ?? { kind: "system", id: null, label: null },
    entity: input.entity ?? null,
    entityId: input.entityId ?? null,
    version: input.version ?? DEFAULT_VERSION,
    error: input.error ?? null,
  };
}
