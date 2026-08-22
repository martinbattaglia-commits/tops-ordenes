import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
  }),
}));

import {
  resetClientRateAction,
  saveClientRateAction,
} from "@/app/(app)/orders/tarifas/actions";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "actor" } }, error: null });
});

describe("tarifas actions", () => {
  const validRateInput = {
    clientId: CLIENT_ID,
    serviceSlug: "almacenamiento:pallet",
    currency: "ARS",
    rate: 100,
    minQty: null,
    minBilling: null,
    validFrom: "2026-08-22",
    reason: "Acuerdo comercial",
  } as const;

  it("sólo confirma el guardado cuando la RPC devuelve un UUID", async () => {
    mocks.rpc.mockResolvedValue({ data: "22222222-2222-4222-8222-222222222222", error: null });
    const result = await saveClientRateAction(validRateInput);
    expect(result.ok).toBe(true);
  });

  it.each([null, {}, true, "ok", "22222222-2222-2222-2222-222222222222"])(
    "rechaza respuesta RPC de guardado malformada: %j",
    async (data) => {
      mocks.rpc.mockResolvedValue({ data, error: null });
      const result = await saveClientRateAction(validRateInput);
      expect(result.ok).toBe(false);
      expect(result.error).toContain("no confirmó");
    },
  );

  it("restablece exclusivamente mediante la RPC canónica y exige true", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const result = await resetClientRateAction(CLIENT_ID, "almacenamiento:pallet");
    expect(result.ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("client_service_rate_reset", {
      p_client_id: CLIENT_ID,
      p_service_slug: "almacenamiento:pallet",
      p_reason: "Restablecimiento solicitado desde Nexus",
    });
  });

  it("rechaza el falso éxito cuando la RPC no modificó ninguna tarifa", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const result = await resetClientRateAction(CLIENT_ID, "almacenamiento:pallet");
    expect(result).toEqual({
      ok: false,
      error: "No había una tarifa personalizada vigente o futura para restablecer.",
    });
  });

  it("no expone detalles internos de PostgreSQL al restablecer", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission denied for table client_service_rates" },
    });
    const result = await resetClientRateAction(CLIENT_ID, "almacenamiento:pallet");
    expect(result.error).not.toContain("client_service_rates");
    expect(result.error).not.toContain("permission denied");
  });

  it("rechaza identidad inválida antes de tocar la base", async () => {
    const result = await resetClientRateAction("no-uuid", "x");
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("no expone detalles internos de PostgreSQL al guardar", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "23514", message: "constraint secret_internal_name violated" },
    });
    const result = await saveClientRateAction(validRateInput);
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain("secret_internal_name");
    expect(result.error).not.toContain("constraint");
  });
});
