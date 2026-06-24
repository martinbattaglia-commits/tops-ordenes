// Wiring real del Sync Engine: arma las dependencias (Drive + Supabase) y
// ejecuta runSync. Lo usa el endpoint /api/tesoreria/caja-chica/sync (FASE 5).
// Aislado de sync-engine.ts (puro) para no contaminar los unit-tests con IO.

import { env } from "@/lib/env";
import { runSync, type RunOpts } from "./sync-engine";
import { createDriveSheetSource } from "./sync-drive";
import { createSupabaseCashBoxDb } from "./sync-db";
import type { CajaChicaSyncReport } from "./types";

export async function runCajaChicaSync(opts: RunOpts, periodosOverride?: number[]): Promise<CajaChicaSyncReport> {
  const fileId = env.cajaChica.driveFileId || null;
  const periodos = periodosOverride && periodosOverride.length ? periodosOverride : env.cajaChica.periodos;
  const now = () => new Date();
  const db = createSupabaseCashBoxDb();

  if (!db) {
    const t = now();
    return {
      runId: null,
      trigger: opts.trigger,
      status: "skipped",
      startedAt: t.toISOString(),
      finishedAt: t.toISOString(),
      durationMs: 0,
      fileId,
      periodos: periodos.length ? periodos : [t.getUTCFullYear()],
      rowsParsed: 0,
      rowsInserted: 0,
      rowsChanged: 0,
      rowsRemoved: 0,
      warnings: 0,
      errors: 0,
      dryRun: !!opts.dryRun,
      message: "Supabase service-role no configurado",
      perPeriodo: [],
      events: [{ level: "error", msg: "createAdminClient() devolvió null" }],
    };
  }

  const source = createDriveSheetSource(fileId);
  return runSync({ source, db, now, fileId, periodos }, opts);
}
