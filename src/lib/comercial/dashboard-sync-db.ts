import { createAdminClient } from "@/lib/supabase/server";
import type { UiDeal } from "@/lib/clientify/mappers";
import { buildCacheRows, buildSnapshotRows } from "./dashboard-snapshot";

/**
 * Persiste el snapshot de Clientify en Supabase con service-role (bypassa RLS):
 *  1. Replace atómico de la caché vía RPC clientify_replace_deals_cache.
 *  2. Upsert de 1 snapshot por pipeline por día (unique snapshot_date,pipeline_id).
 * Devuelve los conteos para la bitácora. No escribe el log (lo hace la route).
 */
export async function persistDealsSync(
  deals: UiDeal[],
  runId: string
): Promise<{ cached: number; snapshots: number }> {
  const admin = createAdminClient();
  if (!admin) throw new Error("Admin client unavailable (missing env vars)");

  const cacheRows = buildCacheRows(deals);
  const { data: cached, error: rpcErr } = await admin.rpc("clientify_replace_deals_cache", {
    p_rows: cacheRows,
    p_run_id: runId,
  });
  if (rpcErr) throw new Error(`replace cache: ${rpcErr.message}`);

  const snapRows = buildSnapshotRows(deals, runId).map((r) => ({
    ...r,
    snapshot_date: new Date().toISOString().slice(0, 10),
  }));
  if (snapRows.length) {
    const { error: snapErr } = await admin
      .from("clientify_dashboard_snapshots")
      .upsert(snapRows, { onConflict: "snapshot_date,pipeline_id" });
    if (snapErr) throw new Error(`upsert snapshots: ${snapErr.message}`);
  }

  return { cached: (cached as number) ?? cacheRows.length, snapshots: snapRows.length };
}
