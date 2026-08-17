import { describe, expect, it } from "vitest";
import type { POItem } from "@/lib/types-po";
import { purchaseItemFromCatalog, validatePurchaseItemsForContinue } from "./wizard-validation";

const line = (patch: Partial<POItem> = {}): POItem => ({
  sku: null,label: "Servicio logístico",unit: "un",qty: 2,price: null,subtotal: null,
  price_state: "pending",price_reason: "Cotización del proveedor en curso",pos: 0,...patch,
});

describe("validación de avance de OC con precio pendiente", () => {
  it("permite una línea pendiente con motivo", () => {
    expect(validatePurchaseItemsForContinue([line()])).toEqual({ valid: true, errors: {} });
  });
  it("explica el motivo faltante junto a la línea", () => {
    const result = validatePurchaseItemsForContinue([line({ price_reason: "" })]);
    expect(result.valid).toBe(false);
    expect(result.errors[0].price_reason).toMatch(/por qué/i);
  });
  it("permite todas las líneas pendientes", () => {
    expect(validatePurchaseItemsForContinue([line(), line({ pos: 1, unit: "m2", qty: 12.5 })]).valid).toBe(true);
  });
  it("permite mezcla de conocida y pendiente", () => {
    expect(validatePurchaseItemsForContinue([
      line({ price_state: "known", price: 1500, subtotal: 3000, price_reason: null }),
      line({ pos: 1 }),
    ]).valid).toBe(true);
  });
  it("rechaza un importe ficticio dentro de una línea pendiente", () => {
    const result = validatePurchaseItemsForContinue([line({ price: 1, subtotal: 2 })]);
    expect(result.valid).toBe(false);
    expect(result.errors[0].price).toMatch(/no puede contener/i);
  });
  it("normaliza a null un producto de catálogo sin precio real", () => {
    expect(purchaseItemFromCatalog({ sku: "S-1", label: "A cotizar", unit: "m2", price: 0 }, 4)).toMatchObject({
      price_state: "pending",
      price: null,
      subtotal: null,
      qty: 4,
    });
  });
});
