import { NextResponse } from "next/server";
import { runCajaChicaSync } from "@/lib/tesoreria/caja-chica/sync";
import { pickPrimary } from "@/lib/tesoreria/caja-chica/sync-engine";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET|POST /api/tesoreria/caja-chica/sync
 *
 * Sincroniza la Caja Chica desde la planilla de Google Drive (espejo read-only).
 * Pensado para cron diario 21:05 ART — ver .github/workflows/caja-chica-drive-sync.yml.
 *
 * Auth F4.4-E2: FAIL-CLOSED vía requireCronAuth() — 503 sin CRON_SECRET,
 * 401 Bearer inválido (timing-safe). El workflow de GH Actions ya envía el Bearer.
 * Query:
 *   ?dry=1        → recorre y reporta sin escribir (transactions/snapshots/log).
 *   ?periodo=2026 → sincroniza solo ese ejercicio (default: CAJA_CHICA_PERIODOS).
 * Códigos: 503/401 auth · 400 período inválido · 200 reporte · 502 error.
 */
async function handle(req: Request): Promise<Response> {
  const denied = requireCronAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";

  let periodosOverride: number[] | undefined;
  const periodoParam = url.searchParams.get("periodo");
  if (periodoParam != null && periodoParam !== "") {
    const p = parseInt(periodoParam, 10);
    if (!Number.isInteger(p)) {
      return NextResponse.json({ success: false, error: `periodo inválido: ${periodoParam}` }, { status: 400 });
    }
    periodosOverride = [p];
  }

  try {
    const r = await runCajaChicaSync({ trigger: "cron", dryRun }, periodosOverride);
    const primary = pickPrimary(r.perPeriodo);
    const httpStatus = r.status === "error" ? 502 : 200;
    return NextResponse.json(
      {
        success: r.status !== "error",
        status: r.status,
        sync_log_id: r.runId,
        periodos: r.periodos,
        rowsParsed: r.rowsParsed,
        rowsInserted: r.rowsInserted,
        rowsChanged: r.rowsChanged,
        rowsRemoved: r.rowsRemoved,
        warnings: r.warnings,
        errors: r.errors,
        saldoExcel: primary?.saldoExcel ?? null,
        saldoCalc: primary?.saldoCalc ?? null,
        saldoDelta: primary?.saldoDelta ?? null,
        durationMs: r.durationMs,
        dryRun: r.dryRun,
        message: r.message,
        perPeriodo: r.perPeriodo,
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
