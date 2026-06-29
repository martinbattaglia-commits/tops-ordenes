/**
 * Paso 0 del cron: leer la planilla 00_ESTADO_COMPLIANCE (Google Sheet → CSV),
 * normalizar y upsert idempotente en compliance_cases (origen='sheet', confianza='confirmada').
 * No muta nada fuera de compliance_cases.
 */
import { createHash } from "crypto";
import { exportGoogleFile } from "@/lib/drive/client";
import { parseEstadoSheet, type SheetCaseRow } from "./sheet";
import { canTransition } from "./transitions";
import type { EstadoAdministrativo } from "./types";
import type { NormRow } from "./normalize";

export interface CaseRecord {
  item_id: string;
  sede: string | null;
  tipo_certificado: string | null;
  expediente_nro: string | null;
  organismo: string | null;
  estado_administrativo: string;
  etapa: string | null;
  nivel_riesgo: string | null;
  fecha_inicio: string | null;
  fecha_pronto_despacho: string | null;
  ultima_actuacion: string | null;
  proxima_accion: string | null;
  observaciones: string | null;
  origen: "sheet";
  confianza: "confirmada";
  activo: true;
  row_hash: string;
  last_synced_at: string;
}

export function mapSheetRowToCaseRecord(r: SheetCaseRow, now: string = new Date().toISOString()): CaseRecord {
  const hash = createHash("sha1").update(JSON.stringify(r)).digest("hex");
  return {
    item_id: r.item_id,
    sede: r.sede,
    tipo_certificado: r.tipo_certificado,
    expediente_nro: r.expediente_nro,
    organismo: r.organismo,
    estado_administrativo: r.estado_administrativo,
    etapa: r.etapa,
    nivel_riesgo: r.nivel_riesgo,
    fecha_inicio: r.fecha_inicio,
    fecha_pronto_despacho: r.fecha_pronto_despacho,
    ultima_actuacion: r.ultima_actuacion,
    proxima_accion: r.proxima_accion,
    observaciones: r.observaciones,
    origen: "sheet",
    confianza: "confirmada",
    activo: true,
    row_hash: hash,
    last_synced_at: now,
  };
}

export interface EvidenceRecord {
  case_id: string | null;
  item_id: string | null;
  from_estado: string | null;
  to_estado: string;
  origen: "sheet";
  nivel_verificacion: "confirmada";
  fecha_evidencia: string | null;
  drive_file_id: string | null;
  url: string | null;
  titulo: string | null;
  descripcion: string | null;
}

/** Construye la evidencia de un cambio de estado (D12). En iteración 1 el respaldo es la planilla. */
export function evidenceFor(args: {
  caseId: string | null;
  itemId: string | null;
  from: EstadoAdministrativo | null;
  to: EstadoAdministrativo;
  fecha: string | null;
  titulo?: string | null;
}): EvidenceRecord {
  return {
    case_id: args.caseId,
    item_id: args.itemId,
    from_estado: args.from,
    to_estado: args.to,
    origen: "sheet",
    nivel_verificacion: "confirmada",
    fecha_evidencia: args.fecha,
    drive_file_id: null,
    url: null,
    titulo: args.titulo ?? "Planilla 00_ESTADO_COMPLIANCE",
    descripcion: `Cambio de estado ${args.from ?? "—"} → ${args.to} confirmado en la planilla.`,
  };
}

/** Decide qué filas se aplican y cuáles se bloquean por transición inválida (D11). PURA. */
export function planCaseChanges(
  rows: SheetCaseRow[],
  prior: Map<string, EstadoAdministrativo>,
): { apply: SheetCaseRow[]; blocked: { item_id: string; from: EstadoAdministrativo; to: EstadoAdministrativo }[] } {
  const apply: SheetCaseRow[] = [];
  const blocked: { item_id: string; from: EstadoAdministrativo; to: EstadoAdministrativo }[] = [];
  for (const r of rows) {
    const from = prior.get(r.item_id) ?? "sin_iniciar";
    const to = r.estado_administrativo;
    if (canTransition(from, to)) apply.push(r);
    else blocked.push({ item_id: r.item_id, from, to });
  }
  return { apply, blocked };
}

