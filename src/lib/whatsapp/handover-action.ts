"use server";

// Nexus Link · Handover Action (P1).
// Control de pausa y reactivación de Max Bot por conversación de WhatsApp.
// Invoca el RPC canónico `connect_set_handover_state` (0260), fail-closed.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { canChannel } from "@/lib/rbac/nexus-link";

const HandoverSchema = z.object({
  conversationId: z.string().uuid(),
  state: z.enum(["BOT_ACTIVE", "PAUSED_HUMAN"]),
});

export type HandoverActionResult =
  | { ok: true; state: "BOT_ACTIVE" | "PAUSED_HUMAN" }
  | { ok: false; message: string };

export async function setHandoverStateAction(raw: unknown): Promise<HandoverActionResult> {
  const parsed = HandoverSchema.safeParse(raw);
  if (!parsed.success) {
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

  const allowed = await canChannel("nexus_link.whatsapp.send");
  if (!allowed) {
    return { ok: false, message: "No tenés permiso para operar este canal." };
  }

  // Verifica que la conversación sea de kind 'whatsapp'
  const { data: conv, error: convError } = await supabase
    .from("connect_conversations")
    .select("kind")
    .eq("id", parsed.data.conversationId)
    .maybeSingle();

  if (convError || !conv || conv.kind !== "whatsapp") {
    return { ok: false, message: "La conversación de WhatsApp no pudo validarse." };
  }

  const { error } = await supabase.rpc("connect_set_handover_state", {
    p_conversation_id: parsed.data.conversationId,
    p_state: parsed.data.state,
  });

  if (error) {
    const isPermission = error.message.toLowerCase().includes("permission") ||
      error.message.toLowerCase().includes("privilege");
    return {
      ok: false,
      message: isPermission
        ? "Sin permiso para conmutar el estado de Max en este canal."
        : "No se pudo actualizar el estado de Max. Probá de nuevo.",
    };
  }

  revalidatePath(`/connect/c/${parsed.data.conversationId}`);
  return { ok: true, state: parsed.data.state };
}
