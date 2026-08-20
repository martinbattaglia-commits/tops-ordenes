import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyMetaHmacSignature } from "@/lib/whatsapp/hmac";

describe("WhatsApp Meta Webhook HMAC-SHA256 Security", () => {
  const secret = "test_app_secret_12345";
  const rawBody = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

  it("acepta una firma HMAC-SHA256 correcta", () => {
    const hash = createHmac("sha256", secret).update(rawBody).digest("hex");
    const signatureHeader = `sha256=${hash}`;

    const valid = verifyMetaHmacSignature(rawBody, signatureHeader, secret);
    expect(valid).toBe(true);
  });

  it("rechaza firmas con secreto incorrecto", () => {
    const hash = createHmac("sha256", "wrong_secret").update(rawBody).digest("hex");
    const signatureHeader = `sha256=${hash}`;

    const valid = verifyMetaHmacSignature(rawBody, signatureHeader, secret);
    expect(valid).toBe(false);
  });

  it("rechaza encabezados malformados o ausentes", () => {
    expect(verifyMetaHmacSignature(rawBody, null, secret)).toBe(false);
    expect(verifyMetaHmacSignature(rawBody, undefined, secret)).toBe(false);
    expect(verifyMetaHmacSignature(rawBody, "invalid_header", secret)).toBe(false);
    expect(verifyMetaHmacSignature(rawBody, "sha256=", secret)).toBe(false);
  });
});
