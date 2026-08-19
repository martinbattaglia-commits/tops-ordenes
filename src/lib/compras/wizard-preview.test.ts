import { describe, it, expect } from "vitest";
import { computeTotals } from "./totals";
import { PurchasePricingError } from "./pricing";
import {
  previewTotals,
  projectDraftItemsForPreview,
  PREVIEW_DRAFT_REASON,
} from "./wizard-preview";
import type { POItem } from "@/lib/types-po";

function linea(patch: Partial<POItem> = {}): POItem {
  return {
    sku: null,
    label: "Bidón 20L",
    unit: "u",
    qty: 1,
    price: null,
    subtotal: null,
    price_state: "pending",
    price_reason: null,
    pos: 0,
    ...patch,
  } as POItem;
}

describe("la causa raíz, medida", () => {
  it("el dominio LANZA con un motivo de un solo carácter", () => {
    expect(() =>
      computeTotals([{ qty: 1, price: null, price_state: "pending", price_reason: "N" }]),
    ).toThrow(PurchasePricingError);
  });
});

describe("previewTotals", () => {
  it("no lanza mientras el motivo se está escribiendo", () => {
    for (const parcial of ["", "N", "No", "No ", "No llegó la cotización"]) {
      expect(() => previewTotals([linea({ price_reason: parcial })])).not.toThrow();
      expect(previewTotals([linea({ price_reason: parcial })]).state).toBe("pending");
    }
  });

  it("degrada a pendiente en vez de propagar un borrador que el dominio rechaza", () => {
    // Cantidad cero: `computePurchasePricing` lanza y no hay proyección que lo
    // tape, porque la cantidad la escribe el usuario.
    const t = previewTotals([linea({ qty: 0, price_state: "known", price: -5 })]);
    expect(t.state).toBe("pending");
    expect(t.total).toBeNull();
  });

  it("calcula el total real cuando el borrador ya es válido", () => {
    const t = previewTotals([linea({ price_state: "known", price: 100, qty: 2 })]);
    expect(t.state).toBe("known");
    expect(t.neto).toBe(200);
    expect(t.total).toBe(242);
  });
});

describe("projectDraftItemsForPreview", () => {
  it("completa sólo la vista previa, sin tocar el borrador", () => {
    const original = linea({ price_reason: "No" });
    const [proyectada] = projectDraftItemsForPreview([original]);
    expect(proyectada.price_reason).toBe(PREVIEW_DRAFT_REASON);
    expect(original.price_reason).toBe("No");
  });

  it("respeta el motivo cuando ya alcanza el mínimo del dominio", () => {
    const [proyectada] = projectDraftItemsForPreview([linea({ price_reason: "Sin cotización" })]);
    expect(proyectada.price_reason).toBe("Sin cotización");
  });

  it("lee un precio ausente como pendiente y normaliza la cantidad", () => {
    const [proyectada] = projectDraftItemsForPreview([
      linea({ price_state: "known", price: null, qty: 0 }),
    ]);
    expect(proyectada.price_state).toBe("pending");
    expect(proyectada.qty).toBe(1);
  });
});
