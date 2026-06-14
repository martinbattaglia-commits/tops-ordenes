/**
 * Parser Banco Santander — Conciliación Bancaria IA (S1).
 *
 * El "XLS" real de Santander es TEXTO tab-separated (ASCII, CRLF) — NO un BIFF
 * binario — por lo que se parsea como texto plano (cero dependencia de planilla).
 *
 * Layout (7 columnas por fila de movimiento):
 *   [0] fecha YYYYMMDD · [1] descripción · [2] importe ±zeropad.dec ·
 *   [3] referencia/op · [4] canal · [5] saldo ±zeropad.dec · [6] códigoConcepto
 *
 * Fila 0 = metadatos (col0 = CUIT 11 díg). Última fila = totales (col0 = "87").
 * Sólo se toman filas cuyo col0 sea fecha de 8 dígitos.
 *
 * PURO: recibe el texto ya leído del archivo; no hace I/O.
 */
import type { ParsedLine } from "../types";

const RE_FECHA8 = /^\d{8}$/;

function fechaIso(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** "-00000038520.92" / "+00040496269.69" → -38520.92 / 40496269.69 (pesos, signo). */
function parseImporte(raw: string): number {
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : 0;
}

/** Extrae contraparte (nombre) y CUIT de la descripción Santander. */
function parseContraparte(desc: string): { contraparte: string | null; cuit: string | null } {
  const cuitMatch = desc.match(/\b(\d{11})\b/g);
  const cuit = cuitMatch ? cuitMatch[cuitMatch.length - 1] : null;
  // "… - A <nombre>  /…"  ·  "… - De <nombre>  /…"  ·  "recibido - <nombre>  <CUIT>"
  const m =
    desc.match(/\b(?:A|De)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][^/]+?)\s{2,}/) ||
    desc.match(/recibido\s*-\s*([A-Za-zÁÉÍÓÚÑáéíóúñ].+?)\s+\d{11}/i) ||
    desc.match(/-\s*De\s+([A-Za-zÁÉÍÓÚÑáéíóúñ].+?)\s*\//i);
  const contraparte = m ? m[1].replace(/\s+/g, " ").trim() : null;
  return { contraparte, cuit };
}

export function parseSantander(tsvText: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  const lines = tsvText.split(/\r?\n/);
  let orden = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    if (cols.length < 7) continue; // meta (4 cols) y totales (4 cols) quedan fuera
    if (!RE_FECHA8.test(cols[0].trim())) continue; // sólo filas de movimiento

    const descripcion = cols[1].trim();
    const importe = parseImporte(cols[2]);
    const refOp = cols[3].trim();
    const saldo = parseImporte(cols[5]);
    const codigoConcepto = cols[6].trim() || null;
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
