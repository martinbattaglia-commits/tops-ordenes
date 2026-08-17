import type { POItem } from "@/lib/types-po";

export interface PurchaseLineErrors {
  label?: string;
  qty?: string;
  unit?: string;
  price?: string;
  price_reason?: string;
}

export interface PurchaseItemsValidation {
  valid: boolean;
  errors: Record<number, PurchaseLineErrors>;
}

export interface PurchaseCatalogSelection {
  sku: string;
  label: string;
  unit: string;
  price: number;
}

/** Un importe ausente/cero de catálogo nunca se materializa como precio ficticio. */
export function purchaseItemFromCatalog(
  product: PurchaseCatalogSelection,
  qty: number,
): Pick<POItem, "sku" | "label" | "unit" | "qty" | "price" | "subtotal" | "price_state" | "price_reason"> {
  const hasPrice = Number.isFinite(product.price) && product.price > 0;
  const normalizedQty = Number.isFinite(qty) && qty > 0 ? qty : 1;
  return {
    sku: product.sku,
    label: product.label,
    unit: product.unit,
    qty: normalizedQty,
    price: hasPrice ? product.price : null,
    subtotal: hasPrice ? normalizedQty * product.price : null,
    price_state: hasPrice ? "known" : "pending",
    price_reason: null,
  };
}

/** Validación pura del paso Productos; replica el contrato server/DB. */
export function validatePurchaseItemsForContinue(items: readonly POItem[]): PurchaseItemsValidation {
  const errors: Record<number, PurchaseLineErrors> = {};
  if (items.length === 0) return { valid: false, errors: { 0: { label: "Cargá al menos un producto o servicio." } } };

  items.forEach((item, index) => {
    const line: PurchaseLineErrors = {};
    if (item.label.trim().length < 2) line.label = "Ingresá el producto o servicio.";
    if (!Number.isFinite(item.qty) || item.qty <= 0) line.qty = "La cantidad debe ser mayor a cero.";
    else if (Math.abs(item.qty * 100 - Math.round(item.qty * 100)) >= 1e-7) line.qty = "Usá como máximo dos decimales.";
    if (item.unit.trim().length === 0) line.unit = "Indicá la unidad.";

    const reason = item.price_reason?.trim() ?? "";
    if (item.price_state === "pending") {
      if (item.price !== null || item.subtotal !== null) {
        line.price = "Una línea pendiente no puede contener precio ni subtotal.";
      }
      if (reason.length < 3) line.price_reason = "Explicá por qué el precio está pendiente.";
    } else {
      if (item.price === null || !Number.isFinite(item.price) || item.price < 0) {
        line.price = "Ingresá un precio no negativo.";
      }
      if (item.price_state === "estimated" && reason.length < 3) {
        line.price_reason = "Indicá la fuente o motivo del estimado.";
      }
    }
    if (Object.keys(line).length > 0) errors[index] = line;
  });
  return { valid: Object.keys(errors).length === 0, errors };
}
