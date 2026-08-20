"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { VoiceField } from "@/components/voice/VoiceField";
import { cn } from "@/lib/utils";
import { useRealtimeTable } from "@/lib/supabase/realtime";
import type { Message } from "@/lib/connect/types";
import {
  messageDisplayBody, resolveMentions, type MentionPick,
} from "@/lib/connect/domain/message";
import { timeHM, isNewDay, dayLabel } from "@/lib/connect/format";
import { postMessageAction } from "@/lib/connect/adapters/driving/message-actions";
import { sendWhatsappTextAction } from "@/lib/whatsapp/reply-action";
import { dispatchComposerSend } from "@/lib/connect/composer-dispatch";
import {
  audioRecorderOptionsFor, composerBlockNotice, composerCapabilities, ownBubbleClass, sendButtonClass,
} from "@/lib/connect/composer-policy";
import {
  reduceMessageState,
  projectWaMessage,
  projectionFromActionOutcome,
  initialMessageState,
  hydrateMessageState,
  isAuditedConfirmation,
  clearsSendError,
  type BubbleStatus,
} from "@/lib/connect/realtime-status";
import type { ConversationKind, WaProjection } from "@/lib/connect/types";
import { applyRealtimeEvent, type RealtimeEvent } from "@/lib/connect/realtime-merge";
import { markReadAction } from "@/lib/connect/adapters/driving/read-actions";
import { createClient } from "@/lib/supabase/client";
import { useAudioRecorder } from "@/lib/connect/audio/recorder";
import {
  prepareAudioUploadAction, finalizeAudioMessageAction,
} from "@/lib/connect/adapters/driving/audio-actions";
import { useWa24hWindow } from "@/hooks/useWa24hWindow";
import { Wa24hWindowIndicator } from "@/components/nexus-link/Wa24hWindowIndicator";
import { WaTemplateSelector } from "@/components/nexus-link/WaTemplateSelector";
import { setHandoverStateAction } from "@/lib/whatsapp/handover-action";
import { AudioPlayer } from "./AudioPlayer";
import { AttachmentComposer } from "./AttachmentComposer";
import { MessageAttachments } from "./MessageAttachments";

function MicIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}

