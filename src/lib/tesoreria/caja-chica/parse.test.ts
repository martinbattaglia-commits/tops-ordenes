import { describe, it, expect } from "vitest";
import { parseImporte, parseArgDate, rawDateString, findSaldo, parseMatrix, rowHash } from "./parse";
import type { Cell, CellMatrix } from "./types";

const c = (value: unknown, text?: string): Cell => ({ value, text: text ?? (value == null ? "" : String(value)) });
const E: Cell = { value: null, text: "" };
const D = (y: number, m1: number, d: number): Date => new Date(Date.UTC(y, m1 - 1, d));
const R = (cells: Record<number, Cell>): Cell[] => Array.from({ length: 9 }, (_, i) => cells[i] ?? E);

/** Fixture fiel a la solapa real 2026 (lados asimétricos, total, falso positivo). */
function fixture2026(withSaldoLabel = true): CellMatrix {
  return [
    R({ 0: c("2026 Caja Chica ") }),
    R({ 0: c("ACREDITADOS "), 3: c("GASTOS "), 8: withSaldoLabel ? c("SALDO ") : E }),
    R({
      0: c("FECHA "), 1: c("ORIGEN "), 2: c("IMPORTE "),
      3: c("FECHA "), 4: c("DESTINO"), 5: c("IMPORTE"),
      8: withSaldoLabel ? c({ formula: "C140-F140", result: 5512186 }, "$5,512,186.00") : E,
    }),
    // fila 4: cell.text trae el día ANTERIOR (TZ AR) a propósito; el parser usa cell.value
    R({ 0: c(D(2026, 1, 2), "Thu Jan 01 2026 21:00"), 1: c("Planilla del 2025"), 2: c(2349395),
        3: c(D(2026, 1, 2)), 4: c("Recolector de residuos "), 5: c(10000) }),
    R({ 0: c(D(2026, 1, 7)), 1: c("Pago de Divanlito "), 2: c(8430000),
        3: c(D(2026, 1, 8)), 4: c("Almuerzos de Martin"), 5: c(13000) }),
    // falso positivo: "saldo" DENTRO del ORIGEN → no debe tomarse como celda de saldo
    R({ 0: c(D(2026, 3, 13)), 1: c("Pago de Nati por Visa (saldo $963.717)"), 2: c(1621963),
        3: c(D(2026, 1, 12)), 4: c("Quartier "), 5: c(4000) }),
    // espaciadora del lado acreditados; gastos continúan
    R({ 3: c(D(2026, 1, 15)), 4: c("Coca Cola "), 5: c(15000) }),
    R({ 3: c(D(2026, 2, 10)), 4: c("Manu a Rendir"), 5: c(15500) }),
    // fila de TOTAL: importe sin concepto (como C140/F140) → excluir
    R({ 2: c(99999999), 5: c(88888888) }),
  ];
}

describe("parseImporte", () => {
  it("number nativo de exceljs pasa derecho", () => expect(parseImporte(10000)).toBe(10000));
  it("celda-fórmula exceljs → usa .result", () => expect(parseImporte({ formula: "C140-F140", result: 5512186 })).toBe(5512186));
  it("redondea a 2 decimales", () => expect(parseImporte(10.005)).toBe(10.01));
  it("string US $2,349,395.00", () => expect(parseImporte("$2,349,395.00")).toBe(2349395));
  it("string AR $8.430.000,00", () => expect(parseImporte("$8.430.000,00")).toBe(8430000));
  it("vacío → null", () => expect(parseImporte("")).toBeNull());
  it("basura → null", () => expect(parseImporte("n/a")).toBeNull());
  it("Date → null (no es importe)", () => expect(parseImporte(D(2026, 1, 2))).toBeNull());
});

describe("parseArgDate (UTC-safe, año desde periodo)", () => {
  it("Date de exceljs no se corre de día (gotcha TZ)", () => expect(parseArgDate(D(2026, 1, 2), 2026)).toBe("2026-01-02"));
  it("string dd/mm", () => expect(parseArgDate("07/01", 2026)).toBe("2026-01-07"));
  it("string dd/mm/yyyy ignora el año del texto y usa el periodo", () => expect(parseArgDate("05/03/2025", 2026)).toBe("2026-03-05"));
  it("inválida 31/02 → null", () => expect(parseArgDate("31/02", 2026)).toBeNull());
  it("texto suelto → null", () => expect(parseArgDate("varios", 2026)).toBeNull());
  it("vacío → null", () => expect(parseArgDate("", 2026)).toBeNull());
});

describe("rawDateString", () => {
  it("desde Date reconstruye dd/mm por UTC", () => expect(rawDateString(D(2026, 1, 2))).toBe("02/01"));
  it("desde string lo deja trim", () => expect(rawDateString(" 12/05 ")).toBe("12/05"));
});

