import { describe, it, expect } from "vitest";
import {
  structuredLog,
  KNOWLEDGE_TECH_EVENTS,
  KNOWLEDGE_CORRELATION_GUC,
  KNOWLEDGE_METRICS,
  withKnowledgeCorrelation,
  type LogStatus,
  type StructuredLogEvent,
} from "./observability";

// ─── structuredLog ────────────────────────────────────────────────────────────

describe("structuredLog", () => {
  it("con input mínimo produce todos los campos con defaults correctos", () => {
    const result = structuredLog({
      component: "projection-worker",
      operation: "project_ordenes",
      status: "ok",
      timestamp: "2026-06-28T00:00:00.000Z", // inyectado para determinismo
    });

    expect(result.component).toBe("projection-worker");
    expect(result.operation).toBe("project_ordenes");
    expect(result.status).toBe("ok");
    expect(result.timestamp).toBe("2026-06-28T00:00:00.000Z");
    expect(result.correlationId).toBeNull();
    expect(result.durationMs).toBeNull();
    expect(result.actor).toEqual({ kind: "system", id: null, label: null });
    expect(result.entity).toBeNull();
    expect(result.entityId).toBeNull();
    expect(result.version).toBe("knowledge@f0.5.1");
    expect(result.error).toBeNull();
  });

  it("con timestamp inyectado es determinístico", () => {
    const ts = "2026-06-28T12:00:00.000Z";
    const r1 = structuredLog({
      component: "c",
      operation: "o",
      status: "ok",
      timestamp: ts,
    });
    const r2 = structuredLog({
      component: "c",
      operation: "o",
      status: "ok",
      timestamp: ts,
    });
    expect(r1).toEqual(r2);
    expect(r1.timestamp).toBe(ts);
  });

  it("sin timestamp inyectado usa new Date().toISOString() (no determinístico pero válido ISO)", () => {
    const before = Date.now();
    const result = structuredLog({
      component: "c",
      operation: "o",
      status: "skipped",
    });
    const after = Date.now();
    const ts = new Date(result.timestamp).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("respeta el enum de status: ok | error | skipped", () => {
    const statuses: LogStatus[] = ["ok", "error", "skipped"];
    for (const s of statuses) {
      const r = structuredLog({
        component: "c",
        operation: "o",
        status: s,
        timestamp: "2026-06-28T00:00:00.000Z",
      });
      expect(r.status).toBe(s);
    }
  });

  it("con todos los campos los preserva, incluido error y actor", () => {
    const full: StructuredLogEvent = {
      timestamp: "2026-06-28T09:00:00.000Z",
      component: "backfill-runner",
      operation: "backfill_compras",
      correlationId: "corr-abc-123",
      durationMs: 452,
      status: "error",
      actor: { kind: "integration", id: "svc-backfill", label: "Backfill Service" },
      entity: "compras",
      entityId: "comp-001",
      version: "knowledge@custom",
      error: {
        code: "PROJ_FAILED",
        message: "Projection failed",
        detail: "Constraint violation on knowledge_events",
      },
    };

    const result = structuredLog(full);

    expect(result).toEqual(full);
    expect(result.actor.kind).toBe("integration");
    expect(result.actor.id).toBe("svc-backfill");
    expect(result.actor.label).toBe("Backfill Service");
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe("PROJ_FAILED");
    expect(result.error?.message).toBe("Projection failed");
    expect(result.error?.detail).toBe("Constraint violation on knowledge_events");
    expect(result.correlationId).toBe("corr-abc-123");
    expect(result.durationMs).toBe(452);
  });

  it("actor con kind user se preserva", () => {
    const result = structuredLog({
      component: "ui",
      operation: "manual_trigger",
      status: "ok",
      timestamp: "2026-06-28T00:00:00.000Z",
      actor: { kind: "user", id: "usr-001", label: "Martín" },
    });
    expect(result.actor).toEqual({ kind: "user", id: "usr-001", label: "Martín" });
  });

  it("error sin detail omite la propiedad detail", () => {
    const result = structuredLog({
      component: "c",
      operation: "o",
      status: "error",
      timestamp: "2026-06-28T00:00:00.000Z",
      error: { code: "ERR_X", message: "algo falló" },
    });
    expect(result.error?.code).toBe("ERR_X");
    expect(result.error?.detail).toBeUndefined();
  });
});

// ─── KNOWLEDGE_TECH_EVENTS ────────────────────────────────────────────────────

describe("KNOWLEDGE_TECH_EVENTS", () => {
  it("tiene exactamente los 5 nombres de eventos técnicos correctos", () => {
    expect(KNOWLEDGE_TECH_EVENTS.ProjectionStarted).toBe(
      "KnowledgeProjectionStarted"
    );
    expect(KNOWLEDGE_TECH_EVENTS.ProjectionFinished).toBe(
      "KnowledgeProjectionFinished"
    );
    expect(KNOWLEDGE_TECH_EVENTS.ProjectionFailed).toBe(
      "KnowledgeProjectionFailed"
    );
    expect(KNOWLEDGE_TECH_EVENTS.BackfillStarted).toBe(
      "KnowledgeBackfillStarted"
    );
    expect(KNOWLEDGE_TECH_EVENTS.BackfillCompleted).toBe(
      "KnowledgeBackfillCompleted"
    );
    expect(Object.keys(KNOWLEDGE_TECH_EVENTS)).toHaveLength(5);
  });
});

// ─── KNOWLEDGE_CORRELATION_GUC ────────────────────────────────────────────────

describe("KNOWLEDGE_CORRELATION_GUC", () => {
  it('es exactamente "knowledge.correlation_id"', () => {
    expect(KNOWLEDGE_CORRELATION_GUC).toBe("knowledge.correlation_id");
  });
});

// ─── withKnowledgeCorrelation ─────────────────────────────────────────────────

describe("withKnowledgeCorrelation", () => {
  it('devuelve ["knowledge.correlation_id", <id>]', () => {
    const result = withKnowledgeCorrelation("abc");
    expect(result).toEqual(["knowledge.correlation_id", "abc"]);
    expect(result[0]).toBe("knowledge.correlation_id");
    expect(result[1]).toBe("abc");
  });

  it("es readonly (tuple inmutable)", () => {
    const result = withKnowledgeCorrelation("xyz-789");
    // El tipo es readonly [string, string]; verificamos longitud y valores
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(KNOWLEDGE_CORRELATION_GUC);
    expect(result[1]).toBe("xyz-789");
  });
});

// ─── KNOWLEDGE_METRICS ────────────────────────────────────────────────────────

describe("KNOWLEDGE_METRICS", () => {
  it("tiene al menos 2 contratos de métricas", () => {
    expect(KNOWLEDGE_METRICS.length).toBeGreaterThanOrEqual(2);
  });

  it("todos los contratos tienen name, kind, labels y unit válidos", () => {
    const validKinds = new Set(["counter", "gauge", "histogram"]);
    for (const m of KNOWLEDGE_METRICS) {
      expect(typeof m.name).toBe("string");
      expect(m.name.length).toBeGreaterThan(0);
      expect(validKinds.has(m.kind)).toBe(true);
      expect(Array.isArray(m.labels)).toBe(true);
      expect(typeof m.unit).toBe("string");
      expect(m.unit.length).toBeGreaterThan(0);
    }
  });

  it("contiene knowledge_events_projected_total como counter", () => {
    const m = KNOWLEDGE_METRICS.find(
      (x) => x.name === "knowledge_events_projected_total"
    );
    expect(m).toBeDefined();
    expect(m?.kind).toBe("counter");
    expect(m?.labels).toContain("source_table");
    expect(m?.labels).toContain("status");
    expect(m?.unit).toBe("events");
  });

  it("contiene knowledge_backfill_duration_ms como histogram", () => {
    const m = KNOWLEDGE_METRICS.find(
      (x) => x.name === "knowledge_backfill_duration_ms"
    );
    expect(m).toBeDefined();
    expect(m?.kind).toBe("histogram");
    expect(m?.labels).toContain("source_table");
    expect(m?.unit).toBe("ms");
  });
});
