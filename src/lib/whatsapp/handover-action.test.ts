import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rbac/nexus-link", () => ({ canChannel: vi.fn(async () => true) }));

import { setHandoverStateAction } from "./handover-action";
import * as serverSupabase from "@/lib/supabase/server";

describe("handover-action · setHandoverStateAction", () => {
  const CONV_ID = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rechaza estado desconocido", async () => {
    const res = await setHandoverStateAction({ conversationId: CONV_ID, state: "DESCONOCIDO" as never });
    expect(res).toEqual({ ok: false, message: "Parámetros inválidos." });
  });

  it("devuelve mensaje informativo en modo demo sin supabase", async () => {
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(null as never);
    const res = await setHandoverStateAction({ conversationId: CONV_ID, state: "PAUSED_HUMAN" });
    expect(res.ok).toBe(false);
    expect(res).toEqual({ ok: false, message: "Modo demo: no se persiste." });
  });

  it("rechaza si no hay usuario autenticado", async () => {
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      rpc: vi.fn(),
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await setHandoverStateAction({ conversationId: CONV_ID, state: "PAUSED_HUMAN" });
    expect(res).toEqual({ ok: false, message: "Sesión no autenticada." });
  });

  it("rechaza si la conversación no es de tipo whatsapp", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { kind: "dm" }, error: null }),
      }),
    });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-1" } }, error: null }) },
      from: vi.fn().mockReturnValue({ select: mockSelect }),
      rpc: vi.fn(),
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await setHandoverStateAction({ conversationId: CONV_ID, state: "PAUSED_HUMAN" });
    expect(res).toEqual({ ok: false, message: "La conversación de WhatsApp no pudo validarse." });
  });

  it("invoca RPC connect_set_handover_state con parámetros canónicos y devuelve ok", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { kind: "whatsapp" }, error: null }),
      }),
    });
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-1" } }, error: null }) },
      from: vi.fn().mockReturnValue({ select: mockSelect }),
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await setHandoverStateAction({ conversationId: CONV_ID, state: "PAUSED_HUMAN" });
    expect(res).toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith("connect_set_handover_state", {
      p_conversation_id: CONV_ID,
      p_state: "PAUSED_HUMAN",
    });
  });

  it("permite reactivar a Max con BOT_ACTIVE", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { kind: "whatsapp" }, error: null }),
      }),
    });
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-1" } }, error: null }) },
      from: vi.fn().mockReturnValue({ select: mockSelect }),
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await setHandoverStateAction({ conversationId: CONV_ID, state: "BOT_ACTIVE" });
    expect(res).toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith("connect_set_handover_state", {
      p_conversation_id: CONV_ID,
      p_state: "BOT_ACTIVE",
    });
  });

  it("captura y devuelve error de Supabase sin romper la sesión", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { kind: "whatsapp" }, error: null }),
      }),
    });
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: { message: "permiso denegado" } });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-1" } }, error: null }) },
      from: vi.fn().mockReturnValue({ select: mockSelect }),
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await setHandoverStateAction({ conversationId: CONV_ID, state: "PAUSED_HUMAN" });
    expect(res).toEqual({ ok: false, message: "permiso denegado" });
  });
});
