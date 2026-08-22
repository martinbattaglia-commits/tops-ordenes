"use server";

// Nexus Link · Reacciones con Emojis (P3).
// Acciones del servidor para agregar y quitar reacciones a mensajes internos.
// Invoca los RPCs canónicos `connect_react` y `connect_unreact` (0144 / 0163).
// Restringido estrictamente a los 6 emojis autorizados por diseño: 👍 ❤️ 😂 😮 😢 🙏

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const SUPPORTED_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"] as const;
export type SupportedEmoji = (typeof SUPPORTED_EMOJIS)[number];

const ReactionSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().uuid(),
  emoji: z.enum(SUPPORTED_EMOJIS),
});

export type ReactionActionResult =
  | { ok: true }
  | { ok: false; message: string };

export async function addReactionAction(raw: unknown): Promise<ReactionActionResult> {
  const parsed = ReactionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: "Emoji o parámetros de reacción no autorizados." };
  }

  const supabase = createClient();
  if (!supabase) {
    return { ok: false, message: "Modo demo: sin persistencia." };
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, message: "Sesión no autenticada." };
  }

  const { error } = await supabase.rpc("connect_react", {
    p_message_id: parsed.data.messageId,
    p_emoji: parsed.data.emoji,
  });

  if (error) {
    const isPermission = error.message.toLowerCase().includes("permission") ||
      error.message.toLowerCase().includes("privilege") ||
      error.message.toLowerCase().includes("denied");
    return {
      ok: false,
      message: isPermission
        ? "Sin permiso para reaccionar en esta conversación."
        : "No se pudo registrar la reacción.",
    };
  }

  revalidatePath(`/connect/c/${parsed.data.conversationId}`);
  return { ok: true };
}

export async function removeReactionAction(raw: unknown): Promise<ReactionActionResult> {
  const parsed = ReactionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: "Emoji o parámetros de reacción no autorizados." };
  }

  const supabase = createClient();
  if (!supabase) {
    return { ok: false, message: "Modo demo: sin persistencia." };
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, message: "Sesión no autenticada." };
  }

  const { error } = await supabase.rpc("connect_unreact", {
    p_message_id: parsed.data.messageId,
    p_emoji: parsed.data.emoji,
  });

  if (error) {
    const isPermission = error.message.toLowerCase().includes("permission") ||
      error.message.toLowerCase().includes("privilege") ||
      error.message.toLowerCase().includes("denied");
    return {
      ok: false,
      message: isPermission
        ? "Sin permiso para modificar reacciones en esta conversación."
        : "No se pudo remover la reacción.",
    };
  }

  revalidatePath(`/connect/c/${parsed.data.conversationId}`);
  return { ok: true };
}
