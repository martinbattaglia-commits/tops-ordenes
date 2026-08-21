/**
 * Dominio de Conceptos Libres en Órdenes de Servicio TOPS.
 * Soporta hasta 5 conceptos independientes con cálculo de IVA y retrocompatibilidad.
 */

export interface ConceptoLibreItem {
  id: string;
  label: string;
  price: number;
  observ: string;
}

export interface ConceptoLibre {
  enabled: boolean;
  label?: string;
  price?: number;
  observ?: string;
  items?: ConceptoLibreItem[];
}

/**
 * Normaliza el estado de concepto libre garantizando retrocompatibilidad
 * con órdenes antiguas de 1 solo concepto libre.
 */
export function normalizeConceptoLibreItems(cl: ConceptoLibre): ConceptoLibreItem[] {
  if (Array.isArray(cl.items) && cl.items.length > 0) {
    return cl.items;
  }
  return [
    {
      id: "item-1",
      label: cl.label ?? "",
      price: cl.price ?? 0,
      observ: cl.observ ?? "",
    },
  ];
}
