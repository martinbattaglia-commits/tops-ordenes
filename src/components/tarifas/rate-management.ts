export interface RateWindowRow {
  id: string;
  client_id: string;
  service_slug: string;
  rate: number | string;
  min_qty: number | string | null;
  min_billing: number | string | null;
  valid_from: string;
  valid_to: string | null;
}

export interface CurrentRateSummary {
  clientRateId: string;
  rate: number;
  minQty: number | null;
  minBilling: number | null;
}

export interface ManagedRateSummary extends CurrentRateSummary {
  validFrom: string;
  status: "active" | "scheduled";
  futureCount: number;
}

export function groupClientRateWindows(rows: RateWindowRow[], asOf: string): {
  current: Record<string, Record<string, CurrentRateSummary>>;
  management: Record<string, Record<string, ManagedRateSummary>>;
} {
  const current: Record<string, Record<string, CurrentRateSummary>> = {};
  const management: Record<string, Record<string, ManagedRateSummary>> = {};

  for (const row of rows) {
    const payload: CurrentRateSummary = {
      clientRateId: row.id,
      rate: Number(row.rate),
      minQty: row.min_qty == null ? null : Number(row.min_qty),
      minBilling: row.min_billing == null ? null : Number(row.min_billing),
    };
    const isActive = row.valid_from <= asOf && (row.valid_to == null || row.valid_to > asOf);
    const isFuture = row.valid_from > asOf;
    if (!isActive && !isFuture) continue;

    if (isActive) (current[row.client_id] ??= {})[row.service_slug] = payload;

    const byClient = (management[row.client_id] ??= {});
    const existing = byClient[row.service_slug];
    if (!existing || (existing.status === "scheduled" && isActive)) {
      byClient[row.service_slug] = {
        ...payload,
        validFrom: row.valid_from,
        status: isActive ? "active" : "scheduled",
        futureCount: isFuture ? 1 : 0,
      };
    } else if (isFuture) {
      existing.futureCount += 1;
    }
  }

  return { current, management };
}
