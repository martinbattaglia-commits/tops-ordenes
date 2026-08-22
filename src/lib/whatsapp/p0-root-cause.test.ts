import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rbac/nexus-link", () => ({ canChannel: vi.fn(async () => true) }));

import {
  createSupabaseMakeRelayPorts,
  getContextIdCandidates,
} from "./make-relay-worker.supabase";
import { shouldSilenceMaxBot } from "./handover";
import { setHandoverStateAction } from "./handover-action";
import * as serverSupabase from "@/lib/supabase/server";

describe("P0 Causa Raíz · Demostración y Recuperación de Max Bot en WhatsApp Comercial", () => {
  const CONV_ID = "33333333-3333-4333-8333-333333333333";
  const RAW_PHONE_AR_WITH_9 = "5491168239031";
  const RAW_PHONE_AR_WITHOUT_9 = "541168239031";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("1. Normalización de context_id: resuelve formatos internacionales y variantes argentinas (+54 9)", () => {
    const c9 = getContextIdCandidates(RAW_PHONE_AR_WITH_9);
    expect(c9).toContain("wa:5491168239031");
    expect(c9).toContain("wa:+5491168239031");
    expect(c9).toContain("wa:541168239031");
    expect(c9).toContain("541168239031");

    const cSin9 = getContextIdCandidates(RAW_PHONE_AR_WITHOUT_9);
    expect(cSin9).toContain("wa:5491168239031");
    expect(cSin9).toContain("wa:541168239031");
  });

  it("2. Consulta SQL alineada con contrato 0260 (sin columnas inexistentes como is_bot_active)", async () => {
    const selectSpy = vi.fn();
    const fakeAdmin = {
      rpc: vi.fn(),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "connect_conversations") {
          return {
            select: selectSpy.mockReturnValue({
              in: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{ id: CONV_ID, handover_state: "BOT_ACTIVE" }],
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
    await ports.deliver({
      id: 1,
      relayKey: "key-1",
      rawBody: JSON.stringify({
        entry: [{ changes: [{ value: { messages: [{ from: RAW_PHONE_AR_WITH_9 }] } }] }],
      }),
      signatureHeader: "sha256=mock",
      attempts: 0,
    });

    expect(selectSpy).toHaveBeenCalledWith("id, handover_state");
  });

  it("3. Transición controlada: BOT_ACTIVE permite el relay a Make, PAUSED_HUMAN lo silencia de forma segura", () => {
    expect(shouldSilenceMaxBot("BOT_ACTIVE")).toBe(false);
    expect(shouldSilenceMaxBot(null)).toBe(false);
    expect(shouldSilenceMaxBot(undefined)).toBe(false);
    expect(shouldSilenceMaxBot("PAUSED_HUMAN")).toBe(true);
  });

  it("4. Reactivación operativa de Max por el operador humano", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { kind: "whatsapp" }, error: null }),
      }),
    });
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "op-1" } }, error: null }) },
      from: vi.fn().mockReturnValue({ select: mockSelect }),
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const result = await setHandoverStateAction({
      conversationId: CONV_ID,
      state: "BOT_ACTIVE",
    });

    expect(result).toEqual({ ok: true, state: "BOT_ACTIVE" });
    expect(mockRpc).toHaveBeenCalledWith("connect_set_handover_state", {
      p_conversation_id: CONV_ID,
      p_state: "BOT_ACTIVE",
    });
  });
});
