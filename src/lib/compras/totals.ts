import type { POItem } from "@/lib/types-po";
import { computePurchasePricing, type POPriceState } from "./pricing";

export interface Totals {
  neto: number | null;
  iva: number | null;
  total: number | null;
  planningNeto: number | null;
  planningIva: number | null;
  planningTotal: number | null;
  state: POPriceState;
  knownPartialNeto: number;
  pendingLines: number;
}

export const IVA_RATE = 0.21;

export function computeTotals(
  items: Pick<POItem, "qty" | "price" | "price_state" | "price_reason">[],
): Totals {
  const result = computePurchasePricing(items, IVA_RATE);
  return {
    neto: result.accounting?.neto ?? null,
    iva: result.accounting?.iva ?? null,
    total: result.accounting?.total ?? null,
    planningNeto: result.planning?.neto ?? null,
    planningIva: result.planning?.iva ?? null,
    planningTotal: result.planning?.total ?? null,
    state: result.state,
    knownPartialNeto: result.known_partial_neto,
    pendingLines: result.pending_lines,
  };
}

export function lineSubtotal(qty: number, price: number | null): number | null {
  if (price === null) return null;
  return Math.round(Number(qty ?? 0) * Number(price ?? 0) * 100) / 100;
}

/**
 * Hash de integridad SHA-256 sobre los datos canónicos de la OC.
 * Permite detectar alteraciones posteriores a la firma.
 */
export async function integrityHash(input: {
  vendor_id: string;
  items: Array<Pick<POItem, "sku" | "label" | "qty" | "price" | "price_state" | "price_reason">>;
  total: number | null;
  emisor_email: string;
  signed_at: string | null;
}): Promise<string> {
  const canon = JSON.stringify({
    v: input.vendor_id,
    i: input.items.map((it) =>
      `${it.sku ?? ""}|${it.label}|${it.qty}|${it.price_state}|${it.price ?? "PENDING"}|${it.price_reason ?? ""}`,
    ),
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
