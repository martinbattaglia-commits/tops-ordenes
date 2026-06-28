export type RawRow = Record<string, string>;
export interface RawTable { headers: string[]; rows: RawRow[]; sourceName: string }
export type DetectedFormat = string & { readonly __brand: "DetectedFormat" };
export const asDetectedFormat = (s: string): DetectedFormat => s as DetectedFormat;

export interface FieldDiagnostic { level: "error" | "warn"; code: string; field?: string; message: string }
export type RowStatus = "novo" | "posible" | "exacto"; // 🟢 / 🟡 / 🔴

export interface RowOutcome { valid: boolean; diagnostics: FieldDiagnostic[] }
export interface PreviewRow<TRow> {
  index: number;
  row: TRow;
  valid: boolean;
  diagnostics: FieldDiagnostic[];
  dedupStatus: RowStatus;
  dedupReason: string;
}
export interface PreviewStats {
  registros: number;
  columnas: number;
  errores: number;
  pctValidos: number;
  pctRechazados: number;
  empresasUnicas: number;
  contactosUnicos: number;
  posiblesDuplicados: number;
  duplicadosExactos: number;
  detectedFormat: string;
  sourceSlug: string;
  unmappedHeaders: string[];
  excedeMaxBatch: boolean;
}
export interface PreviewModel<TRow> { rows: PreviewRow<TRow>[]; stats: PreviewStats }
export interface ImportReport { inserted: number; duplicates: number; rejected: number; message: string }
