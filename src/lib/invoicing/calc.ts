/**
 * Cálculo fiscal de comprobantes: totales por alícuota, validación de la
 * identidad ImpTotal = ImpNeto + ImpIVA + no gravado + exento + tributos,
 * mapeos de tipo de comprobante, y número en letras para el PDF.
 */

import {
  CbteTipo,
  Concepto,
  alicuotaToId,
  type CbteTipoCode,
  type AlicIva,
} from "@/lib/arca/types";
import type { ComprobanteTipo, InvoiceItem, CondicionIva } from "./types";

const CBTE_MAP: Record<ComprobanteTipo, CbteTipoCode> = {
  FACTURA_A: CbteTipo.FACTURA_A,
  NOTA_DEBITO_A: CbteTipo.NOTA_DEBITO_A,
  NOTA_CREDITO_A: CbteTipo.NOTA_CREDITO_A,
  FACTURA_B: CbteTipo.FACTURA_B,
  NOTA_DEBITO_B: CbteTipo.NOTA_DEBITO_B,
  NOTA_CREDITO_B: CbteTipo.NOTA_CREDITO_B,
  FACTURA_C: CbteTipo.FACTURA_C,
  NOTA_DEBITO_C: CbteTipo.NOTA_DEBITO_C,
  NOTA_CREDITO_C: CbteTipo.NOTA_CREDITO_C,
  FACTURA_E: CbteTipo.FACTURA_E,
};

export function comprobanteToCbteTipo(t: ComprobanteTipo): CbteTipoCode {
  return CBTE_MAP[t];
}

/**
 * Determina el tipo de comprobante (Factura A/B/C) según la condición IVA
 * del receptor. Emisor RI: a RI/Monotributo → A, a CF/Exento → B.
 */
