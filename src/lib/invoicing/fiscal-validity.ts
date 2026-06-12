/**
 * H2 · FISCAL-HARDENING — Regla de corte de validez fiscal (ÚNICA).
 *
 * Un comprobante de venta es fiscalmente válido ⟺
 *   estado_arca = 'AUTORIZADO_ARCA' ∧ anulada = false ∧ ambiente = fiscal_config.ambiente
 *
 * Prohibido re-implementar este filtro ad hoc: todo consumidor TypeScript
 * (KPIs, reportes, futuros libros) usa este helper; el lado SQL usa la
 * función `public.fiscal_ambiente()` (migración 0071) con el mismo criterio.
 * Los comprobantes no válidos NO se borran (append-only): quedan visibles
 * solo en la vista operativa de /billing, con badge de ambiente/estado.
 */
import type { ArcaAmbiente, CustomerInvoice } from "./types";

export type FiscalValidityFields = Pick<
  CustomerInvoice,
  "estado_arca" | "anulada" | "ambiente"
>;

export function isFiscallyValid(
  inv: FiscalValidityFields,
  ambienteVigente: ArcaAmbiente
): boolean {
  return (
    inv.estado_arca === "AUTORIZADO_ARCA" &&
    inv.anulada === false &&
    inv.ambiente === ambienteVigente
  );
}
