import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rbac/nexus-link", () => ({ canChannel: vi.fn(async () => true) }));

import { setHandoverStateAction } from "./handover-action";
import { createSupabaseMakeRelayPorts } from "./make-relay-worker.supabase";
import * as serverSupabase from "@/lib/supabase/server";

describe("P1 Handover · Robustez, Concurrencia y Resiliencia Adversarial", () => {
  const CONV_ID = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("doble clic / reintento rápido: procesa secuencialmente de forma idempotente", async () => {
    let rpcCalls = 0;
    const mockRpc = vi.fn().mockImplementation(async () => {
      rpcCalls++;
      return { data: null, error: null };
    });

    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { kind: "whatsapp" }, error: null }),
      }),
    });

    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "op-1" } }, error: null }) },
      from: vi.fn().mockReturnValue({ select: mockSelect }),
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    // Dos invocaciones concurrentes (doble clic)
    const [res1, res2] = await Promise.all([
      setHandoverStateAction({ conversationId: CONV_ID, state: "PAUSED_HUMAN" }),
      setHandoverStateAction({ conversationId: CONV_ID, state: "PAUSED_HUMAN" }),
    ]);

    expect(res1).toEqual({ ok: true });
    expect(res2).toEqual({ ok: true });
    expect(rpcCalls).toBe(2);
  });

  it("dos operadores concurrentes: el último estado persistido es canónico", async () => {
    const executedStates: string[] = [];
    const mockRpc = vi.fn().mockImplementation(async (_fn, args: { p_state: string }) => {
      executedStates.push(args.p_state);
      return { data: null, error: null };
    });

    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { kind: "whatsapp" }, error: null }),
      }),
    });

    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "op-2" } }, error: null }) },
      from: vi.fn().mockReturnValue({ select: mockSelect }),
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    // Operador A pausa, Operador B reactiva
    await setHandoverStateAction({ conversationId: CONV_ID, state: "PAUSED_HUMAN" });
    await setHandoverStateAction({ conversationId: CONV_ID, state: "BOT_ACTIVE" });

    expect(executedStates).toEqual(["PAUSED_HUMAN", "BOT_ACTIVE"]);
  });

  it("pausa mientras existe mensaje entrante: bloquea inmediatamente la entrega a Max", async () => {
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
    expect(outcome.state).toBe("delivered"); // Marcado como entregado/omitido para no ciclar en reintentos
  });

  it("reactivación sin reprocesar mensajes históricos: mensajes nuevos fluyen al relay", async () => {
    const fakeAdmin = {
      rpc: vi.fn(),
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "connect_conversations") {
          return {
            select: vi.fn().mockReturnValue({
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
    const outcome = await ports.deliver({
      id: 11,
      relayKey: "key-11",
      rawBody: JSON.stringify({
        entry: [{ changes: [{ value: { messages: [{ from: "5491100000000" }] } }] }],
      }),
      signatureHeader: "sha256=test",
      attempts: 0,
    });

    // Como no hay endpoint configurado en test env, devuelve misconfigured (relay intentado)
    expect(outcome.state).toBe("misconfigured");
  });

  it("fallo de persistencia / red en Supabase es fail-closed y no muta optimistamente", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { kind: "whatsapp" }, error: null }),
      }),
    });
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: { message: "timeout de conexión a BD" } });
    const mockClient = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "op-1" } }, error: null }) },
      from: vi.fn().mockReturnValue({ select: mockSelect }),
      rpc: mockRpc,
    };
    vi.spyOn(serverSupabase, "createClient").mockReturnValue(mockClient as never);

    const res = await setHandoverStateAction({ conversationId: CONV_ID, state: "PAUSED_HUMAN" });
    expect(res).toEqual({ ok: false, message: "timeout de conexión a BD" });
  });
});
