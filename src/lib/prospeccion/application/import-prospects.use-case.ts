// Caso de uso · ImportProspects (Parte II §2.3). Orquesta: valida cada fila vía VOs/AR (dominio),
// descarta inválidas con motivo, mapea a DTO y delega la escritura atómica en IngestPort.
// Depende SOLO de ports (AP-3/AP-15): IdGeneratorPort + IngestPort.
import { type Result, ok } from "../domain/result";
import { ProspectFactory, type ProspectImportInput } from "../domain/prospect";
import { SourceSlug } from "../domain/vo/source-slug";
import { makeProspectId } from "../domain/vo/prospect-id";
import type { IdGeneratorPort } from "../ports/id-generator.port";
import type { IngestPort, ProspectIngestRow } from "../ports/ingest.port";

export interface ImportProspectsCommand {
  readonly source: string;
  readonly rows: ReadonlyArray<ProspectImportInput>;
}

export interface RejectedRow {
  readonly index: number;
  readonly reason: string;
}

export interface ImportProspectsResult {
  readonly received: number;
  readonly valid: number;
  readonly inserted: number;
  readonly duplicates: number;
  readonly rejected: ReadonlyArray<RejectedRow>;
}

/** Guarda de seguridad: tope de lote para no agotar el timeout serverless (CONS-H1, NFB-1). */
export const MAX_BATCH = 500;

export class ImportProspectsUseCase {
  constructor(
    private readonly ids: IdGeneratorPort,
    private readonly ingest: IngestPort,
  ) {}

  async execute(cmd: ImportProspectsCommand): Promise<Result<ImportProspectsResult>> {
    const sourceR = SourceSlug.create(cmd.source);
    if (!sourceR.ok) return sourceR;
    const source = sourceR.value;

    const rows = cmd.rows.slice(0, MAX_BATCH);
    const valid: ProspectIngestRow[] = [];
    const rejected: RejectedRow[] = [];

    rows.forEach((row, index) => {
      const idR = makeProspectId(this.ids.uuid());
      if (!idR.ok) {
        rejected.push({ index, reason: idR.error.message });
        return;
      }
      const prospectR = ProspectFactory.fromImportRow(idR.value, source, row);
      if (!prospectR.ok) {
        rejected.push({ index, reason: prospectR.error.message });
        return;
      }
      const s = prospectR.value.toSnapshot();
      valid.push({
        company_name: s.company_name,
        cuit: s.cuit,
        website: s.website,
        full_name: s.full_name,
        cargo: s.cargo,
        email: s.email,
        phone: s.phone,
        linkedin_url: s.linkedin_url,
        raw: s.raw,
      });
    });

    if (valid.length === 0) {
      return ok({ received: rows.length, valid: 0, inserted: 0, duplicates: 0, rejected });
    }

    const ingestR = await this.ingest.ingest(valid, source.value);
    if (!ingestR.ok) return ingestR;

    return ok({
      received: rows.length,
      valid: valid.length,
      inserted: ingestR.value.inserted,
      duplicates: ingestR.value.duplicates,
      rejected,
    });
  }
}
