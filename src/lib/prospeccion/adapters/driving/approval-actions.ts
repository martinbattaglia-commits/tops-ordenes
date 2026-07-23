"use server";

// Driving adapter · Approval/Rejection de prospectos (F2 Prospección Inteligente).
// Autoriza (canAccess), cablea ApproveProspectUseCase + SupabaseQualificationAdapter.
// Escritura vía service_role (createAdminClient). Zero reglas de negocio aquí.
import { revalidatePath } from "next/cache";
import { canAccess } from "@/lib/rbac/guard";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { ApproveProspectUseCase } from "../../application/approve-prospect.use-case";
import {
  SupabaseQualificationAdapter,
  type RpcCapableClient,
} from "../supabase/supabase-qualification.adapter";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type ApprovalActionResult = { ok: true } | { ok: false; message: string };

export type BulkApprovalActionResult =
  | { ok: true; approved: number }
  | { ok: false; message: string };

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Crea el use case cableado al adapter service_role. Solo se llama dentro de una action. */
function buildUseCase(admin: unknown): ApproveProspectUseCase {
  return new ApproveProspectUseCase(
    new SupabaseQualificationAdapter(admin as RpcCapableClient),
  );
}

/** Extrae el user autenticado y verifica permiso de aprobación. Devuelve user o null+mensaje. */
async function authenticate(): Promise<
  { user: { id: string } } | { user: null; message: string }
> {
  const userClient = createClient();
  const user = userClient ? (await userClient.auth.getUser()).data.user : null;
  if (!user) return { user: null, message: "Sesión no autenticada." };
  if (!(await canAccess("prospeccion.approve")))
    return { user: null, message: "Sin permiso (prospeccion.approve)." };
  return { user };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Aprueba un único prospecto (status 'scoreado' → 'aprobado'). */
export async function approveProspectAction(
  prospectId: string,
): Promise<ApprovalActionResult> {
  const auth = await authenticate();
  if (!auth.user) return { ok: false, message: auth.message };

  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Supabase no configurado." };

  const result = await buildUseCase(admin).approve(prospectId, auth.user.id);
  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath("/comercial/prospeccion");
  return { ok: true };
}

/** Aprueba un array de prospectos en serie. Devuelve cuántos se aprobaron con éxito. */
export async function bulkApproveAction(
  prospectIds: string[],
): Promise<BulkApprovalActionResult> {
  if (prospectIds.length === 0)
    return { ok: false, message: "No se especificaron prospectos para aprobar." };

  const auth = await authenticate();
  if (!auth.user) return { ok: false, message: auth.message };

  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Supabase no configurado." };

  const useCase = buildUseCase(admin);
  let approved = 0;

  for (const id of prospectIds) {
    const result = await useCase.approve(id, auth.user.id);
    if (result.ok) approved++;
    // Se registra el error en la consola vía el use case pero no detiene el lote.
  }

  revalidatePath("/comercial/prospeccion");
  return { ok: true, approved };
}

/** Rechaza un único prospecto (status → 'rechazado') con un motivo opcional. */
export async function rejectProspectAction(
  prospectId: string,
  reason: string,
): Promise<ApprovalActionResult> {
  const auth = await authenticate();
  if (!auth.user) return { ok: false, message: auth.message };

  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Supabase no configurado." };

  const result = await buildUseCase(admin).reject(
    prospectId,
    auth.user.id,
    reason,
  );
  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath("/comercial/prospeccion");
  return { ok: true };
}

/**
 * Aprueba en bulk todos los prospectos que tienen decision='import' en la vista
 * prospeccion_scores_current y status actual='scoreado' en prospeccion_prospects.
 *
 * Flujo:
 *  1. Consulta la vista para obtener los IDs candidatos.
 *  2. Filtra solo los que siguen en status='scoreado' (guardia de transición).
 *  3. Ejecuta bulk approve.
 */
export async function approveAllGreenAction(): Promise<BulkApprovalActionResult> {
  const auth = await authenticate();
  if (!auth.user) return { ok: false, message: auth.message };

  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Supabase no configurado." };

  const adminTyped = admin as unknown as SupabaseClient;

  // Fetch IDs con decision='import' desde la vista de scores actuales
  const { data: scoreRows, error: scoreError } = await adminTyped
    .from("prospeccion_scores_current")
    .select("prospect_id")
    .eq("decision", "import");

  if (scoreError) {
    return {
      ok: false,
      message: `Error al leer scores: ${scoreError.message}`,
    };
  }

  if (!scoreRows || scoreRows.length === 0) {
    return { ok: true, approved: 0 };
  }

  const candidateIds = (scoreRows as Array<{ prospect_id: string }>).map(
    (r) => r.prospect_id,
  );

  // Filtra solo los que siguen en 'scoreado' (previene aprobaciones dobles)
  const { data: eligibleRows, error: eligibleError } = await adminTyped
    .from("prospeccion_prospects")
    .select("id")
    .in("id", candidateIds)
    .eq("status", "scoreado");

  if (eligibleError) {
    return {
      ok: false,
      message: `Error al filtrar prospectos elegibles: ${eligibleError.message}`,
    };
  }

  if (!eligibleRows || eligibleRows.length === 0) {
    return { ok: true, approved: 0 };
  }

  const eligibleIds = (eligibleRows as Array<{ id: string }>).map((r) => r.id);

  // Aprueba el lote elegible
  const useCase = buildUseCase(admin);
  let approved = 0;

  for (const id of eligibleIds) {
    const result = await useCase.approve(id, auth.user.id);
    if (result.ok) approved++;
  }

  revalidatePath("/comercial/prospeccion");
  return { ok: true, approved };
}
