import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { parseWaExport, type WaParseResult } from "./parser";

/**
 * Nexus Link · LINK-WA-002 F1a — Ingesta del export a Connect (service_role).
 *
 * Garantías:
 *  · Idempotente: external_msg_id = sha256(context|ts|autor|texto|ocurrencia) con
 *    upsert ignoreDuplicates ⇒ re-importar el mismo export (o uno ampliado) NO duplica.
 *  · D1: la conversación nace ARCHIVADA (memoria, no acción).
 *  · D2: los únicos participantes con perfil son los admins importadores ⇒ RLS de
 *    membresía limita la visibilidad por construcción.
 *  · El export bruto NO se persiste: entra como texto, salen mensajes normalizados.
 *  · Reversible por chat: delete de la conversación (cascade) — se devuelve el id.
 */

export interface WaIngestInput {
  raw: string;
  counterpartAuthor: string; // autor del export que ES la contraparte
  counterpartPhone: string;  // E164: +549…
  displayName: string;       // nombre visible del hilo / identidad
  entityType?: "cliente" | "proveedor" | "contacto" | "interno" | null;
  entityId?: string | null;
  importerProfileId: string; // admin que confirma (participante staff/owner)
}

export interface WaIngestResult {
  ok: boolean;
  message?: string;
  conversationId?: string;
  contextId?: string;
  inserted?: number;
  duplicates?: number;
  parse?: Pick<WaParseResult, "skippedSystem" | "skippedMedia" | "unparsedLines">;
}

const BATCH = 400;
/** Tamaño de página al leer los external_msg_id ya ingestados (respuesta, no URI). */
const PAGE = 1000;

/**
 * Número del canal comercial histórico de TOPS (+54 9 11 2531-6740). NUNCA puede ser
 * la contraparte: si se usara como identidad del hilo, TODOS los chats importados
 * colisionarían en una sola conversación (context_id compartido).
 */
const TOPS_CHANNEL_E164 = "+5491125316740";

export function normalizePhoneE164(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  if (!/^\+\d{8,15}$/.test(digits)) return null;
  return digits;
}

function externalMsgId(contextId: string, ts: string, author: string, text: string, occ: number): string {
  return createHash("sha256")
    .update(`${contextId}|${ts}|${author}|${text}|${occ}`)
    .digest("hex");
}