describe("findSaldo (por etiqueta, no por coordenada)", () => {
  it("lee el .result de la fórmula en la columna del banner SALDO", () => expect(findSaldo(fixture2026(true))).toBe(5512186));
  it("ignora 'saldo' que aparece DENTRO del texto de un ORIGEN", () => {
    // el único 5512186 viene del banner; el 1621963 con '(saldo ...)' no se confunde
    expect(findSaldo(fixture2026(true))).not.toBe(1621963);
  });
  it("sin etiqueta SALDO → null (dispara fallback)", () => expect(findSaldo(fixture2026(false))).toBeNull());
});

describe("parseMatrix (solapa completa)", () => {
  const ps = parseMatrix(fixture2026(true), 2026);
  const acred = ps.rows.filter((r) => r.direction === "acreditado");
  const gastos = ps.rows.filter((r) => r.direction === "gasto");

  it("separa lados asimétricos", () => {
    expect(acred).toHaveLength(3);
    expect(gastos).toHaveLength(5);
  });
  it("excluye la fila de totales (importe sin concepto)", () => {
    expect(ps.rows.some((r) => r.importe === 99999999 || r.importe === 88888888)).toBe(false);
  });
  it("totales correctos", () => {
    expect(ps.totalAcreditado).toBe(12401358);
    expect(ps.totalGasto).toBe(57500);
    expect(ps.saldoCalc).toBe(12343858);
  });
  it("saldo por etiqueta (no fallback)", () => {
    expect(ps.saldoExcel).toBe(5512186);
    expect(ps.saldoSource).toBe("label");
    expect(ps.saldoResuelto).toBe(5512186);
  });
  it("fecha no se corre de día y concepto = ORIGEN/DESTINO", () => {
    const planilla = acred.find((r) => r.concepto === "Planilla del 2025")!;
    expect(planilla.tx_date).toBe("2026-01-02");
    expect(planilla.tx_date_raw).toBe("02/01");
    expect(gastos.find((r) => r.concepto === "Recolector de residuos")).toBeTruthy();
  });
  it("incluye la fila con 'saldo' en el texto como acreditado normal", () => {
    expect(acred.some((r) => r.importe === 1621963)).toBe(true);
  });
});

describe("parseMatrix — fallback Σ cuando no hay etiqueta SALDO", () => {
  const ps = parseMatrix(fixture2026(false), 2026);
  it("saldoExcel null y source calc_fallback", () => {
    expect(ps.saldoExcel).toBeNull();
    expect(ps.saldoSource).toBe("calc_fallback");
  });
  it("saldoResuelto = Σ(acreditado) − Σ(gasto)", () => {
    expect(ps.saldoResuelto).toBe(ps.saldoCalc);
    expect(ps.saldoResuelto).toBe(12343858);
  });
});

describe("multi-ejercicio", () => {
  it("el año sale del periodo, no del Date de la celda", () => {
    const ps = parseMatrix(fixture2026(true), 2027);
    expect(ps.periodo).toBe(2027);
    expect(ps.rows.every((r) => r.tx_date === null || r.tx_date.startsWith("2027-"))).toBe(true);
  });
});

describe("row_hash", () => {
  it("determinístico y único por fila", () => {
    const ps = parseMatrix(fixture2026(true), 2026);
    const hashes = new Set(ps.rows.map((r) => r.row_hash));
    expect(hashes.size).toBe(ps.rows.length);
  });
  it("estable entre corridas idénticas", () => {
    const a = parseMatrix(fixture2026(true), 2026).rows.map((r) => r.row_hash);
    const b = parseMatrix(fixture2026(true), 2026).rows.map((r) => r.row_hash);
    expect(a).toEqual(b);
  });
  it("cambia si cambia el importe", () => {
    const base = { direction: "gasto" as const, periodo: 2026, source_row: 5, tx_date_raw: "10/02", concepto: "Nafta", importe: 12000 };
    expect(rowHash(base)).not.toBe(rowHash({ ...base, importe: 12001 }));
  });
});

describe("corruptCount", () => {
  it("cuenta conceptos con importe no parseable, sin incluirlos", () => {
    const m: CellMatrix = [
      R({ 0: c("FECHA"), 1: c("ORIGEN"), 2: c("IMPORTE"), 3: c("FECHA"), 4: c("DESTINO"), 5: c("IMPORTE") }),
      R({ 1: c("Algo raro"), 2: c("n/a") }), // concepto presente, importe basura → corrupto, excluido
      R({ 1: c("Bueno"), 2: c(500) }),
    ];
    const ps = parseMatrix(m, 2026);
    expect(ps.corruptCount).toBe(1);
    expect(ps.rows.filter((r) => r.direction === "acreditado")).toHaveLength(1);
  });
});
