// Nexus Link · dominio puro de mensajería (RC1.1). Sin I/O, sin Supabase: lógica testeable.
// Las reglas de escritura críticas viven en las RPC SECDEF (RC1.0); acá va lo que es genuinamente
// de dominio y se reutiliza en UI + use-cases (validación de posteo, menciones, presentación).

import type { Message } from "../types";

export const MAX_MESSAGE_LENGTH = 8000;

/** ¿El mensaje es posteable? Cuerpo no vacío (tras trim) o trae adjuntos. */
export function canPost(body: string | null | undefined, attachmentCount = 0): boolean {
  const hasBody = typeof body === "string" && body.trim().length > 0;
  return (hasBody && body!.trim().length <= MAX_MESSAGE_LENGTH) || attachmentCount > 0;
}

/** Normaliza el cuerpo para persistir (trim; null si queda vacío). */
export function normalizeBody(body: string | null | undefined): string | null {
  if (typeof body !== "string") return null;
  const t = body.trim();
  return t.length === 0 ? null : t;
}

/**
 * Extrae @menciones de un cuerpo markdown. Devuelve los handles ÚNICOS (sin el '@'),
 * preservando el orden de aparición. Handle = [A-Za-z0-9._-]+.
 */
export function parseMentions(body: string | null | undefined): string[] {
  if (typeof body !== "string" || body.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /(^|[^A-Za-z0-9_])@([A-Za-z0-9._-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const handle = m[2];
    if (!seen.has(handle.toLowerCase())) {
      seen.add(handle.toLowerCase());
      out.push(handle);
    }
  }
  return out;
}

/** Texto a mostrar (respeta soft-delete/redacción — append-only real). */
export function messageDisplayBody(m: Pick<Message, "deletedAt" | "redacted" | "body">): string {
  if (m.deletedAt || m.redacted) return "Mensaje eliminado";
  return m.body ?? "";
}

/** No-leídos = último seq de la conversación − último seq leído por el participante (≥ 0). */
export function unreadCount(lastMessageSeq: number | null, lastReadSeq: number): number {
  return Math.max((lastMessageSeq ?? 0) - (lastReadSeq ?? 0), 0);
}

/** ¿El mensaje es del usuario dado? (para alinear el hilo). */
export function isOwnMessage(m: Pick<Message, "authorProfileId">, userId: string | null): boolean {
  return !!userId && m.authorProfileId === userId;
}
