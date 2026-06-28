import type { Result } from "./result";
import type {
  RawRow, RawTable, DetectedFormat, FieldDiagnostic, RowOutcome, PreviewModel,
} from "./types";

export type FieldNormalizer = (raw: string) => string;

export interface ReaderPort {
  id: string;
  accepts(file: { name: string; type: string }): boolean;
  read(file: Blob): Promise<Result<RawTable>>;
}
export interface FormatDetectorPort {
  id: string;
  detect(table: RawTable): { format: DetectedFormat; confidence: number } | null; // confidence ∈ [0,1]
}
export interface NormalizerPort { normalize(table: RawTable, fmt: DetectedFormat): RawTable }
export interface EnricherPort { enrich(table: RawTable, fmt: DetectedFormat): Promise<RawTable> }

export interface MapperPort<TRow> { format: DetectedFormat; map(row: RawRow, fmt: DetectedFormat): TRow }
export interface ValidatorPort<TRow> { validate(row: TRow): RowOutcome }
export interface DedupKeyExtractorPort<TRow> {
  keysOf(row: TRow): Record<string, string | null>;
  primaryKey(row: TRow): string | null;
}
export type Projector<TRow> = (row: TRow) => { company: string | null; contactKey: string | null };
export interface PreviewBuilderPort<TRow> {
  build(rows: TRow[], outcomes: RowOutcome[], fmt: DetectedFormat, sourceSlug: string, unmappedHeaders: string[], columnas: number): PreviewModel<TRow>;
}
export interface ExecutorPort<TRow, TReport> { execute(rows: TRow[], source: string): Promise<Result<TReport>> }
export interface PersistenceReporterPort<TReport> { toReport(r: TReport): { inserted: number; duplicates: number; rejected: number; message: string } }

export interface MappingPack<TRow> {
  aliases: Record<string, keyof TRow>;
  mapperFor(fmt: DetectedFormat): MapperPort<TRow>;
  normalizer?: NormalizerPort;
  enricher?: EnricherPort;
  validator: ValidatorPort<TRow>;
  dedup: DedupKeyExtractorPort<TRow>;
  preview: PreviewBuilderPort<TRow>;
}
export interface CommitPack<TRow, TReport> {
  executor: ExecutorPort<TRow, TReport>;
  reporter: PersistenceReporterPort<TReport>;
}
export interface DomainPack<TRow, TReport> {
  contextId: string;
  mapping: MappingPack<TRow>;
  commit: CommitPack<TRow, TReport>;
}

export interface ReaderRegistry {
  register(r: ReaderPort): void;
  resolve(file: { name: string; type: string }): ReaderPort | null;
  list(): readonly ReaderPort[];
}
export interface DetectorRegistry {
  register(d: FormatDetectorPort): void;
  detect(table: RawTable): { format: DetectedFormat; confidence: number } | null;
  list(): readonly FormatDetectorPort[];
}
export type { FieldDiagnostic };
