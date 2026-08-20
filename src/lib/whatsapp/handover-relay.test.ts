import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createSupabaseMakeRelayPorts,
  getContextIdCandidates,
} from "./make-relay-worker.supabase";

describe("Handover Relay Blocking Unit Tests", () => {
  it("genera los candidatos correctos de context_id para números locales e internacionales", () => {
    const c1 = getContextIdCandidates("5491168239031");
    expect(c1).toContain("wa:5491168239031");
    expect(c1).toContain("wa:+5491168239031");
    expect(c1).toContain("wa:541168239031");
    expect(c1).toContain("wa:+541168239031");

    const c2 = getContextIdCandidates("+14155552671");
    expect(c2).toContain("wa:14155552671");
    expect(c2).toContain("wa:+14155552671");
  });

  it("omite la llamada a Make y retorna delivered si handover_state es PAUSED_HUMAN", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const fakeAdmin = {
      rpc: vi.fn(),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "connect_conversations") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{ id: "c-1", handover_state: "PAUSED_HUMAN" }],
                }),
              }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: [] }),
              }),
            }),
          }),
        };
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
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Relay omitido por Handover activo"));

    consoleSpy.mockRestore();
  });

  it("consulta únicamente columnas existentes del contrato 0260", async () => {
    const selectSpy = vi.fn();

    const fakeAdmin = {
      rpc: vi.fn(),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "connect_conversations") {
          return {
            select: selectSpy.mockReturnValue({
              in: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{ id: "c-2", handover_state: "BOT_ACTIVE" }],
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    const ports = createSupabaseMakeRelayPorts(fakeAdmin as any);
    const row = {
      id: 2,
      relayKey: "test-key-2",
      rawBody: JSON.stringify({
        entry: [{ changes: [{ value: { messages: [{ from: "5491112345678" }] } }] }],
      }),
      signatureHeader: "sha256=fake",
      attempts: 0,
    };

    const outcome = await ports.deliver(row);

    expect(selectSpy).toHaveBeenCalledWith("id, handover_state");
    expect(outcome).toEqual({ ok: false, state: "misconfigured" });
  });

  it("no entrega a Max si no puede acreditar el handover", async () => {
    const fakeAdmin = {
      rpc: vi.fn(),
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "column does not exist" },
            }),
          }),
        }),
      }),
    };
    const ports = createSupabaseMakeRelayPorts(fakeAdmin as any);
    await expect(ports.deliver({
      id: 3,
      relayKey: "test-key-3",
      rawBody: JSON.stringify({
        entry: [{ changes: [{ value: { messages: [{ from: "5491112345678" }] } }] }],
      }),
      signatureHeader: "sha256=fake",
      attempts: 0,
    })).rejects.toThrow("handover_state_unavailable");
  });

  it("reencola y no entrega a Max si la lectura de handover lanza una excepción", async () => {
    const fakeAdmin = {
      rpc: vi.fn(),
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error("network unavailable")),
          }),
        }),
      }),
    };
    const ports = createSupabaseMakeRelayPorts(fakeAdmin as any);
    await expect(ports.deliver({
      id: 4,
      relayKey: "test-key-4",
      rawBody: JSON.stringify({
        entry: [{ changes: [{ value: { messages: [{ from: "5491112345678" }] } }] }],
      }),
      signatureHeader: "sha256=fake",
      attempts: 0,
    })).rejects.toThrow("network unavailable");
  });
});
