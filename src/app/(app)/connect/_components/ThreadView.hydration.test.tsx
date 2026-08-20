/** @vitest-environment jsdom */

import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/lib/connect/types";

const realtimeHarness = vi.hoisted(() => ({
  handler: undefined as ((payload: unknown) => void) | undefined,
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => null }));
vi.mock("@/lib/supabase/realtime", () => ({
  useRealtimeTable: (_table: string, handler: (payload: unknown) => void) => {
    realtimeHarness.handler = handler;
  },
}));
vi.mock("@/components/voice/VoiceField", () => ({
  VoiceField: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/Icon", () => ({ Icon: () => <span aria-hidden="true" /> }));
vi.mock("@/lib/connect/adapters/driving/attachment-actions", () => ({
  prepareAttachmentUploadAction: vi.fn(async () => ({ ok: false, message: "no usado" })),
  finalizeAttachmentAction: vi.fn(async () => ({ ok: false, message: "no usado" })),
}));
vi.mock("@/lib/connect/adapters/driving/message-actions", () => ({
  postMessageAction: vi.fn(async () => ({
    ok: true,
    status: "sent",
    route: "connect",
    messageId: "synthetic-sent",
    seq: 99,
  })),
}));
vi.mock("@/lib/whatsapp/reply-action", () => ({
  sendWhatsappTextAction: vi.fn(async () => ({
    ok: true,
    status: "sent",
    route: "whatsapp",
    messageId: "synthetic-wa-sent",
  })),
}));
vi.mock("@/lib/connect/client-mark-read", () => ({
  markReadInBrowser: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/rbac/nexus-link", () => ({ canChannel: async () => true }));
vi.mock("@/lib/whatsapp/media-send", () => ({
  sendWhatsappMediaForAttachment: async () => ({
    ok: true,
    state: "sent",
    wamid: "wamid.SYNTHETIC",
  }),
}));

import { ThreadView } from "./ThreadView";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
const NAVIGATED_CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const BEFORE_MIDNIGHT_BA = "2026-08-15T02:59:59.999Z";
const AFTER_MIDNIGHT_BA = "2026-08-15T03:00:00.001Z";
const ORIGINAL_TZ = process.env.TZ;

function message(overrides: Partial<Message>): Message {
  return {
    id: "synthetic-text",
    conversationId: CONVERSATION_ID,
    seq: 1,
    authorParticipantId: null,
    authorProfileId: "synthetic-user",
    authorName: "Operador sintético",
    kind: "text",
    body: "mensaje sintético",
    bodyFormat: "markdown",
    replyToMessageId: null,
    editedAt: null,
    deletedAt: null,
    redacted: false,
    createdAt: "2026-08-15T02:58:00.000Z",
    ...overrides,
  };
}

const INITIAL_MESSAGES: Message[] = [
  message({}),
  message({
    id: "synthetic-audio",
    seq: 2,
    kind: "audio",
    body: null,
  }),
  message({
    id: "synthetic-file",
    seq: 3,
    kind: "file",
    body: "adjunto-sintetico.pdf",
  }),
];

function renderThread(
  initialNowIso: string,
  conversationId: string = CONVERSATION_ID,
  initialMessages: Message[] = INITIAL_MESSAGES,
) {
  return (
    <ThreadView
      conversationId={conversationId}
      kind="dm"
      initialMessages={initialMessages}
      currentUserId="synthetic-user"
      initialNowIso={initialNowIso}
    />
  );
}

describe("ThreadView hydration", () => {
  let consoleErrors: unknown[][];
  let restoreConsoleError: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    realtimeHarness.handler = undefined;
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    // Fail-closed: se captura TODO console.error, sin filtros ni allowlist.
    consoleErrors = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => { consoleErrors.push(args); };
    restoreConsoleError = () => { console.error = originalConsoleError; };
  });

  afterEach(() => {
    const capturedConsoleErrors = [...consoleErrors];
    restoreConsoleError();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    expect(capturedConsoleErrors).toEqual([]);
  });

  it("hydrates the real thread across runtime TZ and Buenos Aires midnight", async () => {
    const recoverableErrors: unknown[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | undefined;

    process.env.TZ = "UTC";
    vi.setSystemTime(new Date(BEFORE_MIDNIGHT_BA));
    const serverHtml = renderToString(renderThread(BEFORE_MIDNIGHT_BA));
    container.innerHTML = serverHtml;
    expect(container.textContent).toContain("Hoy");
    expect(container.textContent).toContain("23:58");

    process.env.TZ = "America/Argentina/Buenos_Aires";
    vi.setSystemTime(new Date(AFTER_MIDNIGHT_BA));
    const clientFirstRenderHtml = renderToString(renderThread(BEFORE_MIDNIGHT_BA));
    expect(clientFirstRenderHtml).toBe(serverHtml);

    await act(async () => {
      root = hydrateRoot(container, renderThread(BEFORE_MIDNIGHT_BA), {
        onRecoverableError: (error) => recoverableErrors.push(error),
      });
    });

    expect(recoverableErrors).toEqual([]);
    expect(recoverableErrors.map(String).join(" ")).not.toMatch(
      /Minified React error #(425|422)|hydration|server HTML/i,
    );
    expect(container.textContent).toContain("Ayer");
    expect(container.textContent).toContain("23:58");
    expect(container.textContent).toContain("adjunto-sintetico.pdf");
    expect(container.querySelector('button[title="Reproducir"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Posición del audio"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Adjuntar archivo"]')).not.toBeNull();

    await act(async () => {
      realtimeHarness.handler?.({
        eventType: "INSERT",
        new: {
          id: "synthetic-realtime",
          conversation_id: CONVERSATION_ID,
          seq: 4,
          author_profile_id: "synthetic-peer",
          kind: "text",
          body: "realtime sintético",
          body_format: "markdown",
          created_at: AFTER_MIDNIGHT_BA,
        },
      });
    });
    expect(container.textContent).toContain("realtime sintético");

    const navigatedMessages = [message({
      id: "synthetic-navigation",
      conversationId: NAVIGATED_CONVERSATION_ID,
      body: "navegación sintética",
    })];
    window.history.pushState({}, "", `/connect/c/${NAVIGATED_CONVERSATION_ID}`);
    await act(async () => root?.render(
      renderThread(BEFORE_MIDNIGHT_BA, NAVIGATED_CONVERSATION_ID, navigatedMessages),
    ));
    expect(window.location.pathname).toBe(`/connect/c/${NAVIGATED_CONVERSATION_ID}`);
    expect(container.textContent).toContain("navegación sintética");
    expect(container.textContent).not.toContain("realtime sintético");
    expect(recoverableErrors).toEqual([]);

    await act(async () => root?.unmount());

    const reloadContainer = document.createElement("div");
    document.body.appendChild(reloadContainer);
    process.env.TZ = "UTC";
    vi.setSystemTime(new Date(BEFORE_MIDNIGHT_BA));
    const reloadServerHtml = renderToString(
      renderThread(BEFORE_MIDNIGHT_BA, NAVIGATED_CONVERSATION_ID, navigatedMessages),
    );
    reloadContainer.innerHTML = reloadServerHtml;

    process.env.TZ = "America/Argentina/Buenos_Aires";
    vi.setSystemTime(new Date(AFTER_MIDNIGHT_BA));
    let reloadRoot: Root | undefined;
    await act(async () => {
      reloadRoot = hydrateRoot(
        reloadContainer,
        renderThread(BEFORE_MIDNIGHT_BA, NAVIGATED_CONVERSATION_ID, navigatedMessages),
        {
        onRecoverableError: (error) => recoverableErrors.push(error),
        },
      );
    });
    expect(recoverableErrors).toEqual([]);
    expect(reloadContainer.textContent).toContain("Ayer");
    expect(reloadContainer.textContent).toContain("navegación sintética");
    await act(async () => reloadRoot?.unmount());
  });
});
