/**
 * engine.ts — Motor de ingesta Compliance ↔ Google Drive.
 *
 * Cada corrida (diaria 21:00 ART, o manual) recorre la carpeta regulatoria
 * («AGENCIA GUBERNAMENTAL DE CONTROL»), cataloga documentos (altas/cambios/bajas),
 * los asocia a ítems regulatorios (por sede + categoría), recalcula las alertas de
 * vencimiento/faltantes y registra trazabilidad (compliance_sync_log +
 * compliance_documents + compliance_alerts).
 *
 * Reutiliza la integración Drive corporativa (service account) y el cliente
 * service-role de Supabase. Degrada con gracia: si Drive o la base no están
 * configurados, devuelve un reporte 'skipped' sin efectos. Es idempotente.
 *
 * NOTA: el inventario de ítems (compliance_items) NO se borra ni se reescribe.
 * Drive es la fuente DOCUMENTAL (compliance_documents); los ítems sólo reciben
 * `last_synced_at`, `source='drive'` y el conteo `docs` cuando se les asocia ≥1
 * documento. Así el snapshot auditado nunca se pierde.
 */

import { createAdminClient } from "@/lib/supabase/server";
import {
  isDriveConfigured,
  findFolderByPath,
  isUnderRoot,
  walkFolderForSync,
} from "@/lib/drive/client";
import { env } from "@/lib/env";
import { deriveComplianceStatus } from "@/lib/compliance/data";
import { rowToItem, COMPLIANCE_ITEM_COLUMNS, type ComplianceRow } from "@/lib/compliance/row";
import {
  classifySede,
  classifyCategoria,
  classifyTipo,
  extractDates,
} from "./classify";
import type { ComplianceSyncReport, SyncEvent, SyncRunStatus, SyncTrigger } from "./types";

interface RunOpts {
  trigger: SyncTrigger;
  /** No escribe en la base (sólo recorre y reporta). */
  dryRun?: boolean;
  /** Presupuesto de tiempo por corrida (Netlify functions ~10-26s). */
  timeBudgetMs?: number;
  /** Tope de archivos por corrida. */
  maxFiles?: number;
  /** Usuario que dispara una corrida manual (auditoría). */
  userId?: string | null;
}

type AdminDb = NonNullable<ReturnType<typeof createAdminClient>>;

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Resuelve la carpeta regulatoria de Drive (id directo, por ruta, o root). */
async function resolveComplianceFolder(): Promise<{ id: string | null; via: string }> {
  const root = env.google.driveRootFolderId || undefined;
  const direct = env.compliance.driveFolderId;
  if (direct) {
    if (!root || direct === root || (await isUnderRoot(direct))) return { id: direct, via: "env-id" };
    return root ? { id: root, via: "root" } : { id: null, via: "none" };
  }
  const subpath = env.compliance.driveSubpath.split("/").map((s) => s.trim()).filter(Boolean);
  const byPath = await findFolderByPath(subpath);
  if (byPath) return { id: byPath, via: "path" };
  if (root) return { id: root, via: "root" };
  return { id: null, via: "none" };
}

