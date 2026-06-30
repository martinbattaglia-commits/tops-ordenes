import { describe, it, expect } from "vitest";
import {
  canPost, normalizeBody, parseMentions, messageDisplayBody, unreadCount, isOwnMessage,
  MAX_MESSAGE_LENGTH,
} from "./message";

describe("connect/domain/message · canPost", () => {
  it("rechaza cuerpo vacío sin adjuntos", () => {
    expect(canPost("", 0)).toBe(false);
    expect(canPost("   ", 0)).toBe(false);
    expect(canPost(null, 0)).toBe(false);
    expect(canPost(undefined, 0)).toBe(false);
  });
  it("acepta cuerpo con texto", () => {
    expect(canPost("hola", 0)).toBe(true);
  });
  it("acepta solo-adjunto (cuerpo vacío)", () => {
    expect(canPost("", 1)).toBe(true);
  });
  it("rechaza cuerpo que excede el máximo", () => {
    expect(canPost("a".repeat(MAX_MESSAGE_LENGTH + 1), 0)).toBe(false);
  });
});

describe("connect/domain/message · normalizeBody", () => {
  it("trimea y devuelve null si queda vacío", () => {
    expect(normalizeBody("  hola  ")).toBe("hola");
    expect(normalizeBody("   ")).toBeNull();
    expect(normalizeBody(null)).toBeNull();
  });
});

describe("connect/domain/message · parseMentions", () => {
  it("extrae handles únicos en orden", () => {
    expect(parseMentions("hola @maria y @diego, gracias @maria")).toEqual(["maria", "diego"]);
  });
  it("no confunde emails", () => {
    expect(parseMentions("escribime a juan@tops.com")).toEqual([]);
  });
  it("soporta handles con punto/guion", () => {
    expect(parseMentions("@maria.gonzalez @diego-f")).toEqual(["maria.gonzalez", "diego-f"]);
  });
  it("vacío si no hay menciones", () => {
    expect(parseMentions("")).toEqual([]);
    expect(parseMentions(null)).toEqual([]);
  });
});

describe("connect/domain/message · presentación", () => {
  it("muestra placeholder en soft-delete/redacción", () => {
    expect(messageDisplayBody({ deletedAt: "2026-06-30T00:00:00Z", redacted: false, body: "x" })).toBe("Mensaje eliminado");
    expect(messageDisplayBody({ deletedAt: null, redacted: true, body: "x" })).toBe("Mensaje eliminado");
    expect(messageDisplayBody({ deletedAt: null, redacted: false, body: "hola" })).toBe("hola");
  });
  it("unreadCount nunca negativo", () => {
    expect(unreadCount(10, 4)).toBe(6);
    expect(unreadCount(4, 10)).toBe(0);
    expect(unreadCount(null, 0)).toBe(0);
  });
  it("isOwnMessage compara author con user", () => {
    expect(isOwnMessage({ authorProfileId: "u1" }, "u1")).toBe(true);
    expect(isOwnMessage({ authorProfileId: "u1" }, "u2")).toBe(false);
    expect(isOwnMessage({ authorProfileId: "u1" }, null)).toBe(false);
  });
});
