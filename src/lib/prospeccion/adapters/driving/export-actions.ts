"use server";

// Driving adapter · Exportación de prospectos aprobados a Clientify (F2 Prospección Inteligente).
// Autoriza (canAccess), carga los IDs elegibles, cablea ExportToClientifyUseCase.
// Escritura/lectura de lote vía service_role (createAdminClient) para evitar restricciones RLS.
import { revalidatePath } from "next/cache";
import { canAccess } from "@/lib/rbac/guard";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { ClientifyExportAdapter } from "../clientify/clientify-export.adapter";
import { ExportToClientifyUseCase } from "../../application/export-to-clientify.use-case";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type ExportActionResult =
  | {
      ok: true;
      totalOk: number;
      totalErrors: number;
      results: Array<{
        prospect_id: string;
        ok: boolean;
        clientify_contact_id: number | null;
        error: string | null;
      }>;
    }
  | { ok: false; message: string };

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

/**
 * Exporta prospectos aprobados a Clientify CRM.
 *
 * Si se pasan `prospectIds`, exporta solo ese subconjunto (todos deben tener status='aprobado').
 * Si no se pasan, busca todos los prospectos con status='aprobado' (máx 200).
 *
 * El use case filtra internamente los que no estén en status 'aprobado' y los reporta en `skipped`.
 */
export async function exportApprovedToClientifyAction(
  prospectIds?: string[],
): Promise<ExportActionResult> {
  // ---- Zero-Trust gate (SEC-4/SEC-10) ----
  const userClient = createClient();
  const user = userClient ? (await userClient.auth.getUser()).data.user : null;
  if (!user) return { ok: false, message: "Sesión no autenticada." };
  if (!(await canAccess("prospeccion.export")))
    return { ok: false, message: "Sin permiso (prospeccion.export)." };

  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Supabase no configurado." };

  const adminTyped = admin as unknown as SupabaseClient;

  // ---- Resolver IDs a exportar ----
  let idsToExport: string[];

  if (prospectIds && prospectIds.length > 0) {
    idsToExport = prospectIds;
  } else {
    // Sin IDs explícitos: buscar todos los aprobados (batch máx 200)
    const { data, error } = await adminTyped
      .from("prospeccion_prospects")
      .select("id")
      .eq("status", "aprobado")
      .limit(200);

    if (error) {
      return {
        ok: false,
        message: `Error al leer prospectos aprobados: ${error.message}`,
      };
    }

    idsToExport = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);

    if (idsToExport.length === 0) {
      return {
        ok: true,
        totalOk: 0,
        totalErrors: 0,
        results: [],
      };
    }
  }

  // ---- Cablear Use Case ----
  const exportAdapter = new ClientifyExportAdapter(adminTyped);
  const useCase = new ExportToClientifyUseCase(exportAdapter, adminTyped);

  const result = await useCase.execute({
    prospectIds: idsToExport,
    actorId: user.id,
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath("/comercial/prospeccion");

  const { totalOk, totalErrors, results } = result.value;
  return {
    ok: true,
    totalOk,
    totalErrors,
    results: results.map((r) => ({
      prospect_id: r.prospect_id,
      ok: r.ok,
      clientify_contact_id: r.clientify_contact_id,
      error: r.error,
    })),
  };
}
