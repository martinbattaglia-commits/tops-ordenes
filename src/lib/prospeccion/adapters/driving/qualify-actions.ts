"use server";

// Driving adapter · QualifyProspects (F2 Prospección Inteligente).
// Autoriza (canAccess), carga el lote, cablea QualifyProspectsUseCase y SupabaseQualificationAdapter.
// Zero reglas de negocio aquí — viven en qualify.ts y QualifyProspectsUseCase.
// Escritura via service_role (createAdminClient); lectura del lote también via admin para evitar
// restricciones RLS en tabla interna (el gate es la sesión + permiso).
import { revalidatePath } from "next/cache";
import { canAccess } from "@/lib/rbac/guard";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { QualifyProspectsUseCase } from "../../application/qualify-prospects.use-case";
import {
  SupabaseQualificationAdapter,
  type RpcCapableClient,
} from "../supabase/supabase-qualification.adapter";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type QualifyActionResult =
  | {
      ok: true;
      qualified: number;
      errors: number;
      results: Array<{
        prospect_id: string;
        score: number;
        decision: string;
        explanation: string;
      }>;
    }
  | { ok: false; message: string };

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

/**
 * Califica todos los prospectos en status 'imported' o 'raw' (batch máx 200),
 * o un subconjunto específico si se proporcionan IDs.
 */
export async function qualifyProspectsAction(
  prospectIds?: string[],
): Promise<QualifyActionResult> {
  // ---- Zero-Trust gate (SEC-4/SEC-10) ----
  const userClient = createClient();
  const user = userClient ? (await userClient.auth.getUser()).data.user : null;
  if (!user) return { ok: false, message: "Sesión no autenticada." };
  if (!(await canAccess("prospeccion.create")))
    return { ok: false, message: "Sin permiso (prospeccion.create)." };

  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Supabase no configurado." };

  // ---- Fetch del lote a calificar ----
  const adminTyped = admin as unknown as SupabaseClient;
  let query = adminTyped
    .from("prospeccion_prospects")
    .select(
      "id, raw, company_name, cargo, email, website, cuit, linkedin_url, status",
    )
    .in("status", ["imported", "raw"]);

  if (prospectIds && prospectIds.length > 0) {
    query = query.in("id", prospectIds);
  } else {
    query = query.limit(200);
  }

  const { data, error } = await query;

  if (error) {
    return { ok: false, message: `Error al cargar prospectos: ${error.message}` };
  }
  if (!data || data.length === 0) {
    return { ok: false, message: "No hay prospectos en estado 'imported' o 'raw' para calificar." };
  }

  // ---- Orquestar Use Case ----
  const useCase = new QualifyProspectsUseCase(
    new SupabaseQualificationAdapter(admin as unknown as RpcCapableClient),
  );

  type ProspectRow = {
    id: string;
    raw: Record<string, unknown> | null;
    company_name: string | null;
    cargo: string | null;
    email: string | null;
    website: string | null;
    cuit: string | null;
    linkedin_url: string | null;
  };

  const result = await useCase.execute({
    prospects: (data as ProspectRow[]).map((p) => ({
      prospect_id: p.id,
      raw: (p.raw as Record<string, unknown>) ?? {},
      company_name: p.company_name,
      cargo: p.cargo,
      email: p.email,
      website: p.website,
      cuit: p.cuit,
      linkedin_url: p.linkedin_url,
    })),
    actorId: user.id,
  });

  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath("/comercial/prospeccion");

  return { ok: true, ...result.value };
}
