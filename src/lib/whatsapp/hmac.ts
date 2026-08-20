import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Valida la firma HMAC-SHA256 enviada por Meta en el encabezado `X-Hub-Signature-256`
 * en solicitudes POST de webhooks de WhatsApp Cloud API.
 *
 * Formato esperado del header: `sha256=<hex_hash>`
 */
export function verifyMetaHmacSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret: string
): boolean {
  if (!signatureHeader || !secret) return false;

  const parts = signatureHeader.split("=");
  if (parts.length !== 2 || parts[0] !== "sha256") return false;

  const expectedHash = parts[1];
  const hmac = createHmac("sha256", secret);
  hmac.update(rawBody);
  const calculatedHash = hmac.digest("hex");

  try {
    const expectedBuf = Buffer.from(expectedHash, "hex");
    const calculatedBuf = Buffer.from(calculatedHash, "hex");

    if (expectedBuf.length !== calculatedBuf.length) return false;
    return timingSafeEqual(expectedBuf, calculatedBuf);
  } catch {
    return false;
  }
}
