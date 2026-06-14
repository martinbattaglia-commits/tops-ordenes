/**
 * classify.ts — Heurísticas de clasificación documental (sin I/O).
 *
 * Clasifica un documento por su nombre de archivo, extrae CUIT y razón social
 * aproximada desde el nombre de carpeta, e identifica adendas/rescisiones para
 * el motor de alertas.
 */

import type { ContractDocTipo } from "./types";

const DOC_RULES: { tipo: ContractDocTipo; rx: RegExp }[] = [
  { tipo: "rescision", rx: /rescis|distracto|terminaci[oó]n|\bbaja\b/i },
  { tipo: "carta_documento", rx: /carta\s*documento|\bc\.?d\.?\b|intimaci[oó]n/i },
  { tipo: "renovacion", rx: /renovaci[oó]n|pr[oó]rroga|prorroga/i },
  { tipo: "adenda", rx: /adenda|addendum|anexo|modificaci[oó]n|complementari/i },
  { tipo: "condiciones", rx: /condiciones\s*generales|t[eé]rminos\s*y\s*condiciones/i },
  { tipo: "propuesta", rx: /propuesta|cotizaci[oó]n|oferta/i },
  { tipo: "acuse", rx: /acuse|notificaci[oó]n|conformidad/i },
  { tipo: "nosis", rx: /nosis|veraz|informe\s*crediticio/i },
  { tipo: "contrato", rx: /contrato|comodato|locaci[oó]n|dep[oó]sito|almacenaj/i },
];

/** Clasifica el tipo de instrumento por el nombre de archivo. */
export function classifyDocTipo(filename: string): ContractDocTipo {
  const base = filename.normalize("NFC");
  for (const r of DOC_RULES) if (r.rx.test(base)) return r.tipo;
  return "otro";
}

const CUIT_RX = /\b(\d{2})[-\s.]?(\d{8})[-\s.]?(\d)\b/;

/** Extrae el primer CUIT con formato XX-XXXXXXXX-X de un texto (o null). */
export function parseCuit(text: string): string | null {
  const m = text.match(CUIT_RX);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Razón social aproximada desde el nombre de carpeta (quita CUIT y normaliza). */
export function folderToRazon(folderName: string): string {
  return folderName
    .replace(CUIT_RX, "")
    .replace(/[_]+/g, " ")
    .replace(/\s{2,}/g, " ")
    // Limpia separadores al borde, pero conserva el "." final (p. ej. «S.A.»).
    .replace(/^[\s\-·.]+|[\s\-·]+$/g, "")
    .trim();
}

/** Una adenda o renovación cuenta como modificación contractual relevante. */
export function isAdendaTipo(tipo: ContractDocTipo): boolean {
  return tipo === "adenda" || tipo === "renovacion";
}

export function isRescisionTipo(tipo: ContractDocTipo): boolean {
  return tipo === "rescision";
}
