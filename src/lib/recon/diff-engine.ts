// src/lib/recon/diff-engine.ts
// Motor puro: sin I/O, determinístico, testeable.

import type {
  POForRecon,
  InvoiceForRecon,
  ReconDiff,
  ReconResult,
  ReconDiffSeverity,
} from "./types";
import { SEVERITY_WEIGHT } from "./types";

const TOLERANCE_ARS = 0.02; // diferencias ≤ 2 centavos se ignoran (AFIP redondeo)

function numDiff(
  field: ReconDiff["field"],
  oc: number,
  inv: number,
  severity: ReconDiffSeverity = "warning",
): ReconDiff | null {
  const delta = Math.abs(oc - inv);
  if (delta <= TOLERANCE_ARS) return null;
  return {
    field,
    val_oc: String(oc),
    val_factura: String(inv),
    delta_num: inv - oc,
    severity,
  };
}

function strDiff(
  field: ReconDiff["field"],
  oc: string | undefined | null,
  inv: string | undefined | null,
  severity: ReconDiffSeverity = "warning",
): ReconDiff | null {
  const a = (oc ?? "").trim().toLowerCase();
  const b = (inv ?? "").trim().toLowerCase();
  if (a === b) return null;
  return { field, val_oc: oc ?? "", val_factura: inv ?? "", severity };
}

export function computeRecon(po: POForRecon, invoice: InvoiceForRecon): ReconResult {
  const diffs: ReconDiff[] = [];

  const push = (d: ReconDiff | null) => d && diffs.push(d);

  // Proveedor (misma empresa → error)
  if (po.vendor_id !== invoice.vendor_id) {
    diffs.push({
      field: "proveedor",
      val_oc: po.vendor?.razon_social ?? po.vendor_id,
      val_factura: invoice.vendor?.razon_social ?? invoice.vendor_id,
      severity: "error",
    });
  }

  // CUIT
  push(strDiff("cuit", po.vendor?.cuit, invoice.vendor?.cuit, "error"));

  // Moneda
  push(strDiff("moneda", po.moneda ?? "ARS", invoice.moneda ?? "ARS", "error"));

  // Importes
  push(numDiff("neto",   po.neto,  invoice.neto,  "warning"));
  push(numDiff("iva",    po.iva,   invoice.iva,   "warning"));
  push(numDiff("total",  po.total, invoice.total, "error"));

  // Percepciones y tributos (la OC no los tiene pre-calculados → sólo warning si invoice > 0)
  if ((invoice.percepciones ?? 0) > 0) {
    diffs.push({
      field: "percepciones",
      val_oc: "0",
      val_factura: String(invoice.percepciones),
      delta_num: -(invoice.percepciones ?? 0),
      severity: "warning",
    });
  }

  if ((invoice.tributos ?? 0) > 0) {
    diffs.push({
      field: "tributos",
      val_oc: "0",
      val_factura: String(invoice.tributos),
      delta_num: -(invoice.tributos ?? 0),
      severity: "warning",
    });
  }

  // invoice no tiene items detallados en este modelo; si el total de neto difiere ya está capturado

  // Tipo de comprobante: la OC espera FACTURA_A (ej) — info si es diferente tipo
  if (!invoice.tipo_comprobante.startsWith("FACTURA")) {
    diffs.push({
      field: "tipo_comprobante",
      val_oc: "FACTURA_A / FACTURA_B",
      val_factura: invoice.tipo_comprobante,
      severity: "warning",
    });
  }

  // CAE presente (info si no tiene)
  if (!invoice.cae) {
    diffs.push({
      field: "cae",
      val_oc: "requerido",
      val_factura: "(vacío)",
      severity: "info",
    });
  }

  // Calcular score: se descuenta peso por cada diff
  const totalWeight = diffs.reduce((acc, d) => acc + SEVERITY_WEIGHT[d.severity], 0);
  const score = Math.max(0, Math.round(100 - totalWeight));

  return { score, diffs };
}
