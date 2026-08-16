"use server";

// Nexus Link · driving adapter (server action de lectura): markRead. Optimista (no revalidatePath:
// el contador se confirma por realtime). Escritura por sesión vía RPC connect_mark_read (RC1.0).

import { z } from "zod";
import { canReadInternalChat } from "@/lib/rbac/internal-chat";
import { getDepotManagerBoot } from "@/lib/rbac/boot-permissions";
import { createClient } from "@/lib/supabase/server";
import { MarkReadUseCase } from "../../application/use-cases";
import { ConnectRpcAdapter, type RpcCapableClient } from "../supabase/connect-rpc.adapter";

const MarkReadSchema = z.object({
  conversationId: z.string().min(1),
  upToSeq: z.number().int().nonnegative(),
});

export type SimpleResult = { ok: true } | { ok: false; message: string };

export async function markReadAction(raw: unknown): Promise<SimpleResult> {
  const supabase = createClient();
  if (!supabase) return { ok: true }; // demo: no-op silencioso
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sesión no autenticada." };
  if (!(await canReadInternalChat())) {
    return { ok: false, message: "Sin permiso (connect.view)." };
  }
  const parsed = MarkReadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Datos inválidos." };

  const managerScope = await getDepotManagerBoot();
  if (managerScope.restricted) {
    if (!managerScope.authorized) return { ok: false, message: "Acceso denegado." };
    const { error } = await supabase.rpc("nexus_depot_manager_connect_mark_read", {
      p_conversation_id: parsed.data.conversationId,
      p_up_to_seq: parsed.data.upToSeq,
    });
    return error ? { ok: false, message: "No se pudo actualizar la lectura." } : { ok: true };
  }

  const useCase = new MarkReadUseCase(
    new ConnectRpcAdapter(supabase as unknown as RpcCapableClient),
  );
  const result = await useCase.execute(parsed.data.conversationId, parsed.data.upToSeq);
  if (!result.ok) return { ok: false, message: result.error.message };
  return { ok: true };
}
