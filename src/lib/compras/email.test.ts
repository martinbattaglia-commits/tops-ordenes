import { afterEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  app: { url: "https://ordenes.example.test" },
  email: {
    resendKey: "resend-test-key" as string | undefined,
    from: "TOPS <ordenes@example.test>",
  },
}));

vi.mock("@/lib/env", () => ({ env: envMock }));

import { sendPurchaseOrderEmails } from "./email";

const input = {
  public_id: "OC-2026-0001",
  issuedAt: "2026-08-15T12:00:00.000Z",
  emitter: {
    name: "Firmante Canónico",
    email: "firmante@example.test",
    role: "Apoderado de prueba",
  },
  vendor: {
    razon: "Proveedor Canónico",
    cuit: "30-70000001-5",
    email: "proveedor@example.test",
    contacto: "Compras",
  },
  items: [{
    sku: null,
    label: "Producto",
    unit: "un",
    qty: 1,
    price: 100,
    subtotal: 100,
    price_state: "known" as const,
    price_reason: null,
    pos: 0,
  }],
  totals: {
    neto: 100,
    iva: 21,
    total: 121,
    planningNeto: 100,
    planningIva: 21,
    planningTotal: 121,
    state: "known" as const,
    knownPartialNeto: 100,
    pendingLines: 0,
  },
  categoria: "Insumos",
  cond_pago: "30 días",
  entrega: "Inmediata",
  destino: "Agustín Magaldi 1765 · CABA",
  observ: "",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  envMock.email.resendKey = "resend-test-key";
});

describe("email idempotente de OC", () => {
  it("sin configuración no produce egress", async () => {
    envMock.email.resendKey = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendPurchaseOrderEmails(input, "purchase-order/vendor/oc-1"))
      .resolves.toMatchObject({ sent: false, skippedReason: "no_resend_key" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reintenta una falla de red con exactamente la misma Idempotency-Key", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("provider response contained personal data"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "resend-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const key = "purchase-order/vendor/11111111-1111-4111-8111-111111111111";

    await expect(sendPurchaseOrderEmails(input, key)).resolves.toMatchObject({
      sent: true,
      providerId: "resend-1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(([, init]) => String((init as RequestInit).body));
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain("Firmante Canónico");
    expect(bodies[0]).toContain("Apoderado de prueba");
    expect(bodies[0]).not.toContain("/api/compras/");
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).headers).toMatchObject({ "Idempotency-Key": key });
    }
  });

  it("rechaza una respuesta sin ID estable y no expone el body del proveedor", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
    await expect(sendPurchaseOrderEmails(input, "purchase-order/vendor/oc-1"))
      .rejects.toThrow("PO_EMAIL_PROVIDER_RESPONSE_INVALID");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      "recipient proveedor@example.test rejected",
      { status: 422 },
    )));
    await expect(sendPurchaseOrderEmails(input, "purchase-order/vendor/oc-1"))
      .rejects.toThrow("PO_EMAIL_PROVIDER_REJECTED");
  });

  it("rechaza una clave inválida antes de llamar al proveedor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendPurchaseOrderEmails(input, "bad\nkey"))
      .rejects.toThrow("PO_EMAIL_IDEMPOTENCY_KEY_INVALID");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
