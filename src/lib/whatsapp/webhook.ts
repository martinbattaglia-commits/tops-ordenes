import { createHmac } from "node:crypto";
import { timingSafeStringEqual } from "@/lib/cron-auth";

/**
 * webhook.ts — F4.4-E2 · Verificación HMAC del webhook de WhatsApp (Meta Cloud API).
 *
 * Meta firma cada POST con `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256 del
 * body CRUDO con el App Secret de la app (META_WA_APP_SECRET). Hasta F4.4 el
 * webhook aceptaba cualquier POST (TODO F3 nunca cerrado — hallazgo A08 de la
 * auditoría). Patrón espejo de `clientify/webhook.ts`: funciones puras, secret
 * inyectable, fail-closed, comparación timing-safe.
 *
 * Reglas (plan F4.4 §12): verificar SIEMPRE sobre el body crudo (antes de
 * JSON.parse), nunca loguear el secret ni la firma completa.
 */

export type MetaSignatureReason = "ok" | "no_secret" | "no_signature" | "bad_format" | "mismatch";

export interface MetaSignatureResult {
  valid: boolean;
  reason: MetaSignatureReason;
}

/**
 * Verifica `X-Hub-Signature-256` contra el HMAC-SHA256 del body crudo.
 * Fail-closed: sin `appSecret` configurado → inválido (`no_secret`, el route
 * responde 503); firma ausente o mal formada → inválido (401).
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  appSecret: string | undefined,
): MetaSignatureResult {
  const secret = appSecret?.trim();
  if (!secret) return { valid: false, reason: "no_secret" };
  if (!signatureHeader) return { valid: false, reason: "no_signature" };
  if (!signatureHeader.startsWith("sha256=")) return { valid: false, reason: "bad_format" };

  const expectedHex = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const providedHex = signatureHeader.slice("sha256=".length).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(providedHex)) return { valid: false, reason: "bad_format" };

  return timingSafeStringEqual(expectedHex, providedHex)
    ? { valid: true, reason: "ok" }
    : { valid: false, reason: "mismatch" };
}

/**
 * Verifica el token del handshake GET de Meta (`hub.verify_token`).
 * Fail-closed: sin token configurado → false (F4.4 elimina el default
 * hardcodeado `"nexus-tops-verify"` que tenía el route).
 */
export function verifyMetaVerifyToken(
  provided: string | null | undefined,
  configured: string | undefined,
): boolean {
  const expected = configured?.trim();
  if (!expected) return false;
  if (!provided) return false;
  return timingSafeStringEqual(provided, expected);
}
