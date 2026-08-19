"use server";

// Nexus Link · LINK-MEDIA-001 — server actions de mensajes de audio.
//
// Flujo en 3 pasos (evita pasar 10 MB por el body de una server action):
//   1. prepareAudioUploadAction  → valida sesión + permiso + MEMBRESÍA + hilo NO archivado,
//      y emite una signed UPLOAD URL de storage para un path elegido por el SERVIDOR.
//   2. el cliente sube el blob directo a storage (URL firmada, un solo uso).
//   3. finalizeAudioMessageAction → descarga el objeto, valida FIRMA BINARIA real +
//      límites, calcula sha256, inserta attachment + mensaje kind='audio'
//      (client_msg_id ⇒ envío único). Si algo falla: borra el objeto (cero huérfanos).
//
// Lectura: getAudioUrlAction resuelve attachment por mensaje BAJO RLS DE SESIÓN
// (membresía) y luego pide la signed URL vía el RPC existente (0144), que re-valida.

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { canReadInternalChat } from "@/lib/rbac/internal-chat";
import { canChannel } from "@/lib/rbac/nexus-link";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { validateAudio, AUDIO_LIMITS } from "../../audio/validate";
import { classifyMediaFailure, type MediaDiagnostic } from "../../media-outcome";
import { counterpartPhoneFromContext } from "@/lib/whatsapp/reply-core";
import { sendWhatsappMediaForAttachment, type MediaSendResult } from "@/lib/whatsapp/media-send";

const BUCKET = "connect-files";

type SessionGuard =
  | { ok: true; userId: string }
  | { ok: false; message: string };

async function guardSession(): Promise<SessionGuard> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Modo demo: audio deshabilitado." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sesión no autenticada." };
  if (!(await canReadInternalChat())) return { ok: false, message: "Sin permiso de chat interno." };
  return { ok: true, userId: user.id };
}

type PuedeGrabar =
  | { ok: true; kind: string; contextId: string | null }
  | { ok: false; message: string };

/**
 * Membresía + hilo activo + CAPACIDAD DEL CANAL, verificados bajo RLS de
 * sesión (fail-closed).
 *
 * H2/H4 (FASE B): antes esta función sólo exigía `connect.view` + membresía,
 * sin distinguir canal — la MISMA asimetría que ya tenían los adjuntos antes
 * de `assertPuedeAdjuntar`. Un audio en WhatsApp nunca pasaba por
 * `nexus_link.whatsapp.media`. Se alinea al mismo criterio, exacto.
 */
async function assertPuedeGrabar(conversationId: string): Promise<PuedeGrabar> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Sin sesión." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sin sesión." };
  const { data, error } = await supabase
    .from("connect_conversations")
    .select("id, kind, context_id, archived_at, connect_participants!inner(profile_id)")
    .eq("id", conversationId)
    .eq("connect_participants.profile_id", user.id)
    .limit(1)
    .maybeSingle();
  if (error || !data) return { ok: false, message: "No sos miembro de esta conversación." };
  const conv = data as { kind: string; context_id: string | null; archived_at: string | null };
  if (conv.archived_at) {
    return { ok: false, message: "La conversación está archivada: no se pueden enviar audios." };
  }
  const capacidad = conv.kind === "whatsapp"
    ? "nexus_link.whatsapp.media" as const
    : "nexus_link.internal_chat.media" as const;
  if (!(await canChannel(capacidad))) return { ok: false, message: "No tenés acceso a este canal." };
  return { ok: true, kind: conv.kind, contextId: conv.context_id };
}

/** Mismo intento de egress que los adjuntos — ver su docblock en attachment-actions.ts. */
async function intentarEnviarAudioPorWhatsapp(
  autorizado: Extract<PuedeGrabar, { ok: true }>,
  input: { messageId: string; bucket: string; path: string; mimeType: string; fileName: string },
): Promise<{ state: MediaSendResult["state"]; message?: string } | undefined> {
  if (autorizado.kind !== "whatsapp") return undefined;
  const to = counterpartPhoneFromContext(autorizado.contextId ?? "");
  if (!to) return { state: "failed", message: "El hilo no tiene un teléfono de contraparte válido." };
  const r = await sendWhatsappMediaForAttachment({
    messageId: input.messageId, to, bucket: input.bucket, path: input.path,
    mimeType: input.mimeType, fileName: input.fileName,
  });
  return r.ok ? { state: r.state } : { state: r.state, message: r.message };
}

