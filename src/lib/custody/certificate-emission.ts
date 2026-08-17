/**
 * EMISIÓN DEL DOCUMENTO PROBATORIO · 2-C-2.
 *
 * ─── QUÉ FALTABA, EXACTAMENTE ────────────────────────────────────────────
 *
 * `evaluateCertificateEligibility` está escrita, completa y verificada tres
 * veces, con sus 22 códigos de bloqueo. Y **no la llamaba nadie**: medido sobre
 * el árbol, sus únicos consumidores eran su propio módulo y la suite de tests.
 *
 * Lo que faltaba no era política. Era un consumidor.
 *
 * ─── EL CERTIFICADO NO REEMPLAZA AL POD ──────────────────────────────────
 *
 * Son documentos distintos y conviven:
 *
 *   · el **POD** prueba la ENTREGA del despacho, con la firma de quien recibe;
 *   · el **certificado** prueba la INTEGRIDAD de la unidad bajo custodia, y sale
 *     de la decisión humana sobre el caso.
 *
 * Uno no sustituye al otro y ninguno bloquea al otro.
 *
 * ─── CERTIFICADO O ACTA · LO DECIDE LA POLÍTICA, NO ESTE MÓDULO ──────────
 *
 * `evaluateCertificateEligibility` devuelve `certificate` cuando no hay ningún
 * bloqueo y `acta_inspeccion` cuando los hay. Este módulo **no reinterpreta ese
 * veredicto**: lo transporta, y traduce los bloqueos con el traductor guía de
 * 2-B para que digan qué falta y qué hacer en vez de un código.
 *
 * Que exista un acta y no un certificado no es un error ni un fallo de emisión:
 * es el documento correcto para un caso que se liberó sin alcanzar la barra
 * probatoria completa —una liberación por override humano, típicamente—. El
 * sistema emite igual, y dice cuál de los dos emitió.
 *
 * ─── LA FILA YA ESTÁ PERSISTIDA · NO SE INSERTA NADA ACÁ ─────────────────
 *
 * `custody_release_certificates` la escribe la BASE al liberar (`0251:257`),
 * dentro de la misma transacción que registra la decisión, y la tabla es
 * inmutable por trigger. Este módulo LEE esa fila —posible desde 0254, que
 * agregó la política de tenant que faltaba— y la combina con el veredicto de la
 * política. Emitir desde la aplicación una fila que la base ya escribe sería
 * duplicar el asiento probatorio, y con la tabla inmutable ni siquiera se
 * podría corregir.
 */

import "server-only";

import { evaluateCertificateEligibility } from "@/lib/custody/integrity/certificate-policy";
import type {
  CertificateContext,
  DocumentKind,
} from "@/lib/custody/integrity/certificate-policy";
import { guidanceList } from "@/lib/custody/blocker-guidance";

/** Lo que la fila persistida aporta al documento. */
export interface PersistedCertificate {
  id: string;
  basis: string;
  chainHeadAtRelease: string;
  issuedAt: string;
}

/** El documento, ya resuelto y listo para pintar. */
export interface CustodyDocument {
  /** `certificate` o `acta_inspeccion`. Lo decide la política. */
  kind: DocumentKind;
  /** `true` sólo para el certificado sin bloqueos. */
  isCertificate: boolean;
  /** Motivos por los que NO es certificado, ya guiados. Vacío si lo es. */
  reasons: string[];
  /** La fila probatoria, si la base la escribió. `null` si el caso no se liberó. */
  persisted: PersistedCertificate | null;
  /**
   * `true` cuando la política dice `certificate` pero no hay fila persistida.
   * Es una incoherencia real y se declara en vez de esconderse: significa que
   * el caso figura liberado y la base no dejó asiento.
   */
  missingPersistedRow: boolean;
}

/**
 * Resuelve el documento que corresponde a un caso.
 *
 * No decide nada por su cuenta: delega en la política y en lo que la base
 * persistió. `persisted` en `null` con `kind: "acta_inspeccion"` es el caso
 * normal de un caso que todavía no se liberó.
 */
export function resolveCustodyDocument(
  ctx: CertificateContext,
  persisted: PersistedCertificate | null,
): CustodyDocument {
  const eligibility = evaluateCertificateEligibility(ctx);
  const isCertificate = eligibility.document === "certificate";
  return {
    kind: eligibility.document,
    isCertificate,
    reasons: guidanceList(eligibility.blockers),
    persisted,
    missingPersistedRow: isCertificate && persisted === null,
  };
}
