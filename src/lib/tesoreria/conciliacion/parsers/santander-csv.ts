/**
 * Parser Banco Santander — formato CSV ("Descargar últimos movimientos").
 *
 * CSV `;`-separado CON ENCABEZADO NOMBRADO:
 *   Fecha;Suc. Origen;Desc. Sucursal;Cod. Operativo;Referencia;Concepto;Importe;Saldo
 *
 * Particularidades reales (vs el XLS/TSV):
 *  - Importe/Saldo en formato AR contable: negativos ENTRE PARÉNTESIS `(374,22)`,
 *    miles `.`, decimales `,`.
 *  - Encoding Latin-1 (acentos); los campos numéricos/códigos son ASCII.
 *  - DOS secciones: "Movimientos del Día" (saldo VACÍO → intradía, se excluyen)
 *    y "Últimos Movimientos" (con saldo). Sólo se toman filas con saldo.
 *  - SIN fila de totales (el XLS sí la trae).
 *
 * PURO: recibe el texto ya decodificado; no hace I/O. Emite `ParsedLine[]` →
 * mismo normalizador que el resto de los bancos (`normalize(_, "santander")`).
 */
import type { ParsedLine } from "../types";

const RE_FECHA = /^\d{2}\/\d{2}\/\d{4}$/;

function fechaIso(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split("/");
  return `${y}-${m}-${d}`;
}

/** "(374,22)" → -374.22 · "2.711.231,00" → 2711231 · "" → null. */
function parseArParen(raw: string): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const neg = s.startsWith("(") && s.includes(")");
  const clean = s.replace(/[()\s]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(clean);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

function parseContraparte(desc: string): { contraparte: string | null; cuit: string | null } {
  const cuitMatch = desc.match(/\b(\d{11})\b/g);
  const cuit = cuitMatch ? cuitMatch[cuitMatch.length - 1] : null;
  const m =
    desc.match(/\b(?:A|De)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][^/]+?)\s{2,}/) ||
    desc.match(/recibido\s*-\s*([A-Za-zÁÉÍÓÚÑáéíóúñ].+?)\s+\d{11}/i);
  const contraparte = m ? m[1].replace(/\s+/g, " ").trim() : null;
  return { contraparte, cuit };
}

export function parseSantanderCsv(csvText: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  let orden = 0;
  for (const rawLine of csvText.split(/\r?\n/)) {
    const line = rawLine.replace(/\r/g, "");
    if (!RE_FECHA.test(line.split(";")[0]?.trim() ?? "")) continue; // descarta títulos/ruido/encabezados
    const cols = line.split(";");
    if (cols.length < 8) continue;
    const importe = parseArParen(cols[6]);
    const saldo = parseArParen(cols[7]);
    if (importe === null || saldo === null) continue; // filas "del día" (saldo vacío) → intradía, fuera

    const descripcion = cols[5].trim();
    const codigoConcepto = cols[3].trim() || null;
    const refOp = cols[4].trim();
    const { contraparte, cuit } = parseContraparte(descripcion);
    const referencia = [refOp, cuit].filter(Boolean).join("/") || null;

    out.push({
      ordenArchivo: orden++,
      fecha: fechaIso(cols[0].trim()),
      importe,
      saldo,
      descripcion,
      contraparte,
      referencia,
      codigoConcepto,
    });
  }
  return out;
}
