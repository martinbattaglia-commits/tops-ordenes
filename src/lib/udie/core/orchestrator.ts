import type { DomainPack, ReaderRegistry, DetectorRegistry, NormalizerPort, Projector } from "../kernel/ports";
import { ok, err, domainError, type Result } from "../kernel/result";
import { asDetectedFormat, type DetectedFormat, type ImportReport, type PreviewModel, type RowOutcome } from "../kernel/types";
import { resolveReader } from "../readers/reader-for-file";
import { mapTable } from "./mapper";
import { buildPreview } from "./preview-model";

export interface OrchestratorDeps<TRow, TReport> {
  readers: ReaderRegistry;
  detectors: DetectorRegistry;
  defaultNormalizer: NormalizerPort;
  pack: DomainPack<TRow, TReport>;
  maxBatch: number;
  projector?: Projector<TRow>;
  formatToSlug?: (fmt: DetectedFormat) => string; // el consumidor mapea formato→slug del catálogo; el Core no conoce slugs
}

export function createOrchestrator<TRow, TReport>(deps: OrchestratorDeps<TRow, TReport>) {
  const { mapping, commit } = deps.pack;
  const projector: Projector<TRow> = deps.projector ?? (() => ({ company: null, contactKey: null }));

  return {
    async plan(file: Blob, override?: { format?: DetectedFormat }): Promise<Result<PreviewModel<TRow>>> {
      const meta = { name: (file as File).name ?? "archivo", type: file.type };
      const readerR = resolveReader(deps.readers, meta);
      if (!readerR.ok) return readerR;
      const tableR = await readerR.value.read(file);
      if (!tableR.ok) return tableR;

      const normalizer = mapping.normalizer ?? deps.defaultNormalizer;
      let table = normalizer.normalize(tableR.value, asDetectedFormat("unknown"));

      const detected = override?.format
        ? { format: override.format, confidence: 1 }
        : deps.detectors.detect(table);
      const fmt = detected?.format ?? asDetectedFormat("Generic CSV");

      if (mapping.enricher) table = await mapping.enricher.enrich(table, fmt);

      const aliasHeaders = Object.keys(mapping.aliases);
      const { rows, unmappedHeaders } = mapTable<TRow>(table, mapping.mapperFor(fmt), fmt, aliasHeaders);
      const outcomes: RowOutcome[] = rows.map((row) => mapping.validator.validate(row));

      const sourceSlug = (deps.formatToSlug ?? (() => "csv"))(fmt);
      const model = mapping.preview.build(rows, outcomes, fmt, sourceSlug, unmappedHeaders, table.headers.length);
      return ok(model);
    },

    async commit(decision: { proceed: boolean; source: string }, rows: TRow[]): Promise<Result<ImportReport>> {
      if (!decision.proceed) return err(domainError("CANCELLED", "importación cancelada por el usuario"));
      const r = await commit.executor.execute(rows, decision.source);
      if (!r.ok) return r;
      return ok(commit.reporter.toReport(r.value));
    },
  };
}

// El Core nunca conoce el catálogo de slugs: el consumidor inyecta `formatToSlug` (ver wiring en Task 14).
