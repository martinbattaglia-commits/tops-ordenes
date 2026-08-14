"use server";

// Nexus Link · FASE B — server actions de adjuntos (imágenes, fotos, archivos).
//
// Calcado del patrón ya probado de `audio-actions.ts`, en tres pasos, para NO
// construir una segunda arquitectura:
//   1. prepareAttachmentUploadAction  → abre una SUBIDA PENDIENTE en la base
//      (0238), que valida sesión, capacidad de canal, MEMBRESÍA y hilo activo y
//      devuelve un path elegido por el SERVIDOR; con ese path se emite la
//      signed UPLOAD URL.
//   2. el cliente sube el binario directo a storage (URL firmada, un solo uso).
//   3. finalizeAttachmentAction → RECLAMA la subida con una transición atómica
//      `pending → finalized`, y sólo entonces descarga el objeto, valida FIRMA
//      BINARIA real + límites + nombre, calcula sha256, inserta el ADJUNTO y lo
//      liga al MENSAJE del lote, creándolo si es el primero.
//
// UN MENSAJE, VARIOS ADJUNTOS. `client_msg_id` identifica el MENSAJE LÓGICO, no
// el archivo: los hasta cinco adjuntos de un envío lo comparten. Cada archivo
// tiene su propia identidad de SUBIDA (el path que elige el servidor) y su
// propia identidad de ADJUNTO (su fila). Ver `obtenerOCrearMensaje`.
//
// La capacidad depende del CANAL de la conversación: `internal_chat.media` para
// los hilos nativos, `whatsapp.media` para WhatsApp. Membresía y capacidad son
// acumulativas y se verifican en el servidor, nunca en la UI.
//
// POR QUÉ LA TRANSICIÓN VIVE EN LA BASE Y NO ACÁ: entre "consulto si nadie lo
// tomó" y "lo tomo" hay una ventana en la que otra llamada —o el barrido de
// huérfanos— puede ganar. Esa carrera no se puede cerrar desde el proceso; se
// cierra con un UPDATE condicional, que es decisión y escritura en un solo
// acto. `connect_upload_claim_finalize()` devuelve `claimed` a quien gana,
// `already_finalized` a su gemelo —que sigue por el camino idempotente— y
// `denied` a todo lo demás, con un único mensaje que no revela nada.

import { createHash } from "node:crypto";
import { z } from "zod";
import { canAccess } from "@/lib/rbac/guard";
import { canChannel } from "@/lib/rbac/nexus-link";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { validateAttachment } from "../../attachments/validate";

const BUCKET = "connect-files";

/** ¿El error de Postgres es una violación de unicidad? (23505 o texto). */
function esConflictoDeUnicidad(message: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("duplicate") || m.includes("23505") || m.includes("unique");
}

/**
 * Borra el objeto SÓLO si ninguna fila de `connect_attachments` lo referencia.
 *
 * Es la regla que impide que un reintento se lleve puesto el adjunto de un envío
 * ya exitoso: si existe registro, el objeto le pertenece a alguien y no se toca.
 */
async function limpiarSiNoReferenciado(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  path: string,
): Promise<void> {
  const { data } = await admin
    .from("connect_attachments")
    .select("id")
    .eq("storage_bucket", BUCKET)
    .eq("storage_path", path)
    .maybeSingle();
  if (data) return; // referenciado ⇒ NO se borra
  await admin.storage.from(BUCKET).remove([path]);
}

/**
 * Etiqueta del mensaje cuando el operador no escribió pie de foto.
 *
 * Con un solo archivo el nombre es informativo; con varios no —el nombre del
 * primero mentiría sobre el resto—, así que se cuenta.
 */
function cuerpoDelMensaje(pie: string | null | undefined, fileName: string, n: number): string {
  const texto = (pie ?? "").trim();
  if (texto.length > 0) return texto;
  return n > 1 ? `📎 ${n} archivos` : `📎 ${fileName}`;
}

interface MensajeLogico {
  conversationId: string;
  userId: string;
  clientMsgId: string;
  participantId: string | null;
  body: string;
}

