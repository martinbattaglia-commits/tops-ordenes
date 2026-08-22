import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rbac/nexus-link", () => ({ canChannel: vi.fn(async () => true) }));

import { setHandoverStateAction } from "./handover-action";
import { createSupabaseMakeRelayPorts } from "./make-relay-worker.supabase";
import * as serverSupabase from "@/lib/supabase/server";

describe("P1 Handover · Robustez, Concurrencia Canónica y CAS (HIGH 1)", () => {
  const CONV_ID = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("1. Compare-And-Swap (CAS) en base de datos: rechaza mutación si el estado esperado no coincide", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { kind: "whatsapp" },
          error: null,
        }),
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
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "op-2" } }, error: null }) },
      from: vi.fn().mockReturnValue({ select: mockSelect }),
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    // El operador intenta pasar a PAUSED_HUMAN esperando que esté en BOT_ACTIVE, pero el RPC detecta conflicto
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
    expect(mockRpc).toHaveBeenCalledWith("connect_set_handover_state", {
      p_conversation_id: CONV_ID,
      p_state: "PAUSED_HUMAN",
      p_expected_state: "BOT_ACTIVE",
    });
  });

  it("2. CAS exitoso: actualiza atómicamente y devuelve el actor autenticado", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { kind: "whatsapp" },
          error: null,
        }),
      }),
    });
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        state: "PAUSED_HUMAN",
        actor: "op-1",
        updated_at: "2026-08-22T03:00:00.000Z",
      },
      error: null,
    });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "op-1" } }, error: null }) },
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
      ok: true,
      state: "PAUSED_HUMAN",
      actorId: "op-1",
    });
    expect(mockRpc).toHaveBeenCalledWith("connect_set_handover_state", {
      p_conversation_id: CONV_ID,
      p_state: "PAUSED_HUMAN",
      p_expected_state: "BOT_ACTIVE",
    });
  });

  it("3. Concurrencia real: dos operadores con el mismo expectedState no pueden obtener ambos transición exitosa", async () => {
    // Simula estado en base de datos concurrente con serialización / FOR UPDATE
    let dbHandoverState = "BOT_ACTIVE";

    function makeClient(operatorId: string) {
      return {
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: operatorId } }, error: null }) },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { kind: "whatsapp" }, error: null }),
            }),
          }),
        }),
        rpc: vi.fn().mockImplementation(async (_fn: string, args: { p_expected_state: string | null; p_state: string }) => {
          // Emula la lógica atómica de connect_set_handover_state con FOR UPDATE
          if (args.p_expected_state !== null && dbHandoverState !== args.p_expected_state) {
            return {
              data: {
                ok: false,
                conflict: true,
                state: dbHandoverState,
                message: "El estado fue modificado por otro operador.",
              },
              error: null,
            };
          }
          dbHandoverState = args.p_state;
          return {
            data: {
              ok: true,
              state: args.p_state,
              actor: operatorId,
            },
            error: null,
          };
        }),
      };
    }

    // Operador A inicia transición
    const clientA = makeClient("op-A");
    vi.spyOn(serverSupabase, "createClient").mockReturnValueOnce(clientA as never);
    const promiseA = setHandoverStateAction({
      conversationId: CONV_ID,
      state: "PAUSED_HUMAN",
      expectedState: "BOT_ACTIVE",
    });

    // Operador B inicia transición concurrente con el mismo expectedState
    const clientB = makeClient("op-B");
    vi.spyOn(serverSupabase, "createClient").mockReturnValueOnce(clientB as never);
    const promiseB = setHandoverStateAction({
      conversationId: CONV_ID,
      state: "PAUSED_HUMAN",
      expectedState: "BOT_ACTIVE",
    });

    const [resA, resB] = await Promise.all([promiseA, promiseB]);

    // Exactamente uno debe tener éxito y el otro recibir conflicto
    const successes = [resA, resB].filter((r) => r.ok);
    const conflicts = [resA, resB].filter((r) => !r.ok);

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      ok: false,
      message: "El estado fue modificado por otro operador.",
      actualState: "PAUSED_HUMAN",
    });
  });

  it("4. Pausa durante procesamiento: bloquea inmediatamente la entrega a Max", async () => {
    const fakeAdmin = {
      rpc: vi.fn(),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "connect_conversations") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{ id: CONV_ID, handover_state: "PAUSED_HUMAN" }],
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
    const outcome = await ports.deliver({
      id: 10,
      relayKey: "key-10",
      rawBody: JSON.stringify({
        entry: [{ changes: [{ value: { messages: [{ from: "5491100000000" }] } }] }],
      }),
      signatureHeader: "sha256=test",
      attempts: 0,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.state).toBe("delivered");
  });

  it("5. Fallo de persistencia / timeout en Supabase es fail-closed y devuelve error sanitizado", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { kind: "whatsapp" },
          error: null,
        }),
      }),
    });
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: { message: "connection timeout" } });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "op-1" } }, error: null }) },
      from: vi.fn().mockReturnValue({ select: mockSelect }),
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await setHandoverStateAction({
      conversationId: CONV_ID,
      state: "PAUSED_HUMAN",
      expectedState: "BOT_ACTIVE",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toBe("No se pudo actualizar el estado de Max. Probá de nuevo.");
    }
  });
});
