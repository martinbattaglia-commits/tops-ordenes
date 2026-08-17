"use server";

// Nexus Link · RC1.4 favoritos. Marca/desmarca favorito una conversación/canal/contexto ERP
// (todo es conversación → reusa connect_toggle_favorite de 0144, sin DB nueva). Fail-closed.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canReadInternalChat } from "@/lib/rbac/internal-chat";
import { createClient } from "@/lib/supabase/server";

export type SimpleResult = { ok: true } | { ok: false; message: string };

export async function toggleFavoriteAction(raw: unknown): Promise<SimpleResult> {
  const p = z.object({ conversationId: z.string().min(1), on: z.boolean() }).safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Modo demo: el favorito no persiste (sin Supabase)." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sesión no autenticada." };
  if (!(await canReadInternalChat())) return { ok: false, message: "Sin permiso de chat interno." };

  const { error } = await supabase.rpc("connect_toggle_favorite", {
    p_conversation_id: p.data.conversationId,
    p_on: p.data.on,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/connect", "layout");
  return { ok: true };
}
