/**
 * engine.ts — Motor de ingesta Contratos ↔ Google Drive.
 *
 * Cada corrida (diaria 21:00 ART, o manual) recorre la carpeta operativa
 * («Comercial → Cynthia → Clientes»), detecta documentos nuevos / modificados /
 * eliminados, extrae texto (cadena de prioridad), vincula cada dossier a un
 * contrato y registra trazabilidad (contract_sync_runs + contract_sync_events) y
 * alertas (documento eliminado, adenda modificada, rescisión detectada).
 *
 * Reutiliza la integración Drive corporativa (service account) y el cliente
 * service-role de Supabase. Degrada con gracia: si Drive o la base no están
 * configurados, devuelve un reporte 'skipped' sin efectos.
 */

import { createAdminClient } from "@/lib/supabase/server";
import {
  isDriveConfigured,
  resolveContratosFolderId,
  listFolderForSync,
  walkFolderForSync,
} from "@/lib/drive/client";
import { env } from "@/lib/env";
import { extractDocumentText } from "./extract";
import { classifyDocTipo, parseCuit, folderToRazon } from "./classify";
import { diffDoc, docAlertAction, planRemovals, type ExistingDocState } from "./plan";
import type { SyncEvent, SyncRunReport, SyncRunStatus, SyncTrigger } from "./types";

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

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/** Tamaño de lote para upserts a Supabase (1 round-trip por bloque). */
const UPSERT_BATCH = 250;

/** Parte un array en bloques de tamaño `size` (>=1). */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += Math.max(1, size)) out.push(arr.slice(i, i + size));
  return out;
}

