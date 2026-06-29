/**
 * Parser de la planilla central 00_ESTADO_COMPLIANCE (Google Sheet → CSV).
 * Determinístico (sin IA). Toda fila válida queda origen='sheet', confianza='confirmada'.
 */
import { normalizar, type NormRow } from "./normalize";
import type { EstadoAdministrativo, Etapa, NivelRiesgo } from "./types";

export interface SheetCaseRow {
  item_id: string;
  sede: string | null;
  tipo_certificado: string | null;
  expediente_nro: string | null;
  organismo: string | null;
  estado_administrativo: EstadoAdministrativo;
  etapa: Etapa | null;
  nivel_riesgo: NivelRiesgo | null;
  fecha_inicio: string | null;
  fecha_pronto_despacho: string | null;
  ultima_actuacion: string | null;
  proxima_accion: string | null;
  observaciones: string | null;
}

/** CSV mínimo robusto: comillas dobles, comas/saltos embebidos, "" como comilla escapada. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const HEADERS: Record<string, keyof SheetCaseRow | "estado_raw" | "etapa_raw" | "riesgo_raw"> = {
  "item id": "item_id",
  "sede": "sede",
  "tipo de certificado": "tipo_certificado",
  "expediente": "expediente_nro",
  "organismo": "organismo",
  "estado administrativo": "estado_raw",
  "fecha de inicio": "fecha_inicio",
  "fecha del pronto despacho": "fecha_pronto_despacho",
  "ultima actuacion": "ultima_actuacion",
  "proxima accion": "proxima_accion",
  "nivel de riesgo": "riesgo_raw",
  "observaciones": "observaciones",
};

const hkey = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const blank = (s: string | undefined): string | null => (s && s.trim() !== "" ? s.trim() : null);

export function parseEstadoSheet(csv: string, dict?: NormRow[]): { rows: SheetCaseRow[]; errors: string[] } {
  const grid = parseCsv(csv).filter((r) => r.some((c) => c.trim() !== ""));
  const errors: string[] = [];
  if (grid.length === 0) return { rows: [], errors: ["Planilla vacía"] };

  const header = grid[0].map(hkey);
  const idx = (logical: string) => header.findIndex((h) => HEADERS[h] === logical);
  const colItem = idx("item_id");
  const colEstado = idx("estado_raw");
  if (colItem < 0 || colEstado < 0) {
    return { rows: [], errors: ["Faltan columnas obligatorias 'Item ID' y/o 'Estado administrativo'"] };
  }

  const get = (cells: string[], logical: string): string | null => {
    const c = idx(logical);
    return c >= 0 ? blank(cells[c]) : null;
  };

  const rows: SheetCaseRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i];
    const itemId = blank(cells[colItem]);
    if (!itemId) { errors.push(`Fila ${i + 1}: falta 'Item ID' — descartada`); continue; }

    const estadoRaw = blank(cells[colEstado]);
    const estado = normalizar(estadoRaw, "estado", dict) as EstadoAdministrativo | null;
    if (!estado) { errors.push(`Fila ${i + 1} (${itemId}): estado no reconocido ("${estadoRaw ?? ""}") — descartada`); continue; }

    const fechaPD = get(cells, "fecha_pronto_despacho");
    let etapa = normalizar(estadoRaw, "etapa", dict) as Etapa | null;
    if (!etapa && fechaPD) etapa = "pronto_despacho"; // inferencia: si hay fecha de pronto despacho

    const nivel = normalizar(get(cells, "riesgo_raw"), "riesgo", dict) as NivelRiesgo | null;

    rows.push({
      item_id: itemId,
      sede: get(cells, "sede"),
      tipo_certificado: get(cells, "tipo_certificado"),
      expediente_nro: get(cells, "expediente_nro"),
      organismo: get(cells, "organismo"),
      estado_administrativo: estado,
      etapa,
      nivel_riesgo: nivel,
      fecha_inicio: get(cells, "fecha_inicio"),
      fecha_pronto_despacho: fechaPD,
      ultima_actuacion: get(cells, "ultima_actuacion"),
      proxima_accion: get(cells, "proxima_accion"),
      observaciones: get(cells, "observaciones"),
    });
  }
  return { rows, errors };
}
