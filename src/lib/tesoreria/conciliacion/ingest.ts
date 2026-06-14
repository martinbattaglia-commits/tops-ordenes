/**
 * Orquestación de ingesta + mapeo de persistencia — Conciliación Bancaria IA (S4).
 *
 * PURO (sin I/O ni Supabase): recibe el CONTENIDO ya extraído del extracto
 * (texto para CSV/XLS/PDF-Galicia) + los candidatos `treasury_movements`, corre
 * el pipeline completo (parse → normalize → validar continuidad → clasificar →
 * conciliar) y construye el PAYLOAD de persistencia (filas listas para insertar
 * vía RPC). También reconstruye el resultado desde filas de DB (para el
 * dashboard), garantizando round-trip idéntico.
 *
 * La capa de I/O (leer archivo, pdf-parse, llamar RPC, subir al bucket) vive en
 * el route/actions; acá no se toca la red.
 */
import type { Banco, NormalizedLine } from "./types";
import { normalize, validateSaldoContinuity } from "./normalize";
import { parseGalicia } from "./parsers/galicia";
import { parseSantander } from "./parsers/santander";
import { parseSantanderCsv } from "./parsers/santander-csv";
import { conciliar, type ConciliarOpts, type MatchLinea, type MovimientoNexus, type ResultadoConciliacion } from "./matching";
import { dashboard, type DashboardConciliacion } from "./dashboard";

export type SourceKind = "csv" | "xls" | "pdf";

const cents = (n: number) => Math.round((Number(n) || 0) * 100);

// ── Filas de persistencia (espejo de las tablas 0078) ──────────────────────
export interface StatementRow {
  banco: Banco;
  source_kind: SourceKind;
  period_from: string | null;
  period_to: string | null;
  opening_balance: number; // pesos
  closing_balance: number; // pesos
  hash: string; // idempotencia
}
export interface LineRow {
  line_no: number;
  fecha: string;
  descripcion: string;
  importe: number; // pesos ABS
  direction: "ingreso" | "egreso";
  saldo: number; // pesos
  referencia: string | null;
  contraparte: string | null;
  categoria: "sistemico" | "operativo";
  subtipo: string | null;
  codigo_concepto: string | null;
  match_status: "conciliado" | "posible" | "no_conciliado" | "diferencia" | "sistemico";
}
export interface MatchRow {
  line_no: number; // enlaza con LineRow
  score: number;
  method: string;
  status: "sugerido" | "aceptado" | "rechazado";
  motivo: string;
  movement_ids: string[]; // para la tabla puente N:M
}

export interface IngestPayload {
  statement: StatementRow;
  lines: LineRow[];
  matches: MatchRow[];
}

export interface IngestResult {
  lineas: NormalizedLine[];
  resultado: ResultadoConciliacion;
  metrics: DashboardConciliacion;
  deltaCents: number;
  saldoOk: boolean; // Δ saldo == 0
  payload: IngestPayload;
}

/** djb2 — hash determinista del contenido (idempotencia). Sin crypto. */
function hashContenido(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

function parsePorBanco(contenido: string, banco: Banco, source: SourceKind) {
  if (banco === "galicia") return parseGalicia(contenido); // texto pdf-parse
  return source === "csv" ? parseSantanderCsv(contenido) : parseSantander(contenido);
}

/** Estado de la LÍNEA al momento de la ingesta: nada se concilia sin humano. */
function lineStatus(m: MatchLinea): LineRow["match_status"] {
  if (m.estado === "sistemico") return "sistemico";
  if (m.estado === "no_conciliado") return "no_conciliado";
  return "posible"; // conciliado/posible del motor → sugerencia pendiente de aprobación
}

export function procesarExtracto(args: {
  contenido: string;
  banco: Banco;
  sourceKind: SourceKind;
  candidatos: MovimientoNexus[];
  opts?: ConciliarOpts;
}): IngestResult {
  const lineas = normalize(parsePorBanco(args.contenido, args.banco, args.sourceKind), args.banco);
  const v = validateSaldoContinuity(lineas);
  const resultado = conciliar(lineas, args.candidatos, args.opts);
  const metrics = dashboard(resultado, v.deltaCents);

  const fechas = lineas.map((l) => l.fecha).sort();
  const lineRows: LineRow[] = resultado.matches.map((m, i) => ({
    line_no: i,
    fecha: m.linea.fecha,
    descripcion: m.linea.descripcion,
    importe: m.linea.importe / 100,
    direction: m.linea.tipo === "credito" ? "ingreso" : "egreso",
    saldo: m.linea.saldo / 100,
    referencia: m.linea.referencia,
    contraparte: m.linea.contraparte,
    categoria: m.linea.categoria,
    subtipo: m.linea.subtipo,
    codigo_concepto: m.linea.codigoConcepto,
    match_status: lineStatus(m),
  }));
  const matchRows: MatchRow[] = resultado.matches
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.estado !== "sistemico" && m.movimientoIds.length > 0)
    .map(({ m, i }) => ({ line_no: i, score: m.score, method: m.metodo, status: "sugerido" as const, motivo: m.motivo, movement_ids: m.movimientoIds }));

  const payload: IngestPayload = {
    statement: {
      banco: args.banco,
      source_kind: args.sourceKind,
      period_from: fechas[0] ?? null,
      period_to: fechas[fechas.length - 1] ?? null,
      opening_balance: v.openingCents / 100,
      closing_balance: v.closingCents / 100,
      hash: hashContenido(args.contenido),
    },
    lines: lineRows,
    matches: matchRows,
  };

  return { lineas, resultado, metrics, deltaCents: v.deltaCents, saldoOk: v.ok, payload };
}

/**
 * Reconstruye el resultado para el dashboard a partir de filas de DB (lectura).
 * `accepted` marca los matches ya aceptados por un humano (→ estado conciliado).
 */
export function reconstruirResultado(
  lines: (LineRow & { id?: string })[],
  matches: (MatchRow & { accepted?: boolean })[],
  movById: Map<string, MovimientoNexus>
): { matches: MatchLinea[]; movimientos: MovimientoNexus[] } {
  const matchByLine = new Map(matches.map((m) => [m.line_no, m]));
  const out: MatchLinea[] = lines.map((l) => {
    const linea: NormalizedLine = {
      fecha: l.fecha,
      importe: cents(l.importe),
      tipo: l.direction === "ingreso" ? "credito" : "debito",
      descripcion: l.descripcion,
      contraparte: l.contraparte,
      referencia: l.referencia,
      saldo: cents(l.saldo),
      categoria: l.categoria,
      subtipo: (l.subtipo as NormalizedLine["subtipo"]) ?? null,
      codigoConcepto: l.codigo_concepto,
    };
    if (l.categoria === "sistemico") {
      return { linea, estado: "sistemico", metodo: "sistemico", score: 100, movimientoIds: [], motivo: `sistémico: ${l.subtipo ?? "—"}` };
    }
    const mr = matchByLine.get(l.line_no);
    if (!mr) return { linea, estado: "no_conciliado", metodo: "ninguno", score: 0, movimientoIds: [], motivo: "sin contraparte en Nexus" };
    const estado = mr.accepted ? "conciliado" : "posible";
    return { linea, estado, metodo: mr.method as MatchLinea["metodo"], score: mr.score, movimientoIds: mr.movement_ids, motivo: mr.motivo };
  });
  const movimientos = Array.from(movById.values());
  return { matches: out, movimientos };
}
