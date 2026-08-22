import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  addReactionAction,
  removeReactionAction,
} from "./reaction-actions";
import { SUPPORTED_EMOJIS } from "@/lib/connect/domain/reactions";
import * as serverSupabase from "@/lib/supabase/server";

describe("P3 Reacciones · reaction-actions & Database Contract (HIGH 4)", () => {
  const MSG_ID = "22222222-2222-4222-8222-222222222222";
  const CONV_ID = "conv-100";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("1. Acepta los 6 emojis autorizados por diseño (👍 ❤️ 😂 😮 😢 🙏)", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    for (const emoji of SUPPORTED_EMOJIS) {
      const res = await addReactionAction({
        conversationId: CONV_ID,
        messageId: MSG_ID,
        emoji,
      });
      expect(res).toEqual({ ok: true });
      expect(mockRpc).toHaveBeenCalledWith("connect_react", {
        p_message_id: MSG_ID,
        p_emoji: emoji,
      });
    }
  });

  it("2. Rechaza emojis no autorizados (ej: 🚀, 🎉, 💩) fail-closed en servidor", async () => {
    const mockRpc = vi.fn();
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const unauthorized = ["🚀", "🎉", "💩", "custom_emoji", ""];
    for (const emoji of unauthorized) {
      const res = await addReactionAction({
        conversationId: CONV_ID,
        messageId: MSG_ID,
        emoji: emoji as never,
      });
      expect(res).toEqual({ ok: false, message: "Emoji o parámetros de reacción no autorizados." });
    }
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("3. Rechaza si no hay usuario autenticado", async () => {
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      rpc: vi.fn(),
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await addReactionAction({
      conversationId: CONV_ID,
      messageId: MSG_ID,
      emoji: "👍",
    });
    expect(res).toEqual({ ok: false, message: "Sesión no autenticada." });
  });

  it("4. Sanitiza errores de base de datos sin exponer trazas internas", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: { message: "permission denied for function connect_react" } });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await addReactionAction({
      conversationId: CONV_ID,
      messageId: MSG_ID,
      emoji: "👍",
    });
    expect(res).toEqual({ ok: false, message: "Sin permiso para reaccionar en esta conversación." });
  });

  it("5. removeReactionAction remueve la reacción con connect_unreact", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null }) },
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
});
