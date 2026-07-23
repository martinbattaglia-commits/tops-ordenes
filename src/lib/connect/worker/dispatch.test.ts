import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { app: { demoMode: false, needsSupabase: false } } }));

import { dispatchConnectOutbox, governanceProcessor, type OutboxRow } from "./dispatch";
import { createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

type EnvApp = { demoMode: boolean; needsSupabase: boolean };
function setDemo(v: boolean) {
  (env.app as EnvApp).demoMode = v;
}

const ROW: OutboxRow = {
  seq: 1,
  topic: "connect.message.posted",
  payload: { conversation_id: "c1", message_id: "m1" },
  status: "processing",
  retry_count: 0,
  created_at: "2026-07-01T00:00:00.000Z",
};

/** Mock del cliente service_role: rpc despacha por nombre; from().select().in().lte() resuelve count. */
function makeSupabase(opts: {
  claims: unknown[][];
  markFailedStatus?: string;
  dueCount?: number;
  pruned?: number;
}) {
  let claimIdx = 0;
  const calls: Record<string, number> = {};
  const rpc = vi.fn(async (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
    if (name === "connect_claim_batch") {
      const batch = opts.claims[claimIdx] ?? [];
      claimIdx++;
      return { data: batch, error: null };
    }
    if (name === "connect_mark_failed") return { data: opts.markFailedStatus ?? "failed", error: null };
    if (name === "connect_prune_outbox") return { data: opts.pruned ?? 0, error: null };
    if (name === "connect_record_worker_run") return { data: "run-1", error: null };
    return { data: null, error: null };
  });
  const query = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    lte: vi.fn().mockResolvedValue({ count: opts.dueCount ?? 0, error: null }),
  };
  const client = { rpc, from: vi.fn().mockReturnValue(query) };
  vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);
  return { client, rpc, query, calls: () => calls };
}

beforeEach(() => {
  setDemo(false);
  vi.clearAllMocks();
});

describe("dispatchConnectOutbox — guards", () => {
  it("demo mode → no-op limpio (no toca supabase)", async () => {
    setDemo(true);
    const s = await dispatchConnectOutbox();
    expect(s.status).toBe("ok");
    expect(s.claimed).toBe(0);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("sin service_role client → no-op limpio", async () => {
    vi.mocked(createAdminClient).mockReturnValue(null as unknown as ReturnType<typeof createAdminClient>);
    const s = await dispatchConnectOutbox();
    expect(s.status).toBe("ok");
    expect(s.claimed).toBe(0);
  });
});

describe("dispatchConnectOutbox — dry-run (D-F41-3)", () => {
  it("dry=1 cuenta due sin reclamar ni procesar ni prunear (y persiste telemetría dry)", async () => {
    const m = makeSupabase({ claims: [[ROW]], dueCount: 42 });
    const s = await dispatchConnectOutbox({ dry: true });
    expect(s.dry).toBe(true);
    expect(s.pendingRemaining).toBe(42);
    expect(s.claimed).toBe(0);
    expect(m.calls()["connect_claim_batch"]).toBeUndefined();
    expect(m.calls()["connect_prune_outbox"]).toBeUndefined();
    // Revisión adversarial: la corrida dry también queda registrada (evidencia D-F41-3 "antes").
    expect(m.calls()["connect_record_worker_run"]).toBe(1);
  });
});

describe("dispatchConnectOutbox — drenaje de backlog sin efectos (D-F41-3/8)", () => {
  it("procesa el backlog como processed+skipped (sin notificaciones históricas)", async () => {
    const rows = [ROW, { ...ROW, seq: 2 }, { ...ROW, seq: 3, topic: "topic.desconocido" }];
    const m = makeSupabase({ claims: [rows, []] });
    const s = await dispatchConnectOutbox();
    expect(s.claimed).toBe(3);
    expect(s.processed).toBe(3);
    expect(s.skipped).toBe(3); // TODO el drenado F4.1 es de gobierno: cero efectos
    expect(s.failedRetried).toBe(0);
    expect(m.calls()["connect_mark_processed"]).toBe(3);
    expect(m.calls()["connect_recover_stuck"]).toBe(1);
  });

  it("registra telemetría (connect_record_worker_run) al cierre", async () => {
    const m = makeSupabase({ claims: [[ROW], []] });
    await dispatchConnectOutbox();
    expect(m.calls()["connect_record_worker_run"]).toBe(1);
    const call = (m.rpc.mock.calls as unknown as [string, Record<string, unknown>?][]).find(
      (c) => c[0] === "connect_record_worker_run",
    );
    const args = (call?.[1] ?? {}) as Record<string, unknown>;
    expect(args.p_claimed).toBe(1);
    expect(args.p_skipped).toBe(1);
    expect(args.p_dry).toBe(false);
  });
});

describe("dispatchConnectOutbox — reintentos e idempotencia", () => {
  it("procesador que falla → mark_failed (retry) y contabiliza", async () => {
    const m = makeSupabase({ claims: [[ROW], []], markFailedStatus: "failed" });
    const s = await dispatchConnectOutbox({}, async () => ({ ok: false, error: "boom" }));
    expect(s.failedRetried).toBe(1);
    expect(s.failedDead).toBe(0);
    expect(s.retries).toBe(1);
    expect(m.calls()["connect_mark_failed"]).toBe(1);
  });

  it("mark_failed devuelve dead → contabiliza dead-letter", async () => {
    makeSupabase({ claims: [[ROW], []], markFailedStatus: "dead" });
    const s = await dispatchConnectOutbox({}, async () => ({ ok: false, error: "boom" }));
    expect(s.failedDead).toBe(1);
    expect(s.failedRetried).toBe(0);
  });

  it("excepción del procesador NO tumba la corrida (se convierte en failed)", async () => {
    makeSupabase({ claims: [[ROW], []] });
    const s = await dispatchConnectOutbox({}, async () => {
      throw new Error("kaput");
    });
    expect(s.status).toBe("ok");
    expect(s.failedRetried).toBe(1);
  });

  it("re-corrida sin due → 0 claimed (idempotente a nivel corrida)", async () => {
    makeSupabase({ claims: [[]] });
    const s = await dispatchConnectOutbox();
    expect(s.claimed).toBe(0);
    expect(s.batches).toBe(0);
    expect(s.status).toBe("ok");
  });
});

describe("dispatchConnectOutbox — batching y retención", () => {
  it("respeta maxBatches (corta aunque haya más filas)", async () => {
    const m = makeSupabase({ claims: [[ROW], [{ ...ROW, seq: 2 }], [{ ...ROW, seq: 3 }]] });
    const s = await dispatchConnectOutbox({ maxBatches: 2 });
    expect(s.batches).toBe(2);
    expect(s.claimed).toBe(2);
    expect(m.calls()["connect_claim_batch"]).toBe(2);
  });

  it("prune (D-F41-7) corre en corridas reales y reporta conteo", async () => {
    const m = makeSupabase({ claims: [[]], pruned: 7 });
    const s = await dispatchConnectOutbox();
    expect(m.calls()["connect_prune_outbox"]).toBe(1);
    expect(s.pruned).toBe(7);
  });

  it("governanceProcessor es skipped=true (contrato D-F41-3)", async () => {
    const r = await governanceProcessor(ROW);
    expect(r).toEqual({ ok: true, skipped: true });
  });
});
