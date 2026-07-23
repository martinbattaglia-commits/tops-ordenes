import { describe, expect, it } from "vitest";
import {
  checkOutboundAllowed,
  isDestinationAllowed,
  isSandboxEnabled,
  normalizeMsisdn,
  parseAllowlist,
} from "./sandbox";

// F4.4-E3 — allowlist sandbox: dentro / fuera / flag off (TDD §23).

describe("isSandboxEnabled", () => {
  it("ON por default (flag ausente) — fail-closed", () => {
    expect(isSandboxEnabled(undefined)).toBe(true);
  });
  it("ON con cualquier valor distinto de '0'", () => {
    expect(isSandboxEnabled("1")).toBe(true);
    expect(isSandboxEnabled("true")).toBe(true);
    expect(isSandboxEnabled("")).toBe(true);
  });
  it("OFF solo con '0' explícito", () => {
    expect(isSandboxEnabled("0")).toBe(false);
    expect(isSandboxEnabled(" 0 ")).toBe(false);
  });
});

describe("normalizeMsisdn / parseAllowlist", () => {
  it("normaliza +54 9 11... a dígitos", () => {
    expect(normalizeMsisdn("+54 9 11 3107-9124")).toBe("5491131079124");
  });
  it("parsea lista con espacios, '+' y entradas vacías", () => {
    expect(parseAllowlist(" +5491131079124 , 5491100000001 ,, ")).toEqual([
      "5491131079124",
      "5491100000001",
    ]);
  });
  it("lista vacía o undefined ⇒ []", () => {
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(parseAllowlist("")).toEqual([]);
  });
});

describe("isDestinationAllowed", () => {
  const list = parseAllowlist("5491131079124");
  it("permite destino en la lista (con o sin '+')", () => {
    expect(isDestinationAllowed("5491131079124", list)).toBe(true);
    expect(isDestinationAllowed("+5491131079124", list)).toBe(true);
  });
  it("rechaza destino fuera de la lista", () => {
    expect(isDestinationAllowed("5491199999999", list)).toBe(false);
  });
  it("rechaza con allowlist vacía (nada sale)", () => {
    expect(isDestinationAllowed("5491131079124", [])).toBe(false);
  });
  it("rechaza destino vacío o sin dígitos", () => {
    expect(isDestinationAllowed("", list)).toBe(false);
    expect(isDestinationAllowed("abc", list)).toBe(false);
  });
});

describe("checkOutboundAllowed", () => {
  it("sandbox ON + destino allowlisted ⇒ permitido", () => {
    expect(
      checkOutboundAllowed("+5491131079124", { flag: "1", allowlistRaw: "5491131079124" }),
    ).toEqual({ allowed: true, sandbox: true });
  });
  it("sandbox ON + destino fuera ⇒ rechazado con razón", () => {
    expect(
      checkOutboundAllowed("5491199999999", { flag: undefined, allowlistRaw: "5491131079124" }),
    ).toEqual({ allowed: false, sandbox: true, reason: "destination_not_allowlisted" });
  });
  it("sandbox OFF explícito ⇒ permitido sin allowlist (F5, decisión Dirección)", () => {
    expect(checkOutboundAllowed("5491199999999", { flag: "0", allowlistRaw: "" })).toEqual({
      allowed: true,
      sandbox: false,
    });
  });
});
