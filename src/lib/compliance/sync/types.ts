/**
 * types.ts — Tipos del motor de sincronización Compliance ↔ Google Drive.
 *
 * Google Drive («AGENCIA GUBERNAMENTAL DE CONTROL») es la fuente documental de
 * verdad. El motor recorre la carpeta, cataloga documentos (altas/cambios/bajas),
 * los asocia a ítems regulatorios, recalcula alertas y registra trazabilidad
 * (tablas 0081: compliance_documents / compliance_alerts / compliance_sync_log).
 */

export type SyncTrigger = "cron" | "manual" | "api";
export type SyncRunStatus = "running" | "completed" | "partial" | "error" | "skipped";

/** Evento granular de una corrida (se vuelca a report.events del sync_log). */
export interface SyncEvent {
  level: "info" | "warn" | "error";
  category: "folder" | "document" | "item" | "alert";
  action: string;
  driveFileId?: string | null;
  itemId?: string | null;
  titulo?: string | null;
  detail?: string | null;
}

/**
 * Reporte de una corrida — forma devuelta por el endpoint y persistida en
 * compliance_sync_log. Los nombres de campos snake_case que pide el endpoint
 * (`documents_scanned`, etc.) se derivan de acá en route.ts.
 */
export interface ComplianceSyncReport {
  runId: string | null;
  trigger: SyncTrigger;
  status: SyncRunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  folderId: string | null;
  folderVia: string;
  documentsScanned: number;
  documentsUpserted: number;
  documentsRemoved: number;
  itemsTouched: number;
  alertsCreated: number;
  errors: number;
  /** true si fue un ensayo (no escribió en la base). */
  dryRun: boolean;
  message: string;
  events: SyncEvent[];
}
