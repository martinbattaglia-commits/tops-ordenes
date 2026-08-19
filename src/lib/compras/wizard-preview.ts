import type { POItem } from "@/lib/types-po";
import { computeTotals, type Totals } from "./totals";

/**
 * HOTFIX-01 · la vista previa del wizard NO puede tirar abajo la pantalla.
 *
 * `computePurchasePricing` es el validador del dominio: ante una línea
 * incompleta LANZA. El wizard lo invocaba desde su fase de render, así que
 * cualquier borrador que el dominio rechaza terminaba en el error boundary de
 * `app/error.tsx` — «Algo no salió bien» — con el formulario perdido.
 *
 * El caso medido: la proyección anterior tapaba el motivo con `||`, que sólo
 * cubre el string vacío. Al teclear el PRIMER carácter del motivo, el motivo
 * pasaba a ser corto pero verdadero, dejaba de taparse, y `requiredReason`
 * lanzaba en pleno render. Cada usuario que escribía un motivo se estrellaba
 * en la primera tecla; por eso producción no tiene ni una OC pendiente.
 *
 * Acá van las dos mitades del arreglo:
 *  1. la proyección mide LONGITUD, no verdad, así que un motivo a medio
 *     escribir no rompe el contrato del dominio;
 *  2. `previewTotals` no propaga NINGUNA excepción: la vista previa degrada a
 *     «pendiente» y la validación de verdad la sigue haciendo
 *     `validatePurchaseItemsForContinue`, dentro del formulario.
 *
 * La proyección es de sólo lectura: el borrador conserva siempre los bytes
 * que el usuario tipeó, y el submit viaja con ésos.
 */

/** Mínimo que `requiredReason` exige en `pricing.ts`. */
export const PREVIEW_MIN_REASON_LENGTH = 3;

/** Relleno de vista previa; nunca se persiste ni se envía. */
export const PREVIEW_DRAFT_REASON = "Borrador incompleto";

type PreviewLine = Pick<POItem, "qty" | "price" | "price_state" | "price_reason">;

function previewReason(reason: string | null | undefined): string {
  const trimmed = (reason ?? "").trim();
  return trimmed.length >= PREVIEW_MIN_REASON_LENGTH ? trimmed : PREVIEW_DRAFT_REASON;
}

/**
 * Proyecta el borrador a algo que el dominio acepte, sin mutarlo: cantidades
 * no positivas van a 1, un precio ausente se lee como pendiente y un motivo
 * demasiado corto se completa sólo para la vista previa.
 */
export function projectDraftItemsForPreview(items: readonly POItem[]): PreviewLine[] {
  return items.map((item) => {
    const qty = Number.isFinite(item.qty) && item.qty > 0 ? item.qty : 1;
    if (item.price_state === "pending" || item.price === null || !Number.isFinite(item.price)) {
      return { qty, price: null, price_state: "pending", price_reason: previewReason(item.price_reason) };
    }
    if (item.price_state === "estimated") {
      return { qty, price: item.price, price_state: "estimated", price_reason: previewReason(item.price_reason) };
    }
    return { qty, price: item.price, price_state: "known", price_reason: item.price_reason };
  });
}

/**
 * Totales para la vista previa. No lanza: ante un borrador que el dominio
 * rechaza devuelve el estado «pendiente», que es exactamente lo que la
 * pantalla debe mostrar mientras el usuario todavía está cargando.
 */
export function previewTotals(items: readonly POItem[]): Totals {
  try {
    return computeTotals(projectDraftItemsForPreview(items));
  } catch {
    return {
      neto: null,
      iva: null,
      total: null,
      planningNeto: null,
      planningIva: null,
      planningTotal: null,
      state: "pending",
      knownPartialNeto: 0,
      pendingLines: items.length,
    };
  }
}
