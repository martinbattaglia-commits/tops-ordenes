import { NextResponse } from "next/server";
import { runContractsSync } from "@/lib/comercial/contracts-sync/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET|POST /api/comercial/contratos/sync
 *
 * Ingesta diaria de la cartera contractual desde Google Drive
 * («Comercial → Cynthia → Clientes»). Pensado para cron diario 21:00 ART
 * (= 00:00 UTC) — ver .github/workflows/contratos-drive-sync.yml.
 *
 * Cron-friendly: si CRON_SECRET está seteado, exige `Authorization: Bearer <secret>`.
 * `?dry=1` recorre y reporta sin escribir. Códigos: 401 cron · 200 reporte · 502 error.
 */
async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";

  try {
    const report = await runContractsSync({ trigger: "cron", dryRun });
    const httpStatus = report.status === "error" ? 502 : 200;
    return NextResponse.json({ ok: report.status !== "error", ...report }, { status: httpStatus });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
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