export async function runComplianceSync(opts: RunOpts): Promise<ComplianceSyncReport> {
  const { trigger } = opts;
  const dryRun = opts.dryRun ?? false;
  const timeBudgetMs = opts.timeBudgetMs ?? 20_000;
  const maxFiles = opts.maxFiles ?? 2000;
  const t0 = Date.now();
  const startedAt = new Date(t0).toISOString();
  const events: SyncEvent[] = [];

  const make = (
    status: SyncRunStatus,
    message: string,
    extra: Partial<ComplianceSyncReport> = {},
  ): ComplianceSyncReport => ({
    runId: null,
    trigger,
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    folderId: null,
    folderVia: "none",
    documentsScanned: 0,
    documentsUpserted: 0,
    documentsRemoved: 0,
    itemsTouched: 0,
    alertsCreated: 0,
    errors: 0,
    dryRun,
    message,
    events,
    ...extra,
  });

  if (!isDriveConfigured()) {
    return make("skipped", "Google Drive no configurado (GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_DRIVE_ROOT_FOLDER_ID).");
  }
  const db = createAdminClient();
  if (!db) {
    return make("skipped", "Supabase service-role no configurado (SUPABASE_SERVICE_ROLE_KEY).");
  }

  // Resolver carpeta regulatoria.
  let folderId: string | null = null;
  let folderVia = "none";
  try {
    const r = await resolveComplianceFolder();
    folderId = r.id;
    folderVia = r.via;
  } catch (e) {
    return make("error", `No se pudo resolver la carpeta regulatoria: ${msg(e)}`);
  }
  if (!folderId) {
    return make("skipped", `Carpeta regulatoria no encontrada (${env.compliance.driveSubpath}).`);
  }

  // Cargar ítems (para asociación por sede+categoría y recálculo de alertas).
  let itemRows: ComplianceRow[] = [];
  try {
    const { data, error } = await db.from("compliance_items").select(COMPLIANCE_ITEM_COLUMNS);
    if (error) throw new Error(error.message);
    itemRows = (data ?? []) as ComplianceRow[];
  } catch (e) {
    return make("error", `No se pudieron leer compliance_items: ${msg(e)}`);
  }

  // Índice sede|categoria → itemId, SÓLO cuando es único (evita asociar mal).
  const comboCount = new Map<string, number>();
  const comboItem = new Map<string, string>();
  for (const it of itemRows) {
    const key = `${it.sede}|${it.categoria}`;
    comboCount.set(key, (comboCount.get(key) ?? 0) + 1);
    comboItem.set(key, it.id);
  }
  const itemForCombo = (sede: string | null, categoria: string | null): string | null => {
    if (!sede || !categoria) return null;
    const key = `${sede}|${categoria}`;
    return comboCount.get(key) === 1 ? (comboItem.get(key) ?? null) : null;
  };

  // Abrir corrida (para run_id en docs/alertas/eventos).
  let runId: string | null = null;
  if (!dryRun) {
    const { data, error } = await db
      .from("compliance_sync_log")
      .insert({ trigger, status: "running", folder_id: folderId, created_by: opts.userId ?? null })
      .select("run_id")
      .single();
    if (!error && data) runId = (data as { run_id: string }).run_id;
  }

  let documentsScanned = 0;
  let documentsUpserted = 0;
  let errors = 0;
  let truncated = false;
  const seenDriveIds = new Set<string>();
  const docsPerItem = new Map<string, number>(); // itemId → docs asociados esta corrida
  const itemsTouchedSet = new Set<string>();

  try {
    // Recorrido recursivo de la carpeta regulatoria.
    let walk: Awaited<ReturnType<typeof walkFolderForSync>>;
    try {
      walk = await walkFolderForSync(folderId, { maxDepth: 4, maxFiles });
    } catch (e) {
      const report = make("error", `Error recorriendo Drive: ${msg(e)}`, { runId, folderId, folderVia, errors: 1 });
      await persist(db, runId, dryRun, report, events);
      return report;
    }
    if (walk.truncated) truncated = true;

    for (const file of walk.files) {
      if (Date.now() - t0 > timeBudgetMs) {
        truncated = true;
        events.push({ level: "warn", category: "folder", action: "time_budget", detail: "Presupuesto de tiempo agotado; quedan archivos sin procesar." });
        break;
      }
      documentsScanned += 1;
      seenDriveIds.add(file.id);

      const sede = classifySede(file.name, file.folderPath);
      const categoria = classifyCategoria(file.name, file.folderPath);
      const tipo = classifyTipo(file.name, file.folderPath);
      const { emision, vencimiento } = extractDates(file.name);
      const itemId = itemForCombo(sede, categoria);
      if (itemId) docsPerItem.set(itemId, (docsPerItem.get(itemId) ?? 0) + 1);

      if (dryRun) continue;

      try {
        const row = {
          item_id: itemId,
          sede,
          categoria,
          tipo_doc: tipo,
          titulo: file.name,
          drive_file_id: file.id,
          url: file.webViewLink,
          mime_type: file.mimeType,
          size_bytes: file.size,
          md5_checksum: file.md5Checksum,
          drive_modified_at: file.modifiedAt,
          fecha_emision: emision,
          fecha_vencimiento: vencimiento,
          sync_status: "synced",
          sync_error: null,
          last_synced_at: new Date().toISOString(),
        };
        const { error } = await db
          .from("compliance_documents")
          .upsert(row, { onConflict: "drive_file_id" });
        if (error) throw new Error(error.message);
        documentsUpserted += 1;
      } catch (e) {
        errors += 1;
        events.push({ level: "error", category: "document", action: "upsert_error", driveFileId: file.id, titulo: file.name, detail: msg(e) });
      }
    }

    // Baja de documentos desaparecidos de Drive — sólo si la corrida fue COMPLETA.
    let documentsRemoved = 0;
    if (!truncated && !dryRun) {
      try {
        const { data: existing } = await db
          .from("compliance_documents")
          .select("id, drive_file_id")
          .eq("sync_status", "synced")
          .not("drive_file_id", "is", null);
        const stale = ((existing ?? []) as { id: string; drive_file_id: string }[])
          .filter((d) => !seenDriveIds.has(d.drive_file_id));
        if (stale.length) {
          await db
            .from("compliance_documents")
            .update({ sync_status: "removed", last_synced_at: new Date().toISOString() })
            .in("id", stale.map((d) => d.id));
          documentsRemoved = stale.length;
          events.push({ level: "warn", category: "alert", action: "documentos_eliminados", detail: `${stale.length} documento(s) ya no están en Drive.` });
        }
      } catch (e) {
        errors += 1;
        events.push({ level: "error", category: "document", action: "removal_error", detail: msg(e) });
      }
    }

    // Actualizar ítems asociados: docs live + last_synced_at + source='drive'.
    if (!dryRun) {
      const nowIso = new Date().toISOString();
      for (const [itemId, count] of docsPerItem) {
        try {
          await db
            .from("compliance_items")
            .update({ docs: count, last_synced_at: nowIso, source: "drive" })
            .eq("id", itemId);
          itemsTouchedSet.add(itemId);
        } catch (e) {
          errors += 1;
          events.push({ level: "error", category: "item", action: "update_error", itemId, detail: msg(e) });
        }
      }
    }

    // Recalcular alertas (idempotente: cierra las abiertas y reescribe el estado actual).
    let alertsCreated = 0;
    if (!dryRun) {
      try {
        alertsCreated = await rebuildAlerts(db, itemRows, runId, events);
      } catch (e) {
        errors += 1;
        events.push({ level: "error", category: "alert", action: "rebuild_error", detail: msg(e) });
      }
    } else {
      alertsCreated = countAlertsDryRun(itemRows);
    }

    const status: SyncRunStatus = errors > 0 ? "partial" : truncated ? "partial" : "completed";
    const message =
      status === "completed"
        ? `Sincronización completa: ${documentsUpserted} documentos, ${itemsTouchedSet.size} ítems, ${alertsCreated} alertas.`
        : `Sincronización parcial (${truncated ? "presupuesto agotado" : "con errores"}): ${documentsUpserted} documentos, ${errors} errores.`;
    const report = make(status, message, {
      runId,
      folderId,
      folderVia,
      documentsScanned,
      documentsUpserted,
      documentsRemoved,
      itemsTouched: itemsTouchedSet.size,
      alertsCreated,
      errors,
    });
    await persist(db, runId, dryRun, report, events);
    return report;
  } catch (e) {
    errors += 1;
    const report = make("error", `Error de sincronización: ${msg(e)}`, {
      runId, folderId, folderVia, documentsScanned, documentsUpserted, errors,
    });
    await persist(db, runId, dryRun, report, events);
    return report;
  }
}

