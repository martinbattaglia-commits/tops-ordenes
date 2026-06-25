"use server";

// Driving adapter (Composition Root en el borde, Parte II §3.2). Traduce la acción humana a un
// caso de uso: autoriza (canAccess), valida, cablea los driven adapters y ejecuta. Cero reglas
// de negocio aquí (viven en el dominio/caso de uso). La escritura usa service_role (RPC DEFINER).
// Vive en adapters/ (no en application/): ensambla infra → respeta la Regla de Dependencia.
import { revalidatePath } from "next/cache";
import { canAccess } from "@/lib/rbac/guard";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { ImportProspectsUseCase } from "../../application/import-prospects.use-case";
import { UuidIdGenerator } from "../id/uuid-id-generator";
import { SupabaseIngestAdapter, type RpcCapableClient } from "../supabase/supabase-ingest.adapter";
import { parseCsv } from "../import/csv-parser";
import type { ProspectImportInput } from "../../domain/prospect";

export interface ImportProspectsActionInput {
  source: string;
  csvText?: string;
  rows?: ProspectImportInput[];
}

export type ImportProspectsActionResult =
  | { ok: true; message: string; inserted: number; duplicates: number; rejected: number }
  | { ok: false; message: string };

export async function importProspectsAction(
  input: ImportProspectsActionInput,
): Promise<ImportProspectsActionResult> {
  // CR-HIGH #1 (Zero Trust, SEC-4/SEC-10): la escritura usa service_role (BYPASSA RLS), por lo que
  // la RLS NO es la frontera de esta ruta. Por eso el borde es FAIL-CLOSED en dos niveles:
  //   (1) DEBE existir una sesión autenticada real (sin sesión → 0 escritura, sin importar RBAC dormido);
  //   (2) DEBE tener el permiso prospeccion.create.
  // Residual conocido y documentado (RO-2/MTD-03, sistémico de todo Nexus): con RBAC DORMIDO,
  // canAccess() es permisivo para un usuario autenticado sin rol asignado; el enforcement fino por
  // rol queda gateado a la activación del RBAC (MTD-03), no es un defecto introducido por F0.
  const userClient = createClient();
  const user = userClient ? (await userClient.auth.getUser()).data.user : null;
  if (!user) {
    return { ok: false, message: "Sesión no autenticada: la ingesta requiere un usuario logueado." };
  }
  if (!(await canAccess("prospeccion.create"))) {
    return { ok: false, message: "Sin permiso para importar prospectos (prospeccion.create)." };
  }

  const rows = input.rows ?? (input.csvText ? parseCsv(input.csvText) : []);
  if (rows.length === 0) {
    return { ok: false, message: "No hay filas para importar." };
  }

  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, message: "Supabase no configurado en este entorno (no se puede ingestar)." };
  }

  const useCase = new ImportProspectsUseCase(
    new UuidIdGenerator(),
    // Cast acotado en el composition root: el SupabaseClient cumple estructuralmente RpcCapableClient.
    new SupabaseIngestAdapter(admin as unknown as RpcCapableClient),
  );

  const result = await useCase.execute({ source: input.source, rows });
  if (!result.ok) {
    return { ok: false, message: result.error.message };
  }

  revalidatePath("/comercial/prospeccion");
  const r = result.value;
  return {
    ok: true,
    message: `Import: ${r.inserted} nuevos · ${r.duplicates} duplicados · ${r.rejected.length} rechazados (de ${r.received}).`,
    inserted: r.inserted,
    duplicates: r.duplicates,
    rejected: r.rejected.length,
  };
}
