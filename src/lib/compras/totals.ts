import type { POItem } from "@/lib/types-po";

export interface Totals {
  neto: number;
  iva: number;
  total: number;
}

export const IVA_RATE = 0.21;

export function computeTotals(items: Pick<POItem, "qty" | "price">[]): Totals {
  const neto = items.reduce((a, b) => a + Number(b.qty ?? 0) * Number(b.price ?? 0), 0);
  const iva = Math.round(neto * IVA_RATE);
  const total = Math.round(neto) + iva;
  return { neto: Math.round(neto), iva, total };
}

export function lineSubtotal(qty: number, price: number): number {
  return Math.round(Number(qty ?? 0) * Number(price ?? 0));
}

/**
 * Hash de integridad SHA-256 sobre los datos canónicos de la OC.
 * Permite detectar alteraciones posteriores a la firma.
 */
export async function integrityHash(input: {
  vendor_id: string;
  items: Array<Pick<POItem, "sku" | "label" | "qty" | "price">>;
  total: number;
  emisor_email: string;
  signed_at: string | null;
}): Promise<string> {
  const canon = JSON.stringify({
    v: input.vendor_id,
    i: input.items.map((it) => `${it.sku ?? ""}|${it.label}|${it.qty}|${it.price}`),
    t: input.total,
    e: input.emisor_email,
    s: input.signed_at ?? "",
  });
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const buf = new TextEncoder().encode(canon);
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // node fallback
  const nodeCrypto = await import("crypto");
  return nodeCrypto.createHash("sha256").update(canon).digest("hex");
}