export async function runContractsSync(opts: RunOpts): Promise<SyncRunReport> {
  const { trigger } = opts;
  const dryRun = opts.dryRun ?? false;
  // Margen bajo el límite de las funciones de Netlify (corte del edge ~26-30s).
  const timeBudgetMs = opts.timeBudgetMs ?? 18_000;
  const maxFiles = opts.maxFiles ?? 4000;
  const t0 = Date.now();
  // El walk reserva una franja para escrituras; la extracción de texto (lo más
  // caro: descarga + parseo/OCR de PDFs) corta aún antes. Los documentos no
  // extraídos quedan catalogados con text_source NULL y se reintentan en la
  // próxima corrida (ver `missingText`), de modo que nada queda sin texto a la larga.
  const walkDeadlineMs = t0 + Math.max(4_000, timeBudgetMs - 5_000);
  const extractDeadlineMs = t0 + Math.max(3_000, timeBudgetMs - 6_000);
  const startedAt = new Date(t0).toISOString();
  const events: SyncEvent[] = [];

  const make = (status: SyncRunStatus, message: string, extra: Partial<SyncRunReport> = {}): SyncRunReport => ({
    runId: null,
    trigger,
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    folderId: null,
    folderVia: "none",
    foldersScanned: 0,
    docsSeen: 0,
    docsNew: 0,
    docsUpdated: 0,
    docsRemoved: 0,
    contractsUpserted: 0,
    alertsRaised: 0,
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

  // Resolver carpeta operativa.
  let folderId: string | null = null;
  let folderVia = "none";
  try {
    const r = await resolveContratosFolderId();
    folderId = r.id;
    folderVia = r.via;
  } catch (e) {
    return make("error", `No se pudo resolver la carpeta de contratos: ${msg(e)}`);
  }
  if (!folderId) {
    return make("skipped", `Carpeta de contratos no encontrada (${env.contratos.driveSubpath}).`);
  }

  // Crear fila de corrida (para FK de eventos).
  let runId: string | null = null;
  if (!dryRun) {
    const { data, error } = await db
      .from("contract_sync_runs")
      .insert({ trigger, status: "running", folder_id: folderId, created_by: opts.userId ?? null })
      .select("run_id")
      .single();
    if (!error && data) runId = (data as { run_id: string }).run_id;
  }

  let foldersScanned = 0;
  let docsSeen = 0;
  let docsNew = 0;
  let docsUpdated = 0;
  let docsRemoved = 0;
  let contractsUpserted = 0;
  let errors = 0;
  let truncated = false;
  let extractionDisabled = false;
  let extractDeferred = false;

  // Buffer de documentos a upsertar (se escribe en lotes al final — 1 round-trip
  // por bloque en vez de uno por documento).
  const docUpserts: Record<string, unknown>[] = [];
  const seenDriveIds = new Set<string>();
  // Contratos efectivamente recorridos en esta corrida (para baja segura de docs).
  const scannedContractIds = new Set<string>();

  try {
    // Cargar estado actual: contratos (para match) + documentos sincronizados (para diff).
    const { data: contractsRows } = await db.from("contracts").select("id, cuit, razon_social, source");
    const contracts = (contractsRows ?? []) as { id: string; cuit: string | null; razon_social: string; source: string }[];
    const byCuit = new Map<string, string>();
    const byRazon = new Map<string, string>();
    for (const c of contracts) {
      if (c.cuit) byCuit.set(c.cuit.replace(/\D/g, ""), c.id);
      byRazon.set(norm(c.razon_social), c.id);
    }

    const { data: docRows } = await db
      .from("contract_documents")
      .select("id, drive_file_id, md5_checksum, drive_modified_at, contract_id, sync_status, text_source")
      .not("drive_file_id", "is", null);
    const docByDriveId = new Map<
      string,
      { id: string; md5: string | null; modified: string | null; status: string; contractId: string | null; textSource: string | null }
    >();
    for (const d of (docRows ?? []) as {
      id: string;
      drive_file_id: string;
      md5_checksum: string | null;
      drive_modified_at: string | null;
      contract_id: string | null;
      sync_status: string;
      text_source: string | null;
    }[]) {
      docByDriveId.set(d.drive_file_id, {
        id: d.id,
        md5: d.md5_checksum,
        modified: d.drive_modified_at,
        status: d.sync_status,
        contractId: d.contract_id,
        textSource: d.text_source,
      });
    }

    // Carpetas de cliente (dossiers) directamente bajo "Clientes".
    const top = await listFolderForSync(folderId);
    const clientFolders = top.filter((e) => e.isFolder);
    const looseFiles = top.filter((e) => !e.isFolder);
    foldersScanned = clientFolders.length;
    if (looseFiles.length) {
      events.push({ level: "info", category: "folder", action: "loose_files", detail: `${looseFiles.length} archivo(s) sueltos en la raíz (sin dossier de cliente).` });
    }

    for (const cf of clientFolders) {
      if (Date.now() - t0 > timeBudgetMs) {
        truncated = true;
        events.push({ level: "warn", category: "folder", action: "time_budget", detail: `Presupuesto de tiempo agotado; quedan dossiers sin procesar.` });
        break;
      }

      // Resolver / crear el contrato del dossier.
      const cuitRaw = parseCuit(cf.name);
      const cuit = cuitRaw ? cuitRaw.replace(/\D/g, "") : null;
      const razon = folderToRazon(cf.name) || cf.name;
      let contractId: string | null =
        (cuit && byCuit.get(cuit)) || byRazon.get(norm(razon)) || null;

      try {
        if (!contractId) {
          if (dryRun) {
            // Dry-run: no se crea el contrato; se reporta como alta potencial.
            contractsUpserted += 1;
            events.push({ level: "info", category: "contract", action: "new", titulo: razon, detail: `(dry-run) Nuevo dossier de cliente detectado en Drive.` });
          } else {
            const { data, error } = await db
              .from("contracts")
              .insert({
                razon_social: razon,
                cuit: cuitRaw,
                tipo: "Cargas Generales",
                estado: "Vigente",
                riesgo: "Medio",
                semaforo: "Azul",
                source: "drive",
                drive_folder_id: cf.id,
                drive_modified_at: cf.modifiedAt,
                last_synced_at: new Date().toISOString(),
              })
              .select("id")
              .single();
            if (error) throw new Error(error.message);
            contractId = (data as { id: string }).id;
            byRazon.set(norm(razon), contractId);
            if (cuit) byCuit.set(cuit, contractId);
            contractsUpserted += 1;
            events.push({ level: "info", category: "contract", action: "new", contractId, titulo: razon, detail: `Nuevo dossier de cliente detectado en Drive.` });
          }
        } else {
          if (!dryRun) {
            await db
              .from("contracts")
              .update({ source: "drive", drive_folder_id: cf.id, drive_modified_at: cf.modifiedAt, last_synced_at: new Date().toISOString() })
              .eq("id", contractId);
          }
          contractsUpserted += 1;
        }
      } catch (e) {
        errors += 1;
        events.push({ level: "error", category: "contract", action: "upsert_error", titulo: razon, detail: msg(e) });
        continue;
      }

      // Documentos del dossier (recursivo: incluye «Documentación contractual»).
      let walk: Awaited<ReturnType<typeof walkFolderForSync>>;
      try {
        walk = await walkFolderForSync(cf.id, { maxDepth: 3, maxFiles, deadlineMs: walkDeadlineMs });
      } catch (e) {
        errors += 1;
        events.push({ level: "error", category: "folder", action: "walk_error", titulo: cf.name, detail: msg(e) });
        continue;
      }
      if (walk.truncated) truncated = true;
      // El dossier se recorrió OK → habilita detección de bajas para sus documentos.
      if (contractId) scannedContractIds.add(contractId);

      for (const file of walk.files) {
        docsSeen += 1;
        seenDriveIds.add(file.id);
        const existing = docByDriveId.get(file.id);
        const existingState: ExistingDocState | undefined = existing
          ? { id: existing.id, driveFileId: file.id, md5: existing.md5, modified: existing.modified, status: existing.status, contractId: existing.contractId }
          : undefined;
        const change = diffDoc(existingState, { md5Checksum: file.md5Checksum, modifiedAt: file.modifiedAt });
        const changed = change !== "unchanged";
        const tipo = classifyDocTipo(file.name);

        // Extraer texto si el doc cambió, o si nunca se le intentó (text_source
        // NULL) — así lo diferido por presupuesto de tiempo se reintenta luego.
        const missingText = !existing || existing.textSource == null;
        let wantText =
          (changed || missingText) && env.contratos.extractText && !extractionDisabled && !dryRun;
        if (wantText && Date.now() > extractDeadlineMs) {
          // Sin tiempo para descargar/parsear: se cataloga sin texto y se reintenta
          // la extracción en la próxima corrida.
          wantText = false;
          extractDeferred = true;
        }

        let extractedText: string | null = null;
        let textSource = "none";
        let quality = "pendiente";
        let didExtract = false;
        if (wantText) {
          try {
            const ex = await extractDocumentText(file);
            extractedText = ex.text || null;
            textSource = ex.source;
            quality = ex.quality;
            didExtract = true;
            if (ex.error) {
              events.push({ level: "warn", category: "document", action: "extract_error", driveFileId: file.id, titulo: file.name, detail: ex.error });
            }
          } catch (e) {
            // Error crítico (auth/quota/red): desactiva la extracción para el resto
            // de la corrida y sigue catalogando documentos sin texto.
            extractionDisabled = true;
            errors += 1;
            events.push({ level: "error", category: "document", action: "extract_fatal", driveFileId: file.id, titulo: file.name, detail: msg(e) });
          }
        }

        // Se persiste si cambió la metadata, o si recién se extrajo texto de un doc
        // que estaba catalogado sin él. Docs sin cambios y ya texteados: no-op.
        // El upsert real se hace en lotes al final de la corrida (docUpserts).
        if (!dryRun && (changed || didExtract)) {
          docUpserts.push({
            contract_id: contractId,
            tipo_doc: tipo,
            titulo: file.name,
            drive_file_id: file.id,
            url: file.webViewLink,
            md5_checksum: file.md5Checksum,
            drive_modified_at: file.modifiedAt,
            size_bytes: file.size,
            mime_type: file.mimeType,
            sync_status: "synced",
            last_synced_at: new Date().toISOString(),
            fecha: file.modifiedAt ? file.modifiedAt.slice(0, 10) : null,
            // Sólo tocar las columnas de texto si realmente se ejecutó la extracción.
            ...(didExtract ? { extracted_text: extractedText, text_source: textSource, quality } : {}),
          });
        }

        if (changed) {
          if (change === "new") {
            docsNew += 1;
            events.push({ level: "info", category: "document", action: "new", driveFileId: file.id, contractId, titulo: file.name, detail: `Documento nuevo (${tipo}).` });
          } else {
            docsUpdated += 1;
            events.push({ level: "info", category: "document", action: "updated", driveFileId: file.id, contractId, titulo: file.name, detail: `Documento modificado (${tipo}).` });
          }
          const alertAction = docAlertAction(change, tipo);
          if (alertAction) {
            events.push({
              level: "warn",
              category: "alert",
              action: alertAction,
              driveFileId: file.id,
              contractId,
              titulo: file.name,
              detail:
                alertAction === "rescision_detectada"
                  ? `Rescisión detectada en Drive: ${file.name}.`
                  : `Adenda/renovación modificada: ${file.name}.`,
            });
          }
        }
      }
    }

    // Upsert de documentos en lotes (1 consulta por bloque) — evita N round-trips
    // secuenciales que hacían que la corrida superara el límite serverless.
    if (!dryRun && docUpserts.length) {
      for (const batch of chunk(docUpserts, UPSERT_BATCH)) {
        const { error } = await db
          .from("contract_documents")
          .upsert(batch, { onConflict: "drive_file_id" });
        if (error) {
          errors += 1;
          events.push({ level: "error", category: "document", action: "upsert_error", detail: `Lote de ${batch.length}: ${error.message}` });
        }
      }
    }

    // Detección de bajas: documentos sincronizados que ya no aparecen en Drive.
    // Sólo si la corrida fue COMPLETA (si se truncó, no podemos afirmar baja).
    if (!truncated) {
      const allDocs: ExistingDocState[] = Array.from(docByDriveId, ([driveFileId, v]) => ({
        id: v.id,
        driveFileId,
        md5: v.md5,
        modified: v.modified,
        status: v.status,
        contractId: v.contractId,
      }));
      // Sólo se dan de baja docs cuyo contrato fue recorrido (evita falsos positivos).
      const toRemove = planRemovals(allDocs, seenDriveIds, scannedContractIds);
      for (const d of toRemove) {
        docsRemoved += 1;
        events.push({ level: "warn", category: "alert", action: "documento_eliminado", driveFileId: d.driveFileId, contractId: d.contractId, detail: `Documento desaparecido de Drive (id ${d.driveFileId}).` });
      }
      if (!dryRun && toRemove.length) {
        // Baja en lote (una sola consulta) — evita N updates secuenciales.
        await db
          .from("contract_documents")
          .update({ sync_status: "removed", last_synced_at: new Date().toISOString() })
          .in("id", toRemove.map((d) => d.id));
      }
    }
  } catch (e) {
    errors += 1;
    const status: SyncRunStatus = "error";
    const report = make(status, `Error de sincronización: ${msg(e)}`, { runId, folderId, folderVia, foldersScanned, docsSeen, docsNew, docsUpdated, docsRemoved, contractsUpserted, errors, alertsRaised: countAlerts(events) });
    await persist(db, runId, dryRun, report, events);
    return report;
  }

  const alertsRaised = countAlerts(events);
  const status: SyncRunStatus = truncated ? "partial" : "completed";
  const deferNote = extractDeferred
    ? " Extracción de texto diferida en algunos documentos (se completa en próximas corridas)."
    : "";
  const message = truncated
    ? "Sincronización parcial (presupuesto de tiempo/archivos agotado)."
    : `Sincronización completa: ${docsNew} nuevos, ${docsUpdated} modificados, ${docsRemoved} eliminados.${deferNote}`;
  const report = make(status, message, {
    runId,
    folderId,
    folderVia,
    foldersScanned,
    docsSeen,
    docsNew,
    docsUpdated,
    docsRemoved,
    contractsUpserted,
    alertsRaised,
    errors,
  });
  await persist(db, runId, dryRun, report, events);
  return report;
}

function countAlerts(events: SyncEvent[]): number {
  return events.filter((e) => e.category === "alert").length;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Persiste el cierre de la corrida + sus eventos (best-effort). */
async function persist(
  db: NonNullable<ReturnType<typeof createAdminClient>>,
  runId: string | null,
  dryRun: boolean,
  report: SyncRunReport,
  events: SyncEvent[],
): Promise<void> {
  if (dryRun || !runId) return;
  try {
    await db
      .from("contract_sync_runs")
      .update({
        status: report.status,
        finished_at: report.finishedAt,
        duration_ms: report.durationMs,
        folders_scanned: report.foldersScanned,
        docs_seen: report.docsSeen,
        docs_new: report.docsNew,
        docs_updated: report.docsUpdated,
        docs_removed: report.docsRemoved,
        contracts_upserted: report.contractsUpserted,
        alerts_raised: report.alertsRaised,
        errors: report.errors,
        message: report.message,
        report: { folderVia: report.folderVia, trigger: report.trigger },
      })
      .eq("run_id", runId);

    if (events.length) {
      const rows = events.slice(0, 1000).map((e) => ({
        run_id: runId,
        level: e.level,
        category: e.category,
        action: e.action,
        drive_file_id: e.driveFileId ?? null,
        contract_id: e.contractId ?? null,
        titulo: e.titulo ?? null,
        detail: e.detail ?? null,
      }));
      await db.from("contract_sync_events").insert(rows);
    }
  } catch {
    // best-effort: la corrida ya hizo su trabajo; el log es secundario.
  }
}
