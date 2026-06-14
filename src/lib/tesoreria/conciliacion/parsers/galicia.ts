/**
 * Parser Banco Galicia (Office Banking) — Conciliación Bancaria IA (S1).
 *
 * Recibe el TEXTO ya extraído del PDF (vía pdf-parse). El PDF es de TEXTO (no
 * escaneado) → cero Vision/IA. PURO: no hace I/O.
 *
 * Estructura del texto (por movimiento):
 *   "DD/MM/YYYY <descripción> $ <saldo>\t<±> $ <importe>"   ← línea principal
 *   "<sub-línea>"  …                                         ← contraparte/CUIT/banco
 * El saldo viene EMBEBIDO al final del segmento previo al tab; el importe
 * (débito −/ crédito +) después del tab. Se descarta el ruido de página.
 */
import type { ParsedLine } from "../types";

const RE_MOV = /^(\d{2}\/\d{2}\/\d{4})\s+(.*)$/;
const RE_RUIDO = [
  /^Office Banking/i,
  /^Movimientos de/i,
  /^CBU:/i,
  /^Fecha de descarga/i,
  /^\d{2}\/\d{2}\/\d{2}\s*-\s*\d{2}:\d{2}hs/, // timestamp de descarga (año 2 díg)
  /^Saldos\s/i, // encabezado de columnas
  /^--\s*\d+\s*of\s*\d+\s*--/i, // "-- 1 of 5 --"
];
const FILLER = new Set(["VARIOS", "FACTURAS", "ABONO", "PVS", "ALQUILERES", "ALQ", "FAC"]);

function esRuido(line: string): boolean {
  return RE_RUIDO.some((r) => r.test(line));
}

function fechaIso(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split("/");
  return `${y}-${m}-${d}`;
}

/** "$ -3.212.437,68" / "- $ 300.582,32" → número en pesos (sin signo). */
function parseArAbs(raw: string): number {
  const clean = raw.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : 0;
}

/** Saldo con signo (puede ser negativo). */
function parseArSigned(raw: string): number {
  const abs = parseArAbs(raw);
  return /-/.test(raw) ? -abs : abs;
}

/** De las sub-líneas extrae contraparte (nombre) y CUIT (11 díg). */
function parseSublineas(sub: string[]): { contraparte: string | null; referencia: string | null } {
  const cuit = sub.find((s) => /^\d{11}$/.test(s.trim())) ?? null;
  const contraparte =
    sub.find((s) => {
      const t = s.trim();
      return (
        /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(t) &&
        !/^\d+$/.test(t) &&
        !/^BANCO\b/i.test(t) &&
        !/^Capital Federal$/i.test(t) &&
        !/^[A-Za-z]+\s+\d{4}$/.test(t) && // "Mayo 2026"
        !FILLER.has(t.toUpperCase())
      );
    })?.trim() ?? null;
  return { contraparte, referencia: cuit };
}

export function parseGalicia(pdfText: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  const lines = pdfText.split(/\r?\n/);
  let orden = 0;

  // Acumulador del movimiento actual + sus sub-líneas.
  let cur: { base: ParsedLine; sub: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const { contraparte, referencia } = parseSublineas(cur.sub);
    cur.base.contraparte = contraparte;
    cur.base.referencia = referencia;
    // Clasificación robusta: concepto + sub-líneas (p.ej. SIRCREB vive en sub-línea).
    cur.base.descripcion = [cur.base.descripcion, ...cur.sub].join(" ").replace(/\s+/g, " ").trim();
    out.push(cur.base);
    cur = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r/g, "");
    if (!line.trim()) continue;
    if (esRuido(line)) {
      flush(); // un bloque de ruido (cambio de página) corta el movimiento actual
      continue;
    }
    const mov = line.match(RE_MOV);
    if (mov) {
      flush();
      const fecha = fechaIso(mov[1]);
      const resto = mov[2];
      const [izq, der = ""] = resto.split("\t");
      // izq = "<desc> $ <saldo>"  ·  der = "<±> $ <importe>"
      const saldoMatch = izq.match(/\$\s*(-?[\d.]+,\d{2})\s*$/);
      const saldo = saldoMatch ? parseArSigned(saldoMatch[1]) : 0;
      const descripcion = saldoMatch ? izq.slice(0, saldoMatch.index).trim() : izq.trim();
      const impMatch = der.match(/([+-])\s*\$\s*([\d.]+,\d{2})/);
      const signo = impMatch ? impMatch[1] : "-";
      const importeAbs = impMatch ? parseArAbs(impMatch[2]) : 0;
      const importe = signo === "+" ? importeAbs : -importeAbs;
      cur = {
        base: {
          ordenArchivo: orden++,
          fecha,
          importe,
          saldo,
          descripcion,
          contraparte: null,
          referencia: null,
          codigoConcepto: null, // Galicia no trae código de concepto
        },
        sub: [],
      };
    } else if (cur) {
      cur.sub.push(line.trim()); // sub-línea del movimiento actual
    }
  }
  flush();
  return out;
}
