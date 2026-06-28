import type { MapperPort } from "../kernel/ports";
import type { RawTable, DetectedFormat } from "../kernel/types";

export function mapTable<TRow>(
  table: RawTable,
  mapper: MapperPort<TRow>,
  fmt: DetectedFormat,
  knownHeaders: string[],
): { rows: TRow[]; unmappedHeaders: string[] } {
  const known = new Set(knownHeaders.map((h) => h.toLowerCase()));
  const unmappedHeaders = table.headers.filter((h) => !known.has(h.toLowerCase()));
  const rows = table.rows.map((row) => mapper.map(row, fmt));
  return { rows, unmappedHeaders };
}
