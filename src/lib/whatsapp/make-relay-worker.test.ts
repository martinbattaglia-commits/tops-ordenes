import { describe, expect, it, vi } from "vitest";
import {
  consumeMakeRelayBatch,
  type ClaimedMakeRelay,
  type MakeRelayWorkerPorts,
} from "./make-relay-worker";

const row: ClaimedMakeRelay = {
  id: 7,
  relayKey: "a".repeat(64),
  rawBody: "{\"synthetic\":true}",
  signatureHeader: "sha256=synthetic",
  attempts: 1,
};

function ports(over: Partial<MakeRelayWorkerPorts> = {}): MakeRelayWorkerPorts {
  return {
    newToken: () => "00000000-0000-4000-8000-000000000001",
    claim: async () => [row],
    deliver: async () => ({ ok: true, state: "delivered" }),
    release: async (_id, _token, outcome) => outcome === "delivered" ? "delivered" : "requeued",
    ...over,
  };
}

describe("Make relay outbox · recuperación durable", () => {
  it("2xx acredita y cierra la fila reclamada", async () => {
    const release = vi.fn(async () => "delivered" as const);
    const result = await consumeMakeRelayBatch(ports({ release }));
    expect(result).toMatchObject({ claimed: 1, delivered: 1, requeued: 0, dead: 0 });
    expect(release).toHaveBeenCalledWith(row.id, expect.any(String), "delivered", null);
  });

  it.each(["timeout", "network", "upstream_rejected", "misconfigured"] as const)(
    "%s conserva el evento para reintento interno",
    async (state) => {
      const release = vi.fn(async () => "requeued" as const);
      const result = await consumeMakeRelayBatch(ports({
        deliver: async () => ({ ok: false, state }),
        release,
      }));
      expect(result.requeued).toBe(1);
      expect(release).toHaveBeenCalledWith(row.id, expect.any(String), "retryable", state);
    },
  );

  it("el dead-letter queda visible y no se declara entregado", async () => {
    const result = await consumeMakeRelayBatch(ports({
      deliver: async () => ({ ok: false, state: "network" }),
      release: async () => "dead",
    }));
    expect(result).toMatchObject({ delivered: 0, dead: 1 });
  });

  it("el kick reclama sólo la identidad solicitada", async () => {
    const claim = vi.fn(async () => [row]);
    await consumeMakeRelayBatch(ports({ claim }), { limit: 25, relayKey: row.relayKey });
    expect(claim).toHaveBeenCalledWith(expect.any(String), 1, row.relayKey);
  });

  it("fallos de claim/release no exponen payload ni firma", async () => {
    const claimFail = await consumeMakeRelayBatch(ports({ claim: async () => { throw new Error(row.rawBody); } }));
    expect(claimFail.errors).toEqual(["claim_failed"]);
    const releaseFail = await consumeMakeRelayBatch(ports({ release: async () => { throw new Error(row.signatureHeader!); } }));
    expect(releaseFail.errors).toEqual(["release_failed"]);
    expect(JSON.stringify({ claimFail, releaseFail })).not.toContain(row.rawBody);
    expect(JSON.stringify({ claimFail, releaseFail })).not.toContain(row.signatureHeader);
  });
});