// AdminDb laxo para no acoplar al tipo de Supabase en este módulo.
type DbLike = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export interface SyncCasesDeps {
  fileId: string;
  /** Lector de CSV (inyectable para test). Default: exportGoogleFile como CSV. */
  readCsv?: (fileId: string) => Promise<string>;
  /** Diccionario adicional (DB). Default: DEFAULT_DICT del parser. */
  dict?: NormRow[];
}

export async function syncCasesFromSheet(
  db: DbLike,
  deps: SyncCasesDeps,
): Promise<{ upserted: number; closed: number; evidence: number; blocked: number; errors: string[]; skipped?: string }> {
  if (!deps.fileId) return { upserted: 0, closed: 0, evidence: 0, blocked: 0, errors: [], skipped: "COMPLIANCE_ESTADO_SHEET_FILE_ID ausente" };
  const read = deps.readCsv ?? ((id: string) => exportGoogleFile(id, "text/csv"));

  let csv: string;
  try {
    csv = await read(deps.fileId);
  } catch (e) {
    return { upserted: 0, closed: 0, evidence: 0, blocked: 0, errors: [`No se pudo leer la planilla: ${e instanceof Error ? e.message : String(e)}`] };
  }

  const { rows, errors } = parseEstadoSheet(csv, deps.dict);
  const now = new Date().toISOString();

  // Estado activo previo por ítem (para validar transición, D11).
  const prior = new Map<string, EstadoAdministrativo>();
  const itemIds = [...new Set(rows.map((r) => r.item_id))];
  if (itemIds.length) {
    const { data, error } = await db
      .from("compliance_cases")
      .select("item_id,estado_administrativo")
      .in("item_id", itemIds)
      .eq("activo", true);
    if (error) errors.push(`Lectura de casos activos: ${error.message}`);
    for (const c of (data ?? []) as Array<{ item_id: string; estado_administrativo: EstadoAdministrativo }>) {
      prior.set(c.item_id, c.estado_administrativo);
    }
  }

  const { apply, blocked } = planCaseChanges(rows, prior);

  // Transiciones inválidas → NO se aplican: alerta de revisión + error de corrida (D11).
  for (const b of blocked) errors.push(`Transición no permitida ${b.from}→${b.to} para ${b.item_id}: cambio no aplicado.`);
  if (blocked.length) {
    const reviewRows = blocked.map((b) => ({
      item_id: b.item_id, nivel: "warning", kind: "review",
      titulo: `${b.item_id} — transición de estado no permitida`,
      detalle: `La planilla pide ${b.from}→${b.to}, transición inválida. Estado conservado. Revisar.`,
      estado: "abierta", origen: "sheet", confianza: "confirmada",
    }));
    const { error } = await db.from("compliance_alerts").insert(reviewRows);
    if (error) errors.push(`Alertas de revisión (transiciones): ${error.message}`);
  }

  let closed = 0, upserted = 0, evidence = 0;
  for (const r of apply) {
    const from = prior.get(r.item_id) ?? null;
    if (from === r.estado_administrativo) continue; // idempotencia: sin cambio → sin evidencia

    // 1) Cerrar el caso activo previo (sólo origen sheet).
    const close = await db
      .from("compliance_cases")
      .update({ activo: false, updated_at: now })
      .eq("item_id", r.item_id).eq("activo", true).eq("origen", "sheet");
    if (close.error) { errors.push(`Cierre previo ${r.item_id}: ${close.error.message}`); continue; }
    if (from) closed += 1;

    // 2) Insertar el nuevo caso activo (devuelve id para la evidencia).
    const rec = mapSheetRowToCaseRecord(r, now);
    const ins = await db.from("compliance_cases").insert(rec).select("id").single();
    if (ins.error || !ins.data) { errors.push(`Insert caso ${r.item_id}: ${ins.error?.message ?? "sin id"}`); continue; }
    upserted += 1;
    const caseId = (ins.data as { id: string }).id;

    // 3) Registrar evidencia del cambio de estado (D12).
    const ev = evidenceFor({
      caseId, itemId: r.item_id, from: from as EstadoAdministrativo | null,
      to: r.estado_administrativo, fecha: r.fecha_pronto_despacho ?? r.fecha_inicio ?? null,
    });
    const evIns = await db.from("compliance_evidence").insert(ev);
    if (evIns.error) errors.push(`Evidencia ${r.item_id}: ${evIns.error.message}`);
    else evidence += 1;
  }

  return { upserted, closed, evidence, blocked: blocked.length, errors };
}
