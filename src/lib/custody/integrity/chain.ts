/**
 * Verificación de cadena con ATESTACIÓN. Módulo puro (puerto inyectado).
 *
 * REVISIÓN 3. `verified` ya no es un booleano con un conteo: es una atestación
 * completa producida POR LA VERIFICACIÓN, que ata el resultado a la entidad y
 * al head de la cadena, con su propio timestamp.
 *
 * Exige acumulativamente:
 *   1. `valid === true`;
 *   2. `events_checked` entero finito y > 0;
 *   3. `verified_event_ids` cubre los eventos de las evidencias comparadas;
 *   4. `chain_head` no vacío — ancla el estado de la cadena en ese instante;
 *   5. `attested_at` ISO emitido por la RPC (NO la hora del caso de uso);
 *   6. `scope`/`entity_id` devueltos coinciden con los consultados.
 *
 * ⚠️ REQUISITO ABIERTO. `verify_custody_chain` (0038) hoy devuelve sólo
 * `valid`, `events_checked` y `first_error`. Con ese contrato, las condiciones
 * 3–6 no pueden satisfacerse y el resultado es SIEMPRE `unverifiable`. Es la
 * conducta correcta: preferimos retener a afirmar. La RPC futura debe emitir la
 * atestación completa (ver WMS-CUSTODY-IA-0221-DESIGN.sql).
 */

import { sealArtifact } from "./sealed";
import type { ChainAttestation, ChainVerification, CustodyEntityScope } from "./types";
import { isIsoInstant, isNonEmptyId, isPositiveInt, msBetween } from "./validation";

export interface RawVerifyChainResult {
  valid: boolean;
  events_checked: number;
  first_error: { public_id?: string; chain_seq?: number; reason?: string } | null;
  /** Requisitos abiertos de la RPC. */
  verified_event_ids?: readonly string[] | null;
  chain_head?: string | null;
  attested_at?: string | null;
  scope?: string | null;
  entity_id?: string | null;
}

export type VerifyChainPort = (
  packingUnitId: string | null,
  shipmentId: string | null
) => Promise<RawVerifyChainResult>;

function isRaw(value: unknown): value is RawVerifyChainResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.valid === "boolean" && typeof v.events_checked === "number";
}

export interface VerifyChainRequest {
  scope: CustodyEntityScope;
  entityId: string;
  requiredEventIds: readonly string[];
  /** Sólo se usa para fechar resultados NO verificados. Nunca acredita nada. */
  verifiedAtIso: string;
  /** Contexto del caso al que queda atado el artefacto sellado. */
  boundTo?: string;
}

export async function verifyChainForCase(
  verifyChain: VerifyChainPort,
  request: VerifyChainRequest
): Promise<ChainVerification> {
  const { scope, entityId, requiredEventIds, verifiedAtIso } = request;
  const bound = request.boundTo ?? "";
  const unverifiable = (error: string): ChainVerification =>
    sealArtifact("chain-verification", bound, {
      status: "unverifiable" as const,
      verifiedAt: verifiedAtIso,
      error,
    });

  let raw: unknown;
  try {
    raw = await verifyChain(
      scope === "packing_unit" ? entityId : null,
      scope === "shipment" ? entityId : null
    );
  } catch (e) {
    return unverifiable(e instanceof Error ? e.message : String(e));
  }

  if (!isRaw(raw)) return unverifiable("verify_custody_chain devolvió una respuesta malformada");

  if (!raw.valid) {
    return sealArtifact("chain-verification", bound, {
      status: "invalid" as const,
      eventsChecked: isPositiveInt(raw.events_checked) ? raw.events_checked : 0,
      verifiedAt: verifiedAtIso,
      firstError: raw.first_error
        ? {
            publicId: raw.first_error.public_id,
            chainSeq: raw.first_error.chain_seq,
            reason: raw.first_error.reason,
          }
        : null,
    });
  }

  // valid === true. Todo lo demás debe sostenerlo.
  if (!isPositiveInt(raw.events_checked)) {
    return unverifiable(`events_checked no es creíble: ${String(raw.events_checked)}`);
  }

  if (!Array.isArray(raw.verified_event_ids)) {
    return unverifiable(
      "la RPC no acredita qué eventos recorrió; sin vinculación evidencia↔cadena no " +
        "se puede afirmar verificación (requisito abierto de la RPC)"
    );
  }
  const covered = new Set(raw.verified_event_ids.filter(isNonEmptyId));
  const missing = requiredEventIds.filter((id) => !covered.has(id));
  if (requiredEventIds.length === 0 || missing.length > 0) {
    return unverifiable(
      `evidencias no vinculadas a la cadena verificada: ${missing.join(", ") || "sin eventos requeridos"}`
    );
  }
  if (raw.events_checked < requiredEventIds.length) {
    return unverifiable("events_checked es menor que la cantidad de eventos requeridos");
  }

  if (!isNonEmptyId(raw.chain_head)) {
    return unverifiable("la RPC no devuelve chain_head: la atestación no ancla el estado de la cadena");
  }
  if (!isIsoInstant(raw.attested_at)) {
    return unverifiable("la RPC no devuelve attested_at: la hora del caller no acredita verificación");
  }
  if (raw.scope !== scope || raw.entity_id !== entityId) {
    return unverifiable("la atestación no corresponde a la entidad consultada");
  }

  const attestation: ChainAttestation = {
    scope,
    entityId,
    chainHead: raw.chain_head,
    eventsChecked: raw.events_checked,
    verifiedEventIds: [...covered],
    attestedAt: raw.attested_at,
  };
  return sealArtifact("chain-verification", bound, { status: "verified" as const, attestation });
}

/** Vigencia máxima de una atestación para sostener una liberación. */
export const ATTESTATION_MAX_AGE_MINUTES = 60;

/**
 * ¿La atestación sigue siendo válida al decidir?
 *
 * Ata la decisión al head verificado: si la cadena creció o cambió entre la
 * evaluación y la liberación, la atestación ya no la describe.
 */
export function isAttestationCurrent(
  attestation: ChainAttestation,
  currentChainHead: string | null,
  nowIso: string,
  maxAgeMinutes: number = ATTESTATION_MAX_AGE_MINUTES
): boolean {
  if (!isIsoInstant(attestation.attestedAt) || !isIsoInstant(nowIso)) return false;
  if (!isNonEmptyId(currentChainHead) || currentChainHead !== attestation.chainHead) return false;
  const age = msBetween(attestation.attestedAt, nowIso);
  return age >= 0 && age <= maxAgeMinutes * 60_000;
}
