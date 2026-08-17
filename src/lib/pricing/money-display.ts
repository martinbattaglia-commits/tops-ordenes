/**
 * Presentación de importes de órdenes de servicio.
 *
 * Un importe ausente no es cero. Una línea con precio pendiente llega con
 * `rate`/`subtotal`/`total` en NULL —lo fuerza el CHECK de 0249, justamente
 * para que la base nunca invente un cero— y el contrato prohíbe mostrarla
 * como "$ 0" o "$ 1".
 *
 * `fmtCurrency` no puede sostener esa distinción: sus call-sites legítimos le
 * pasan ceros reales (bonificaciones al 100 %, ítems sin cargo, KPIs en cero)
 * y deben seguir viéndose como "$ 0". Por eso la rama de pendiente se decide
 * acá, antes de formatear, y `fmtCurrency` queda intacta.
 */
import { fmtCurrency } from "@/lib/utils";

/** Etiqueta por defecto para documentos formales (PDF, comprobantes). */
export const PENDING_MONEY_LABEL = "PENDIENTE DE COTIZACIÓN";

/** Etiqueta compacta para listados y celdas angostas. */
export const PENDING_MONEY_LABEL_SHORT = "Pendiente";

export function fmtMoneyOrPending(
  amount: number | null | undefined,
  currency: "ARS" | "USD" | null = "ARS",
  pendingLabel: string = PENDING_MONEY_LABEL,
): string {
  // El importe ausente decide primero: sin cotización no hay nada que
  // formatear, y la moneda es irrelevante para lo que hay que comunicar.
  // Un valor no finito tampoco es un importe: delegarlo devolvía "$ 0"
  // para NaN y "$ ∞" para Infinity, es decir el síntoma que esto erradica.
  if (amount == null || !Number.isFinite(amount)) return pendingLabel;
  if (!currency) return "— · MONEDA NO INFORMADA";
  return fmtCurrency(amount, currency);
}