/** Cuenta cuántas alertas generaría el estado actual (para dry-run). */
function countAlertsDryRun(itemRows: ComplianceRow[]): number {
  let n = 0;
  for (const r of itemRows) {
    const it = deriveComplianceStatus(rowToItem(r));
    if (it.riesgo !== "Verde") n += 1;
  }
  return n;
}

/**
 * Reconstruye compliance_alerts desde el estado actual de los ítems.
 * Idempotente: cierra las alertas 'abierta' GENERADAS POR SYNC y reinserta las
 * vigentes.
 *
 * Hardening R1 (gate de prod): el cierre se acota a `run_id IS NOT NULL`, es
 * decir SÓLO alertas creadas por corridas de sincronización. Las alertas
 * manuales o externas (`run_id IS NULL`) NUNCA se cierran acá — quedan a cargo de
 * quien las creó. Esto evita pérdida de alertas humanas cuando otros escritores
 * (admin/supervisor/operaciones, habilitados por RLS) participan.
 */
async function rebuildAlerts(
  db: AdminDb,
  itemRows: ComplianceRow[],
  runId: string | null,
  events: SyncEvent[],
): Promise<number> {
  // Cerrar SÓLO las alertas abiertas generadas por sync (run_id no nulo);
  // preservar las manuales/externas (run_id nulo).
  await db
    .from("compliance_alerts")
    .update({ estado: "resuelta", resolved_at: new Date().toISOString() })
    .eq("estado", "abierta")
    .not("run_id", "is", null);

  const rows: Record<string, unknown>[] = [];
  for (const r of itemRows) {
    const it = deriveComplianceStatus(rowToItem(r));
    if (it.riesgo === "Verde") continue;

    let nivel: "critical" | "warning";
    let kind: "expiration" | "missing_doc" | "audit_observation";
    let titulo: string;
    let detalle: string;

    if (it.vencimiento) {
      kind = "expiration";
      nivel = it.riesgo === "Rojo" ? "critical" : "warning";
      titulo = `${it.documento} — ${it.estado}`;
      detalle =
        it.dias !== null && it.dias < 0
          ? `Vencido hace ${Math.abs(it.dias)} días (${it.venc_fmt}).`
          : `Vence en ${it.dias} días (${it.venc_fmt}).`;
    } else if (it.riesgo === "Rojo") {
      kind = "missing_doc";
      nivel = "critical";
      titulo = `${it.documento} — faltante / en proyecto`;
      detalle = it.nota || "Documento faltante o brecha regulatoria a cerrar.";
    } else {
      kind = "audit_observation";
      nivel = "warning";
      titulo = `${it.documento} — a verificar`;
      detalle = it.nota || "Documentación a verificar (sin fecha de vencimiento determinada).";
    }

    rows.push({
      item_id: it.id,
      nivel,
      kind,
      titulo,
      detalle,
      due_date: it.vencimiento,
      dias: it.dias,
      run_id: runId,
      estado: "abierta",
    });
  }

  if (rows.length) {
    const { error } = await db.from("compliance_alerts").insert(rows);
    if (error) throw new Error(error.message);
    events.push({ level: "info", category: "alert", action: "rebuilt", detail: `${rows.length} alertas vigentes.` });
  }
  return rows.length;
}

/** Persiste el cierre de la corrida + eventos (best-effort). */
async function persist(
  db: AdminDb,
  runId: string | null,
  dryRun: boolean,
  report: ComplianceSyncReport,
  events: SyncEvent[],
): Promise<void> {
  if (dryRun || !runId) return;
  try {
    await db
      .from("compliance_sync_log")
      .update({
        status: report.status,
        finished_at: report.finishedAt,
        duration_ms: report.durationMs,
        documents_scanned: report.documentsScanned,
        documents_upserted: report.documentsUpserted,
        documents_removed: report.documentsRemoved,
        items_touched: report.itemsTouched,
        alerts_created: report.alertsCreated,
        errors: report.errors,
        message: report.message,
        report: { folderVia: report.folderVia, trigger: report.trigger, events: events.slice(0, 200) },
      })
      .eq("run_id", runId);
  } catch {
    // best-effort: la corrida ya hizo su trabajo; el log es secundario.
  }
}
