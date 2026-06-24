// Adaptador CashBoxDb real sobre Supabase (service-role, bypassa RLS).
// No se unit-testea (IO); se valida en branch efímero / dry-run.

import { createAdminClient } from "@/lib/supabase/server";
import type { CashBoxDb, SnapshotInput, SyncLogFinal } from "./sync-engine";
import type { CategoryRule, ParsedRow, SyncTrigger } from "./types";
import type { PrevRow } from "./guards";

export function createSupabaseCashBoxDb(): CashBoxDb | null {
  const db = createAdminClient();
  if (!db) return null;

  return {
    async getCategoryRules(): Promise<CategoryRule[]> {
      const { data, error } = await db
        .from("cash_box_category_rules")
        .select("match_type,pattern,categoria,prioridad,activo")
        .eq("activo", true);
      if (error) throw new Error(error.message);
      return (data ?? []) as CategoryRule[];
    },

    async countTransactions(periodo: number): Promise<number> {
      const { count, error } = await db
        .from("cash_box_transactions")
        .select("*", { count: "exact", head: true })
        .eq("periodo", periodo);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },

    async getPrevRows(periodo: number): Promise<PrevRow[]> {
      const { data, error } = await db
        .from("cash_box_transactions")
        .select("direction,source_row,row_hash")
        .eq("periodo", periodo);
      if (error) throw new Error(error.message);
      return (data ?? []) as PrevRow[];
    },

    async insertSyncLog(row: { trigger: SyncTrigger; file_id: string | null; periodos: number[] }): Promise<string | null> {
      const { data, error } = await db
        .from("cash_box_sync_log")
        .insert({ trigger: row.trigger, status: "running", file_id: row.file_id, periodos: row.periodos })
        .select("run_id")
        .single();
      if (error) throw new Error(error.message);
      return (data?.run_id as string) ?? null;
    },

    async replacePeriodo(periodo: number, rows: ParsedRow[], runId: string | null): Promise<number> {
      const { data, error } = await db.rpc("cash_box_replace_periodo", {
        p_periodo: periodo,
        p_rows: rows,
        p_run_id: runId,
      });
      if (error) throw new Error(error.message);
      return (data as number) ?? rows.length;
    },

    async upsertSnapshot(snap: SnapshotInput): Promise<void> {
      const { error } = await db
        .from("cash_box_snapshots")
        .upsert(snap, { onConflict: "periodo,snapshot_date" });
      if (error) throw new Error(error.message);
    },

    async updateSyncLog(runId: string, patch: SyncLogFinal): Promise<void> {
      const { error } = await db.from("cash_box_sync_log").update(patch).eq("run_id", runId);
      if (error) throw new Error(error.message);
    },
  };
}
