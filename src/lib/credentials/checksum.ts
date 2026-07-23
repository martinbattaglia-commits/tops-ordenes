import { createHash } from "node:crypto";

/** SHA-256 (hex, minúsculas) del string en UTF-8. Fuente única del algoritmo. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export const CHECKSUM_ALGO = "SHA-256" as const;
