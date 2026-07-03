import { describe, expect, it } from "vitest";
import { emailFailureNotification } from "./email-failure";

// F4.4-E3 — el aviso de email fallido: dispara con datos mínimos, sin PII.

const ORDER_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";

describe("emailFailureNotification", () => {
  it("arma un broadcast a admin enlazado a la orden", () => {
    const row = emailFailureNotification({
      orderId: ORDER_ID,
      publicId: "OS-2026-0101",
      tag: "cliente",
      providerError: "validation_error: You can only send testing emails",
    });
    expect(row.role_target).toBe("admin");
    expect(row.entity).toBe("orders");
    expect(row.entity_id).toBe(ORDER_ID);
    expect(row.title).toContain("FALLÓ");
    expect(row.message).toContain("OS-2026-0101");
    expect(row.message).toContain("'cliente'");
    expect(row.message).toContain("validation_error");
  });

  it("NO incluye direcciones de email en el mensaje (PII)", () => {
    const row = emailFailureNotification({
      orderId: ORDER_ID,
      publicId: "OS-2026-0102",
      tag: "depot",
      providerError: "boom",
    });
    expect(row.message).not.toMatch(/@/);
    expect(row.title).not.toMatch(/@/);
  });

  it("recorta errores largos del proveedor", () => {
    const row = emailFailureNotification({
      orderId: ORDER_ID,
      publicId: null,
      tag: "director",
      providerError: "x".repeat(500),
    });
    expect(row.message.length).toBeLessThan(320);
    expect(row.message).toContain("…");
    // Sin public_id cae al uuid (el link de la campana sigue funcionando).
    expect(row.message).toContain(ORDER_ID);
  });

  it("tolera providerError ausente", () => {
    const row = emailFailureNotification({ orderId: ORDER_ID, publicId: "OS-1", tag: "facturacion" });
    expect(row.message).toContain("Revisar configuración Resend");
  });
});
