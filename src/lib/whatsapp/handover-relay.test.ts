import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createSupabaseMakeRelayPorts } from "./make-relay-worker.supabase";

describe("Handover Relay Blocking Unit Test", () => {
  it("omite la llamada a Make y retorna delivered si handover_state es PAUSED_HUMAN", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const fakeAdmin = {
      rpc: vi.fn(),
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { handover_state: "PAUSED_HUMAN" },
              }),
            }),
          }),
        }),
      }),
    };

    const ports = createSupabaseMakeRelayPorts(fakeAdmin as any);
    const row = {
      id: 1,
      relayKey: "test-key-1",
      rawBody: JSON.stringify({
        entry: [{ changes: [{ value: { messages: [{ from: "5491112345678" }] } }] }],
      }),
      signatureHeader: "sha256=fake",
      attempts: 0,
    };

    const outcome = await ports.deliver(row);

    expect(outcome.ok).toBe(true);
    expect(outcome.state).toBe("delivered");
    expect(consoleSpy).toHaveBeenCalledWith("[whatsapp] Relay omitido por Handover activo");

    consoleSpy.mockRestore();
  });
});
