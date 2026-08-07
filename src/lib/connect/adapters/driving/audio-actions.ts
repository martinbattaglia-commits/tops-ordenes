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
import { canAccess } from "@/lib/rbac/guard";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { validateAudio, AUDIO_LIMITS } from "../../audio/validate";

const BUCKET = "connect-files";

type SessionGuard =
  | { ok: true; userId: string }
  | { ok: false; message: string };

async function guardSession(): Promise<SessionGuard> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Modo demo: audio deshabilitado." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sesión no autenticada." };
  if (!(await canAccess("connect.view"))) return { ok: false, message: "Sin permiso (connect.view)." };
  return { ok: true, userId: user.id };
}

/** Membresía + hilo activo, verificados BAJO RLS DE SESIÓN (fail-closed). */
async function assertMemberActive(conversationId: string): Promise<string | null> {
  const supabase = createClient();
  if (!supabase) return "Sin sesión.";
  const { data, error } = await supabase
    .from("connect_conversations")
    .select("id, archived_at, connect_participants!inner(profile_id)")
    .eq("id", conversationId)
    .limit(1)
    .maybeSingle();
  if (error || !data) return "No sos miembro de esta conversación.";
  if ((data as { archived_at: string | null }).archived_at) {
    return "La conversación está archivada: no se pueden enviar audios.";
  }
  return null;
}

const PrepareSchema = z.object({ conversationId: z.string().uuid() });

export type PrepareUploadResult =
  | { ok: true; path: string; token: string }
  | { ok: false; message: string };

export async function prepareAudioUploadAction(raw: unknown): Promise<PrepareUploadResult> {
  const g = await guardSession();
  if (!g.ok) return g;
  const p = PrepareSchema.safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const membership = await assertMemberActive(p.data.conversationId);
  if (membership) return { ok: false, message: membership };

  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Storage no disponible." };
  // Path elegido por el SERVIDOR (el cliente jamás lo controla).
  const path = `${p.data.conversationId}/audio/${randomUUID()}`;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, message: `No se pudo preparar la subida: ${error?.message}` };
  return { ok: true, path: data.path, token: data.token };
}

const FinalizeSchema = z.object({
  conversationId: z.string().uuid(),
  path: z.string().min(1).max(300),
  durationMs: z.number().int().positive().max(AUDIO_LIMITS.maxDurationMs),
  clientMsgId: z.string().uuid(),
});

export type FinalizeResult =
  | { ok: true; messageId: string; attachmentId: string }
  | { ok: false; message: string };

export async function finalizeAudioMessageAction(raw: unknown): Promise<FinalizeResult> {
  const g = await guardSession();
  if (!g.ok) return { ok: false, message: g.message };
  const p = FinalizeSchema.safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  // El path DEBE pertenecer a la conversación declarada (anti cruce de hilos).
  if (!p.data.path.startsWith(`${p.data.conversationId}/audio/`)) {
    return { ok: false, message: "Path inválido." };
  }
  const membership = await assertMemberActive(p.data.conversationId);
  if (membership) return { ok: false, message: membership };

  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Storage no disponible." };

  const { data: file, error: dlErr } = await admin.storage.from(BUCKET).download(p.data.path);
  if (dlErr || !file) return { ok: false, message: "El audio no llegó a storage." };
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

  return { ok: true, messageId, attachmentId };
}

const UrlSchema = z.object({ messageId: z.string().uuid() });

export type AudioUrlResult =
  | { ok: true; url: string }
  | { ok: false; message: string };

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
  if (error || !att) return { ok: false, message: "Audio no disponible o sin acceso." };
  // RPC existente (0144) = PORTÓN: re-valida membresía y AUDITA el acceso; devuelve
  // {bucket, path}. La firma con expiración la emite el servidor con service client.
  const { data: gate, error: rpcErr } = await supabase.rpc("connect_emit_attachment_signed_url", {
    p_attachment_id: (att as { id: string }).id,
  });
  if (rpcErr || !gate) return { ok: false, message: rpcErr?.message ?? "Acceso denegado." };
  const { bucket, path } = gate as { bucket?: string; path?: string };
  if (!bucket || !path) return { ok: false, message: "Respuesta del portón inválida." };
  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Storage no disponible." };
  const { data: signed, error: signErr } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, 300); // 5 min de vigencia
  if (signErr || !signed?.signedUrl) {
    return { ok: false, message: signErr?.message ?? "No se pudo firmar la URL." };
  }
  return { ok: true, url: signed.signedUrl };
}
