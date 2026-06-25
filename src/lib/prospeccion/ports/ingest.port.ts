// Port (driven) · IngestPort — única puerta de escritura masiva de F0. Lo implementa la RPC
// `prospeccion_ingest(p_rows, p_source)` (DEFINER, atómica: prospect + 2 eventos al Outbox en una tx).
// Esto encarna el UnitOfWork de F0 (CS-RPC-1): una RPC = un lote + sus eventos en la misma transacción.
import type { Result } from "../domain/result";
import type { SourceSlugValue } from "../domain/vo/source-slug";

/** Fila normalizada (DTO de persistencia, sin `source`: el origen va por lote = p_source). */
export interface ProspectIngestRow {
  readonly company_name: string | null;
  readonly cuit: string | null;
  readonly website: string | null;
  readonly full_name: string | null;
  readonly cargo: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly linkedin_url: string | null;
  readonly raw: Record<string, unknown>;
}

/** Resultado de la RPC `prospeccion_ingest`. */
export interface IngestResult {
  readonly inserted: number;
  readonly duplicates: number;
}

export interface IngestPort {
  ingest(rows: ReadonlyArray<ProspectIngestRow>, source: SourceSlugValue): Promise<Result<IngestResult>>;
}
