/**
 * @vitest-environment jsdom
 *
 * Test DOM para Reacciones con Emojis (P3), Citas/Respuestas (P3) y Avatares (P2) en ThreadView.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Message } from "@/lib/connect/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = vi.fn();

vi.mock("@/lib/supabase/client", () => ({ createClient: () => null }));
vi.mock("@/lib/supabase/realtime", () => ({ useRealtimeTable: () => {} }));
vi.mock("@/components/voice/VoiceField", () => ({
  VoiceField: (p: { children?: unknown }) => <div>{p.children as never}</div>,
}));
vi.mock("@/components/Icon", () => ({ Icon: () => <span /> }));
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
  setHandoverStateAction: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("@/lib/connect/adapters/driving/audio-actions", () => ({
  prepareAudioUploadAction: vi.fn(),
  finalizeAudioMessageAction: vi.fn(),
}));

const addReactionAction = vi.fn(async () => ({ ok: true as const }));
const removeReactionAction = vi.fn(async () => ({ ok: true as const }));
vi.mock("@/lib/connect/adapters/driving/reaction-actions", () => ({
  SUPPORTED_EMOJIS: ["👍", "❤️", "😂", "😮", "😢", "🙏"],
  addReactionAction: (...a: unknown[]) => addReactionAction(...(a as [])),
  removeReactionAction: (...a: unknown[]) => removeReactionAction(...(a as [])),
}));

const postMessageAction = vi.fn(async () => ({ ok: true as const, messageId: "srv-msg-1", seq: 2 }));
vi.mock("@/lib/connect/adapters/driving/message-actions", () => ({
  postMessageAction: (...a: unknown[]) => postMessageAction(...(a as [])),
}));

import { ThreadView } from "./ThreadView";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

const CONV_ID = "11111111-1111-4111-8111-111111111111";
const MSG_1: Message = {
  id: "msg-1",
  conversationId: CONV_ID,
  seq: 1,
  authorParticipantId: "part-1",
  authorProfileId: "user-author",
  authorName: "Martín Battaglia",
  authorAvatarUrl: "https://ejemplo.com/avatar.jpg",
  kind: "text",
  body: "Hola equipo, tenemos novedades.",
  bodyFormat: "markdown",
  replyToMessageId: null,
  editedAt: null,
  deletedAt: null,
  redacted: false,
  createdAt: "2026-08-20T12:00:00.000Z",
  reactions: [
    { id: "rx-1", emoji: "👍", count: 2, myReaction: false },
    { id: "rx-2", emoji: "❤️", count: 1, myReaction: true },
  ],
};

function montar(props: { initialMessages?: Message[]; currentUserId?: string }) {
  act(() => {
    root.render(
      <ThreadView
        conversationId={CONV_ID}
        kind="dm"
        initialMessages={props.initialMessages ?? [MSG_1]}
        currentUserId={props.currentUserId ?? "my-user-id"}
      />,
    );
  });
}

describe("P2 & P3 · ThreadView UI (Avatares, Reacciones y Citas)", () => {
  it("renderiza el avatar del autor o iniciales", () => {
    montar({});
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://ejemplo.com/avatar.jpg");
    expect(container.textContent).toContain("Martín Battaglia");
  });

  it("renderiza las píldoras de reacciones existentes con sus conteos", () => {
    montar({});
    expect(container.textContent).toContain("👍");
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("❤️");
    expect(container.textContent).toContain("1");
  });

  it("permite agregar una reacción haciendo clic en la barra de emojis", async () => {
    montar({});
    const emojiButtons = [...container.querySelectorAll("button")].filter(
      (b) => b.getAttribute("title")?.startsWith("Reaccionar con"),
    );
    expect(emojiButtons.length).toBe(6); // 👍 ❤️ 😂 😮 😢 🙏

    const laughBtn = emojiButtons.find((b) => b.getAttribute("title") === "Reaccionar con 😂")!;
    await act(async () => {
      laughBtn.click();
    });

    expect(addReactionAction).toHaveBeenCalledWith({
      conversationId: CONV_ID,
      messageId: "msg-1",
      emoji: "😂",
    });
    expect(container.textContent).toContain("😂");
  });

  it("permite alternar/quitar una reacción propia al hacer clic en su píldora activa", async () => {
    montar({});
    const pills = [...container.querySelectorAll("button")].filter(
      (b) => b.getAttribute("title") === "Quitar mi reacción",
    );
    expect(pills.length).toBe(1); // ❤️ tenía myReaction: true

    await act(async () => {
      pills[0].click();
    });

    expect(removeReactionAction).toHaveBeenCalledWith({
      conversationId: CONV_ID,
      messageId: "msg-1",
      emoji: "❤️",
    });
  });

  it("al hacer clic en Responder, activa el banner de respuesta en el composer", async () => {
    montar({});
    const replyBtn = container.querySelector('button[title="Responder a este mensaje"]') as HTMLButtonElement;
    expect(replyBtn).not.toBeNull();

    await act(async () => {
      replyBtn.click();
    });

    expect(container.textContent).toContain("Respondiendo a Martín Battaglia");
    expect(container.textContent).toContain("Hola equipo, tenemos novedades.");
  });

  it("permite cancelar el modo de respuesta con el botón de cierre", async () => {
    montar({});
    const replyBtn = container.querySelector('button[title="Responder a este mensaje"]') as HTMLButtonElement;
    await act(async () => {
      replyBtn.click();
    });
    expect(container.textContent).toContain("Respondiendo a Martín Battaglia");

    const cancelBtn = container.querySelector('button[title="Cancelar respuesta"]') as HTMLButtonElement;
    await act(async () => {
      cancelBtn.click();
    });
    expect(container.textContent).not.toContain("Respondiendo a Martín Battaglia");
  });

  it("renderiza la tarjeta del mensaje citado en mensajes que tienen replyToMessageId", () => {
    const msgWithReply: Message = {
      id: "msg-2",
      conversationId: CONV_ID,
      seq: 2,
      authorParticipantId: "part-2",
      authorProfileId: "my-user-id",
      authorName: "Operador",
      kind: "text",
      body: "Totalmente de acuerdo.",
      bodyFormat: "markdown",
      replyToMessageId: "msg-1",
      replyToMessage: {
        id: "msg-1",
        authorName: "Martín Battaglia",
        body: "Hola equipo, tenemos novedades.",
      },
      editedAt: null,
      deletedAt: null,
      redacted: false,
      createdAt: "2026-08-20T12:05:00.000Z",
    };

    montar({ initialMessages: [MSG_1, msgWithReply] });
    expect(container.textContent).toContain("Totalmente de acuerdo.");
    expect(container.textContent).toContain("Martín Battaglia");
  });
});
