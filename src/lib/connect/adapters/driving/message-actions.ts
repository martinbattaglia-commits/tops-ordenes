"use server";

// Nexus Link · driving adapter (server actions de mensajería). Patrón canónico (import-actions.ts):
// createClient→getUser→canAccess→zod→use-case(adapter sesión)→revalidatePath→union.
// Escritura POR SESIÓN: el RPC connect_post_message (RC1.0) re-valida membresía + audita al usuario real.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canAccess } from "@/lib/rbac/guard";
import { createClient } from "@/lib/supabase/server";
import { PostMessageUseCase } from "../../application/use-cases";
import { ConnectRpcAdapter, type RpcCapableClient } from "../supabase/connect-rpc.adapter";

const PostMessageSchema = z.object({
  conversationId: z.string().min(1),
  body: z.string().max(8000).nullable().optional(),
  replyTo: z.string().uuid().nullable().optional(),
  clientMsgId: z.string().min(8).max(64),
  attachmentIds: z.array(z.string().uuid()).max(10).default([]),
  // F4.1B (D-F41-8): profile ids ya resueltos por resolveMentions en el composer.
  mentions: z.array(z.string().uuid()).max(20).default([]),
});

export type PostMessageResult =
  | { ok: true; messageId: string; seq: number }
  | { ok: false; message: string };

export async function postMessageAction(raw: unknown): Promise<PostMessageResult> {
  const supabase = createClient();
  if (!supabase) {
    return { ok: false, message: "Modo demo: el mensaje no se persiste (sin Supabase configurado)." };
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sesión no autenticada." };
  if (!(await canAccess("connect.create"))) {
    return { ok: false, message: "Sin permiso para enviar mensajes (connect.create)." };
  }

  const parsed = PostMessageSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Datos inválidos." };

  const useCase = new PostMessageUseCase(
    new ConnectRpcAdapter(supabase as unknown as RpcCapableClient),
  );
  const result = await useCase.execute({
    conversationId: parsed.data.conversationId,
    body: parsed.data.body ?? null,
    replyTo: parsed.data.replyTo ?? null,
    clientMsgId: parsed.data.clientMsgId,
    attachmentIds: parsed.data.attachmentIds,
    mentions: parsed.data.mentions,
  });
  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath(`/connect/c/${parsed.data.conversationId}`);
  revalidatePath("/connect");
  return { ok: true, messageId: result.value.messageId, seq: result.value.seq };
}
