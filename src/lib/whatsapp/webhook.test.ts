import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMetaSignature, verifyMetaVerifyToken } from "./webhook";

// F4.4-E2 — vectores fijos, sin red (TDD §23: firma válida / inválida / ausente /
// secret ausente / largo distinto / body alterado).

const APP_SECRET = "meta-app-secret-de-prueba";
const BODY = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "123" }] });

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("verifyMetaSignature", () => {
  it("acepta una firma válida", () => {
    expect(verifyMetaSignature(BODY, sign(BODY, APP_SECRET), APP_SECRET)).toEqual({
      valid: true,
      reason: "ok",
    });
  });

  it("acepta hex en mayúsculas (normaliza)", () => {
    const header = "sha256=" + sign(BODY, APP_SECRET).slice("sha256=".length).toUpperCase();
    expect(verifyMetaSignature(BODY, header, APP_SECRET).valid).toBe(true);
  });

  it("rechaza fail-closed si el App Secret no está configurado", () => {
    expect(verifyMetaSignature(BODY, sign(BODY, APP_SECRET), undefined)).toEqual({
      valid: false,
      reason: "no_secret",
    });
    expect(verifyMetaSignature(BODY, sign(BODY, APP_SECRET), "  ").reason).toBe("no_secret");
  });

  it("rechaza si falta el header de firma", () => {
    expect(verifyMetaSignature(BODY, null, APP_SECRET).reason).toBe("no_signature");
    expect(verifyMetaSignature(BODY, undefined, APP_SECRET).reason).toBe("no_signature");
  });

  it("rechaza formato inválido (sin prefijo sha256= o hex corto)", () => {
    expect(verifyMetaSignature(BODY, "sha1=abc", APP_SECRET).reason).toBe("bad_format");
    expect(verifyMetaSignature(BODY, "sha256=zzzz", APP_SECRET).reason).toBe("bad_format");
    expect(verifyMetaSignature(BODY, "sha256=abc123", APP_SECRET).reason).toBe("bad_format");
  });

  it("rechaza firma calculada con otro secret", () => {
    expect(verifyMetaSignature(BODY, sign(BODY, "otro-secret"), APP_SECRET).reason).toBe("mismatch");
  });

  it("rechaza si el body fue alterado después de firmar", () => {
    const header = sign(BODY, APP_SECRET);
    expect(verifyMetaSignature(BODY + " ", header, APP_SECRET).reason).toBe("mismatch");
  });

  it("verifica sobre el body CRUDO: re-serializar el JSON rompe la firma", () => {
    const rawConEspacios = '{ "object" : "whatsapp_business_account" }';
    const header = sign(rawConEspacios, APP_SECRET);
    const reSerializado = JSON.stringify(JSON.parse(rawConEspacios));
    expect(verifyMetaSignature(rawConEspacios, header, APP_SECRET).valid).toBe(true);
    expect(verifyMetaSignature(reSerializado, header, APP_SECRET).valid).toBe(false);
  });
});

describe("verifyMetaVerifyToken (handshake GET)", () => {
  it("acepta token exacto", () => {
    expect(verifyMetaVerifyToken("tok-123", "tok-123")).toBe(true);
  });
  it("fail-closed sin token configurado (sin default hardcodeado)", () => {
    expect(verifyMetaVerifyToken("nexus-tops-verify", undefined)).toBe(false);
    expect(verifyMetaVerifyToken("nexus-tops-verify", "")).toBe(false);
  });
  it("rechaza token ausente o distinto", () => {
    expect(verifyMetaVerifyToken(null, "tok-123")).toBe(false);
    expect(verifyMetaVerifyToken("tok-124", "tok-123")).toBe(false);
  });
});
