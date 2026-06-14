/**
 * types.ts — Tipos del motor de sincronización Contratos ↔ Google Drive.
 *
 * Google Drive («Comercial → Cynthia → Clientes») es la fuente de verdad
 * operativa. El motor recorre la carpeta, detecta altas/cambios/bajas de
 * documentos y actualiza el repositorio Nexus (tablas 0076 + 0077).
 */

export type SyncTrigger = "cron" | "manual" | "api";
export type SyncRunStatus = "running" | "completed" | "partial" | "error" | "skipped";

/** Origen del texto extraído (cadena de prioridad de la auditoría). */
export type DocTextSource = "native" | "gdoc" | "gsheet" | "xlsx" | "pdf_text" | "ocr" | "none";

/** Calidad documental del texto extraído. */
export type DocQuality = "ok" | "sin_texto" | "parcial" | "error" | "pendiente";

/** Tipo de instrumento contractual (clasificado por nombre de archivo). */
export type ContractDocTipo =
  | "contrato"
  | "adenda"
  | "renovacion"
  | "rescision"
  | "carta_documento"
  | "condiciones"
  | "propuesta"
  | "acuse"
  | "nosis"
  | "otro";

/** Evento granular de una corrida de sincronización. */
export interface SyncEvent {
  level: "info" | "warn" | "error";
  category: "folder" | "document" | "contract" | "alert";
  action: string;
  driveFileId?: string | null;
  contractId?: string | null;
  titulo?: string | null;
  detail?: string | null;
}

/** Reporte de una corrida (forma devuelta por la API y persistida en contract_sync_runs). */
export interface SyncRunReport {
  runId: string | null;
  trigger: SyncTrigger;
  status: SyncRunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  folderId: string | null;
  folderVia: string;
  foldersScanned: number;
  docsSeen: number;
  docsNew: number;
  docsUpdated: number;
  docsRemoved: number;
  contractsUpserted: number;
  alertsRaised: number;
  errors: number;
  /** true si fue un ensayo (no escribió en la base). */
  dryRun: boolean;
  message: string;
  events: SyncEvent[];
}

/** Resumen de sincronización embebido en el portafolio (para el tablero). */
export interface ContractsSyncSummary {
  /** ¿Está configurada la integración Drive corporativa? */
  driveConfigured: boolean;
  /** ¿Hay base para persistir (service-role)? */
  dbConfigured: boolean;
  /** Última corrida registrada (o null si nunca corrió). */
  lastRun: {
    runId: string;
    trigger: SyncTrigger;
    status: SyncRunStatus;
    startedAt: string;
    finishedAt: string | null;
    durationMs: number | null;
    docsSeen: number;
    docsNew: number;
    docsUpdated: number;
    docsRemoved: number;
    contractsUpserted: number;
    alertsRaised: number;
    errors: number;
    message: string | null;
  } | null;
  /** Próxima corrida programada (ISO) — diaria 21:00 ART. */
  nextRunAt: string | null;
  /** Alertas de sincronización recientes (documento eliminado, adenda modificada, rescisión). */
  alerts: {
    level: "warn" | "error";
    action: string;
    titulo: string | null;
    detail: string | null;
    at: string;
  }[];
  /** Distribución de calidad documental. */
  quality: { ok: number; parcial: number; sin_texto: number; error: number; pendiente: number };
  /** Total de documentos en el repositorio. */
  totalDocs: number;
}
