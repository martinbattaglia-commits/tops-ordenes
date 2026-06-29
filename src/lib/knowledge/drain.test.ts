import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { app: { demoMode: false, needsSupabase: false } } }));

import { drainKnowledge, noopProcessor, type KnowledgeEventRow } from "./drain";
import { createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

type EnvApp = { demoMode: boolean; needsSupabase: boolean };
function setDemo(v: boolean) {
  (env.app as EnvApp).demoMode = v;
}

const EV: KnowledgeEventRow = {
  id: "e1",
  seq: 1,
  event_type: "x",
  entity_type: "t",
  entity_id: "1",
  summary: null,
  payload: null,
  source_table: "s",
  status: "processing",
  retry_count: 0,
  correlation_id: null,
};

/** Mock del cliente service_role: rpc despacha por nombre de función; from().select().in().lte() resuelve count. */
function makeSupabase(opts: { claims: unknown[][]; markFailedStatus?: string; dueCount?: number }) {
  let claimIdx = 0;
  const calls: Record<string, number> = {};
  const rpc = vi.fn(async (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
    if (name === "knowledge_claim_batch") {
      const batch = opts.claims[claimIdx] ?? [];
      claimIdx++;
      return { data: batch, error: null };
    }
    if (name === "knowledge_mark_failed") return { data: opts.markFailedStatus ?? "failed", error: null };
    if (name === "knowledge_record_worker_run") return { data: "run-1", error: null };
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

describe("drainKnowledge — guards", () => {
  it("no-op en demo mode (no toca el cliente)", async () => {
    setDemo(true);
    const s = await drainKnowledge();
    expect(s.claimed).toBe(0);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("no-op cuando createAdminClient devuelve null", async () => {
    vi.mocked(createAdminClient).mockReturnValue(null as unknown as ReturnType<typeof createAdminClient>);
    const s = await drainKnowledge();
    expect(s.claimed).toBe(0);
  });
});

describe("drainKnowledge — dry", () => {
  it("cuenta los due, no reclama ni procesa", async () => {
    const { rpc } = makeSupabase({ claims: [], dueCount: 7 });
    const s = await drainKnowledge({ dry: true });
    expect(s.dry).toBe(true);
    expect(s.pendingRemaining).toBe(7);
    expect(s.claimed).toBe(0);
    expect(rpc).not.toHaveBeenCalledWith("knowledge_claim_batch", expect.anything());
  });
});

describe("drainKnowledge — ciclo feliz", () => {
  it("reclama un lote, procesa con noop -> processed, frena en vacío, registra la corrida", async () => {
    const { calls } = makeSupabase({ claims: [[EV], []] });
    const s = await drainKnowledge({}, noopProcessor);
    expect(s.claimed).toBe(1);
    expect(s.processed).toBe(1);
    expect(s.batches).toBe(1);
    expect(s.status).toBe("ok");
    expect(calls()["knowledge_recover_stuck"]).toBe(1);
    expect(calls()["knowledge_mark_processed"]).toBe(1);
    expect(calls()["knowledge_record_worker_run"]).toBe(1);
  });
});

describe("drainKnowledge — procesador que falla", () => {
  it("marca failed y cuenta retry", async () => {
    const { calls } = makeSupabase({ claims: [[EV], []], markFailedStatus: "failed" });
    const failing = async () => ({ ok: false, error: "boom" });
    const s = await drainKnowledge({}, failing);
    expect(s.failedRetried).toBe(1);
    expect(s.failedDead).toBe(0);
    expect(s.retries).toBe(1);
    expect(calls()["knowledge_mark_failed"]).toBe(1);
  });

  it("cuenta dead cuando mark_failed devuelve 'dead'", async () => {
    makeSupabase({ claims: [[EV], []], markFailedStatus: "dead" });
    const failing = async () => ({ ok: false, error: "boom" });
    const s = await drainKnowledge({}, failing);
    expect(s.failedDead).toBe(1);
    expect(s.failedRetried).toBe(0);
  });
});
