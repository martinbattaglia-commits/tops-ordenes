import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  rpc: vi.fn(),
  configured: true,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => harness.configured ? { rpc: harness.rpc } : null,
}));

import { markReadInBrowser } from "./client-mark-read";

describe("markReadInBrowser", () => {
  beforeEach(() => {
    harness.configured = true;
    harness.rpc.mockReset();
    harness.rpc.mockResolvedValue({ error: null });
  });

  it("envía el cursor exacto por la sesión autenticada del navegador", async () => {
    await expect(markReadInBrowser("conversation-1", 17)).resolves.toEqual({ ok: true });
    expect(harness.rpc).toHaveBeenCalledTimes(1);
    expect(harness.rpc).toHaveBeenCalledWith("connect_mark_read", {
      p_conversation_id: "conversation-1",
      p_up_to_seq: 17,
    });
  });

  it("no declara éxito cuando PostgREST rechaza la escritura", async () => {
    harness.rpc.mockResolvedValue({ error: { message: "permission denied" } });
    await expect(markReadInBrowser("conversation-1", 17)).resolves.toEqual({
      ok: false,
      message: "No se pudo actualizar la lectura.",
    });
  });

  it("convierte una falla de red en resultado reintentable", async () => {
    harness.rpc.mockRejectedValue(new Error("network unavailable"));
    await expect(markReadInBrowser("conversation-1", 17)).resolves.toEqual({
      ok: false,
      message: "No se pudo actualizar la lectura.",
    });
  });

  it.each([
    ["", 1],
    ["conversation-1", -1],
    ["conversation-1", Number.MAX_SAFE_INTEGER + 1],
  ])("rechaza entradas inválidas sin tocar la red", async (conversationId, seq) => {
    await expect(markReadInBrowser(conversationId, seq)).resolves.toEqual({
      ok: false,
      message: "Datos de lectura inválidos.",
    });
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("conserva el no-op del entorno demo", async () => {
    harness.configured = false;
    await expect(markReadInBrowser("conversation-1", 1)).resolves.toEqual({ ok: true });
    expect(harness.rpc).not.toHaveBeenCalled();
  });
});
