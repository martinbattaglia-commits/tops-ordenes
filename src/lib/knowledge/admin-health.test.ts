import { describe, it, expect } from "vitest";
import { computeHealth, isWorkerStale, DEFAULT_WORKER_STALE_SECONDS } from "./admin-health";
import type { HealthSignals } from "./admin-types";

const NOW = Date.parse("2026-06-29T12:00:00Z");

function signals(over: Partial<HealthSignals> = {}): HealthSignals {
  return {
    totalEvents: 233,
    deadCount: 0,
    stuckCount: 0,
    processingCount: 0,
    dueNow: 0,
    oldestPendingAgeSeconds: null,
    lastRunAt: null,
    lastNonDryRunAt: null,
    ...over,
  };
}

describe("isWorkerStale", () => {
  it("nunca corrió (null) ⇒ atrasado", () => {
    expect(isWorkerStale(null, DEFAULT_WORKER_STALE_SECONDS, NOW)).toBe(true);
  });
  it("corrida reciente ⇒ no atrasado", () => {
    const recent = new Date(NOW - 60_000).toISOString(); // 1 min
    expect(isWorkerStale(recent, DEFAULT_WORKER_STALE_SECONDS, NOW)).toBe(false);
  });
  it("corrida vieja ⇒ atrasado", () => {
    const old = new Date(NOW - 30 * 60_000).toISOString(); // 30 min
    expect(isWorkerStale(old, DEFAULT_WORKER_STALE_SECONDS, NOW)).toBe(true);
  });
  it("fecha inválida ⇒ atrasado (fail-safe)", () => {
    expect(isWorkerStale("no-es-fecha", DEFAULT_WORKER_STALE_SECONDS, NOW)).toBe(true);
  });
});

describe("computeHealth", () => {
  it("sano: cola drenada + worker reciente", () => {
    const a = computeHealth(signals({ lastNonDryRunAt: new Date(NOW - 60_000).toISOString() }), { nowMs: NOW });
    expect(a.status).toBe("healthy");
    expect(a.score).toBe(100);
    expect(a.reasons[0]).toMatch(/drenada/i);
  });

  it("sano: worker nunca corrió pero NO hay backlog (caso prod E2.2)", () => {
    // dueNow=0 ⇒ que el worker no haya corrido no degrada la salud.
    const a = computeHealth(signals({ lastNonDryRunAt: null, dueNow: 0 }), { nowMs: NOW });
    expect(a.status).toBe("healthy");
    expect(a.score).toBe(100);
  });

  it("crítico: hay dead-letter", () => {
    const a = computeHealth(signals({ deadCount: 2 }), { nowMs: NOW });
    expect(a.status).toBe("critical");
    expect(a.score).toBe(60);
    expect(a.reasons.join(" ")).toMatch(/dead-letter/i);
  });

  it("degradado: eventos atascados, sin dead", () => {
    const a = computeHealth(signals({ stuckCount: 3 }), { nowMs: NOW });
    expect(a.status).toBe("degraded");
    expect(a.score).toBe(80);
    expect(a.reasons.join(" ")).toMatch(/atascad/i);
  });

  it("crítico: backlog due + worker atrasado", () => {
    const a = computeHealth(signals({ dueNow: 5, lastNonDryRunAt: null }), { nowMs: NOW });
    expect(a.status).toBe("critical");
    expect(a.score).toBe(70);
    expect(a.reasons.join(" ")).toMatch(/sin drenar/i);
  });

  it("degradado: backlog due pero worker activo", () => {
    const recent = new Date(NOW - 60_000).toISOString();
    const a = computeHealth(signals({ dueNow: 5, lastNonDryRunAt: recent }), { nowMs: NOW });
    expect(a.status).toBe("degraded");
    expect(a.score).toBe(85);
  });

  it("score nunca baja de 0 ni el estado se desescala", () => {
    const a = computeHealth(
      signals({ deadCount: 10, stuckCount: 10, dueNow: 10, lastNonDryRunAt: null }),
      { nowMs: NOW },
    );
    expect(a.status).toBe("critical");
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThanOrEqual(100);
  });
});