const PrepareSchema = z.object({ conversationId: z.string().uuid() });

export type PrepareUploadResult =
  | { ok: true; path: string; token: string }
  | { ok: false; message: string; cause?: MediaDiagnostic };

export async function prepareAudioUploadAction(raw: unknown): Promise<PrepareUploadResult> {
  const g = await guardSession();
  if (!g.ok) return g;
  const p = PrepareSchema.safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const autorizado = await assertPuedeGrabar(p.data.conversationId);
  if (!autorizado.ok) return { ok: false, message: autorizado.message };

  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Storage no disponible." };
  // Path elegido por el SERVIDOR (el cliente jamás lo controla).
  const path = `${p.data.conversationId}/audio/${randomUUID()}`;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    // SCOPE B · instrumentación del camino de media: el audio compartía el
    // mismo defecto que los adjuntos —causa real descartada, mensaje crudo de
    // Storage expuesto—, y es justo el camino que INC-02 necesita medir.
    const outcome = classifyMediaFailure(error, "upload_begin");
    return { ok: false, message: outcome.userMessage, cause: outcome.diagnostic };
  }
  return { ok: true, path: data.path, token: data.token };
}

const FinalizeSchema = z.object({
  conversationId: z.string().uuid(),
  path: z.string().min(1).max(300),
  durationMs: z.number().int().positive().max(AUDIO_LIMITS.maxDurationMs),
  clientMsgId: z.string().uuid(),
});

/** `whatsapp` refleja el desenlace REAL del envío a Meta — ver el mismo campo en attachment-actions.ts. */
export type FinalizeResult =
  | {
      ok: true; messageId: string; attachmentId: string;
      whatsapp?: { state: MediaSendResult["state"]; message?: string };
    }
  | { ok: false; message: string; cause?: MediaDiagnostic };