/**
 * UN mensaje por `client_msg_id`, tantos adjuntos como haga falta.
 *
 * ─── LAS TRES IDENTIDADES SON DISTINTAS ───────────────────────────────────
 *
 *   · el MENSAJE  se identifica por `client_msg_id` (uno por lote);
 *   · cada SUBIDA se identifica por su `storage_path` (uno por archivo, y lo
 *     elige el servidor);
 *   · cada ADJUNTO se identifica por su propia fila.
 *
 * Confundirlas es lo que rompe: si `client_msg_id` identificara también al
 * adjunto, el segundo archivo del lote parecería un replay del primero y se
 * descartaría; si identificara a la subida, reintentar un archivo publicaría un
 * mensaje nuevo. Acá cada una tiene su clave y su unicidad propia.
 *
 * Se lee ANTES de insertar porque con varios adjuntos el caso común es que el
 * mensaje ya exista: el primer archivo lo crea y los demás lo encuentran. El
 * `insert` queda para el primero, y el conflicto de unicidad —índice
 * `connect_messages_client_msg_uidx` sobre
 * (conversation_id, author_profile_id, client_msg_id)— resuelve el empate
 * cuando dos archivos del mismo lote llegan a la vez.
 *
 * CONSECUENCIA BUSCADA: el texto se publica UNA sola vez. No depende de que el
 * cliente mande el pie sólo con el primer archivo —eso perdería el texto si ese
 * archivo fallara—: lo manda siempre y acá se ignora salvo en la creación.
 */
async function obtenerOCrearMensaje(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  m: MensajeLogico,
): Promise<{ ok: true; id: string; creado: boolean } | { ok: false; message: string }> {
  const buscar = async () => {
    const { data } = await admin
      .from("connect_messages")
      .select("id")
      .eq("conversation_id", m.conversationId)
      .eq("author_profile_id", m.userId)
      .eq("client_msg_id", m.clientMsgId)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  };

  const yaEsta = await buscar();
  if (yaEsta) return { ok: true, id: yaEsta, creado: false };

  const { data, error } = await admin
    .from("connect_messages")
    .insert({
      conversation_id: m.conversationId,
      author_participant_id: m.participantId,
      author_profile_id: m.userId,
      kind: "file",
      body: m.body,
      body_format: "text",
      client_msg_id: m.clientMsgId,
    })
    .select("id")
    .single();
  if (data) return { ok: true, id: (data as { id: string }).id, creado: true };

  if (esConflictoDeUnicidad(error?.message)) {
    // Otro adjunto del MISMO lote lo creó entre la lectura y la escritura.
    const delGanador = await buscar();
    if (delGanador) return { ok: true, id: delGanador, creado: false };
  }
  return { ok: false, message: `mensaje: ${error?.message}` };
}

type Guard = { ok: true; userId: string } | { ok: false; message: string };

async function guardSession(): Promise<Guard> {
  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Modo demo: adjuntos deshabilitados." };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sesión no autenticada." };
  if (!(await canAccess("connect.view"))) return { ok: false, message: "Sin permiso (connect.view)." };
  return { ok: true, userId: user.id };
}

/**
 * Membresía + hilo activo + CAPACIDAD DEL CANAL, todo bajo RLS de sesión.
 *
 * El `kind` se lee de la conversación tal como la ve el usuario: con 0237, si no
 * tiene la capacidad de WhatsApp la conversación ni siquiera es visible, así que
 * el caso degenera al mismo mensaje neutro que "no sos miembro". No se revela
 * que exista ni de qué canal es.
 */
async function assertPuedeAdjuntar(conversationId: string): Promise<string | null> {
  const supabase = createClient();
  if (!supabase) return "Sin sesión.";
  const { data, error } = await supabase
    .from("connect_conversations")
    .select("id, kind, archived_at, connect_participants!inner(profile_id)")
    .eq("id", conversationId)
    .limit(1)
    .maybeSingle();
  if (error || !data) return "No sos miembro de esta conversación.";
  const conv = data as { kind: string; archived_at: string | null };
  if (conv.archived_at) return "La conversación está archivada: no se pueden adjuntar archivos.";

  const capacidad = conv.kind === "whatsapp"
    ? "nexus_link.whatsapp.media" as const
    : "nexus_link.internal_chat.media" as const;
  if (!(await canChannel(capacidad))) return "No tenés acceso a este canal.";
  return null;
}

const PrepareSchema = z.object({ conversationId: z.string().uuid() });

export type PrepareAttachmentResult =
  | { ok: true; path: string; token: string }
  | { ok: false; message: string };

