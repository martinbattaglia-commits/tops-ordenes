import { NextResponse } from "next/server";
import { runComplianceSync } from "@/lib/compliance/sync/engine";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET|POST /api/compliance/sync
 *
 * Ingesta diaria del Compliance Cockpit desde Google Drive («AGENCIA
 * GUBERNAMENTAL DE CONTROL»). Pensado para cron diario 21:00 ART (= 00:00 UTC)
 * — ver .github/workflows/compliance-drive-sync.yml.
 *
 * Auth F4.4-E2: FAIL-CLOSED vía requireCronAuth() — 503 sin CRON_SECRET,
 * 401 Bearer inválido (timing-safe). El workflow de GH Actions ya envía el
 * Bearer (verde en prod), así que el endurecimiento no rompe el cron.
 * `?dry=1` recorre y reporta sin escribir. Códigos: 503/401 auth · 200 reporte · 502 error.
 */
async function handle(req: Request): Promise<Response> {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";

  try {
    const report = await runComplianceSync({ trigger: "cron", dryRun });
    const httpStatus = report.status === "error" ? 502 : 200;
    return NextResponse.json(
      {
        success: report.status !== "error",
        status: report.status,
        sync_log_id: report.runId,
        started_at: report.startedAt,
        finished_at: report.finishedAt,
        duration_ms: report.durationMs,
        folder_id: report.folderId,
        folder_via: report.folderVia,
        documents_scanned: report.documentsScanned,
        documents_upserted: report.documentsUpserted,
        documents_removed: report.documentsRemoved,
        items_touched: report.itemsTouched,
        alerts_created: report.alertsCreated,
        errors: report.errors,
        dry_run: report.dryRun,
        message: report.message,
      },
      { status: httpStatus },
    );
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}

export async function GET(req: Request): Promise<Response> {
  return handle(req);
}
export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
