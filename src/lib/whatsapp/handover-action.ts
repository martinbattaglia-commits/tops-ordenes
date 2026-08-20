"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canAccess } from "@/lib/rbac/guard";
import { createClient } from "@/lib/supabase/server";

export type HandoverActionResult =
  | { ok: true }
  | { ok: false; message: string };

export async function setHandoverStateAction(raw: unknown): Promise<HandoverActionResult> {
  const p = z.object({
    conversationId: z.string().min(1),
    state: z.enum(["BOT_ACTIVE", "PAUSED_HUMAN"]),
  }).safeParse(raw);

  if (!p.success) {
    return { ok: false, message: "Parámetros inválidos." };
  }

  const supabase = createClient();
  if (!supabase) {
    return { ok: false, message: "Modo demo: no se persiste." };
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, message: "Sesión no autenticada." };
  }

  if (!(await canAccess("connect.edit")) && !(await canAccess("connect.view"))) {
    return { ok: false, message: "Sin permiso." };
  }

  const { error } = await supabase.rpc("connect_set_handover_state", {
    p_conversation_id: p.data.conversationId,
    p_state: p.data.state,
  });

  if (error) {
    return { ok: false, message: error.message };
  }

  revalidatePath("/connect", "layout");
  return { ok: true };
}
