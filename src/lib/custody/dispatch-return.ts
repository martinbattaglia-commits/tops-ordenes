import { parseCanonicalUuid } from "@/lib/custody/canonical-contract";

export interface CustodyDispatchReturn {
  orderId: string | null;
  href: string;
  label: string;
}

/**
 * Construye un retorno interno desde un único UUID canónico. No acepta URLs,
 * paths ni valores normalizables, por lo que no existe superficie de redirect.
 */
export function custodyDispatchReturn(value: unknown): CustodyDispatchReturn {
  const orderId = parseCanonicalUuid(value);
  return orderId
    ? {
        orderId,
        href: `/wms/despachos/${orderId}`,
        label: "Volver al despacho",
      }
    : {
        orderId: null,
        href: "/wms/custody",
        label: "Volver a Custodia",
      };
}