export async function prepareAttachmentUploadAction(raw: unknown): Promise<PrepareAttachmentResult> {
  const g = await guardSession();
  if (!g.ok) return g;
  const p = PrepareSchema.safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const bloqueo = await assertPuedeAdjuntar(p.data.conversationId);
  if (bloqueo) return { ok: false, message: bloqueo };

  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Storage no disponible." };

  // La identidad de la subida la crea la BASE, bajo la sesión del usuario: el
  // dueño es `auth.uid()` y el path lo elige el servidor. El navegador no
  // controla ninguna de las dos cosas.
  const supabase = createClient()!;
  const { data: abierta, error: abrirErr } = await supabase.rpc("connect_upload_begin", {
    p_conversation_id: p.data.conversationId,
    p_bucket: BUCKET,
  });
  const fila = (abierta as Array<{ object_path: string }> | null)?.[0];
  if (abrirErr || !fila?.object_path) {
    return { ok: false, message: "No se pudo preparar la subida." };
  }

  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(fila.object_path);
  if (error || !data) return { ok: false, message: `No se pudo preparar la subida: ${error?.message}` };
  return { ok: true, path: data.path, token: data.token };
}

const FinalizeSchema = z.object({
  conversationId: z.string().uuid(),
  path: z.string().min(1).max(300),
  fileName: z.string().min(1).max(300).nullable().optional(),
  body: z.string().max(8000).nullable().optional(),
  /** Identidad del MENSAJE lógico. Compartida por todos los adjuntos del lote. */
  clientMsgId: z.string().uuid(),
  /**
   * Cuántos adjuntos trae el lote. Sólo se usa para redactar la etiqueta cuando
   * no hay pie de foto; si el cliente mintiera, el único efecto es un texto
   * impreciso. Nada de autorización ni de integridad depende de este número.
   */
  attachmentCount: z.number().int().min(1).max(10).optional(),
});

export type FinalizeAttachmentResult =
  | { ok: true; messageId: string; attachmentId: string; fileName: string }
  | { ok: false; message: string };

