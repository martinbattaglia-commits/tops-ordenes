import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { orderEmailPlan } from "./order-email";
import {
  ORDER_RECIPIENT_SAFE_ERROR,
  resolveCanonicalOrderRecipient,
} from "./order-recipient-boundary";
import type { Order } from "./types";

const CANONICAL_EMAIL = "Canonical.Client@Example.com";
const FORGED_EMAIL = "attacker@example.net";
const INTERNAL_DB_ERROR = "duplicate host db-private.internal:6543";

const order = {
  public_id: "OS-FASE-A-001",
  depot: "MAGALDI",
  client: { razon: "Cliente Canónico SA" },
} as Order;

const addresses = {
  depotMagaldi: "deposito-magaldi@example.test",
  depotLujan: "deposito-lujan@example.test",
  director: "director@example.test",
  facturacion: "facturacion@example.test",
};

function expectSafeFailure(result: ReturnType<typeof resolveCanonicalOrderRecipient>) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Se esperaba un rechazo fail-closed");
  expect(result.error).toBe(ORDER_RECIPIENT_SAFE_ERROR);
  expect(result.error).not.toContain(FORGED_EMAIL);
  expect(result.error).not.toContain(CANONICAL_EMAIL);
  expect(result.error).not.toContain(INTERNAL_DB_ERROR);
}

describe("PR66 · frontera canónica del destinatario de la orden", () => {
  it("ignora el email falsificado del navegador y planifica sólo el email canónico exacto", () => {
    const browserPayload = {
      client: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        razon: "Nombre manipulado",
        email: FORGED_EMAIL,
      },
    };
    const canonicalRow = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      razon: "Cliente Canónico SA",
      email: CANONICAL_EMAIL,
    };

    const resolved = resolveCanonicalOrderRecipient(canonicalRow, null);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error(resolved.error);

    const clientItem = orderEmailPlan(order, resolved.email, addresses).find(
      (item) => item.role === "cliente",
    );
    expect(clientItem?.to).toBe(CANONICAL_EMAIL);
    expect(clientItem?.to).not.toBe(browserPayload.client.email);
    expect(resolved.email).toBe(canonicalRow.email);
  });

  it.each([
    ["email ausente", { email: null }, null, "CLIENT_EMAIL_MISSING"],
    ["email vacío", { email: "" }, null, "CLIENT_EMAIL_MISSING"],
    ["email en blanco", { email: "   " }, null, "CLIENT_EMAIL_INVALID"],
    ["cliente inexistente", null, null, "CLIENT_CONTACT_NOT_FOUND"],
    [
      "error de lectura DB",
      { email: CANONICAL_EMAIL },
      new Error(INTERNAL_DB_ERROR),
      "CLIENT_CONTACT_LOOKUP_FAILED",
    ],
    ["email sin formato", { email: "no-es-email" }, null, "CLIENT_EMAIL_INVALID"],
    [
      "lista de destinatarios",
      { email: `${CANONICAL_EMAIL},${FORGED_EMAIL}` },
      null,
      "CLIENT_EMAIL_INVALID",
    ],
    [
      "inyección CRLF",
      { email: `${CANONICAL_EMAIL}\r\nBcc: ${FORGED_EMAIL}` },
      null,
      "CLIENT_EMAIL_INVALID",
    ],
  ])("%s falla cerrado sin exponer direcciones ni detalles internos", (_case, row, error, code) => {
    const result = resolveCanonicalOrderRecipient(row, error);
    expectSafeFailure(result);
    if (!result.ok) expect(result.code).toBe(code);
  });

  it("rechaza incluso una fila parcial cuando la lectura devuelve error", () => {
    const result = resolveCanonicalOrderRecipient(
      { email: CANONICAL_EMAIL },
      new Error(INTERNAL_DB_ERROR),
    );
    expectSafeFailure(result);
    if (!result.ok) expect(result.code).toBe("CLIENT_CONTACT_LOOKUP_FAILED");
  });

  it("la acción valida antes de emitir y nunca deriva el plan desde data.client.email", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/(app)/orders/new/actions.ts"),
      "utf8",
    );
    const validationAt = source.indexOf("resolveCanonicalOrderRecipient(");
    const issueAt = source.indexOf('supabase.rpc("service_order_issue"');
    const planAt = source.indexOf(
      "orderEmailPlan(orderForEmail, canonicalClientEmail,",
    );

    expect(validationAt).toBeGreaterThan(-1);
    expect(issueAt).toBeGreaterThan(validationAt);
    expect(planAt).toBeGreaterThan(issueAt);
    expect(source).not.toMatch(
      /orderEmailPlan\s*\(\s*orderForEmail\s*,\s*data\.client\.email/,
    );
    expect(source).not.toMatch(/clientFicha\s*\?\?\s*clientRow/);
    expect(source).not.toMatch(/canonicalClientEmail\s*(?:\?\?|\|\|).*data\.client\.email/);
  });
});
