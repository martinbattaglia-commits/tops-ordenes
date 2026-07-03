import { describe, expect, it } from "vitest";
import { checkCronAuth, timingSafeStringEqual } from "./cron-auth";

// F4.4-E2 — matriz fail-closed completa del guard de crons (TDD §23 del plan).

const SECRET = "s3cr3t-de-prueba-largo-fijo";

describe("timingSafeStringEqual", () => {
  it("true para strings idénticos", () => {
    expect(timingSafeStringEqual("abc", "abc")).toBe(true);
  });
  it("false para mismo largo distinto contenido", () => {
    expect(timingSafeStringEqual("abc", "abd")).toBe(false);
  });
  it("false para largos distintos (sin tirar)", () => {
    expect(timingSafeStringEqual("abc", "abcd")).toBe(false);
  });
  it("false para vacío vs no-vacío", () => {
    expect(timingSafeStringEqual("", "x")).toBe(false);
  });
});

describe("checkCronAuth (fail-closed)", () => {
  it("503 si el secret NO está configurado (undefined)", () => {
    const r = checkCronAuth(`Bearer ${SECRET}`, undefined);
    expect(r).toEqual({ ok: false, status: 503, error: expect.stringContaining("fail-closed") });
  });

  it("503 si el secret es string vacío o whitespace", () => {
    expect(checkCronAuth("Bearer x", "").ok).toBe(false);
    expect((checkCronAuth("Bearer x", "") as { status: number }).status).toBe(503);
    expect((checkCronAuth("Bearer x", "   ") as { status: number }).status).toBe(503);
  });

  it("401 si falta el header Authorization", () => {
    const r = checkCronAuth(null, SECRET);
    expect(r).toEqual({ ok: false, status: 401, error: "Unauthorized" });
    expect(checkCronAuth(undefined, SECRET)).toMatchObject({ status: 401 });
    expect(checkCronAuth("", SECRET)).toMatchObject({ status: 401 });
  });

  it("401 si el Bearer no coincide", () => {
    expect(checkCronAuth("Bearer otro-secreto-distinto!!", SECRET)).toMatchObject({ status: 401 });
  });

  it("401 si coincide el secret pero falta el prefijo Bearer", () => {
    expect(checkCronAuth(SECRET, SECRET)).toMatchObject({ status: 401 });
  });

  it("401 si el largo difiere (rama length-mismatch del timing-safe)", () => {
    expect(checkCronAuth(`Bearer ${SECRET}x`, SECRET)).toMatchObject({ status: 401 });
    expect(checkCronAuth(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toMatchObject({ status: 401 });
  });

  it("ok con Bearer exacto", () => {
    expect(checkCronAuth(`Bearer ${SECRET}`, SECRET)).toEqual({ ok: true });
  });

  it("el secret configurado se trimea (paridad con env.ts) pero el header no", () => {
    expect(checkCronAuth(`Bearer ${SECRET}`, `  ${SECRET}  `)).toEqual({ ok: true });
    expect(checkCronAuth(`Bearer ${SECRET} `, SECRET)).toMatchObject({ status: 401 });
  });
});
