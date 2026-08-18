/**
 * V4 · Armado PURO de la atestación del documento probatorio. Sin IO.
 */

import type { ChainVerification } from "./types";

/**
 * V4-bis · La atestación del DOCUMENTO: la de la decisión, con los ids de la viva.
 *
 * La política exige que la atestación PRECEDA a la decisión (`edad >= 0` en
 * `isAttestationCurrent` contra `decidedAt`), así que una atestación viva,
 * posterior, no puede reemplazar a la almacenada: daría edad negativa y
 * bloquearía siempre. Lo que la viva aporta es lo que la almacenada no tiene:
 * `verified_event_ids` reales.
 *
 * Y basta con que la viva VERIFIQUE: `custody_chain_attestation` recorre la
 * cadena completa, así que una verificación viva en `verified` acredita que la
 * cadena está ÍNTEGRA — incluida la porción hasta el testigo de la decisión —
 * aunque el head haya avanzado por eventos operativos posteriores (pod,
 * entrega). El avance no es adulteración (decisión firmada V4-bis): no se
 * exige igualdad de heads. Cadena ROTA (viva `invalid`/`unverifiable`) o
 * contexto ausente ⇒ se conserva la almacenada con su lista vacía y el
 * documento degrada a acta. Fail-closed.
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
    live.chainHead.length > 0
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