export async function finalizeAudioMessageAction(raw: unknown): Promise<FinalizeResult> {
  const g = await guardSession();
  if (!g.ok) return { ok: false, message: g.message };
  const p = FinalizeSchema.safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  // El path DEBE pertenecer a la conversación declarada (anti cruce de hilos).
  if (!p.data.path.startsWith(`${p.data.conversationId}/audio/`)) {
    return { ok: false, message: "Path inválido." };
  }
  const autorizado = await assertPuedeGrabar(p.data.conversationId);
  if (!autorizado.ok) return { ok: false, message: autorizado.message };

  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Storage no disponible." };

  const { data: file, error: dlErr } = await admin.storage.from(BUCKET).download(p.data.path);
  if (dlErr || !file) {
    const outcome = classifyMediaFailure(dlErr, "download");
    return { ok: false, message: outcome.userMessage, cause: outcome.diagnostic };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());

  const v = validateAudio(bytes, p.data.durationMs);
  if (!v.ok) {
    await admin.storage.from(BUCKET).remove([p.data.path]); // cero huérfanos
    return { ok: false, message: v.message };
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const { data: att, error: attErr } = await admin
    .from("connect_attachments")
    .insert({
      conversation_id: p.data.conversationId,
      storage_bucket: BUCKET,
      storage_path: p.data.path,
      sha256,
      mime_type: v.sniffed.mime,
      file_size: bytes.length,
      file_name: `voz-${Math.round(p.data.durationMs / 1000)}s.${v.sniffed.ext}`,
      uploaded_by: g.userId,
    })
    .select("id")
    .single();
  if (attErr || !att) {
    await admin.storage.from(BUCKET).remove([p.data.path]);
    return { ok: false, message: `attachment: ${attErr?.message}` };
  }
  const attachmentId = (att as { id: string }).id;

  // Mensaje vía SESIÓN (autoría real + client_msg_id = envío único por índice UNIQUE).
  const supabase = createClient()!;
  const { data: participant } = await supabase
    .from("connect_participants")
    .select("id")
    .eq("conversation_id", p.data.conversationId)
    .eq("profile_id", g.userId)
    .maybeSingle();
  const { data: msg, error: msgErr } = await admin
    .from("connect_messages")
    .insert({
      conversation_id: p.data.conversationId,
      author_participant_id: (participant as { id: string } | null)?.id ?? null,
      author_profile_id: g.userId,
      kind: "audio",
      body: "🎙️ Mensaje de voz",
      body_format: "text",
      client_msg_id: p.data.clientMsgId,
    })
    .select("id")
    .single();
  if (msgErr || !msg) {
    // client_msg_id duplicado ⇒ el mensaje YA existe (reintento) — no es error.
    if ((msgErr?.message ?? "").includes("duplicate")) {
      return { ok: false, message: "Este audio ya fue enviado." };
    }
    await admin.from("connect_attachments").delete().eq("id", attachmentId);
    await admin.storage.from(BUCKET).remove([p.data.path]);
    return { ok: false, message: `mensaje: ${msgErr?.message}` };
  }
  const messageId = (msg as { id: string }).id;
  await admin.from("connect_attachments").update({ message_id: messageId }).eq("id", attachmentId);

  // H2 (FASE B): en WhatsApp, la nota de voz reenvasada (WebM→Ogg, ver
  // opus-remux.ts) recién se publica como enviada cuando Meta la acepta.
  const whatsapp = await intentarEnviarAudioPorWhatsapp(autorizado, {
    messageId, bucket: BUCKET, path: p.data.path,
    mimeType: v.sniffed.mime, fileName: `voz-${Math.round(p.data.durationMs / 1000)}s.${v.sniffed.ext}`,
  });

  return { ok: true, messageId, attachmentId, whatsapp };
}

const UrlSchema = z.object({ messageId: z.string().uuid() });

export type AudioUrlResult =
  | { ok: true; url: string }
  | { ok: false; message: string; cause?: MediaDiagnostic };

export async function getAudioUrlAction(raw: unknown): Promise<AudioUrlResult> {
  const g = await guardSession();
  if (!g.ok) return { ok: false, message: g.message };
  const p = UrlSchema.safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const supabase = createClient()!;
  // Attachment bajo RLS de sesión: sólo miembros del hilo lo ven.
  const { data: att, error } = await supabase
    .from("connect_attachments")
    .select("id")
    .eq("message_id", p.data.messageId)
    .maybeSingle();
  if (error || !att) {
    // Dos condiciones distintas bajo un mismo string: el adjunto no existe, o
    // existe y la RLS de sesión no lo deja ver. PGRST116 agrega una tercera —
    // más de una fila para el mismo mensaje—, que es un defecto de datos.
    const outcome = classifyMediaFailure(error, "signed_url");
    return { ok: false, message: outcome.userMessage, cause: outcome.diagnostic };
  }
  // RPC existente (0144) = PORTÓN: re-valida membresía y AUDITA el acceso; devuelve
  // {bucket, path}. La firma con expiración la emite el servidor con service client.
  const { data: gate, error: rpcErr } = await supabase.rpc("connect_emit_attachment_signed_url", {
    p_attachment_id: (att as { id: string }).id,
  });
  if (rpcErr || !gate) {
    const outcome = classifyMediaFailure(rpcErr, "signed_url");
    return { ok: false, message: outcome.userMessage, cause: outcome.diagnostic };
  }
  const { bucket, path } = gate as { bucket?: string; path?: string };
  if (!bucket || !path) return { ok: false, message: "Respuesta del portón inválida." };
  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Storage no disponible." };
  const { data: signed, error: signErr } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, 300); // 5 min de vigencia
  if (signErr || !signed?.signedUrl) {
    const outcome = classifyMediaFailure(signErr, "signed_url");
    return { ok: false, message: outcome.userMessage, cause: outcome.diagnostic };
  }
  return { ok: true, url: signed.signedUrl };
}
