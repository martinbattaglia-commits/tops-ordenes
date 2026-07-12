"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { VoiceField } from "@/components/voice/VoiceField";
import { cn } from "@/lib/utils";
import { useRealtimeTable } from "@/lib/supabase/realtime";
import type { Message } from "@/lib/connect/types";
import {
  messageDisplayBody, resolveMentions, type MentionPick,
} from "@/lib/connect/domain/message";
import { timeHM } from "@/lib/connect/format";
import { postMessageAction } from "@/lib/connect/adapters/driving/message-actions";
import { markReadAction } from "@/lib/connect/adapters/driving/read-actions";

interface UiMessage extends Message {
  status?: "sending" | "failed";
  clientMsgId?: string;
}

/** Resalta las @menciones de miembros conocidos dentro del cuerpo (F4.1B). */
function renderWithMentions(body: string, names: string[]): ReactNode {
  if (!body || names.length === 0) return body;
  const valid = names.filter((n) => n && n.trim().length > 0);
  if (valid.length === 0) return body;
  const parts: ReactNode[] = [];
  let rest = body;
  let key = 0;
  while (rest.length > 0) {
    let best: { idx: number; name: string } | null = null;
    for (const name of valid) {
      const idx = rest.indexOf(`@${name}`);
      if (idx < 0) continue;
      // Frontera de palabra: "@Anabela" no resalta "@Ana" (revisión adversarial).
      const after = rest.charAt(idx + name.length + 1);
      if (after && /[\p{L}\p{N}_]/u.test(after)) continue;
      // Desempate en mismo idx: gana el nombre MÁS LARGO ("Ana María" sobre "Ana").
      if (best === null || idx < best.idx || (idx === best.idx && name.length > best.name.length)) {
        best = { idx, name };
      }
    }
    if (!best) {
      parts.push(rest);
      break;
    }
    if (best.idx > 0) parts.push(rest.slice(0, best.idx));
    parts.push(
      <span key={`m-${key++}`} className="rounded bg-tops-red/10 px-0.5 font-semibold text-tops-red">
        @{best.name}
      </span>,
    );
    rest = rest.slice(best.idx + best.name.length + 1);
  }
  return parts;
}