export async function ingestWaExport(input: WaIngestInput): Promise<WaIngestResult> {
  const supabase = createAdminClient();
  if (!supabase) return { ok: false, message: "Sin service client (entorno sin Supabase)." };

  const phone = normalizePhoneE164(input.counterpartPhone);
  if (!phone) return { ok: false, message: "Teléfono inválido: usar formato +549… (E164)." };
  if (phone === TOPS_CHANNEL_E164) {
    return {
      ok: false,
      message:
        "Ese es el número del canal de TOPS, no de la contraparte. Poné el teléfono del cliente/proveedor: identifica el hilo.",
    };
  }
  const displayName = input.displayName.trim();
  if (!displayName) return { ok: false, message: "Falta el nombre visible." };

  const parsed = parseWaExport(input.raw);
  if (parsed.messages.length === 0) {
    return { ok: false, message: "El export no contiene mensajes reconocibles." };
  }
  if (!parsed.authors.some((a) => a.name === input.counterpartAuthor)) {
    return { ok: false, message: "El autor contraparte elegido no aparece en el export." };
  }

  const contextId = `wa:${phone}`;

  // (1) Identidad — upsert confirmado por el importador.
  const { error: idErr } = await supabase.from("wa_identities").upsert(
    {
      phone_e164: phone,
      display_name: displayName,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      confirmed_by: input.importerProfileId,
      confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "phone_e164" },
  );
  if (idErr) return { ok: false, message: `wa_identities: ${idErr.message}` };

  // (2) Conversación — get-or-create por context_id (misma contraparte ⇒ mismo hilo).
  const { data: existing } = await supabase
    .from("connect_conversations")
    .select("id")
    .eq("context_id", contextId)
    .maybeSingle();
  let conversationId = (existing as { id: string } | null)?.id ?? null;
  if (!conversationId) {
    const { data: conv, error: convErr } = await supabase
      .from("connect_conversations")
      .insert({
        context_id: contextId,
        kind: "whatsapp",
        title: displayName,
        topic: "WhatsApp Comercial Histórico",
        created_by: input.importerProfileId,
        archived_at: new Date().toISOString(), // D1: nace en Archivo
      })
      .select("id")
      .single();
    if (convErr || !conv) return { ok: false, message: `conversación: ${convErr?.message}` };
    conversationId = (conv as { id: string }).id;
  }

  // (3) Participantes — importador (staff/owner) + un participante 'whatsapp' por autor.
  const { data: partRows, error: partErr } = await supabase
    .from("connect_participants")
    .select("id, profile_id, external_ref")
    .eq("conversation_id", conversationId);
  if (partErr) return { ok: false, message: `participantes: ${partErr.message}` };
  const parts = (partRows ?? []) as Array<{
    id: string; profile_id: string | null; external_ref: { author?: string } | null;
  }>;

  if (!parts.some((p) => p.profile_id === input.importerProfileId)) {
    const { error } = await supabase.from("connect_participants").insert({
      conversation_id: conversationId,
      participant_type: "staff",
      profile_id: input.importerProfileId,
      member_role: "owner",
    });
    if (error) return { ok: false, message: `participante staff: ${error.message}` };
  }

  const partIdByAuthor = new Map<string, string>();
  for (const p of parts) {
    if (p.external_ref?.author) partIdByAuthor.set(p.external_ref.author, p.id);
  }
  for (const a of parsed.authors) {
    if (partIdByAuthor.has(a.name)) continue;
    const isCounterpart = a.name === input.counterpartAuthor;
    const { data: np, error } = await supabase
      .from("connect_participants")
      .insert({
        conversation_id: conversationId,
        participant_type: "whatsapp",
        profile_id: null,
        member_role: "guest",
        external_ref: {
          author: a.name,
          side: isCounterpart ? "counterpart" : "tops",
          display_name: isCounterpart ? displayName : a.name,
          ...(isCounterpart ? { phone } : {}),
        },
      })
      .select("id")
      .single();
    if (error || !np) return { ok: false, message: `participante wa: ${error?.message}` };
    partIdByAuthor.set(a.name, (np as { id: string }).id);
  }

  // (4) Mensajes — claim idempotente por external_msg_id, en lotes, orden cronológico.
  const occ = new Map<string, number>();
  const rows = parsed.messages.map((m) => {
    const base = `${m.ts}|${m.author}|${m.text}`;
    const n = (occ.get(base) ?? 0) + 1;
    occ.set(base, n);
    return {
      conversation_id: conversationId,
      author_participant_id: partIdByAuthor.get(m.author) ?? null,
      author_profile_id: null,
      kind: "whatsapp",
      body: m.text,
      body_format: "text",
      external_msg_id: externalMsgId(contextId, m.ts, m.author, m.text, n),
      created_at: m.ts,
    };
  });

  // Idempotencia: el índice único de external_msg_id es PARCIAL (0143: WHERE ... IS NOT NULL),
  // y PostgREST no puede usarlo para ON CONFLICT. Se filtra contra lo ya presente y se insertan
  // sólo los nuevos; el índice sigue siendo la red de seguridad ante una carrera (23505).
  // Se listan los IDs YA presentes en la conversación paginando la RESPUESTA. No se envían
  // los hashes en la petición: un `.in()` con cientos de sha256 (64 chars c/u) desborda el
  // largo del URI y PostgREST responde 400 (falló con un export de 591 mensajes).
  const alreadyIngested = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("connect_messages")
      .select("external_msg_id")
      .eq("conversation_id", conversationId)
      .not("external_msg_id", "is", null)
      .range(from, from + PAGE - 1);
    if (error) return { ok: false, message: `verificación de duplicados: ${error.message}` };
    const page = (data ?? []) as Array<{ external_msg_id: string | null }>;
    for (const r of page) if (r.external_msg_id) alreadyIngested.add(r.external_msg_id);
    if (page.length < PAGE) break;
  }
  const pending = rows.filter((r) => !alreadyIngested.has(r.external_msg_id));

  let inserted = 0;
  for (let i = 0; i < pending.length; i += BATCH) {
    const chunk = pending.slice(i, i + BATCH);
    const { data, error } = await supabase.from("connect_messages").insert(chunk).select("id");
    if (error) {
      if (error.message.includes("duplicate") || error.message.includes("23505")) {
        return { ok: false, message: "Importación concurrente detectada. Reintentá en unos segundos." };
      }
      return { ok: false, message: `mensajes (lote ${i / BATCH + 1}): ${error.message}` };
    }
    inserted += (data ?? []).length;
  }

  return {
    ok: true,
    conversationId,
    contextId,
    inserted,
    duplicates: rows.length - inserted,
    parse: {
      skippedSystem: parsed.skippedSystem,
      skippedMedia: parsed.skippedMedia,
      unparsedLines: parsed.unparsedLines,
    },
  };
}
