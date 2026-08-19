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
  audioRecorderOptionsFor, composerCapabilities, ownBubbleClass, sendButtonClass,
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
import { AudioPlayer } from "./AudioPlayer";
import { AttachmentComposer } from "./AttachmentComposer";
import { MessageAttachments } from "./MessageAttachments";

/** D1 (LINK-MEDIA-001): ícono propio del MENSAJE de voz — distinto del Voice Command. */
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
  /**
   * WA-8 · `pending` es un estado propio, distinto de `failed`: un envío
   * ambiguo pudo haber llegado y pintarlo como fallo invita a reintentar.
   *
   * WA-8R2 · es DERIVADO de `waEvidence`, nunca la memoria en sí: `undefined`
   * no distingue «confirmado» de «todavía sin evidencia».
   */
  status?: BubbleStatus;
  /**
   * WA-8R3 · proyección SANITIZADA: dirección, estado canónico del proveedor,
   * evidencia de auditoría e instante de ordenamiento. Nada de `meta` crudo,
   * wamid, teléfono ni payload del proveedor.
   *
   * Su AUSENCIA identifica a la burbuja optimista local todavía en vuelo.
   */
  wa?: WaProjection;
  /** WA-8R2 · el error pertenece al mensaje, no a un string global del hilo. */
  sendError?: string;
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
  kind,
  initialMessages,
  currentUserId,
  readOnly = false,
  mentionables = [],
  initialNowIso,
}: {
  conversationId: string;
  /**
   * WA-8 · tipo REAL de la conversación. Es obligatorio y es el ÚNICO criterio
   * de ruteo del composer: sin él no se puede decidir entre Connect y WhatsApp,
   * y adivinar por título, teléfono o contenido es exactamente lo que el
   * contrato prohíbe. Un valor desconocido deja el composer fail-closed.
   */
  kind: ConversationKind;
  initialMessages: Message[];
  currentUserId: string | null;
  /** DEFECT-6 (piloto F3): canal archivado → composer deshabilitado (solo lectura). */
  readOnly?: boolean;
  /** F4.1B: miembros mencionables (@) — la FK de menciones exige miembros (D-F41-8). */
  mentionables?: MentionPick[];
  /** Snapshot temporal del Server Component para un primer render idéntico. */
  initialNowIso?: string;
}) {
  /**
   * WA-8R3 · B · la hidratación pasa por la MISMA política que realtime. Sin
   * esto, un mensaje que llega del servidor entra con `status === undefined` y
   * se pinta como confirmado sin ninguna evidencia — el falso éxito volvía a
   * aparecer apenas el operador recargaba la página.
   */
  const hydrate = useCallback(
    (list: Message[]): UiMessage[] =>
      list.map((m) => ({ ...m, ...hydrateMessageState(kind, (m as UiMessage).wa) })),
    [kind],
  );

  const [messages, setMessages] = useState<UiMessage[]>(() => hydrate(initialMessages));
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  /** Id del texto de ayuda; lo referencia el textarea por `aria-describedby`. */
  const ayudaTecladoId = `composer-ayuda-${conversationId}`;
  /**
   * CLOSEOUT · §4.F · CERROJO SÍNCRONO contra el doble envío.
   *
   * `sending` es estado de React: `setSending(true)` no se refleja hasta el
   * próximo render. Dos clics dentro del mismo lote —un doble clic real— leen
   * ambos `sending === false` y disparan DOS envíos. En WhatsApp eso significa
   * dos mensajes al cliente, y no hay forma de retirarlos.
   *
   * El ref cambia en el acto, así que la segunda entrada ve el cerrojo puesto.
   * El estado sigue existiendo: es el que deshabilita el botón en la UI.
   */
  const enviando = useRef(false);
  // LINK-MEDIA-001: grabación de mensajes de voz (D1: circuito separado del Voice Command).
  // FASE B · el canal decide el formato: WhatsApp no reproduce WebM. La vista
  // consulta la decisión, no compara `kind`.
  const recorder = useAudioRecorder(audioRecorderOptionsFor(kind));
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioErr, setAudioErr] = useState<string | null>(null);
  // El primer render nunca consulta el reloj del proceso/navegador por su cuenta.
  // La ruta SSR entrega un ISO común; otros call-sites usan el sentinel estable
  // `null` y muestran fecha absoluta hasta que el efecto post-mount toma el reloj.
  const [labelNowIso, setLabelNowIso] = useState<string | null>(() => initialNowIso ?? null);

  // WA-8 · capacidades efectivas. Se consultan para PINTAR y se vuelven a exigir
  // antes de EJECUTAR: ocultar un botón no impide que un atajo, un dictado o un
  // re-render disparen la acción igual.
  const caps = useMemo(() => composerCapabilities(kind, { readOnly }), [kind, readOnly]);

  async function sendAudio() {
    // Guarda de LÓGICA, no de CSS: corta antes de `prepareAudioUploadAction`,
    // `uploadToSignedUrl` y `finalizeAudioMessageAction`.
    //
    // SCOPE B · el comentario anterior afirmaba que esta guarda bloqueaba el
    // audio "en WhatsApp": era cierto en WA-8 y dejó de serlo en FASE B, que
    // habilitó `canSendAudio` en ese canal (ver `composerCapabilities`). La
    // documentación desactualizada apuntaba a una causa falsa para INC-02.
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
      recorder.reset(); // el mensaje llega por realtime (insert de connect_messages)
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
    // WA-8 · sin menciones no hay candidatos: el autocomplete no existe en
    // WhatsApp, ni siquiera oculto.
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

  // Reset SOLO al cambiar de conversación (NO en cada revalidate del padre con la misma conversación):
  // así no se pierden mensajes optimistas/fallidos/realtime en-flight cuando el server re-renderiza.
  useEffect(() => {
    setMessages(hydrate(initialMessages));
    sentSeqRef.current = 0;
    setPicks([]);
    setMentionQuery(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => scrollToEnd(), [messages.length, scrollToEnd]);

  useEffect(() => {
    const refreshLabels = () => setLabelNowIso(new Date().toISOString());

    refreshLabels();
    const intervalId = window.setInterval(refreshLabels, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  // VOICE-002: autosize del composer. `draft` es la única fuente de cambios del
  // contenido (tipeo, dictado —insertAtCursor despacha `input` real→onChange—,
  // menciones y envío), así que un solo efecto cubre todos los caminos. Crece
  // hasta el tope de la className (max-h-32 = 128px) y de ahí en más el scroll
  // interno (overflow-y-auto) toma el control. Nunca línea infinita.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft]);

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
      // 1B-1: la reconciliación vive en `connect/realtime-merge` (pura y
      // testeada). Acá queda sólo el mapeo fila→UiMessage, que es lo que
      // depende de la UI. Se conserva el comportamiento de INSERT (incluida la
      // reconciliación DEFECT-5 del eco optimista) y se agrega UPDATE, que
      // antes se descartaba: por eso los estados no llegaban en vivo.
      setMessages(
        (prev) =>
          applyRealtimeEvent<UiMessage>(prev, payload as RealtimeEvent, {
            conversationId,
            build: (row, existing) => {
              // WA-8R2 · el estado NO se decide acá. `meta` y `external_msg_id`
              // entran como `unknown` al reducer y NO se conservan: lo único que
              // cruza a la UI es una evidencia sanitizada.
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
              // Fix realtime (28-07): el mensaje EN VIVO llega sin authorName (el canal no pasa
              // por el read-layer) — se resuelve contra los miembros ya presentes en memoria.
              authorName:
                mentionables.find(
                  (p) => p.profileId === ((row.author_profile_id as string) ?? ""),
                )?.name ??
                existing?.authorName ??
                null,
              ...reduced,
              // El error pertenece a ESTE mensaje: se limpia sólo cuando su
              // propia evidencia queda confirmada, nunca por un evento ajeno.
              sendError: isAuditedConfirmation(reduced.wa) ? undefined : existing?.sendError,
              };
            },
          }) as UiMessage[],
      );
    },
    { filter: `conversation_id=eq.${conversationId}` },
  );

  /** Detecta si el caret está dentro de un token @… en curso (dispara el autocomplete). */
  function updateMentionQuery(value: string, caret: number) {
    // WA-8 · en WhatsApp `@` es texto común: no abre autocomplete ni acumula picks.
    if (!caps.canMention || mentionables.length === 0) {
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
    // El cerrojo se consulta ANTES que el estado: es el único que ya cambió.
    if (!body || enviando.current || sending || readOnly) return;
    enviando.current = true;
    // WA-8 · guarda de LÓGICA: kind desconocido o solo-lectura ⇒ cero acciones.
    if (!caps.canSendText) {
      enviando.current = false;
      return;
    }
    // F4.1B: menciones efectivas = picks ∩ cuerpo final (dominio puro; dedupe/tope/sin autor).
    // WA-8 · en WhatsApp no viajan menciones: no hay a quién notificar del otro
    // lado y mandarlas filtraría nombres del tenant a un tercero.
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
      // WA-8R2 · el estado inicial también sale del módulo puro: el componente
      // no compara `kind` para decidir nada.
      ...initialMessageState(kind),
      sendError: undefined,
      clientMsgId,
    };
    // Una ÚNICA burbuja optimista, con un ÚNICO clientMsgId, antes de elegir camino.
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    setPicks([]);
    setMentionQuery(null);
    setSending(true);

    try {
      // WA-8 · el despacho es del dispatcher puro: acá no se decide nada.
      // WA-8R1 · el dispatcher ya convierte una excepción del camino WhatsApp en
      // `pending`, así que este `await` no puede rechazar por esa vía.
      const outcome = await dispatchComposerSend(
        { kind, conversationId, body, clientMsgId, mentions },
        {
          postConnectMessage: (i) => postMessageAction(i),
          sendWhatsappText: (i) => sendWhatsappTextAction(i),
        },
      );

      // WA-8R2 · la resolución de la acción aplica el MISMO reducer que
      // realtime, y lo hace DENTRO del update funcional: así opera sobre el
      // estado más reciente y no sobre una copia capturada antes del `await`.
      // Sin reintento automático en ninguna rama: un resultado ambiguo pudo
      // haber salido, y reintentarlo le duplica el mensaje al contacto.
      setMessages((prev) =>
        prev.map((m) => {
          if (m.clientMsgId !== clientMsgId) return m;

          const reduced = reduceMessageState({
            kind,
            source: "action",
            current: { wa: m.wa, status: m.status },
            incoming: projectionFromActionOutcome(outcome),
          });
          // D · sólo una confirmación afirmativa limpia el error, y sólo el de
          // ESTE mensaje. El criterio por tipo vive en el módulo puro.
          const confirmed = clearsSendError(kind, reduced);

          return {
            ...m,
            // La identidad sólo se adopta del resultado exitoso; un fallo no
            // reescribe el id ni el seq de una fila que quizá ya existe.
            id: outcome.status === "sent" ? outcome.messageId : m.id,
            seq:
              outcome.status === "sent" && outcome.route === "connect" ? outcome.seq : m.seq,
            ...reduced,
            // El error queda atado a ESTE mensaje: una confirmación lo limpia,
            // y un resultado tardío de otro intento no puede tocarlo.
            sendError: confirmed ? undefined : outcome.status === "sent" ? m.sendError : outcome.message,
          };
        }),
      );
    } finally {
      // WA-8R1 · el composer NUNCA queda congelado en «enviando…». Aun si algo
      // inesperado escapara del dispatcher, el operador recupera el control —
      // sin que eso se interprete como permiso para reintentar.
      setSending(false);
      enviando.current = false;
    }
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="m-auto text-xs text-fg-muted">Todavía no hay mensajes. Escribí el primero.</p>
        )}
        {messages.map((m, i) => {
          // LINK-WA-UX-001: separador de fecha al cambiar de día. Los hilos
          // históricos abarcan años; sin esto un mensaje de 2021 y otro de 2026
          // se ven idénticos. La hora de cada mensaje se conserva intacta.
          const separator = isNewDay(m.createdAt, messages[i - 1]?.createdAt) ? (
            <div key={`day-${m.id}`} className="flex items-center gap-2 py-1">
              <span className="h-px flex-1 bg-stroke-soft" />
              <span className="rounded-full bg-bg-surface-alt px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                {dayLabel(m.createdAt, labelNowIso === null ? null : new Date(labelNowIso))}
              </span>
              <span className="h-px flex-1 bg-stroke-soft" />
            </div>
          ) : null;

          // UX-1a: los eventos de sistema (p. ej. "X agregó a Y") se renderizan como
          // línea centrada y discreta — trazabilidad en el hilo, sin burbuja de autor.
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
                {/*
                  El nombre va en TODOS los mensajes, no sólo en los ajenos.
                  La bandeja de WhatsApp es compartida: varios operadores
                  responden el mismo hilo, y sin el nombre no se sabe quién
                  contestó. Junto con la hora, cada burbuja dice QUIÉN y CUÁNDO.
                */}
                {m.authorName && (
                  <div className="mb-0.5 text-[11px] font-semibold text-fg-secondary">
                    {m.authorName}
                  </div>
                )}
                {/* LINK-MEDIA-001: mensajes de audio → reproductor único (URL firmada on-demand). */}
                {m.kind === "audio" ? (
                  <AudioPlayer messageId={m.id} />
                ) : (
                  <div className="whitespace-pre-wrap break-words">
                    {renderWithMentions(messageDisplayBody(m), mentionNames)}
                  </div>
                )}
                {/*
                  H-1 · LOS ADJUNTOS SE MUESTRAN.

                  Antes no había ninguna rama para `kind === "file"`: el mensaje
                  caía al `else` de arriba y el archivo se pintaba como el texto
                  `📎 foto.png`, inabrible. El cuerpo sigue mostrándose —es el
                  pie de foto cuando lo hay— y debajo va el adjunto real.

                  Cuelga de `attachments` y no de `kind` a propósito: un mensaje
                  con archivo adjunto se muestra igual venga marcado como venga,
                  y una burbuja optimista —que todavía no tiene la lista— no
                  renderiza nada de más.
                */}
                {m.attachments && m.attachments.length > 0 && (
                  <MessageAttachments attachments={m.attachments} />
                )}
                <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-fg-muted">
                  {/*
                    WA-8R9 · H-3 · la HORA se muestra SIEMPRE.

                    Antes colgaba de `status === undefined`, así que cualquier
                    mensaje en vuelo, pendiente o fallido perdía su hora — y las
                    filas históricas, que caían en `pending`, también.
                    El indicador de envío es información ADICIONAL sobre la hora,
                    no un reemplazo.
                  */}
                  <span>{timeHM(m.createdAt)}</span>
                  {m.status === "sending" && <span>enviando…</span>}
                  {m.status === "pending" && (
                    <span className="text-tops-amber">pendiente de confirmación</span>
                  )}
                  {m.status === "failed" && <span className="text-tops-red">no se pudo enviar</span>}
                  {/*
                    Neutro: hay un mensaje y una hora, pero ninguna evidencia
                    acreditable sobre su envío. No se afirma éxito ni pendiente.
                  */}
                  {m.status === "historical" && <span className="text-fg-muted">sin registro de envío</span>}
                </div>
                {/* WA-8R2 · el error vive en SU mensaje. Sin botón de reintento:
                    un envío ambiguo pudo haber salido y reintentarlo lo duplicaría. */}
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

      {readOnly ? (
        <div className="flex items-center justify-center gap-1.5 border-t border-stroke-soft bg-bg-surface-alt px-4 py-3 text-center text-xs text-fg-muted">
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
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-bg-surface-alt text-[10px] font-bold text-fg-secondary">
                    {c.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="truncate text-xs text-fg-primary">{c.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            {/* VOICE-002 (root cause): el wrapper de VoiceField DEBE acotarse en la
                fila flex — su propio docstring prescribe "flex-1 min-w-0". Sin esto,
                el preview del parcial de dictado (p.truncate) no tiene ancho límite
                y se extiende invadiendo el layout. El textarea pasa a w-full porque
                el flex item ahora es el wrapper. */}
            <VoiceField className="min-w-0 flex-1">
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
                /*
                  WA-VIS-01 · el placeholder vuelve a ser corto.
                  La ayuda de teclado vivía acá dentro, en un textarea de UNA
                  línea con `overflow-y:auto`: se recortaba a mitad de frase y
                  el operador nunca leía que Enter envía. Ahora vive fuera, en
                  un elemento propio, y se asocia por `aria-describedby` para
                  que un lector de pantalla la anuncie al enfocar el campo.
                */
                placeholder="Escribí un mensaje…"
                aria-describedby={ayudaTecladoId}
                rows={1}
                className="max-h-32 min-h-[2.25rem] w-full resize-none overflow-y-auto rounded-md border border-stroke-soft bg-bg-page px-3 py-2 text-[13px] text-fg-primary outline-none focus:border-tops-red"
              />
            </VoiceField>
            {/* FASE B: adjuntar archivos. El clip es un tercer ícono DISTINTO del
                micrófono de dictado (VoiceField) y del micrófono de mensaje de
                voz: los tres caminos son distintos y tienen que verse distintos. */}
            {caps.canAttachFile && recorder.state !== "recording" && recorder.state !== "preview" && (
              <AttachmentComposer
                conversationId={conversationId}
                kind={kind}
                disabled={sending || audioBusy}
                caption={draft.trim() || undefined}
                onSent={() => setDraft("")}
              />
            )}
            {/* D1: botón de MENSAJE de voz — separado del Voice Command, sin desplazar el envío.
                WA-8: en WhatsApp no se renderiza; `sendAudio` además corta por lógica. */}
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
          {/*
            WA-VIS-01 · ayuda de teclado FUERA del campo.

            Es texto real y visible —no `sr-only` ni oculto por CSS—: el
            objetivo era que se leyera, no que pasara una captura. El `id` lo
            referencia el textarea con `aria-describedby`.
          */}
          <p id={ayudaTecladoId} className="mt-1 px-0.5 text-[10px] leading-tight text-fg-muted">
            Enter para enviar · Shift+Enter para salto de línea
          </p>
          {/* LINK-MEDIA-001: barra de grabación/preview (reemplaza visualmente al flujo de texto). */}
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
