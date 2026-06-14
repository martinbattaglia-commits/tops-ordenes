/**
 * plan.ts — Reglas de decisión PURAS del motor de sincronización (sin I/O).
 *
 * Encapsula la lógica que decide, por documento, si es alta/cambio/sin-cambio,
 * qué alerta dispara, y qué documentos corresponden dar de baja. El motor
 * (`engine.ts`) consume estas funciones; así la lógica es verificable de forma
 * determinista (ver scripts/contracts-sync-gate.ts) sin depender de Drive ni DB.
 *
 * Sólo imports de tipos (se eliminan en runtime) → ejecutable de forma aislada.
 */

import type { ContractDocTipo } from "./types";

export type ChangeKind = "new" | "updated" | "unchanged";
export type SyncAlertAction = "rescision_detectada" | "adenda_modificada";

/** Estado mínimo de un documento ya sincronizado, para diffing. */
export interface ExistingDocState {
  id: string;
  driveFileId: string;
  md5: string | null;
  modified: string | null;
  status: string;
  contractId: string | null;
}

/** Metadata mínima de un archivo de Drive, para diffing. */
export interface DriveFileState {
  md5Checksum: string | null;
  modifiedAt: string | null;
}

/**
 * Clasifica el cambio de un documento: nuevo (no existía), modificado (cambió su
 * checksum o fecha de modificación) o sin cambios.
 */
export function diffDoc(existing: ExistingDocState | undefined, file: DriveFileState): ChangeKind {
  if (!existing) return "new";
  const changed = existing.md5 !== file.md5Checksum || existing.modified !== file.modifiedAt;
  return changed ? "updated" : "unchanged";
}

/**
 * Determina la alerta de sincronización para un documento según su cambio y tipo:
 *  · rescisión recién aparecida → 'rescision_detectada'
 *  · adenda/renovación modificada → 'adenda_modificada'
 */
export function docAlertAction(change: ChangeKind, tipo: ContractDocTipo): SyncAlertAction | null {
  if (change === "new" && tipo === "rescision") return "rescision_detectada";
  if (change === "updated" && (tipo === "adenda" || tipo === "renovacion")) return "adenda_modificada";
  return null;
}

/**
 * Selecciona los documentos a dar de baja: sincronizados, no vistos en la corrida
 * y cuyo contrato SÍ fue recorrido (evita falsos positivos por errores/saltos).
 * Debe invocarse sólo cuando la corrida fue completa (no truncada).
 */
export function planRemovals(
  docs: ExistingDocState[],
  seenDriveIds: Set<string>,
  scannedContractIds: Set<string>,
): ExistingDocState[] {
  return docs.filter(
    (d) =>
      d.status === "synced" &&
      !seenDriveIds.has(d.driveFileId) &&
      (d.contractId == null || scannedContractIds.has(d.contractId)),
  );
}
