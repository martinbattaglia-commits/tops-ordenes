"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";
import { useRealtimeTable } from "@/lib/supabase/realtime";
import type { Message } from "@/lib/connect/types";
import { messageDisplayBody } from "@/lib/connect/domain/message";
import { timeHM } from "@/lib/connect/format";
import { postMessageAction } from "@/lib/connect/adapters/driving/message-actions";
import { markReadAction } from "@/lib/connect/adapters/driving/read-actions";

interface UiMessage extends Message {
  status?: "sending" | "failed";
  clientMsgId?: string;
}

export function ThreadView({
  conversationId,
  initialMessages,
  currentUserId,
}: {
  conversationId: string;
  initialMessages: Message[];
  currentUserId: string | null;
}) {
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const sentSeqRef = useRef(0);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
  }, []);

  // Reset SOLO al cambiar de conversación (NO en cada revalidate del padre con la misma conversación):
  // así no se pierden mensajes optimistas/fallidos/realtime en-flight cuando el server re-renderiza.
  useEffect(() => {
    setMessages(initialMessages);
    sentSeqRef.current = 0;
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

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
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
    setSending(true);
    const res = await postMessageAction({ conversationId, body, clientMsgId });
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
                <div className="whitespace-pre-wrap break-words">{messageDisplayBody(m)}</div>
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

      <div className="border-t border-stroke-soft bg-bg-surface px-3 py-2.5">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            aria-label="Escribir mensaje"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Escribí un mensaje…  (Enter envía · Shift+Enter salto de línea)"
            rows={1}
            className="max-h-32 min-h-[2.25rem] flex-1 resize-none rounded-md border border-stroke-soft bg-bg-page px-3 py-2 text-[13px] text-fg-primary outline-none focus:border-tops-red"
          />
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
    </>
  );
}
