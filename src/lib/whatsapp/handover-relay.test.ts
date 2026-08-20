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

  it("omite la llamada a Make si is_bot_active es false", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const fakeAdmin = {
      rpc: vi.fn(),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "connect_conversations") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{ id: "c-2", is_bot_active: false, handover_state: "BOT_ACTIVE" }],
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
      id: 2,
      relayKey: "test-key-2",
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

  it("omite la llamada a Make y activa PAUSED_HUMAN si el último mensaje saliente fue de un operador humano", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [] }) });

    const fakeAdmin = {
      rpc: vi.fn(),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "connect_conversations") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{ id: "c-3", handover_state: "BOT_ACTIVE", is_bot_active: true }],
                }),
              }),
            }),
            update: updateSpy,
          };
        }
        if (table === "connect_messages") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: "m-1",
                        author_profile_id: "user-operator-1",
                        meta: { direction: "outbound", author: "Martín" },
                        created_at: new Date().toISOString(),
                      },
                    ],
                  }),
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
      id: 3,
      relayKey: "test-key-3",
      rawBody: JSON.stringify({
        entry: [{ changes: [{ value: { messages: [{ from: "5491112345678" }] } }] }],
      }),
      signatureHeader: "sha256=fake",
      attempts: 0,
    };

    const outcome = await ports.deliver(row);

    expect(outcome.ok).toBe(true);
    expect(outcome.state).toBe("delivered");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Relay omitido: último mensaje saliente de operador humano"));
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ handover_state: "PAUSED_HUMAN" }));

    consoleSpy.mockRestore();
  });
});
