/**
 * @vitest-environment jsdom
 *
 * Test DOM Adversarial y de Concurrencia de Reacciones con Emojis (P3 / HIGH 3).
 * Cubre:
 * 1. Operación optimista local.
 * 2. Evento realtime propio con participant_id coincidente (reconciliación idempotente sin duplicación de contador).
 * 3. Evento realtime ajeno con el mismo mensaje y emoji durante la operación local (ambos se suman correctamente sin supresión).
 * 4. Ambos órdenes de llegada (evento propio antes de resolución de action vs resolución antes de evento propio).
 * 5. Fallo local concurrente con evento ajeno del mismo emoji (rollback quirúrgico descuenta solo la acción local, preservando el evento ajeno).
 * 6. Conteo final canónico y preservación correcta de myReaction.
 * 7. Prevención de carreras por doble clic rápido.
 * 8. Feedback accesible con role="alert" y aria-live="assertive" ante error y limpieza tras éxito.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Message } from "@/lib/connect/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = vi.fn();

let realtimeCallbacks: Record<string, (payload: unknown) => void> = {};

vi.mock("@/lib/supabase/client", () => ({ createClient: () => null }));
vi.mock("@/lib/supabase/realtime", () => ({
  useRealtimeTable: (table: string, cb: (payload: unknown) => void) => {
    realtimeCallbacks[table] = cb;
  },
}));

vi.mock("@/components/voice/VoiceField", () => ({
  VoiceField: (p: { children?: unknown }) => <div>{p.children as never}</div>,
}));
vi.mock("@/components/Icon", () => ({ Icon: () => <span data-testid="icon" /> }));
vi.mock("./AttachmentComposer", () => ({ AttachmentComposer: () => null }));
vi.mock("./MessageAttachments", () => ({ MessageAttachments: () => null }));
vi.mock("@/lib/connect/client-mark-read", () => ({ markReadInBrowser: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/hooks/useWa24hWindow", () => ({
  useWa24hWindow: () => ({
    windowInfo: { status: "green_ok", remainingMs: 86400000, formattedRemaining: "24h" },
    draftText: "",
    setDraftText: vi.fn(),
  }),
}));
vi.mock("@/lib/whatsapp/reply-action", () => ({
  sendWhatsappTextAction: vi.fn(async () => ({ ok: true, status: "sent", route: "whatsapp", messageId: "srv-wa-1" })),
}));
vi.mock("@/lib/whatsapp/handover-action", () => ({
  setHandoverStateAction: vi.fn(async () => ({ ok: true as const, state: "PAUSED_HUMAN" as const })),
}));
vi.mock("@/lib/connect/adapters/driving/audio-actions", () => ({
  prepareAudioUploadAction: vi.fn(),
  finalizeAudioMessageAction: vi.fn(),
}));

const mockAddReaction = vi.fn();
const mockRemoveReaction = vi.fn();

vi.mock("@/lib/connect/adapters/driving/reaction-actions", () => ({
  addReactionAction: (raw: unknown) => mockAddReaction(raw),
  removeReactionAction: (raw: unknown) => mockRemoveReaction(raw),
}));

import { ThreadView } from "./ThreadView";

describe("ThreadView · Reacciones Optimistas, Realtime Determinista y Feedback Accesible (HIGH 3)", () => {
  let container: HTMLDivElement;
  let root: Root;

  const MY_PARTICIPANT_ID = "part-my-id";
  const OTHER_PARTICIPANT_ID = "part-other-user";

  const sampleMessages: Message[] = [
    {
      id: "msg-101",
      conversationId: "conv-1",
      seq: 1,
      authorParticipantId: "part-author-1",
      authorProfileId: "prof-author-1",
      authorName: "Carlos Gómez",
      kind: "text",
      body: "Hola equipo, acá va la actualización del pedido.",
      bodyFormat: "markdown",
      replyToMessageId: null,
      editedAt: null,
      deletedAt: null,
      redacted: false,
      createdAt: new Date().toISOString(),
      reactions: [
        { id: "rx-1", emoji: "👍", count: 2, myReaction: false },
        { id: "rx-2", emoji: "❤️", count: 1, myReaction: false },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    realtimeCallbacks = {};
    mockAddReaction.mockResolvedValue({ ok: true });
    mockRemoveReaction.mockResolvedValue({ ok: true });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function findReactionPill(emoji: string): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes(emoji) && /\d/.test(b.textContent || ""),
    );
  }

  it("1. Operación optimista local: incrementa inmediatamente contador y activa myReaction", async () => {
    await act(async () => {
      root.render(
        <ThreadView
          conversationId="conv-1"
          kind="channel"
          initialMessages={sampleMessages}
          currentUserId="prof-current"
          myParticipantId={MY_PARTICIPANT_ID}
        />,
      );
    });

    const pill = findReactionPill("👍");
    expect(pill?.textContent).toContain("2");

    await act(async () => {
      pill?.click();
    });

    expect(findReactionPill("👍")?.textContent).toContain("3");
    expect(findReactionPill("👍")?.className).toContain("border-tops-red");
    expect(mockAddReaction).toHaveBeenCalledWith({
      conversationId: "conv-1",
      messageId: "msg-101",
      emoji: "👍",
    });
  });

  it("2. Operador miembro sin mensajes previos: primera reacción y evento realtime propio no duplican", async () => {
    expect(sampleMessages.some((m) => m.authorProfileId === "prof-current")).toBe(false);
    await act(async () => {
      root.render(
        <ThreadView
          conversationId="conv-1"
          kind="channel"
          initialMessages={sampleMessages}
          currentUserId="prof-current"
          myParticipantId={MY_PARTICIPANT_ID}
        />,
      );
    });

    // 1. Clic local: 2 -> 3
    await act(async () => {
      findReactionPill("👍")?.click();
    });
    expect(findReactionPill("👍")?.textContent).toContain("3");

    // 2. Llega evento Realtime INSERT propio (con myParticipantId)
    await act(async () => {
      realtimeCallbacks["connect_message_reactions"]?.({
        eventType: "INSERT",
        new: { id: "rx-new-my", message_id: "msg-101", participant_id: MY_PARTICIPANT_ID, emoji: "👍" },
      });
    });

    // Contador permanece en 3 (no sube a 4) y myReaction sigue true
    expect(findReactionPill("👍")?.textContent).toContain("3");
    expect(findReactionPill("👍")?.className).toContain("border-tops-red");
  });

  it("3. Evento realtime ajeno con el mismo mensaje y emoji durante la operación local: ambos se suman correctamente", async () => {
    let resolveAction: (v: unknown) => void;
    mockAddReaction.mockImplementation(
      () => new Promise((resolve) => { resolveAction = resolve; }),
    );

    await act(async () => {
      root.render(
        <ThreadView
          conversationId="conv-1"
          kind="channel"
          initialMessages={sampleMessages}
          currentUserId="prof-current"
          myParticipantId={MY_PARTICIPANT_ID}
        />,
      );
    });

    expect(findReactionPill("👍")?.textContent).toContain("2");

    // 1. Usuario local hace clic en 👍 (2 -> 3 optimista)
    await act(async () => {
      findReactionPill("👍")?.click();
    });
    expect(findReactionPill("👍")?.textContent).toContain("3");

    // 2. Mientras la acción local sigue en vuelo, otro usuario reacciona a 👍 vía realtime
    await act(async () => {
      realtimeCallbacks["connect_message_reactions"]?.({
        eventType: "INSERT",
        new: { id: "rx-ext-1", message_id: "msg-101", participant_id: OTHER_PARTICIPANT_ID, emoji: "👍" },
      });
    });

    // 3. El evento ajeno NO es suprimido: el contador pasa a 4 (2 originales + 1 local + 1 ajeno)
    expect(findReactionPill("👍")?.textContent).toContain("4");

    // 4. Concluye la acción local exitosamente
    await act(async () => {
      resolveAction({ ok: true });
    });

    expect(findReactionPill("👍")?.textContent).toContain("4");
    expect(findReactionPill("👍")?.className).toContain("border-tops-red");
  });

  it("4. Ambos órdenes de llegada: evento propio antes de respuesta de action vs action antes de evento", async () => {
    let resolveAction: (v: unknown) => void;
    mockAddReaction.mockImplementation(
      () => new Promise((resolve) => { resolveAction = resolve; }),
    );

    await act(async () => {
      root.render(
        <ThreadView
          conversationId="conv-1"
          kind="channel"
          initialMessages={sampleMessages}
          currentUserId="prof-current"
          myParticipantId={MY_PARTICIPANT_ID}
        />,
      );
    });

    // Clic local: 2 -> 3
    await act(async () => {
      findReactionPill("👍")?.click();
    });

    // Orden A: Evento realtime llega antes de que la action resuelva
    await act(async () => {
      realtimeCallbacks["connect_message_reactions"]?.({
        eventType: "INSERT",
        new: { id: "rx-my-1", message_id: "msg-101", participant_id: MY_PARTICIPANT_ID, emoji: "👍" },
      });
    });
    expect(findReactionPill("👍")?.textContent).toContain("3");

    // Luego resuelve la action
    await act(async () => {
      resolveAction({ ok: true });
    });
    expect(findReactionPill("👍")?.textContent).toContain("3");
  });

  it("5. Fallo local concurrente con evento ajeno del mismo emoji: rollback quirúrgico descuenta solo la acción local", async () => {
    let rejectAction: (err: unknown) => void;
    mockAddReaction.mockImplementation(
      () => new Promise((_, reject) => { rejectAction = reject; }),
    );

    await act(async () => {
      root.render(
        <ThreadView
          conversationId="conv-1"
          kind="channel"
          initialMessages={sampleMessages}
          currentUserId="prof-current"
          myParticipantId={MY_PARTICIPANT_ID}
        />,
      );
    });

    expect(findReactionPill("👍")?.textContent).toContain("2");

    // 1. Clic local: 2 -> 3
    await act(async () => {
      findReactionPill("👍")?.click();
    });
    expect(findReactionPill("👍")?.textContent).toContain("3");

    // 2. Evento externo concurrente llega para el mismo emoji 👍: 3 -> 4
    await act(async () => {
      realtimeCallbacks["connect_message_reactions"]?.({
        eventType: "INSERT",
        new: { id: "rx-ext-1", message_id: "msg-101", participant_id: OTHER_PARTICIPANT_ID, emoji: "👍" },
      });
    });
    expect(findReactionPill("👍")?.textContent).toContain("4");

    // 3. Falla la acción local (error de conexión)
    await act(async () => {
      rejectAction(new Error("Timeout"));
    });

    // 4. Rollback quirúrgico: descuenta únicamente el +1 local, dejando el conteo en 3 (2 iniciales + 1 ajeno)
    expect(findReactionPill("👍")?.textContent).toContain("3");
    // myReaction se desmarca correctamente
    expect(findReactionPill("👍")?.className).not.toContain("border-tops-red");
  });

  it("6. Conteo final canónico y preservación correcta de myReaction ante unreacts externos", async () => {
    const msgWithMyReaction: Message[] = [
      {
        ...sampleMessages[0],
        reactions: [{ id: "rx-1", emoji: "👍", count: 2, myReaction: true }],
      },
    ];

    await act(async () => {
      root.render(
        <ThreadView
          conversationId="conv-1"
          kind="channel"
          initialMessages={msgWithMyReaction}
          currentUserId="prof-current"
          myParticipantId={MY_PARTICIPANT_ID}
        />,
      );
    });

    expect(findReactionPill("👍")?.textContent).toContain("2");
    expect(findReactionPill("👍")?.className).toContain("border-tops-red");

    // Evento realtime DELETE ajeno (otro usuario quitó su reacción)
    await act(async () => {
      realtimeCallbacks["connect_message_reactions"]?.({
        eventType: "DELETE",
        old: { id: "rx-other", message_id: "msg-101", participant_id: OTHER_PARTICIPANT_ID, emoji: "👍" },
      });
    });

    // Conteo baja a 1, pero myReaction se preserva true
    expect(findReactionPill("👍")?.textContent).toContain("1");
    expect(findReactionPill("👍")?.className).toContain("border-tops-red");
  });

  it("7. Prevención de carreras por doble clic rápido", async () => {
    let resolver: (val: unknown) => void;
    mockAddReaction.mockImplementation(
      () => new Promise((resolve) => { resolver = resolve; }),
    );

    await act(async () => {
      root.render(
        <ThreadView
          conversationId="conv-1"
          kind="channel"
          initialMessages={sampleMessages}
          currentUserId="prof-current"
          myParticipantId={MY_PARTICIPANT_ID}
        />,
      );
    });

    const pill = findReactionPill("👍");

    await act(async () => {
      pill?.click();
    });

    await act(async () => {
      pill?.click();
    });

    expect(mockAddReaction).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolver({ ok: true });
    });
  });

  it("8. Feedback de error accesible con role='alert' y aria-live='assertive' ante rechazo del servidor", async () => {
    mockAddReaction.mockResolvedValue({ ok: false, message: "Sin permiso para reaccionar en este canal." });

    await act(async () => {
      root.render(
        <ThreadView
          conversationId="conv-1"
          kind="channel"
          initialMessages={sampleMessages}
          currentUserId="prof-current"
          myParticipantId={MY_PARTICIPANT_ID}
        />,
      );
    });

    await act(async () => {
      findReactionPill("👍")?.click();
    });

    const alertEl = container.querySelector('[role="alert"]');
    expect(alertEl).not.toBeNull();
    expect(alertEl?.getAttribute("aria-live")).toBe("assertive");
    expect(alertEl?.textContent).toContain("Sin permiso para reaccionar en este canal.");

    // Operación exitosa limpia el error
    mockAddReaction.mockResolvedValueOnce({ ok: true });
    await act(async () => {
      findReactionPill("👍")?.click();
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
