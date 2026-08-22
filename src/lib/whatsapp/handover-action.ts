"use server";

// Nexus Link · Handover Action (P1 / HIGH 1).
// Control de pausa y reactivación de Max Bot por conversación de WhatsApp.
// Invoca el RPC canónico `connect_set_handover_state` (0266) con soporte atómico y CAS, fail-closed.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { canChannel } from "@/lib/rbac/nexus-link";

const HandoverSchema = z.object({
  conversationId: z.string().uuid(),
  state: z.enum(["BOT_ACTIVE", "PAUSED_HUMAN"]),
  expectedState: z.enum(["BOT_ACTIVE", "PAUSED_HUMAN"]),
});

export type HandoverActionResult =
  | { ok: true; state: "BOT_ACTIVE" | "PAUSED_HUMAN"; actorId?: string }
  | { ok: false; message: string; actualState?: "BOT_ACTIVE" | "PAUSED_HUMAN" };

const HandoverStateSchema = z.enum(["BOT_ACTIVE", "PAUSED_HUMAN"]);
const RpcHandoverSuccessSchema = z.object({
  ok: z.literal(true),
  state: HandoverStateSchema,
  actor: z.string().optional(),
  updated_at: z.string().optional(),
}).strict();
const RpcHandoverConflictSchema = z.object({
  ok: z.literal(false),
  conflict: z.literal(true),
  state: HandoverStateSchema,
  message: z.string().optional(),
}).strict();
const RpcHandoverFailureSchema = z.object({
  ok: z.literal(false),
  conflict: z.literal(false).optional(),
  state: HandoverStateSchema.optional(),
  message: z.string().optional(),
}).strict();
const RpcHandoverResultSchema = z.union([
  RpcHandoverSuccessSchema,
  RpcHandoverConflictSchema,
  RpcHandoverFailureSchema,
]);

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

  // Ejecución atómica vía RPC con Compare-And-Swap (CAS) obligatorio en base de datos
  const { data, error } = await supabase.rpc("connect_set_handover_state", {
    p_conversation_id: parsed.data.conversationId,
    p_state: parsed.data.state,
    p_expected_state: parsed.data.expectedState,
  });

  if (error) {
    const isPermission =
      error.message.toLowerCase().includes("permission") ||
      error.message.toLowerCase().includes("privilege") ||
      error.message.toLowerCase().includes("sin permiso");
    return {
      ok: false,
      message: isPermission
        ? "Sin permiso para conmutar el estado de Max en este canal."
        : "No se pudo actualizar el estado de Max. Probá de nuevo.",
    };
  }

  const rpcResult = RpcHandoverResultSchema.safeParse(data);
  if (!rpcResult.success) {
    return {
      ok: false,
      message: "Respuesta inválida del servidor al actualizar handover.",
    };
  }
  const res = rpcResult.data;

  if (!res.ok) {
    if (res.conflict) {
      return {
        ok: false,
        message: res.message || "El estado fue modificado por otro operador.",
        actualState: res.state,
      };
    }
    return {
      ok: false,
      message: res.message || "No se pudo actualizar el estado de Max. Probá de nuevo.",
      actualState: res.state,
    };
  }

  revalidatePath(`/connect/c/${parsed.data.conversationId}`);
  return {
    ok: true,
    state: res.state,
    actorId: res.actor || user.id,
  };
}
