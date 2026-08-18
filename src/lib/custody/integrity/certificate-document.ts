/**
 * V4 · Armado PURO de la atestación del documento probatorio. Sin IO.
 */

import type { ChainVerification } from "./types";

/**
 * V4 · La atestación del DOCUMENTO: la de la decisión, confirmada por la viva.
 *
 * La política exige que la atestación PRECEDA a la decisión (`edad >= 0` en
 * `isAttestationCurrent` contra `decidedAt`), así que una atestación viva,
 * posterior, no puede reemplazar a la almacenada: daría edad negativa y
 * bloquearía siempre. Lo que la viva aporta es lo que la almacenada no tiene:
 * `verified_event_ids` reales — y sólo cuando re-deriva EXACTAMENTE el mismo
 * head. Cadena cambiada, viva no verificada o contexto ausente ⇒ se conserva
 * la almacenada con su lista vacía y el documento degrada a acta. Fail-closed.
 */
export function buildDocumentChain(
  stored: ChainVerification | null,
  live: {
    status: string;
    chainHead: string | null;
    verifiedEventIds: readonly string[];
  } | null,
): ChainVerification | null {
  if (
    stored?.status === "verified" &&
    live !== null &&
    live.status === "verified" &&
    typeof live.chainHead === "string" &&
    live.chainHead.length > 0 &&
    live.chainHead === stored.attestation.chainHead
  ) {
    return {
      status: "verified",
      attestation: {
        ...stored.attestation,
        verifiedEventIds: [...live.verifiedEventIds],
      },
    };
  }
  return stored;
}