interface UiMessage extends Message {
  status?: BubbleStatus;
  wa?: WaProjection;
  sendError?: string;
  clientMsgId?: string;
}

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
      const after = rest.charAt(idx + name.length + 1);
      if (after && /[\p{L}\p{N}_]/u.test(after)) continue;
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
  kind,
  initialMessages,
  currentUserId,
  readOnly = false,
  mentionables = [],
  initialNowIso,
  handoverState: initialHandoverState = "BOT_ACTIVE",
  lastCustomerMessageAt,
}: {
  conversationId: string;
  kind: ConversationKind;
  initialMessages: Message[];
  currentUserId: string | null;
  readOnly?: boolean;
  mentionables?: MentionPick[];
  initialNowIso?: string;
  handoverState?: "BOT_ACTIVE" | "PAUSED_HUMAN";
  lastCustomerMessageAt?: string | Date | null;
}) {
  const hydrate = useCallback(
    (list: Message[]): UiMessage[] =>
      list.map((m) => ({ ...m, ...hydrateMessageState(kind, (m as UiMessage).wa) })),
    [kind],
  );

  const [messages, setMessages] = useState<UiMessage[]>(() => hydrate(initialMessages));
  const { windowInfo, draftText, setDraftText } = useWa24hWindow(conversationId, lastCustomerMessageAt);
  const [draft, setDraftState] = useState<string>(draftText);
  const [handoverState, setHandoverState] = useState<"BOT_ACTIVE" | "PAUSED_HUMAN">(initialHandoverState);

  // Sincronizar draft local con el hook useWa24hWindow (preservación de borrador)
  function handleDraftChange(val: string) {
    setDraftState(val);
    setDraftText(val);
  }

  const [sending, setSending] = useState(false);
  const ayudaTecladoId = `composer-ayuda-${conversationId}`;
  const enviando = useRef(false);

  const recorder = useAudioRecorder(audioRecorderOptionsFor(kind));
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioErr, setAudioErr] = useState<string | null>(null);
  const [labelNowIso, setLabelNowIso] = useState<string | null>(() => initialNowIso ?? null);

  const caps = useMemo(() => composerCapabilities(kind, { readOnly }), [kind, readOnly]);
  const bloqueo = useMemo(() => composerBlockNotice(kind, { readOnly }), [kind, readOnly]);

  async function toggleHandoverState() {
    const nextState = handoverState === "BOT_ACTIVE" ? "PAUSED_HUMAN" : "BOT_ACTIVE";
    setHandoverState(nextState);
    await setHandoverStateAction({ conversationId, state: nextState });
  }

  async function sendAudio() {
    if (!caps.canSendAudio) return;
    if (!recorder.blob || audioBusy) return;
    setAudioBusy(true);
    setAudioErr(null);
    try {
      const prep = await prepareAudioUploadAction({ conversationId });
      if (!prep.ok) { setAudioErr(prep.message); return; }
      const sb = createClient();
      if (!sb) { setAudioErr("Demo: audio no disponible."); return; }
      const { error: upErr } = await sb.storage
        .from("connect-files")
        .uploadToSignedUrl(prep.path, prep.token, recorder.blob, {
          contentType: recorder.blob.type || "application/octet-stream",
        });
      if (upErr) { setAudioErr(`Subida: ${upErr.message}`); return; }
      const fin = await finalizeAudioMessageAction({
        conversationId,
        path: prep.path,
        durationMs: Math.max(1, recorder.durationMs),
        clientMsgId: crypto.randomUUID(),
      });
      if (!fin.ok) { setAudioErr(fin.message); return; }
      recorder.reset();
    } finally {
      setAudioBusy(false);
    }
  }

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
    if (!caps.canMention) return [];
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return mentionables
      .filter((m) => m.profileId && m.name && m.profileId !== currentUserId)
      .filter((m) => q.length === 0 || m.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [caps.canMention, mentionQuery, mentionables, currentUserId]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
  }, []);

  useEffect(() => {
    setMessages(hydrate(initialMessages));
    sentSeqRef.current = 0;
    setPicks([]);
    setMentionQuery(null);
  }, [conversationId, hydrate, initialMessages]);

  useEffect(() => scrollToEnd(), [messages.length, scrollToEnd]);

  useEffect(() => {
    const refreshLabels = () => setLabelNowIso(new Date().toISOString());
    refreshLabels();
    const intervalId = window.setInterval(refreshLabels, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft]);

  useEffect(() => {
    const lastSeq = messages.reduce((mx, m) => Math.max(mx, m.seq < Number.MAX_SAFE_INTEGER ? m.seq : 0), 0);
    if (lastSeq > sentSeqRef.current) {
      sentSeqRef.current = lastSeq;
      void markReadAction({ conversationId, upToSeq: lastSeq });
    }
  }, [conversationId, messages]);

  useRealtimeTable(
    "connect_messages",
    (payload) => {
      setMessages((prev) =>
        applyRealtimeEvent<UiMessage>(prev, payload as RealtimeEvent, {
          conversationId,
          build: (row, existing) => {
            const reduced = reduceMessageState({
              kind,
              source: "realtime",
              current: { wa: existing?.wa, status: existing?.status },
              incoming: projectWaMessage({
                meta: row.meta,
                externalMsgId: row.external_msg_id,
              }),
            });
            return {
              id: row.id as string,
              conversationId: (row.conversation_id as string) ?? existing?.conversationId ?? conversationId,
              seq: row.seq != null ? Number(row.seq) : (existing?.seq as number),
              authorParticipantId:
                row.author_participant_id !== undefined
                  ? ((row.author_participant_id as string) ?? null)
                  : existing?.authorParticipantId ?? null,
              authorProfileId:
                row.author_profile_id !== undefined
                  ? ((row.author_profile_id as string) ?? null)
                  : existing?.authorProfileId ?? null,
              kind: (row.kind as Message["kind"]) ?? existing?.kind ?? "text",
              body: row.body !== undefined ? ((row.body as string) ?? null) : existing?.body ?? null,
              bodyFormat: (row.body_format as string) ?? existing?.bodyFormat ?? "markdown",
              replyToMessageId:
                (row.reply_to_message_id as string) ?? existing?.replyToMessageId ?? null,
              editedAt: existing?.editedAt ?? null,
              deletedAt: existing?.deletedAt ?? null,
              redacted: existing?.redacted ?? false,
              createdAt:
                (row.created_at as string) ?? existing?.createdAt ?? new Date().toISOString(),
              clientMsgId: (row.client_msg_id as string) ?? existing?.clientMsgId,
              authorName:
                mentionables.find(
                  (p) => p.profileId === ((row.author_profile_id as string) ?? ""),
                )?.name ??
                existing?.authorName ??
                null,
              ...reduced,
              sendError: isAuditedConfirmation(reduced.wa) ? undefined : existing?.sendError,
            };
          },
        }) as UiMessage[],
      );
    },
    { filter: `conversation_id=eq.${conversationId}` },
  );

  function updateMentionQuery(value: string, caret: number) {
    if (!caps.canMention || mentionables.length === 0) {
      setMentionQuery(null);
      return;
    }
    const upToCaret = value.slice(0, caret);
    const m = /(^|\s)@([^\s@]*)$/.exec(upToCaret);
    setMentionQuery(m ? m[2] : null);
  }

  function pickMention(pick: MentionPick): boolean {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? draft.length;
    const upToCaret = draft.slice(0, caret);
    const m = /(^|\s)@([^\s@]*)$/.exec(upToCaret);
    if (!m) {
      setMentionQuery(null);
      return false;
    }
    const start = caret - m[2].length - 1;
    const next = `${draft.slice(0, start)}@${pick.name} ${draft.slice(caret)}`;
    handleDraftChange(next);
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
    if (!body || enviando.current || sending || readOnly) return;
    enviando.current = true;
    if (!caps.canSendText) {
      enviando.current = false;
      return;
    }

    // Intervención de operador humano en WhatsApp activa PAUSED_HUMAN
    if (lastCustomerMessageAt && handoverState !== "PAUSED_HUMAN") {
      setHandoverState("PAUSED_HUMAN");
    }

    const mentions = caps.canMention ? resolveMentions(body, picks, currentUserId) : [];
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
      ...initialMessageState(kind),
      sendError: undefined,
      clientMsgId,
    };

    setMessages((prev) => [...prev, optimistic]);
    handleDraftChange("");
    setPicks([]);
    setMentionQuery(null);
    setSending(true);

    try {
      const outcome = await dispatchComposerSend(
        { kind, conversationId, body, clientMsgId, mentions },
        {
          postConnectMessage: (i) => postMessageAction(i),
          sendWhatsappText: (i) => sendWhatsappTextAction(i),
        },
      );

      setMessages((prev) =>
        prev.map((m) => {
          if (m.clientMsgId !== clientMsgId) return m;

          const reduced = reduceMessageState({
            kind,
            source: "action",
            current: { wa: m.wa, status: m.status },
            incoming: projectionFromActionOutcome(outcome),
          });
          const confirmed = clearsSendError(kind, reduced);

          return {
            ...m,
            id: outcome.status === "sent" ? outcome.messageId : m.id,
            seq: outcome.status === "sent" && outcome.route === "connect" ? outcome.seq : m.seq,
            ...reduced,
            sendError: confirmed ? undefined : outcome.status === "sent" ? m.sendError : outcome.message,
          };
        }),
      );
    } finally {
      setSending(false);
      enviando.current = false;
    }
  }

  // Es la ventana de WhatsApp expirada (red_locked)?
  const isWaExpired = Boolean(lastCustomerMessageAt) && windowInfo.status === "red_locked";

  return (
    <>
      {/* Visual Indicator de Ventana 24h & State Handover */}
      {Boolean(lastCustomerMessageAt) && (
        <Wa24hWindowIndicator
          windowInfo={windowInfo}
          handoverState={handoverState}
          onToggleHandover={toggleHandoverState}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="m-auto text-xs text-fg-muted">Todavía no hay mensajes. Escribí el primero.</p>
        )}
        {messages.map((m, i) => {
          const separator = isNewDay(m.createdAt, messages[i - 1]?.createdAt) ? (
            <div key={`day-${m.id}`} className="flex items-center gap-2 py-1">
              <span className="h-px flex-1 bg-stroke-soft" />
              <span className="rounded-full bg-bg-surface-alt px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                {dayLabel(m.createdAt, labelNowIso === null ? null : new Date(labelNowIso))}
              </span>
              <span className="h-px flex-1 bg-stroke-soft" />
            </div>
          ) : null;

          if (m.kind === "system") {
            return (
              <Fragment key={m.id}>
                {separator}
                <div className="flex justify-center">
                  <span className="max-w-[85%] rounded-full bg-bg-surface-alt px-3 py-1 text-center text-[11px] text-fg-muted">
                    {messageDisplayBody(m)}
                    <span className="ml-1.5 text-[10px] opacity-70">{timeHM(m.createdAt)}</span>
                  </span>
                </div>
              </Fragment>
            );
          }
          const own = !!currentUserId && m.authorProfileId === currentUserId;
          return (
            <Fragment key={m.id}>
              {separator}
            <div className={cn("flex", own ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[72%] rounded-lg px-3 py-2 text-[13px]",
                  own
                    ? ownBubbleClass(kind)
                    : "border border-stroke-soft bg-bg-surface text-fg-primary",
                )}
              >
                {m.authorName && (
                  <div className="mb-0.5 text-[11px] font-semibold text-fg-secondary">
                    {m.authorName}
                  </div>
                )}
                {m.kind === "audio" ? (
                  <AudioPlayer messageId={m.id} />
                ) : (
                  <div className="whitespace-pre-wrap break-words">
                    {renderWithMentions(messageDisplayBody(m), mentionNames)}
                  </div>
                )}
                {m.attachments && m.attachments.length > 0 && (
                  <MessageAttachments attachments={m.attachments} />
                )}
                <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-fg-muted">
                  <span>{timeHM(m.createdAt)}</span>
                  {m.status === "sending" && <span>enviando…</span>}
                  {m.status === "pending" && (
                    <span className="text-tops-amber">pendiente de confirmación</span>
                  )}
                  {m.status === "failed" && <span className="text-tops-red">no se pudo enviar</span>}
                  {m.status === "historical" && <span className="text-fg-muted">sin registro de envío</span>}
                </div>
                {m.sendError && (
                  <p
                    className={cn(
                      "mt-1 text-[10px]",
                      m.status === "failed" ? "text-tops-red" : "text-amber-500",
                    )}
                  >
                    {m.sendError}
                  </p>
                )}
              </div>
            </div>
            </Fragment>
          );
        })}
        <div ref={endRef} />
      </div>

      {bloqueo ? (
        <div
          role="status"
          className="flex items-center justify-center gap-1.5 border-t border-stroke-soft bg-bg-surface-alt px-4 py-3 text-center text-xs text-fg-muted"
        >
          <Icon name={bloqueo.reason === "read_only" ? "folder" : "x"} size={13} className="text-fg-muted" />
          {bloqueo.message}
        </div>
      ) : isWaExpired ? (
        /* Si la ventana de 24h está expirada (red_locked), conmutar a selector de Plantillas Utility conservando borrador */
        <div className="p-3 border-t border-stroke-soft bg-bg-surface">
          <WaTemplateSelector
            currentDraft={draft}
            onSelectTemplate={(renderedText) => handleDraftChange(renderedText)}
          />
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
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-bg-surface-alt text-[10px] font-bold text-fg-secondary">
                    {c.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="truncate text-xs text-fg-primary">{c.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <VoiceField className="min-w-0 flex-1">
              <textarea
                ref={textareaRef}
                value={draft}
                aria-label="Escribir mensaje"
                onChange={(e) => {
                  handleDraftChange(e.target.value);
                  updateMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length);
                }}
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
                      if (pickMention(candidates[0])) return;
                    }
                    void send();
                  }
                }}
                placeholder="Escribí un mensaje…"
                aria-describedby={ayudaTecladoId}
                rows={1}
                className="max-h-32 min-h-[2.25rem] w-full resize-none overflow-y-auto rounded-md border border-stroke-soft bg-bg-page px-3 py-2 text-[13px] text-fg-primary outline-none focus:border-tops-red"
              />
            </VoiceField>
            {caps.canAttachFile && recorder.state !== "recording" && recorder.state !== "preview" && (
              <AttachmentComposer
                conversationId={conversationId}
                kind={kind}
                disabled={sending || audioBusy}
                caption={draft.trim() || undefined}
                onSent={() => handleDraftChange("")}
              />
            )}
            {caps.canSendAudio && recorder.state !== "recording" && recorder.state !== "preview" && (
              <button
                type="button"
                onClick={() => void recorder.start()}
                disabled={sending || audioBusy}
                className="focus-nexus grid h-8 w-8 shrink-0 place-items-center rounded-full border border-stroke-soft text-fg-secondary transition-colors hover:border-tops-red hover:text-tops-red"
                title="Mensaje de voz"
                aria-label="Grabar mensaje de voz"
              >
                <MicIcon size={15} />
              </button>
            )}
            <button
              type="button"
              onClick={() => void send()}
              disabled={!draft.trim() || sending || !caps.canSendText}
              className={cn("btn btn-sm shrink-0", sendButtonClass(kind))}
              aria-label="Enviar mensaje"
            >
              <Icon name="send" size={15} />
            </button>
          </div>
          <p id={ayudaTecladoId} className="mt-1 px-0.5 text-[10px] leading-tight text-fg-muted">
            Enter para enviar · Shift+Enter para salto de línea
          </p>
          {caps.canSendAudio && recorder.state === "recording" && (
            <div className="mt-2 flex items-center gap-3 rounded-lg border border-tops-red/40 bg-tops-red/5 px-3 py-2">
              <span className="flex items-center gap-2 text-xs font-semibold text-tops-red">
                <span className="h-2 w-2 animate-pulse rounded-full bg-tops-red" />
                Grabando · {Math.floor(recorder.durationMs / 60000)}:{String(Math.floor((recorder.durationMs % 60000) / 1000)).padStart(2, "0")}
              </span>
              <span className="flex-1" />
              <button type="button" className="btn btn-ghost btn-sm text-xs" onClick={recorder.cancel}>
                Cancelar
              </button>
              <button type="button" className="btn btn-nexus btn-sm text-xs" onClick={recorder.stop}>
                Detener
              </button>
            </div>
          )}
          {caps.canSendAudio && recorder.state === "preview" && recorder.blob && (
            <div className="mt-2 flex items-center gap-3 rounded-lg border border-stroke-soft bg-bg-surface px-3 py-2">
              <AudioPlayer src={URL.createObjectURL(recorder.blob)} compact />
              <span className="flex-1" />
              <button type="button" className="btn btn-ghost btn-sm text-xs" disabled={audioBusy} onClick={recorder.cancel}>
                Cancelar
              </button>
              <button type="button" className="btn btn-nexus btn-sm text-xs" disabled={audioBusy} onClick={() => void sendAudio()}>
                {audioBusy ? "Enviando…" : "Enviar audio"}
              </button>
            </div>
          )}
          {caps.canSendAudio && (recorder.error || audioErr) && (
            <p className="mt-1 text-[11px] text-tops-red">{recorder.error ?? audioErr}</p>
          )}
        </div>
      )}
    </>
  );
}
