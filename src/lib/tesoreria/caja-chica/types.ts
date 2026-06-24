// Tipos del submódulo Tesorería › Caja Chica (espejo read-only de Drive).

export type CashBoxDirection = "acreditado" | "gasto";

/** Origen del saldo mostrado: la celda «SALDO» de la planilla, o el cálculo Σ. */
export type SaldoSource = "label" | "calc_fallback";

/** Celda normalizada del adaptador exceljs (valor crudo + texto formateado). */
export interface Cell {
  value: unknown;
  text: string;
}
export type CellMatrix = Cell[][];

/** Una transacción parseada (lista para el payload de cash_box_replace_periodo). */
export interface ParsedRow {
  periodo: number;
  direction: CashBoxDirection;
  tx_date: string | null; // ISO yyyy-mm-dd (null si la fecha es inválida/ausente)
  tx_date_raw: string; // "dd/mm" reconstruido desde UTC (auditoría)
  concepto: string; // ORIGEN (acreditado) o DESTINO (gasto)
  importe: number;
  categoria: string | null; // null en el parser; se resuelve en FASE 3
  source_row: number; // fila 1-based en la planilla
  row_hash: string; // determinístico
}

/** Resultado de parsear una solapa de ejercicio completa. */
export interface ParsedSheet {
  periodo: number;
  rows: ParsedRow[];
  totalAcreditado: number;
  totalGasto: number;
  saldoCalc: number; // Σ(acreditado) − Σ(gasto)
  saldoExcel: number | null; // celda «SALDO» (null si no se halló la etiqueta)
  saldoResuelto: number; // saldoExcel ?? saldoCalc
  saldoSource: SaldoSource;
  corruptCount: number; // conceptos con importe presente pero no parseable
}

/** Regla de categorización (usada en FASE 3). */
export interface CategoryRule {
  match_type: "contains" | "regex" | "exact";
  pattern: string;
  categoria: string;
  prioridad: number;
  activo: boolean;
}