export function ThreadView({
  conversationId,
  initialMessages,
  currentUserId,
  readOnly = false,
  mentionables = [],
}: {
  conversationId: string;
  initialMessages: Message[];
  currentUserId: string | null;
  /** DEFECT-6 (piloto F3): canal archivado → composer deshabilitado (solo lectura). */
  readOnly?: boolean;
  /** F4.1B: miembros mencionables (@) — la FK de menciones exige miembros (D-F41-8). */
  mentionables?: MentionPick[];
}) {
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [picks, setPicks] = useState<MentionPick[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sentSeqRef = useRef(0);

  const mentionNames = useMemo(
    () => mentionables.map((m) => m.name).filter((n): n is string => !!n),
    [mentionables],
  );
  const candidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return mentionables
      .filter((m) => m.profileId && m.name && m.profileId !== currentUserId)
      .filter((m) => q.length === 0 || m.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mentionQuery, mentionables, currentUserId]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
  }, []);

  // Reset SOLO al cambiar de conversación (NO en cada revalidate del padre con la misma conversación):
  // así no se pierden mensajes optimistas/fallidos/realtime en-flight cuando el server re-renderiza.
  useEffect(() => {
    setMessages(initialMessages);
    sentSeqRef.current = 0;
    setPicks([]);
    setMentionQuery(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => scrollToEnd(), [messages.length, scrollToEnd]);

  // markRead: SOLO cuando el último seq REAL avanza (dedup por ref → sin RPC redundante en cada
  // append/re-render). Idempotente en DB (greatest); no-op en demo (createClient null).
  useEffect(() => {
    const lastSeq = messages.reduce((mx, m) => Math.max(mx, m.seq < Number.MAX_SAFE_INTEGER ? m.seq : 0), 0);
    if (lastSeq > sentSeqRef.current) {
      sentSeqRef.current = lastSeq;
      void markReadAction({ conversationId, upToSeq: lastSeq });
    }
  }, [conversationId, messages]);

  // Realtime: append de mensajes nuevos (no-op en demo: createClient()→null).
  useRealtimeTable(
    "connect_messages",
    (payload) => {
      if (payload.eventType !== "INSERT" || !payload.new) return;
      const row = payload.new as Record<string, unknown>;
      const incoming: UiMessage = {
        id: row.id as string,
        conversationId: row.conversation_id as string,
        seq: Number(row.seq),
        authorParticipantId: (row.author_participant_id as string) ?? null,
        authorProfileId: (row.author_profile_id as string) ?? null,
        kind: (row.kind as Message["kind"]) ?? "text",
        body: (row.body as string) ?? null,
        bodyFormat: (row.body_format as string) ?? "markdown",
        replyToMessageId: (row.reply_to_message_id as string) ?? null,
        editedAt: null,
        deletedAt: null,
        redacted: false,
        createdAt: (row.created_at as string) ?? new Date().toISOString(),
        clientMsgId: (row.client_msg_id as string) ?? undefined,
      };
      setMessages((prev) => {
        // Ya tenemos el mensaje real (por id) o su seq real ya reconciliado → no-op (idempotente).
        if (prev.some((m) => m.id === incoming.id || (m.seq === incoming.seq && m.status === undefined))) return prev;
        // DEFECT-5: si el eco realtime corresponde a un mensaje optimista PROPIO (mismo client_msg_id),
        // reconciliarlo EN SU LUGAR en vez de agregar una 2ª burbuja. Idempotente con el ACK de send():
        // corra el que corra primero, converge a UN solo mensaje (por client_msg_id / id).
        if (incoming.clientMsgId && prev.some((m) => m.clientMsgId === incoming.clientMsgId)) {
          return prev.map((m) =>
            m.clientMsgId === incoming.clientMsgId
              ? { ...m, id: incoming.id, seq: incoming.seq, status: undefined }
              : m,
          );
        }
        // Mensaje de otro usuario/origen → append.
        return [...prev, incoming];
      });
    },
    { filter: `conversation_id=eq.${conversationId}` },
  );

  /** Detecta si el caret está dentro de un token @… en curso (dispara el autocomplete). */
  function updateMentionQuery(value: string, caret: number) {
    if (mentionables.length === 0) {
      setMentionQuery(null);
      return;
    }
    const upToCaret = value.slice(0, caret);
    const m = /(^|\s)@([^\s@]*)$/.exec(upToCaret);
    setMentionQuery(m ? m[2] : null);
  }

  /** Inserta la mención elegida reemplazando el @token en curso. false = no había token en el caret. */
  function pickMention(pick: MentionPick): boolean {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? draft.length;
    const upToCaret = draft.slice(0, caret);
    const m = /(^|\s)@([^\s@]*)$/.exec(upToCaret);
    if (!m) {
      setMentionQuery(null);
      return false;
    }
    const start = caret - m[2].length - 1; // posición del '@'
    const next = `${draft.slice(0, start)}@${pick.name} ${draft.slice(caret)}`;
    setDraft(next);
    setPicks((prev) => (prev.some((p) => p.profileId === pick.profileId) ? prev : [...prev, pick]));
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + pick.name.length + 2;
      el?.setSelectionRange(pos, pos);
    });
    return true;
  }

  async function send() {
    const body = draft.trim();
    if (!body || sending || readOnly) return;
    // F4.1B: menciones efectivas = picks ∩ cuerpo final (dominio puro; dedupe/tope/sin autor).
    const mentions = resolveMentions(body, picks, currentUserId);
    const clientMsgId = crypto.randomUUID();
    const optimistic: UiMessage = {
      id: `tmp-${clientMsgId}`,
      conversationId,
      seq: Number.MAX_SAFE_INTEGER,
      authorParticipantId: null,
      authorProfileId: currentUserId,
      authorName: null,
      kind: "text",
      body,
      bodyFormat: "markdown",
      replyToMessageId: null,
      editedAt: null,
      deletedAt: null,
      redacted: false,
      createdAt: new Date().toISOString(),
      status: "sending",
      clientMsgId,
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    setPicks([]);
    setMentionQuery(null);
    setSending(true);
    const res = await postMessageAction({ conversationId, body, clientMsgId, mentions });
    setSending(false);
    setMessages((prev) =>
      prev.map((m) =>
        m.clientMsgId === clientMsgId
          ? res.ok
            ? { ...m, id: res.messageId, seq: res.seq, status: undefined }
            : { ...m, status: "failed" }
          : m,
      ),
    );
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="m-auto text-xs text-fg-muted">Todavía no hay mensajes. Escribí el primero.</p>
        )}
        {messages.map((m) => {
          const own = !!currentUserId && m.authorProfileId === currentUserId;
          return (
            <div key={m.id} className={cn("flex", own ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[72%] rounded-lg px-3 py-2 text-[13px]",
                  own
                    ? "bg-tops-red/10 text-fg-primary"
                    : "border border-stroke-soft bg-bg-surface text-fg-primary",
                )}
              >
                {!own && m.authorName && (
                  <div className="mb-0.5 text-[11px] font-semibold text-fg-secondary">{m.authorName}</div>
                )}
                <div className="whitespace-pre-wrap break-words">
                  {renderWithMentions(messageDisplayBody(m), mentionNames)}
                </div>
                <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-fg-muted">
                  {m.status === "sending" && <span>enviando…</span>}
                  {m.status === "failed" && <span className="text-tops-red">no se pudo enviar</span>}
                  {m.status === undefined && <span>{timeHM(m.createdAt)}</span>}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {readOnly ? (
        <div className="flex items-center justify-center gap-1.5 border-t border-stroke-soft bg-bg-surface-alt/50 px-4 py-3 text-center text-[12px] text-fg-muted">
          <Icon name="folder" size={13} className="text-fg-muted" />
          Esta conversación está archivada. Es de solo lectura: no se pueden enviar mensajes.
        </div>
      ) : (
        <div className="relative border-t border-stroke-soft bg-bg-surface px-3 py-2.5">
          {mentionQuery !== null && candidates.length > 0 && (
            <div
              role="listbox"
              aria-label="Mencionar miembro"
              className="absolute bottom-full left-3 z-20 mb-1 w-64 overflow-hidden rounded border border-stroke-soft bg-bg-surface shadow-lg"
            >
              {candidates.map((c) => (
                <button
                  key={c.profileId}
                  type="button"
                  role="option"
                  aria-selected="false"
                  onClick={() => pickMention(c)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-bg-surface-alt"
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-bg-surface-alt text-[9px] font-bold text-fg-secondary">
                    {c.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="truncate text-[12px] text-fg-primary">{c.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <VoiceField>
              <textarea
                ref={textareaRef}
                value={draft}
                aria-label="Escribir mensaje"
                onChange={(e) => {
                  setDraft(e.target.value);
                  updateMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length);
                }}
                // Recalcula el token @ también cuando el caret se mueve sin tipear
                // (flechas/click) — revisión adversarial: evita dropdown/Enter stale.
                onSelect={(e) => {
                  const t = e.currentTarget;
                  updateMentionQuery(t.value, t.selectionStart ?? t.value.length);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && mentionQuery !== null) {
                    e.preventDefault();
                    setMentionQuery(null);
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (mentionQuery !== null && candidates.length > 0) {
                      // Si el caret ya no está sobre un token @, cae a enviar (sin Enter fantasma).
                      if (pickMention(candidates[0])) return;
                    }
                    void send();
                  }
                }}
                placeholder={
                  mentionables.length > 0
                    ? "Escribí un mensaje…  (@ menciona · Enter envía · Shift+Enter salto)"
                    : "Escribí un mensaje…  (Enter envía · Shift+Enter salto de línea)"
                }
                rows={1}
                className="max-h-32 min-h-[2.25rem] flex-1 resize-none rounded-md border border-stroke-soft bg-bg-page px-3 py-2 text-[13px] text-fg-primary outline-none focus:border-tops-red"
              />
            </VoiceField>
            <button
              type="button"
              onClick={() => void send()}
              disabled={!draft.trim() || sending}
              className="btn btn-primary btn-sm shrink-0"
              aria-label="Enviar mensaje"
            >
              <Icon name="send" size={15} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