export function comprobanteParaReceptor(cond: CondicionIva): ComprobanteTipo {
  switch (cond) {
    case "RESPONSABLE_INSCRIPTO":
      return "FACTURA_A";
    case "MONOTRIBUTO":
    case "EXENTO":
    case "CONSUMIDOR_FINAL":
    case "NO_RESPONSABLE":
    case "NO_CATEGORIZADO":
    default:
      return "FACTURA_B";
  }
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Calcula neto/iva/total de un renglón a partir de cantidad y precio unitario (neto). */
export function computeItem(
  input: Pick<InvoiceItem, "cantidad" | "precio_unitario" | "alicuota_iva">
): Pick<InvoiceItem, "alic_iva_id" | "importe_neto" | "importe_iva" | "importe_total"> {
  const neto = round2(Number(input.cantidad) * Number(input.precio_unitario));
  const iva = round2(neto * (Number(input.alicuota_iva) / 100));
  return {
    alic_iva_id: alicuotaToId(Number(input.alicuota_iva)),
    importe_neto: neto,
    importe_iva: iva,
    importe_total: round2(neto + iva),
  };
}

export interface InvoiceTotals {
  subtotal: number; // neto gravado
  iva: number;
  importe_no_gravado: number;
  importe_exento: number;
  percepciones: number;
  tributos: number;
  total: number;
  /** Alícuotas discriminadas para el array Iva del request ARCA. */
  alicuotas: AlicIva[];
}

/** Agrega los renglones en totales fiscales + array de alícuotas por Id. */
export function computeInvoiceTotals(
  items: InvoiceItem[],
  opts: { percepciones?: number; tributos?: number } = {}
): InvoiceTotals {
  const byId = new Map<number, { base: number; importe: number }>();
  let subtotal = 0;
  let iva = 0;

  for (const it of items) {
    const c = computeItem(it);
    subtotal += c.importe_neto;
    iva += c.importe_iva;
    const cur = byId.get(c.alic_iva_id) ?? { base: 0, importe: 0 };
    cur.base += c.importe_neto;
    cur.importe += c.importe_iva;
    byId.set(c.alic_iva_id, cur);
  }

  subtotal = round2(subtotal);
  iva = round2(iva);
  const percepciones = round2(opts.percepciones ?? 0);
  const tributos = round2(opts.tributos ?? 0);
  const total = round2(subtotal + iva + percepciones + tributos);

  const alicuotas: AlicIva[] = Array.from(byId.entries()).map(([Id, v]) => ({
    Id: Id as AlicIva["Id"],
    BaseImp: round2(v.base),
    Importe: round2(v.importe),
  }));

  return {
    subtotal,
    iva,
    importe_no_gravado: 0,
    importe_exento: 0,
    percepciones,
    tributos,
    total,
    alicuotas,
  };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validaciones previas a solicitar CAE. Replica las que ARCA aplica:
 * identidad de importes, datos del receptor según comprobante, etc.
 */
export function validateInvoice(input: {
  tipo_comprobante: ComprobanteTipo;
  cuit_cliente: string | null;
  items: InvoiceItem[];
  totals: InvoiceTotals;
  concepto: number;
  fch_serv_desde: string | null;
  fch_serv_hasta: string | null;
}): ValidationResult {
  const errors: string[] = [];

  if (input.items.length === 0) {
    errors.push("El comprobante no tiene renglones.");
  }

  // Identidad fiscal: ImpTotal = neto + iva + no gravado + exento + tributos.
  const sum = round2(
    input.totals.subtotal +
      input.totals.iva +
      input.totals.importe_no_gravado +
      input.totals.importe_exento +
      input.totals.percepciones +
      input.totals.tributos
  );
  if (sum !== round2(input.totals.total)) {
    errors.push(
      `Inconsistencia de importes: neto+iva+otros (${sum}) ≠ total (${round2(
        input.totals.total
      )}).`
    );
  }

  if (input.totals.total <= 0) {
    errors.push("El total debe ser mayor a cero.");
  }

  // Factura A exige CUIT del receptor.
  const letraA = input.tipo_comprobante.endsWith("_A");
  if (letraA && !input.cuit_cliente) {
    errors.push("Factura A: el receptor debe tener CUIT.");
  }

  // Concepto Servicios/Ambos exige fechas de servicio.
  if (
    (input.concepto === Concepto.SERVICIOS ||
      input.concepto === Concepto.PRODUCTOS_Y_SERVICIOS) &&
    (!input.fch_serv_desde || !input.fch_serv_hasta)
  ) {
    errors.push(
      "Concepto Servicios/Ambos: se requieren fechas de servicio (desde/hasta)."
    );
  }

  return { ok: errors.length === 0, errors };
}

/** Fecha → yyyymmdd (formato ARCA). */
export function toArcaDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** yyyymmdd → yyyy-mm-dd (ISO para guardar / QR). */
export function fromArcaDate(s: string): string {
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return s;
}

// ---- Número en letras (es-AR) -------------------------------------------

const UNIDADES = [
  "",
  "UNO",
  "DOS",
  "TRES",
  "CUATRO",
  "CINCO",
  "SEIS",
  "SIETE",
  "OCHO",
  "NUEVE",
  "DIEZ",
  "ONCE",
  "DOCE",
  "TRECE",
  "CATORCE",
  "QUINCE",
  "DIECISEIS",
  "DIECISIETE",
  "DIECIOCHO",
  "DIECINUEVE",
  "VEINTE",
];
const DECENAS = [
  "",
  "",
  "VEINTI",
  "TREINTA",
  "CUARENTA",
  "CINCUENTA",
  "SESENTA",
  "SETENTA",
  "OCHENTA",
  "NOVENTA",
];
const CENTENAS = [
  "",
  "CIENTO",
  "DOSCIENTOS",
  "TRESCIENTOS",
  "CUATROCIENTOS",
  "QUINIENTOS",
  "SEISCIENTOS",
  "SETECIENTOS",
  "OCHOCIENTOS",
  "NOVECIENTOS",
];

function centenasEnLetras(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  let txt = CENTENAS[c];
  if (resto > 0) {
    if (resto <= 20) {
      txt += (txt ? " " : "") + UNIDADES[resto];
    } else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      const dec = d === 2 ? "VEINTI" : DECENAS[d] + (u > 0 ? " Y " : "");
      txt += (txt ? " " : "") + dec + (u > 0 ? UNIDADES[u] : "");
    }
  }
  return txt.trim();
}

function enteroEnLetras(n: number): string {
  if (n === 0) return "CERO";
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const parts: string[] = [];
  if (millones > 0) {
    parts.push(
      millones === 1 ? "UN MILLON" : `${centenasEnLetras(millones)} MILLONES`
    );
  }
  if (miles > 0) {
    parts.push(miles === 1 ? "MIL" : `${centenasEnLetras(miles)} MIL`);
  }
  if (resto > 0) parts.push(centenasEnLetras(resto));
  return parts.join(" ").trim();
}

/** "1234.56" → "SON PESOS UN MIL DOSCIENTOS TREINTA Y CUATRO CON 56/100". */
export function montoEnLetras(monto: number, moneda = "PESOS"): string {
  const entero = Math.floor(monto);
  const centavos = Math.round((monto - entero) * 100);
  return `SON ${moneda} ${enteroEnLetras(entero)} CON ${String(centavos).padStart(
    2,
    "0"
  )}/100`;
}
