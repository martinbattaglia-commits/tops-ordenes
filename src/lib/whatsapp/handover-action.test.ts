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

  function mockRpcData(data: unknown) {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { kind: "whatsapp" }, error: null }),
      }),
    });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-1" } }, error: null }) },
      from: vi.fn().mockReturnValue({ select: mockSelect }),
      rpc: vi.fn().mockResolvedValue({ data, error: null }),
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);
  }

  it("rechaza si falta expectedState (CAS obligatorio)", async () => {
    const res = await setHandoverStateAction({ conversationId: CONV_ID, state: "PAUSED_HUMAN" });
    expect(res).toEqual({ ok: false, message: "Parámetros inválidos." });
  });

  it("rechaza estado desconocido", async () => {
    const res = await setHandoverStateAction({
      conversationId: CONV_ID,
      state: "DESCONOCIDO" as never,
      expectedState: "BOT_ACTIVE",
    });
    expect(res).toEqual({ ok: false, message: "Parámetros inválidos." });
  });

  it("devuelve mensaje informativo en modo demo sin supabase", async () => {
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(null as never);
    const res = await setHandoverStateAction({
      conversationId: CONV_ID,
      state: "PAUSED_HUMAN",
      expectedState: "BOT_ACTIVE",
    });
    expect(res).toEqual({ ok: false, message: "Modo demo: no se persiste." });
  });

  it("rechaza si no hay usuario autenticado", async () => {
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      rpc: vi.fn(),
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await setHandoverStateAction({
      conversationId: CONV_ID,
      state: "PAUSED_HUMAN",
      expectedState: "BOT_ACTIVE",
    });
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

    const res = await setHandoverStateAction({
      conversationId: CONV_ID,
      state: "PAUSED_HUMAN",
      expectedState: "BOT_ACTIVE",
    });
    expect(res).toEqual({ ok: false, message: "La conversación de WhatsApp no pudo validarse." });
  });

  it("invoca RPC connect_set_handover_state con parámetros canónicos y devuelve ok con estado confirmado", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { kind: "whatsapp" }, error: null }),
      }),
    });
    const mockRpc = vi.fn().mockResolvedValue({
      data: { ok: true, state: "PAUSED_HUMAN", actor: "u-1", updated_at: "2026-08-22T06:00:00Z" },
      error: null,
    });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-1" } }, error: null }) },
      from: vi.fn().mockReturnValue({ select: mockSelect }),
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await setHandoverStateAction({
      conversationId: CONV_ID,
      state: "PAUSED_HUMAN",
      expectedState: "BOT_ACTIVE",
    });
    expect(res).toEqual({ ok: true, state: "PAUSED_HUMAN", actorId: "u-1" });
    expect(mockRpc).toHaveBeenCalledWith("connect_set_handover_state", {
      p_conversation_id: CONV_ID,
      p_state: "PAUSED_HUMAN",
      p_expected_state: "BOT_ACTIVE",
    });
  });

  it("permite reactivar a Max con BOT_ACTIVE", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { kind: "whatsapp" }, error: null }),
      }),
    });
    const mockRpc = vi.fn().mockResolvedValue({
      data: { ok: true, state: "BOT_ACTIVE", actor: "u-1", updated_at: "2026-08-22T06:01:00Z" },
      error: null,
    });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-1" } }, error: null }) },
      from: vi.fn().mockReturnValue({ select: mockSelect }),
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await setHandoverStateAction({
      conversationId: CONV_ID,
      state: "BOT_ACTIVE",
      expectedState: "PAUSED_HUMAN",
    });
    expect(res).toEqual({ ok: true, state: "BOT_ACTIVE", actorId: "u-1" });
    expect(mockRpc).toHaveBeenCalledWith("connect_set_handover_state", {
      p_conversation_id: CONV_ID,
      p_state: "BOT_ACTIVE",
      p_expected_state: "PAUSED_HUMAN",
    });
  });

  it("maneja respuesta data=null del RPC sin error como fallo fail-closed", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { kind: "whatsapp" }, error: null }),
      }),
    });
    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-1" } }, error: null }) },
      from: vi.fn().mockReturnValue({ select: mockSelect }),
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await setHandoverStateAction({
      conversationId: CONV_ID,
      state: "PAUSED_HUMAN",
      expectedState: "BOT_ACTIVE",
    });
    expect(res).toEqual({
      ok: false,
      message: "Respuesta inválida del servidor al actualizar handover.",
    });
  });

  it.each([
    ["objeto vacío", {}],
    ["ok ausente", { state: "PAUSED_HUMAN" }],
    ["ok de tipo incorrecto", { ok: "true", state: "PAUSED_HUMAN" }],
    ["ok:true sin state", { ok: true }],
    ["state inválido", { ok: true, state: "HUMAN_ACTIVE" }],
    ["array", [{ ok: true, state: "PAUSED_HUMAN" }]],
    ["primitivo", "ok"],
    ["campo inesperado", { ok: true, state: "PAUSED_HUMAN", unexpected: true }],
  ])("rechaza respuesta RPC malformada: %s", async (_label, rpcData) => {
    mockRpcData(rpcData);

    const res = await setHandoverStateAction({
      conversationId: CONV_ID,
      state: "PAUSED_HUMAN",
      expectedState: "BOT_ACTIVE",
    });

    expect(res).toEqual({
      ok: false,
      message: "Respuesta inválida del servidor al actualizar handover.",
    });
  });

  it("rechaza conflicto CAS malformado y no expone actualState inválido", async () => {
    mockRpcData({ ok: false, conflict: true, state: "INVALID", message: "conflict" });

    const res = await setHandoverStateAction({
      conversationId: CONV_ID,
      state: "PAUSED_HUMAN",
      expectedState: "BOT_ACTIVE",
    });

    expect(res).toEqual({
      ok: false,
      message: "Respuesta inválida del servidor al actualizar handover.",
    });
  });

  it("maneja conflicto de CAS retornado por la base de datos", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { kind: "whatsapp" }, error: null }),
      }),
    });
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        ok: false,
        conflict: true,
        state: "PAUSED_HUMAN",
        message: "El estado fue modificado por otro operador.",
      },
      error: null,
    });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-1" } }, error: null }) },
      from: vi.fn().mockReturnValue({ select: mockSelect }),
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await setHandoverStateAction({
      conversationId: CONV_ID,
      state: "PAUSED_HUMAN",
      expectedState: "BOT_ACTIVE",
    });
    expect(res).toEqual({
      ok: false,
      message: "El estado fue modificado por otro operador.",
      actualState: "PAUSED_HUMAN",
    });
  });

  it("sanitiza errores de base de datos sin romper la sesión", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { kind: "whatsapp" }, error: null }),
      }),
    });
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: { message: "permission denied for rpc connect_set_handover_state" } });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-1" } }, error: null }) },
      from: vi.fn().mockReturnValue({ select: mockSelect }),
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await setHandoverStateAction({
      conversationId: CONV_ID,
      state: "PAUSED_HUMAN",
      expectedState: "BOT_ACTIVE",
    });
    expect(res).toEqual({ ok: false, message: "Sin permiso para conmutar el estado de Max en este canal." });
  });
});
