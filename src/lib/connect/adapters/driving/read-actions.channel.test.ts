import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  internal: false,
  whatsapp: false,
  kind: "whatsapp",
  rpc: vi.fn(async () => ({ data: null, error: null })),
}));

vi.mock("@/lib/rbac/internal-chat", () => ({
  canReadInternalChat: vi.fn(async () => H.internal),
}));
vi.mock("@/lib/rbac/nexus-link", () => ({
  canReadWhatsapp: vi.fn(async () => H.whatsapp),
}));
vi.mock("@/lib/rbac/boot-permissions", () => ({
  getDepotManagerBoot: vi.fn(async () => ({ restricted: false, authorized: true })),
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

const { markReadAction } = await import("./read-actions");

describe("markReadAction · autorización por canal", () => {
  beforeEach(() => {
    H.internal = false;
    H.whatsapp = false;
    H.kind = "whatsapp";
    H.rpc.mockClear();
  });

  it("permite marcar un WhatsApp aunque no exista permiso de chat interno", async () => {
    H.whatsapp = true;
    const result = await markReadAction({ conversationId: "wa-1", upToSeq: 7 });
    expect(result).toEqual({ ok: true });
    expect(H.rpc).toHaveBeenCalledWith("connect_mark_read", {
      p_conversation_id: "wa-1",
      p_up_to_seq: 7,
    });
  });

  it("permite el chat interno por su capacidad existente", async () => {
    H.internal = true;
    H.kind = "dm";
    expect(await markReadAction({ conversationId: "dm-1", upToSeq: 3 })).toEqual({ ok: true });
  });

  it("no usa el permiso de WhatsApp para marcar un chat interno", async () => {
    H.whatsapp = true;
    H.kind = "dm";
    const result = await markReadAction({ conversationId: "dm-1", upToSeq: 3 });
    expect(result.ok).toBe(false);
    expect(H.rpc).not.toHaveBeenCalled();
  });

  it("falla cerrado si no tiene lectura en ninguno de los dos canales", async () => {
    const result = await markReadAction({ conversationId: "x", upToSeq: 1 });
    expect(result.ok).toBe(false);
    expect(H.rpc).not.toHaveBeenCalled();
  });
});
