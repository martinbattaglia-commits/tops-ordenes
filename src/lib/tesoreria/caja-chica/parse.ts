// Parser puro de la solapa de ejercicio de «Caja chica .xlsx».
//
// Hallazgos reales (pre-flight contra el archivo) que condicionan el diseño:
//  · Fechas: exceljs las da como JS Date a UTC-medianoche; con TZ AR (GMT-3)
//    cell.text muestra el día ANTERIOR → usar SIEMPRE getUTC* sobre cell.value,
//    nunca cell.text. El año se toma del `periodo` (la solapa), no del Date.
//  · Importes: number nativo (los totales C140/F140 son fórmulas → .result).
//  · SALDO: celda en la columna del banner «SALDO» (I), valor = fórmula =C..-F..
//    → leer .result. Evitar falsos positivos: "saldo" aparece DENTRO del texto de
//    algunos ORIGEN (p.ej. "Pago de Nati por Visa (saldo $963.717)") → match anclado.
//  · Filas de total (importe sin concepto) y filas vacías → excluir.

import { createHash } from "node:crypto";
import type { Worksheet } from "exceljs";
import type { Cell, CellMatrix, ParsedRow, ParsedSheet, CashBoxDirection } from "./types";

const textOf = (c: Cell | undefined): string => (c?.text ?? "") as string;
const valOf = (c: Cell | undefined): unknown => c?.value ?? null;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Importe → number. Acepta number, celda-fórmula exceljs ({result}), o string AR/US. */
export function parseImporte(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object") {
    if (raw instanceof Date) return null;
    const r = raw as { result?: unknown };
    if ("result" in r) return parseImporte(r.result);
    return null;
  }
  if (typeof raw === "number") return Number.isFinite(raw) ? round2(raw) : null;
  let s = String(raw).replace(/[^0-9.,-]/g, "").trim();
  if (!s || s === "-") return null;
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  const dec = lastDot > lastComma ? "." : lastComma > -1 ? "," : "";
  if (dec) {
    const thou = dec === "." ? "," : ".";
    s = s.split(thou).join("").replace(dec, ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? round2(n) : null;
}

/** Fecha → ISO yyyy-mm-dd usando el `periodo` como año. UTC-safe. */
export function parseArgDate(raw: unknown, periodo: number): string | null {
  let day: number, month: number;
  if (raw instanceof Date) {
    day = raw.getUTCDate();
    month = raw.getUTCMonth() + 1;
  } else if (raw != null && raw !== "") {
    const m = String(raw).trim().match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.]\d{2,4})?$/);
    if (!m) return null;
    day = +m[1];
    month = +m[2];
  } else {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(periodo, month - 1, day));
  if (dt.getUTCMonth() !== month - 1) return null; // overflow real (p.ej. 31/02)
  return dt.toISOString().slice(0, 10);
}

