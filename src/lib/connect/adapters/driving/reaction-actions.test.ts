import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { addReactionAction, removeReactionAction } from "./reaction-actions";
import * as serverSupabase from "@/lib/supabase/server";

describe("reaction-actions · addReactionAction y removeReactionAction", () => {
  const MSG_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
  const CONV_ID = "22222222-3333-4444-8555-666666666666";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rechaza emojis no autorizados en el servidor", async () => {
    const res = await addReactionAction({
      conversationId: CONV_ID,
      messageId: MSG_ID,
      emoji: "🚀", // No autorizado
    });
    expect(res).toEqual({ ok: false, message: "Emoji o parámetros de reacción no autorizados." });
  });

  it("admite emojis autorizados (👍 ❤️ 😂 😮 😢 🙏)", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-1" } }, error: null }) },
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await addReactionAction({
      conversationId: CONV_ID,
      messageId: MSG_ID,
      emoji: "👍",
    });

    expect(res).toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith("connect_react", {
      p_message_id: MSG_ID,
      p_emoji: "👍",
    });
  });

  it("rechaza parámetros si messageId no es UUID válido", async () => {
    const res = await addReactionAction({
      conversationId: CONV_ID,
      messageId: "not-a-uuid",
      emoji: "👍",
    });
    expect(res).toEqual({ ok: false, message: "Emoji o parámetros de reacción no autorizados." });
  });

  it("removeReactionAction remueve la reacción autorizada", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-1" } }, error: null }) },
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await removeReactionAction({
      conversationId: CONV_ID,
      messageId: MSG_ID,
      emoji: "❤️",
    });

    expect(res).toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith("connect_unreact", {
      p_message_id: MSG_ID,
      p_emoji: "❤️",
    });
  });

  it("sanitiza mensajes de error de base de datos", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: { message: "permission denied for function connect_react" } });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u-1" } }, error: null }) },
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await addReactionAction({
      conversationId: CONV_ID,
      messageId: MSG_ID,
      emoji: "😂",
    });

    expect(res).toEqual({ ok: false, message: "Sin permiso para reaccionar en esta conversación." });
  });
});
