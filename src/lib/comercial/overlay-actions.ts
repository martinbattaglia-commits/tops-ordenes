"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const HORIZONTES = new Set([
  "Esta semana", "15 días", "30 días", "60 días", "90 días", "+90 días", "A definir",
]);

export async function upsertDealOverlay(input: {
  dealId: number;
  horizonte?: string | null;
  observaciones?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  // La probabilidad NO se edita en Nexus: sale siempre de Clientify. Acá solo
  // se anotan horizonte y observaciones (la RLS exige rol operaciones/admin/supervisor).
  const supabase = createClient();
  if (!supabase) return { ok: false, error: "Supabase no disponible" };

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { ok: false, error: "No autenticado" };

  if (input.horizonte != null && !HORIZONTES.has(input.horizonte))
    return { ok: false, error: "Horizonte inválido" };

  // Escribir SOLO el campo provisto. Si se manda horizonte, no tocar observaciones
  // (y viceversa): en un upsert, las columnas omitidas conservan su valor en ON CONFLICT,
  // evitando que editar un campo borre el otro.
  const payload: {
    clientify_deal_id: number; updated_by: string; updated_at: string;
    horizonte?: string | null; observaciones?: string | null;
  } = {
    clientify_deal_id: input.dealId,
    updated_by: auth.user.id,
    updated_at: new Date().toISOString(),
  };
  if (input.horizonte !== undefined) payload.horizonte = input.horizonte;
  if (input.observaciones !== undefined) payload.observaciones = input.observaciones?.slice(0, 2000) ?? null;

  const { error } = await supabase.from("crm_deal_overlay").upsert(payload, { onConflict: "clientify_deal_id" });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/comercial/tablero");
  return { ok: true };
}
