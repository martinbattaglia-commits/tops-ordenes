import { createHash, timingSafeEqual } from "node:crypto";

/** SHA-256 (hex, minúsculas) del string en UTF-8. Fuente única del algoritmo. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export const CHECKSUM_ALGO = "SHA-256" as const;

/**
 * Compara dos checksums en tiempo CONSTANTE para prevenir timing attacks
 * (ataques de canal lateral). Cada operando se normaliza (trim + minúsculas) y
 * se re-hashea a 32 bytes fijos antes de `crypto.timingSafeEqual`: así
 *   (a) ambos buffers tienen SIEMPRE igual longitud —`timingSafeEqual` lanza
 *       `RangeError` si difieren—, y
 *   (b) no se filtra por tiempo la longitud del checksum esperado (que puede
 *       provenir de un origen no confiable).
 * Devuelve `false` ante cualquier desigualdad; nunca lanza por longitud.
 */
export function checksumsEqual(a: string, b: string): boolean {
  const na = createHash("sha256").update(a.trim().toLowerCase(), "utf8").digest();
  const nb = createHash("sha256").update(b.trim().toLowerCase(), "utf8").digest();
  return timingSafeEqual(na, nb);
}
