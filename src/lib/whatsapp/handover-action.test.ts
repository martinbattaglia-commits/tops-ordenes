import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  kind: "whatsapp",
  allowed: true,
  rpc: vi.fn(async () => ({ data: null, error: null })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rbac/nexus-link", () => ({
  canChannel: vi.fn(async () => H.allowed),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "operator" } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { kind: H.kind }, error: null }),
        }),
      }),
    }),
    rpc: H.rpc,
  }),
}));

const { setHandoverStateAction } = await import("./handover-action");

describe("setHandoverStateAction · control Max por canal", () => {
  beforeEach(() => {
    H.kind = "whatsapp";
    H.allowed = true;
    H.rpc.mockClear();
  });

  it("persiste el estado solicitado para una conversación WhatsApp autorizada", async () => {
    const result = await setHandoverStateAction({
      conversationId: "wa-1",
      state: "PAUSED_HUMAN",
    });
    expect(result).toEqual({ ok: true });
    expect(H.rpc).toHaveBeenCalledWith("connect_set_handover_state", {
      p_conversation_id: "wa-1",
      p_state: "PAUSED_HUMAN",
    });
  });

  it("falla cerrado fuera del canal WhatsApp", async () => {
    H.kind = "dm";
    const result = await setHandoverStateAction({
      conversationId: "dm-1",
      state: "PAUSED_HUMAN",
    });
    expect(result.ok).toBe(false);
    expect(H.rpc).not.toHaveBeenCalled();
  });

  it("no muta si falta la capacidad exacta de envío WhatsApp", async () => {
    H.allowed = false;
    const result = await setHandoverStateAction({
      conversationId: "wa-1",
      state: "BOT_ACTIVE",
    });
    expect(result.ok).toBe(false);
    expect(H.rpc).not.toHaveBeenCalled();
  });
});