export async function finalizeAttachmentAction(raw: unknown): Promise<FinalizeAttachmentResult> {
  const g = await guardSession();
  if (!g.ok) return { ok: false, message: g.message };
  const p = FinalizeSchema.safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  // El path DEBE pertenecer a la conversación declarada (anti cruce de hilos).
  if (!p.data.path.startsWith(`${p.data.conversationId}/files/`)) {
    return { ok: false, message: "Path inválido." };
  }
  const bloqueo = await assertPuedeAdjuntar(p.data.conversationId);
  if (bloqueo) return { ok: false, message: bloqueo };

  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Storage no disponible." };

  // ─── LA TRANSICIÓN ────────────────────────────────────────────────────────
  // Antes de tocar el objeto hay que GANARLO. Un `denied` acá cubre por igual
  // la subida inexistente, la de otro usuario, la de otra conversación, la
  // vencida y la ya reclamada por el barrido — y en ninguno de esos casos se
  // borra nada, porque el objeto no es nuestro.
  const sesion = createClient()!;
  const { data: veredicto, error: claimErr } = await sesion.rpc("connect_upload_claim_finalize", {
    p_conversation_id: p.data.conversationId,
    p_bucket: BUCKET,
    p_path: p.data.path,
  });
  if (claimErr) return { ok: false, message: "No se pudo confirmar la subida." };
  if (veredicto !== "claimed" && veredicto !== "already_finalized") {
    return { ok: false, message: "La subida ya no está disponible." };
  }

  const { data: file, error: dlErr } = await admin.storage.from(BUCKET).download(p.data.path);
  if (dlErr || !file) return { ok: false, message: "El archivo no llegó a storage." };
  const bytes = new Uint8Array(await file.arrayBuffer());

  const v = validateAttachment(bytes, p.data.fileName ?? null);
  if (!v.ok) {
    // El objeto no pasó la validación y NADIE lo referencia: se borra. La fila
    // pendiente queda en 'finalized', que es lo correcto — ya no hay nada que
    // barrer, y el estado terminal impide que se reintente sobre ese path.
    await limpiarSiNoReferenciado(admin, p.data.path);
    return { ok: false, message: v.message };
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  // ─── IDEMPOTENCIA (1/2): el adjunto ───────────────────────────────────────
  // `connect_attachments` tiene UNIQUE (storage_bucket, storage_path). Dos
  // finalize concurrentes sobre el MISMO upload compiten acá: uno inserta y el
  // otro choca. El que choca NO debe limpiar nada — el objeto le pertenece al
  // que ganó—, así que se queda con la fila existente y sigue.
  let creadoEnEstaLlamada = false;
  const { data: att, error: attErr } = await admin
    .from("connect_attachments")
    .insert({
      conversation_id: p.data.conversationId,
      storage_bucket: BUCKET,
      storage_path: p.data.path,
      sha256,
      mime_type: v.sniffed.mime,
      file_size: bytes.length,
      file_name: v.fileName,
      uploaded_by: g.userId,
    })
    .select("id")
    .single();
  let attachmentId: string;
  if (att) {
    attachmentId = (att as { id: string }).id;
    creadoEnEstaLlamada = true;
  } else if (esConflictoDeUnicidad(attErr?.message)) {
    // Carrera: otro finalize ya registró este objeto. Se adopta su fila.
    const { data: existente } = await admin
      .from("connect_attachments")
      .select("id, message_id")
      .eq("storage_bucket", BUCKET)
      .eq("storage_path", p.data.path)
      .maybeSingle();
    if (!existente) return { ok: false, message: "No se pudo resolver el adjunto." };
    const yaLigado = existente as { id: string; message_id: string | null };
    // Si ya quedó ligado a un mensaje, la operación estaba COMPLETA: se devuelve
    // el mismo resultado en vez de repetir el trabajo o romper.
    if (yaLigado.message_id) {
      return { ok: true, messageId: yaLigado.message_id, attachmentId: yaLigado.id, fileName: v.fileName };
    }
    attachmentId = yaLigado.id;
  } else {
    // Fallo real y el objeto no quedó referenciado por nadie: se limpia.
    await limpiarSiNoReferenciado(admin, p.data.path);
    return { ok: false, message: `attachment: ${attErr?.message}` };
  }

  const supabase = createClient()!;
  const { data: participant } = await supabase
    .from("connect_participants")
    .select("id")
    .eq("conversation_id", p.data.conversationId)
    .eq("profile_id", g.userId)
    .maybeSingle();

  // ─── IDEMPOTENCIA (2/2): el MENSAJE, que es del LOTE y no de este archivo ──
  // Un `client_msg_id` repetido ya no significa "este archivo se envió dos
  // veces": significa "este archivo pertenece a un mensaje que quizá ya existe".
  // Por eso se adopta en vez de rechazarse — y por eso reintentar un adjunto no
  // publica un mensaje nuevo, mientras que un segundo adjunto legítimo del mismo
  // lote se suma al mismo mensaje en vez de parecer un replay.
  const mensaje = await obtenerOCrearMensaje(admin, {
    conversationId: p.data.conversationId,
    userId: g.userId,
    clientMsgId: p.data.clientMsgId,
    participantId: (participant as { id: string } | null)?.id ?? null,
    body: cuerpoDelMensaje(p.data.body, v.fileName, p.data.attachmentCount ?? 1),
  });
  if (!mensaje.ok) {
    // Fallo real. Sólo se revierte lo que ESTA llamada creó, y sólo si nadie
    // más quedó referenciando el objeto.
    if (creadoEnEstaLlamada) {
      await admin.from("connect_attachments").delete().eq("id", attachmentId);
      await limpiarSiNoReferenciado(admin, p.data.path);
    }
    return { ok: false, message: mensaje.message };
  }
  const messageId = mensaje.id;

  // Ligadura idempotente: sólo se escribe si todavía no está ligado, para no
  // pisar el `message_id` que puso la llamada ganadora.
  await admin
    .from("connect_attachments")
    .update({ message_id: messageId })
    .eq("id", attachmentId)
    .is("message_id", null);

  return { ok: true, messageId, attachmentId, fileName: v.fileName };
}

const UrlSchema = z.object({ attachmentId: z.string().uuid() });

export type AttachmentUrlResult = { ok: true; url: string } | { ok: false; message: string };

/**
 * URL firmada de vigencia corta para VER o DESCARGAR.
 *
 * No se resuelve nada acá: el portón es el RPC de 0144 endurecido por 0237, que
 * revalida membresía Y capacidad de canal y audita el acceso. Conocer el UUID no
 * alcanza.
 */
export async function getAttachmentUrlAction(raw: unknown): Promise<AttachmentUrlResult> {
  const g = await guardSession();
  if (!g.ok) return { ok: false, message: g.message };
  const p = UrlSchema.safeParse(raw);
  if (!p.success) return { ok: false, message: "Datos inválidos." };
  const supabase = createClient()!;
  const { data: gate, error } = await supabase.rpc("connect_emit_attachment_signed_url", {
    p_attachment_id: p.data.attachmentId,
  });
  if (error || !gate) return { ok: false, message: "Adjunto no disponible o sin acceso." };
  const { bucket, path } = gate as { bucket?: string; path?: string };
  if (!bucket || !path) return { ok: false, message: "Respuesta del portón inválida." };
  const admin = createAdminClient();
  if (!admin) return { ok: false, message: "Storage no disponible." };
  const { data: signed, error: signErr } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, 300); // 5 min
  if (signErr || !signed?.signedUrl) {
    return { ok: false, message: signErr?.message ?? "No se pudo firmar la URL." };
  }
  return { ok: true, url: signed.signedUrl };
}
