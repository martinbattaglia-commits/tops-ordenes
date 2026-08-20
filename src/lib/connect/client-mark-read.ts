"use client";

import { createClient } from "@/lib/supabase/client";

export type ClientMarkReadResult = { ok: true } | { ok: false; message: string };

/**
 * Persiste el cursor de lectura con la sesión real del navegador.
 *
 * No usa una Server Action: esta escritura nace en un efecto de hidratación y
 * debe llegar directamente a PostgREST. `connect_mark_read` sólo puede avanzar
 * `last_read_seq` para el participante cuyo `profile_id = auth.uid()`.
 */
export async function markReadInBrowser(
  conversationId: string,
  upToSeq: number,
): Promise<ClientMarkReadResult> {
  if (!conversationId || !Number.isSafeInteger(upToSeq) || upToSeq < 0) {
    return { ok: false, message: "Datos de lectura inválidos." };
  }

  const supabase = createClient();
  if (!supabase) return { ok: true }; // entorno demo: no-op

  try {
    const { error } = await supabase.rpc("connect_mark_read", {
      p_conversation_id: conversationId,
      p_up_to_seq: upToSeq,
    });
    if (error) return { ok: false, message: "No se pudo actualizar la lectura." };
    return { ok: true };
  } catch {
    return { ok: false, message: "No se pudo actualizar la lectura." };
  }
}
