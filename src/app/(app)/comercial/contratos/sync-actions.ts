"use server";

/**
 * sync-actions.ts — Disparo manual de la sincronización Contratos ↔ Drive
 * desde la UI («Sincronizar ahora»). El cron diario usa la ruta protegida;
 * este action queda disponible para forzar una corrida puntual.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runContractsSync } from "@/lib/comercial/contracts-sync/engine";
import type { SyncRunReport } from "@/lib/comercial/contracts-sync/types";

export type TriggerSyncResult =
  | { ok: true; message: string; report: SyncRunReport }
  | { ok: false; message: string };

export async function triggerContractsSyncAction(): Promise<TriggerSyncResult> {
  // Requiere usuario autenticado (la corrida escribe vía service-role).
  const sb = createClient();
  let userId: string | null = null;
  if (sb) {
    const { data } = await sb.auth.getUser();
    userId = data.user?.id ?? null;
    if (!userId) return { ok: false, message: "Sesión no válida. Iniciá sesión para sincronizar." };
  }

  const report = await runContractsSync({ trigger: "manual", userId });
  revalidatePath("/comercial/contratos");
  return { ok: report.status !== "error", message: report.message, report };
}
