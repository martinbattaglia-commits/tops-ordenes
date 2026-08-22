import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { app: { demoMode: false, needsSupabase: false } },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getMyParticipantId } from "./data";

describe("getMyParticipantId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resuelve server-side al operador miembro aunque todavía no tenga mensajes", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "participant-first-reaction" },
      error: null,
    });
    const eq = vi.fn();
    eq.mockReturnValue({ eq, maybeSingle });
    const select = vi.fn().mockReturnValue({ eq, maybeSingle });
    const from = vi.fn().mockReturnValue({ select });
    vi.mocked(createClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "profile-operator" } },
          error: null,
        }),
      },
      from,
    } as never);

    await expect(getMyParticipantId("conversation-without-own-messages"))
      .resolves.toBe("participant-first-reaction");
    expect(from).toHaveBeenCalledWith("connect_participants");
    expect(select).toHaveBeenCalledWith("id");
    expect(eq).toHaveBeenNthCalledWith(1, "conversation_id", "conversation-without-own-messages");
    expect(eq).toHaveBeenNthCalledWith(2, "profile_id", "profile-operator");
  });

  it.each([
    ["usuario ausente", { data: { user: null }, error: null }, null],
    ["error de auth", { data: { user: null }, error: { message: "auth" } }, null],
    ["participante ausente", { data: { user: { id: "profile-operator" } }, error: null }, { data: null, error: null }],
    ["error de consulta", { data: { user: { id: "profile-operator" } }, error: null }, { data: null, error: { message: "query" } }],
  ])("falla cerrado cuando hay %s", async (_label, authResult, queryResult) => {
    const maybeSingle = vi.fn().mockResolvedValue(queryResult);
    const eq = vi.fn();
    eq.mockReturnValue({ eq, maybeSingle });
    vi.mocked(createClient).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue(authResult) },
      from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq, maybeSingle }) }),
    } as never);

    await expect(getMyParticipantId("conversation-1")).resolves.toBeNull();
  });
});
