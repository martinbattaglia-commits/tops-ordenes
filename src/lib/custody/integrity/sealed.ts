/**
 * Artefactos sellados por el dominio.
 *
 * R3-1. El repositorio ya no puede tratar como confiable un objeto compuesto
 * por el caller. Un artefacto sólo es válido si lo **produjo** una función
 * canónica de validación, y esa procedencia se registra en un `WeakMap`
 * **privado de este módulo**: no hay campo que copiar ni bandera que imitar.
 * Un literal `{ ok: true, … }` con la forma correcta no está registrado y por
 * tanto no pasa.
 *
 * ⚠️ ALCANCE HONESTO DE ESTA GARANTÍA. Esto es defensa en profundidad dentro
 * del proceso, no una frontera de seguridad. Quien ejecute código arbitrario en
 * el mismo proceso puede importar este módulo y sellar lo que quiera. La
 * frontera real es la RPC transaccional en la base (ver
 * WMS-CUSTODY-IA-0221-DESIGN.sql), que revalida todo con el motor. Por eso el
 * repositorio, además de exigir el sello, **re-deriva** los hechos críticos en
 * vez de confiar en el registro.
 */

export type ArtifactKind =
  | "evidence-validation"
  | "chain-verification"
  | "assessment"
  | "inspection-proof";

interface Provenance {
  kind: ArtifactKind;
  /** Contexto al que el artefacto queda atado. Evita reusarlo en otro caso. */
  boundTo: string;
}

const PROVENANCE = new WeakMap<object, Provenance>();

/** Sella un artefacto producido por una función canónica y lo congela. */
export function sealArtifact<T extends object>(
  kind: ArtifactKind,
  boundTo: string,
  value: T
): T {
  const frozen = Object.freeze(value);
  PROVENANCE.set(frozen, { kind, boundTo });
  return frozen;
}

/** ¿Fue producido por el dominio, con esa clase y atado a ese contexto? */
export function isSealedAs(value: unknown, kind: ArtifactKind, boundTo: string): boolean {
  if (typeof value !== "object" || value === null) return false;
  const p = PROVENANCE.get(value as object);
  return p !== undefined && p.kind === kind && p.boundTo === boundTo;
}

/** Clave de contexto de un caso. Ata el artefacto a caso+cliente+entidad. */
export function caseBinding(caseId: string, clientId: string, entityId: string): string {
  return `${caseId}|${clientId}|${entityId}`;
}