/** "dd/mm" para auditoría, reconstruido desde UTC si es Date (cell.text no es confiable). */
export function rawDateString(raw: unknown): string {
  if (raw instanceof Date) {
    const dd = String(raw.getUTCDate()).padStart(2, "0");
    const mm = String(raw.getUTCMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}`;
  }
  return raw == null ? "" : String(raw).trim();
}

/** Hash determinístico de una transacción (para detección de cambios). */
export function rowHash(r: Pick<ParsedRow, "direction" | "periodo" | "source_row" | "tx_date_raw" | "concepto" | "importe">): string {
  return createHash("sha1")
    .update([r.direction, r.periodo, r.source_row, r.tx_date_raw, r.concepto, r.importe].join("|"))
    .digest("hex");
}

/** Localiza el SALDO por la ETIQUETA «SALDO» (no por coordenada fija) y lee su valor/fórmula. */
export function findSaldo(m: CellMatrix): number | null {
  let saldoCol = -1, labelRow = -1;
  for (let i = 0; i < Math.min(m.length, 6) && saldoCol < 0; i++) {
    const row = m[i] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (/^saldo$/i.test(textOf(row[c]).trim())) {
        saldoCol = c;
        labelRow = i;
        break;
      }
    }
  }
  if (saldoCol < 0) return null;
  for (let k = labelRow; k < Math.min(m.length, labelRow + 5); k++) {
    const cell = (m[k] ?? [])[saldoCol];
    const n = parseImporte(valOf(cell) ?? textOf(cell));
    if (n != null) return n;
  }
  return null;
}

/** Índice (0-based) de la fila de headers (ORIGEN/DESTINO o 2× FECHA). */
function headerRowIndex(m: CellMatrix): number {
  for (let i = 0; i < Math.min(m.length, 8); i++) {
    const txt = (m[i] ?? []).map((c) => textOf(c).toUpperCase().trim());
    if (txt.includes("ORIGEN") && txt.includes("DESTINO")) return i;
    if (txt.filter((t) => t === "FECHA").length >= 2) return i;
  }
  return 2; // default observado (headers en fila 3)
}

/** Recorre un lado (acreditados o gastos) y arma sus transacciones. */
function sideRows(
  m: CellMatrix,
  start: number,
  periodo: number,
  dateCol: number,
  conceptCol: number,
  importeCol: number,
  direction: CashBoxDirection,
  corrupt: { n: number },
): ParsedRow[] {
  const out: ParsedRow[] = [];
  for (let i = start; i < m.length; i++) {
    const row = m[i] ?? [];
    const concepto = textOf(row[conceptCol]).trim();
    if (!concepto) continue; // fila vacía, espaciadora o de TOTAL (importe sin concepto)
    const importe = parseImporte(valOf(row[importeCol]) ?? textOf(row[importeCol]));
    if (importe == null) {
      if (textOf(row[importeCol]).trim()) corrupt.n++; // había algo no parseable
      continue;
    }
    const dateRaw = valOf(row[dateCol]) ?? textOf(row[dateCol]);
    const base = {
      periodo,
      direction,
      tx_date: parseArgDate(dateRaw, periodo),
      tx_date_raw: rawDateString(dateRaw),
      concepto,
      importe,
      source_row: i + 1,
    };
    out.push({ ...base, categoria: null, row_hash: rowHash(base) });
  }
  return out;
}

/** Parsea una matriz de celdas (una solapa) → ParsedSheet. Función pura y testeable. */
export function parseMatrix(m: CellMatrix, periodo: number): ParsedSheet {
  const start = headerRowIndex(m) + 1;
  const corrupt = { n: 0 };
  const acred = sideRows(m, start, periodo, 0, 1, 2, "acreditado", corrupt);
  const gastos = sideRows(m, start, periodo, 3, 4, 5, "gasto", corrupt);
  const rows = [...acred, ...gastos];
  const totalAcreditado = round2(acred.reduce((s, r) => s + r.importe, 0));
  const totalGasto = round2(gastos.reduce((s, r) => s + r.importe, 0));
  const saldoCalc = round2(totalAcreditado - totalGasto);
  const saldoExcel = findSaldo(m);
  const saldoSource = saldoExcel == null ? "calc_fallback" : "label";
  const saldoResuelto = saldoExcel == null ? saldoCalc : saldoExcel;
  return { periodo, rows, totalAcreditado, totalGasto, saldoCalc, saldoExcel, saldoResuelto, saldoSource, corruptCount: corrupt.n };
}

/** Adaptador exceljs → CellMatrix (cols A..I). No se unit-testea; se valida en dry-run. */
export function extractMatrix(ws: Worksheet): CellMatrix {
  const m: CellMatrix = [];
  const MAX_COL = 9; // A..I
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: Cell[] = [];
    for (let c = 1; c <= MAX_COL; c++) {
      const cell = row.getCell(c);
      // Defensa: algunas celdas (fórmulas con result null, tipos raros) hacen
      // throw al leer .value/.text. No deben tumbar el parseo del período.
      let value: unknown = null;
      let text = "";
      try { value = cell.value; } catch { value = null; }
      try { text = cell.text ?? ""; } catch { text = value == null ? "" : String(value); }
      cells.push({ value, text });
    }
    m.push(cells);
  });
  return m;
}
