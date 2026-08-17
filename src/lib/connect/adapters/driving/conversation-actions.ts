"use server";

// Nexus Link · driving adapter (server actions de conversaciones). createConversation (+ vínculo
// opcional a entidad ERP, D-RC1-5) y linkEntity. Escritura por sesión vía RPC SECDEF (RC1.0).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canAccess } from "@/lib/rbac/guard";
import { canSendInternalChat } from "@/lib/rbac/internal-chat";
import { getDepotManagerBoot } from "@/lib/rbac/boot-permissions";
import { createClient } from "@/lib/supabase/server";
import { CreateConversationUseCase, LinkEntityUseCase } from "../../application/use-cases";
import { ConnectRpcAdapter, type RpcCapableClient } from "../supabase/connect-rpc.adapter";
import { CONNECT_ENTITY_TYPES } from "../../types";

const CreateConversationSchema = z.object({
  kind: z.enum(["dm", "group", "channel", "erp", "incident", "whatsapp", "ai"]),
  title: z.string().max(200).nullable().optional(),
  slug: z.string().max(120).nullable().optional(),
  visibility: z.enum(["public", "private"]).nullable().optional(),
  memberProfileIds: z.array(z.string().uuid()).max(200).default([]),
  entityType: z.enum(CONNECT_ENTITY_TYPES).nullable().optional(),
  entityId: z.string().uuid().nullable().optional(),
  entityIdText: z.string().max(200).nullable().optional(),
});

const LinkEntitySchema = z.object({
  conversationId: z.string().min(1),
  entityType: z.enum(CONNECT_ENTITY_TYPES),
  entityId: z.string().uuid().nullable().optional(),
  entityIdText: z.string().max(200).nullable().optional(),
});

export type CreateConversationResult =
  | { ok: true; conversationId: string }
  | { ok: false; message: string };

export type SimpleResult = { ok: true } | { ok: false; message: string };

export async function createConversationAction(raw: unknown): Promise<CreateConversationResult> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Modo demo: no se crea la conversación (sin Supabase)." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sesión no autenticada." };
  if (!(await canSendInternalChat())) {
    return { ok: false, message: "Sin permiso para crear conversaciones (connect.create)." };
  }
  const parsed = CreateConversationSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Datos inválidos." };
  const managerScope = await getDepotManagerBoot();
  if (managerScope.restricted && (
    !managerScope.authorized
    || !["dm", "group"].includes(parsed.data.kind)
    || parsed.data.entityType != null
    || parsed.data.entityId != null
    || parsed.data.entityIdText != null
    || parsed.data.visibility === "public"
  )) {
    return { ok: false, message: "La cuenta sólo puede crear chats internos privados." };
  }
  if (managerScope.restricted) {
    const { data, error } = await supabase.rpc("nexus_depot_manager_connect_create_conversation", {
      p_kind: parsed.data.kind,
      p_title: parsed.data.title ?? null,
      p_slug: parsed.data.slug ?? null,
      p_visibility: parsed.data.visibility ?? "private",
      p_member_profile_ids: parsed.data.memberProfileIds,
    });
    if (error || typeof data !== "string") {
      return { ok: false, message: "No se pudo crear el chat interno." };
    }
    revalidatePath("/connect");
    return { ok: true, conversationId: data };
  }

  const useCase = new CreateConversationUseCase(
    new ConnectRpcAdapter(supabase as unknown as RpcCapableClient),
  );
  const result = await useCase.execute({
    kind: parsed.data.kind,
    title: parsed.data.title ?? null,
    slug: parsed.data.slug ?? null,
    visibility: parsed.data.visibility ?? null,
    memberProfileIds: parsed.data.memberProfileIds,
    entityType: parsed.data.entityType ?? null,
    entityId: parsed.data.entityId ?? null,
    entityIdText: parsed.data.entityIdText ?? null,
  });
  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath("/connect");
  return { ok: true, conversationId: result.value.conversationId };
}

export async function linkEntityAction(raw: unknown): Promise<SimpleResult> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Modo demo: no se vincula (sin Supabase)." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sesión no autenticada." };
  if (!(await canAccess("connect.edit"))) {
    return { ok: false, message: "Sin permiso para vincular entidades (connect.edit)." };
  }
  const parsed = LinkEntitySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Datos inválidos." };

  const useCase = new LinkEntityUseCase(
    new ConnectRpcAdapter(supabase as unknown as RpcCapableClient),
  );
  const result = await useCase.execute(
    parsed.data.conversationId, parsed.data.entityType,
    parsed.data.entityId ?? null, parsed.data.entityIdText ?? null,
  );
  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath(`/connect/c/${parsed.data.conversationId}`);
  return { ok: true };
}
