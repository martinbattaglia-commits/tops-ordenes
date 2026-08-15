export const PO_PRICE_STATES = ["known", "estimated", "pending"] as const;

export type POPriceState = (typeof PO_PRICE_STATES)[number];

export interface PurchasePriceInput {
  qty: number;
  price: number | null;
  price_state: POPriceState;
  price_reason?: string | null;
}

export interface PurchasePriceLine extends PurchasePriceInput {
  subtotal: number | null;
}

export interface PurchasePriceTotals {
  neto: number;
  iva: number;
  total: number;
}

export interface PurchasePricingSummary {
  state: POPriceState;
  lines: PurchasePriceLine[];
  /** Importe contable real: existe únicamente cuando todas las líneas son conocidas. */
  accounting: PurchasePriceTotals | null;
  /** Importe de planificación: admite estimados, pero nunca líneas pendientes. */
  planning: PurchasePriceTotals | null;
  known_partial_neto: number;
  pending_lines: number;
  estimated_lines: number;
}

export class PurchasePricingError extends Error {
  constructor(
    message: string,
    readonly lineIndex: number,
  ) {
    super(message);
    this.name = "PurchasePricingError";
  }
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function totals(neto: number, ivaRate: number): PurchasePriceTotals {
  const roundedNeto = money(neto);
  const iva = money(roundedNeto * ivaRate);
  return { neto: roundedNeto, iva, total: money(roundedNeto + iva) };
}

function requiredReason(input: PurchasePriceInput, index: number): string | null {
  if (input.price_state === "known") return null;
  const reason = input.price_reason?.trim() ?? "";
  if (reason.length < 3) {
    throw new PurchasePricingError(
      input.price_state === "pending"
        ? "El precio pendiente requiere un motivo."
        : "El precio estimado requiere un motivo.",
      index,
    );
  }
  return reason;
}

/**
 * Resuelve la semántica económica de una OC sin confundir ausencia con cero.
 *
 * - known: precio real no negativo, integra métricas contables.
 * - estimated: precio no negativo + motivo, sólo integra planificación.
 * - pending: precio y subtotal obligatoriamente null + motivo.
 */
export function computePurchasePricing(
  inputs: readonly PurchasePriceInput[],
  ivaRate = 0.21,
): PurchasePricingSummary {
  if (inputs.length === 0) throw new PurchasePricingError("La orden no tiene líneas.", 0);
  if (!Number.isFinite(ivaRate) || ivaRate < 0) {
    throw new PurchasePricingError("La alícuota de IVA es inválida.", 0);
  }

  let knownPartial = 0;
  let planningNeto = 0;
  let pendingLines = 0;
  let estimatedLines = 0;

  const lines = inputs.map((input, index): PurchasePriceLine => {
    if (!Number.isFinite(input.qty) || input.qty <= 0) {
      throw new PurchasePricingError("La cantidad debe ser mayor a cero.", index);
    }
    const reason = requiredReason(input, index);

    if (input.price_state === "pending") {
      if (input.price !== null) {
        throw new PurchasePricingError(
          "Una línea pendiente no puede guardar un importe aparente.",
          index,
        );
      }
      pendingLines += 1;
      return { ...input, price: null, price_reason: reason, subtotal: null };
    }

    if (input.price === null || !Number.isFinite(input.price) || input.price < 0) {
      throw new PurchasePricingError("El precio informado debe ser un importe no negativo.", index);
    }

    const subtotal = money(input.qty * input.price);
    planningNeto += subtotal;
    if (input.price_state === "known") knownPartial += subtotal;
    else estimatedLines += 1;

    return {
      ...input,
      price: money(input.price),
      price_reason: reason,
      subtotal,
    };
  });

  const state: POPriceState = pendingLines > 0
    ? "pending"
    : estimatedLines > 0
      ? "estimated"
      : "known";
  const planning = pendingLines === 0 ? totals(planningNeto, ivaRate) : null;
  const accounting = state === "known" ? planning : null;

  return {
    state,
    lines,
    accounting,
    planning,
    known_partial_neto: money(knownPartial),
    pending_lines: pendingLines,
    estimated_lines: estimatedLines,
  };
}

export const PO_PRICE_STATE_LABEL: Record<POPriceState, string> = {
  known: "Precio conocido",
  estimated: "Precio estimado",
  pending: "Precio pendiente",
};
