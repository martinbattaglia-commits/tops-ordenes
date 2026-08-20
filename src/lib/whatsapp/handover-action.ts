"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canChannel } from "@/lib/rbac/nexus-link";
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

  const { data: conversation, error: conversationError } = await supabase
    .from("connect_conversations")
    .select("kind")
    .eq("id", p.data.conversationId)
    .maybeSingle();
  if (conversationError || conversation?.kind !== "whatsapp") {
    return { ok: false, message: "La conversación de WhatsApp no pudo validarse." };
  }

  if (!(await canChannel("nexus_link.whatsapp.send"))) {
    return { ok: false, message: "No tenés permiso para operar este canal." };
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
