import { describe, it, expect } from "vitest";
import { parseOperatorProfileIds, isOperatorAuthorized, isUuid } from "./operators";

/**
 * LINK-WA S1 · Operadores sandbox — deny-by-default.
 *
 * Corrección de Dirección: nada de sembrar `role='admin'` automáticamente. Sólo
 * los UUID expresamente configurados pueden incorporarse. UUIDs sintéticos.
 */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-9222-222222222222";
const FUERA = "33333333-3333-4333-a333-333333333333";

describe("parseOperatorProfileIds · deny-by-default", () => {
  it.each([undefined, "", "   ", ",,,"])(
    "sin configuración efectiva (%s) la allowlist queda vacía",
    (raw) => {
      expect(parseOperatorProfileIds(raw).ids).toEqual([]);
    },
  );

  it("acepta UUIDs válidos, normaliza a minúsculas y deduplica", () => {
    const r = parseOperatorProfileIds(` ${A.toUpperCase()} , ${B}, ${A} `);
    expect(r.ids).toEqual([A, B]);
    expect(r.invalid).toEqual([]);
  });

  it("descarta lo que no es UUID y lo reporta sin usarlo", () => {
    const r = parseOperatorProfileIds(`${A}, admin, *, 12345`);
    expect(r.ids).toEqual([A]);
    expect(r.invalid).toEqual(["admin", "*", "12345"]);
  });

  it("una allowlist con SÓLO entradas inválidas no habilita a nadie", () => {
    const r = parseOperatorProfileIds("admin,todos,*");
    expect(r.ids).toEqual([]);
    expect(isOperatorAuthorized(A, r.ids)).toBe(false);
  });
});

describe("isOperatorAuthorized · allowed / denied", () => {
  const allowlist = parseOperatorProfileIds(`${A},${B}`).ids;

  it("permite un perfil expresamente configurado", () => {
    expect(isOperatorAuthorized(A, allowlist)).toBe(true);
    expect(isOperatorAuthorized(B.toUpperCase(), allowlist)).toBe(true);
  });

  it("niega un perfil que no está en la lista", () => {
    expect(isOperatorAuthorized(FUERA, allowlist)).toBe(false);
  });

  it("niega ausencia de perfil", () => {
    expect(isOperatorAuthorized(null, allowlist)).toBe(false);
    expect(isOperatorAuthorized(undefined, allowlist)).toBe(false);
    expect(isOperatorAuthorized("", allowlist)).toBe(false);
  });

  it("niega cualquier cosa cuando la allowlist está vacía", () => {
    expect(isOperatorAuthorized(A, [])).toBe(false);
  });

  it("niega un identificador que no es UUID aunque figure en la lista cruda", () => {
    expect(isOperatorAuthorized("admin", ["admin"])).toBe(false);
  });
});

describe("isUuid", () => {
  it("distingue UUID canónico de basura", () => {
    expect(isUuid(A)).toBe(true);
    expect(isUuid("no-uuid")).toBe(false);
    expect(isUuid("11111111111141118111111111111111")).toBe(false);
  });
});
