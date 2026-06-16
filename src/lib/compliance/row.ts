/**
 * row.ts — Mapeo puro fila de `compliance_items` (Supabase) → ComplianceItem (UI).
 *
 * Sin dependencias de Next/Supabase: lo comparten el loader server-side
 * (source.ts) y el motor de sync (sync/engine.ts). Computa los campos de
 * presentación (`venc_fmt`, `emi_fmt`) a partir de las fechas crudas; `dias`,
 * `estado` y `riesgo` se recalculan luego en runtime con deriveComplianceStatus.
 */

import type { ComplianceItem, Riesgo, Sede } from "./data";

/** Fila tal como vuelve de la tabla compliance_items. */
export interface ComplianceRow {
  id: string;
  sede: string;
  categoria: string;
  documento: string;
  organismo: string | null;
  tipo: string | null;
  emision: string | null;
  vencimiento: string | null;
  frecuencia: string | null;
  estado: string | null;
  riesgo: string;
  fuente: string | null;
  nota: string | null;
  docs: number | null;
}

/** "YYYY-MM-DD" → "DD/MM/YYYY". `empty` si la fecha es nula/ inválida. */
export function fmtDmy(date: string | null | undefined, empty: string): string {
  if (!date) return empty;
  const m = date.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return empty;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

const RIESGOS: Riesgo[] = ["Verde", "Amarillo", "Naranja", "Rojo"];
const SEDES: Sede[] = ["MAGALDI", "LUJAN"];

export function rowToItem(r: ComplianceRow): ComplianceItem {
  const riesgo: Riesgo = RIESGOS.includes(r.riesgo as Riesgo) ? (r.riesgo as Riesgo) : "Amarillo";
  const sede: Sede = SEDES.includes(r.sede as Sede) ? (r.sede as Sede) : "MAGALDI";
  return {
    id: r.id,
    sede,
    categoria: r.categoria,
    documento: r.documento,
    organismo: r.organismo ?? "",
    tipo: r.tipo ?? "",
    emision: r.emision ? r.emision.slice(0, 10) : null,
    vencimiento: r.vencimiento ? r.vencimiento.slice(0, 10) : null,
    frecuencia: r.frecuencia ?? "",
    estado: r.estado ?? "",
    riesgo,
    fuente: r.fuente ?? "",
    nota: r.nota ?? "",
    docs: r.docs ?? 0,
    // Recalculados por deriveComplianceStatus; placeholder coherente acá.
    dias: null,
    venc_fmt: fmtDmy(r.vencimiento, "Sin venc."),
    emi_fmt: fmtDmy(r.emision, "—"),
  };
}

/** Columnas a seleccionar de compliance_items (single source of truth del SELECT). */
export const COMPLIANCE_ITEM_COLUMNS =
  "id,sede,categoria,documento,organismo,tipo,emision,vencimiento,frecuencia,estado,riesgo,fuente,nota,docs";
