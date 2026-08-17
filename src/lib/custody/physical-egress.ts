/**
 * PUERTA DE EGRESO · EL LADO SERVIDOR · S2-3 · Adenda N.º 2 §4.2
 *
 * La máquina de estados vive en `egress-gate.ts` y es pura. Este módulo es lo
 * único que toca sesión, Storage y base: registra la foto de egreso y traduce
 * el rechazo. La separación es deliberada — ver el docblock de `egress-gate`.
 */

import {
  attachPhysicalEvidence,
  classifyPhysicalAttachRejection,
} from "@/lib/custody/physical-ingress";
import { guidance } from "@/lib/custody/blocker-guidance";
import type { CustodyLevel } from "@/lib/custody/egress-gate";

export type { CustodyLevel, EgressGateInput, EgressGateState } from "@/lib/custody/egress-gate";
export { evaluateEgressGate } from "@/lib/custody/egress-gate";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * Registra la FOTO DE EGRESO.
 *
 * Delega el binario, el hash, la atestación y el adjunto en
 * `attachPhysicalEvidence`: es el único lugar donde se sube evidencia física, y
 * duplicarlo dejaría dos superficies de seguridad divergiendo en silencio — la
 * misma razón por la que `physical-ingress.ts` se extrajo de la server action.
 *
 * Lo que ESTE módulo agrega es la puerta por nivel, y la agrega ANTES del
 * upload. La base ya rechaza `foto_egreso` sobre una unidad de nivel 1 con
 * motivo legible (0252 §7b), así que sin esta guarda el operario subiría el
 * binario, esperaría, y recién ahí se enteraría. El rechazo temprano no
 * reemplaza al de la base: lo anticipa. Si los dos desaparecieran el nivel 1
 * quedaría con foto de egreso, y por eso el de la base es el que manda.
 */
export async function registerEgressEvidence(
  form: FormData,
  unitLevel: CustodyLevel,
): Promise<Result<{ evidence_id: string; event_public_id: string }>> {
  if (unitLevel < 2) {
    return { ok: false, error: guidance("CUSTODY_EGRESS_NOT_APPLICABLE") };
  }
  const stage = form.get("stage");
  const eventType = form.get("event_type");
  if (stage !== "despacho" || eventType !== "foto_egreso") {
    return { ok: false, error: "Solicitud de captura de egreso inválida" };
  }
  return attachPhysicalEvidence(form);
}

/**
 * Traduce el rechazo de egreso que devuelve la base. Reusa el clasificador del
 * ingreso —los motivos de adjunto son los mismos— y agrega el único que es
 * propio del egreso: el de nivel.
 */
export function classifyEgressRejection(message: string): string | null {
  const m = (message || "").toLowerCase();
  if (m.includes("nivel 1") || m.includes("no lleva foto de egreso")) {
    return guidance("CUSTODY_EGRESS_NOT_APPLICABLE");
  }
  return classifyPhysicalAttachRejection(message);
}
