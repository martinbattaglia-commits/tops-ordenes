/**
 * T-A0-08 · Guarda de versión de PostgreSQL (M-03).
 *
 * Prueba el parser/gate para 16, 17 y 18, y que la guarda se aplica contra la
 * conexión real antes de cualquier bootstrap.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_SERVER_VERSION_NUM,
  MIN_SERVER_VERSION_NUM,
  UnsupportedPostgresVersionError,
  assertPostgres17,
  parseAndCheckServerVersion,
} from "./harness/version-gate";

describe("T-A0-08 · version gate", () => {
  it("acepta la serie 17", () => {
    expect(parseAndCheckServerVersion("170000")).toBe(170_000);
    expect(parseAndCheckServerVersion("170010")).toBe(170_010);
    expect(parseAndCheckServerVersion("179999")).toBe(179_999);
    expect(parseAndCheckServerVersion(170_004)).toBe(170_004);
  });

  it("rechaza PostgreSQL 16", () => {
    expect(() => parseAndCheckServerVersion("160009")).toThrow(UnsupportedPostgresVersionError);
    expect(() => parseAndCheckServerVersion("160009")).toThrow(/major 16/);
  });

  it("rechaza PostgreSQL 18", () => {
    expect(() => parseAndCheckServerVersion("180000")).toThrow(UnsupportedPostgresVersionError);
    expect(() => parseAndCheckServerVersion("180000")).toThrow(/major 18/);
  });

  it("rechaza valores no numéricos, vacíos o ausentes", () => {
    expect(() => parseAndCheckServerVersion("17.10")).toThrow(/no numérico/);
    expect(() => parseAndCheckServerVersion("")).toThrow(/no numérico/);
    expect(() => parseAndCheckServerVersion(undefined)).toThrow(/ausente/);
    expect(() => parseAndCheckServerVersion(null)).toThrow(/ausente/);
    expect(() => parseAndCheckServerVersion({})).toThrow(/ausente/);
  });

  it("los límites del rango son los declarados", () => {
    expect(MIN_SERVER_VERSION_NUM).toBe(170_000);
    expect(MAX_SERVER_VERSION_NUM).toBe(180_000);
    expect(() => parseAndCheckServerVersion(String(MIN_SERVER_VERSION_NUM - 1))).toThrow();
    expect(() => parseAndCheckServerVersion(String(MAX_SERVER_VERSION_NUM))).toThrow();
  });

  it("assertPostgres17 interroga al servidor y propaga el rechazo", async () => {
    const fake = (v: string) => ({
      query: async () => ({ rows: [{ server_version_num: v }] }),
    });
    await expect(assertPostgres17(fake("170010"))).resolves.toBe(170_010);
    await expect(assertPostgres17(fake("160009"))).rejects.toThrow(/major 16/);
    await expect(assertPostgres17(fake("180000"))).rejects.toThrow(/major 18/);
  });

  it("el mensaje deja claro que no se ejecuta bootstrap ni migraciones", () => {
    try {
      parseAndCheckServerVersion("160009");
      expect.unreachable("debió lanzar");
    } catch (e) {
      expect((e as Error).message).toMatch(/No se ejecuta bootstrap ni se cargan migraciones/);
    }
  });
});
