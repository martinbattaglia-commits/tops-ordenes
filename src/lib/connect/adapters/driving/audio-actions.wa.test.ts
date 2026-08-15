/**
 * H2 · NEXUS LINK FASE B — cableado de `finalizeAudioMessageAction` hacia
 * WhatsApp. Mismo alcance que `attachment-actions.wa.test.ts`: sólo la
 * bisagra (cuándo se llama al adaptador y con qué), no el CAS ni el reenvasado
 * (ya cubiertos en `media-send-core.test.ts` y `opus-remux.test.ts`).
 *
 * También cubre H4 (hallazgo del C4 de esta rama): antes, el audio exigía
 * sólo `connect.view` + membresía, sin capacidad de canal — la asimetría con
 * los adjuntos. `assertPuedeGrabar` la cierra con el mismo criterio exacto de
 * `assertPuedeAdjuntar`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// firma WebM real (misma que audio/validate.test.ts), con padding suficiente.
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...new Array(16).fill(0)]);

const USER_ID = "99999999-9999-4999-8999-999999999999";
const CONV_WA = "11111111-1111-4111-8111-111111111111";
const CONV_DM = "22222222-2222-4222-8222-222222222222";
const MSG_ID = "33333333-3333-4333-8333-333333333333";
const ATT_ID = "44444444-4444-4444-8444-444444444444";

interface Conv { kind: string; context_id: string | null; archived_at: string | null }

function sesionFalsa(conv: Conv) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: (tabla: string) => {
      if (tabla === "connect_conversations") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => ({ maybeSingle: async () => ({ data: conv, error: null }) }),
              }),
            }),
          }),
        };
      }
      if (tabla === "connect_participants") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { id: "part-1" }, error: null }) }),
            }),
          }),
        };
      }
      throw new Error(`sesionFalsa: tabla no cableada: ${tabla}`);
    },
  };
}

function adminFalso() {
  return {
    storage: {
      from: () => ({
        download: async () => ({ data: { arrayBuffer: async () => WEBM.buffer }, error: null }),
        remove: async () => ({ data: null, error: null }),
      }),
    },
    from: (tabla: string) => {
      if (tabla === "connect_attachments") {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: ATT_ID }, error: null }) }) }),
          update: () => ({ eq: async () => ({ data: null, error: null }) }),
          delete: () => ({ eq: async () => ({ data: null, error: null }) }),
        };
      }
      if (tabla === "connect_messages") {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: MSG_ID }, error: null }) }) }),
        };
      }
      throw new Error(`adminFalso: tabla no cableada: ${tabla}`);
    },
  };
}

const createClient = vi.fn();
const createAdminClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
  createAdminClient: () => createAdminClient(),
}));

import type { MediaSendResult } from "@/lib/whatsapp/media-send";

const canAccess = vi.fn(async (_slug: string) => true);
vi.mock("@/lib/rbac/guard", () => ({ canAccess: (slug: string) => canAccess(slug) }));

const canChannel = vi.fn(async (_cap: string) => true);
vi.mock("@/lib/rbac/nexus-link", () => ({ canChannel: (cap: string) => canChannel(cap) }));

const sendWhatsappMediaForAttachment = vi.fn(
  async (_input: unknown): Promise<MediaSendResult> => ({ ok: true, state: "sent", wamid: "wamid.TEST" }),
);
vi.mock("@/lib/whatsapp/media-send", () => ({
  sendWhatsappMediaForAttachment: (input: unknown) => sendWhatsappMediaForAttachment(input),
}));

import { finalizeAudioMessageAction } from "./audio-actions";

const RAW = (conversationId: string) => ({
  conversationId, path: `${conversationId}/audio/x`, durationMs: 4200,
  clientMsgId: "55555555-5555-4555-8555-555555555555",
});

beforeEach(() => {
  vi.clearAllMocks();
  canAccess.mockResolvedValue(true);
  canChannel.mockResolvedValue(true);
  sendWhatsappMediaForAttachment.mockResolvedValue({ ok: true, state: "sent", wamid: "wamid.TEST" });
});

describe("H2/H4 · el audio exige capacidad de canal, igual que los adjuntos", () => {
  it("nota de voz en WhatsApp: exige nexus_link.whatsapp.media, no sólo connect.view", async () => {
    createClient.mockReturnValue(sesionFalsa({ kind: "whatsapp", context_id: "wa:+5491131079124", archived_at: null }));
    createAdminClient.mockReturnValue(adminFalso());
    await finalizeAudioMessageAction(RAW(CONV_WA));
    expect(canChannel).toHaveBeenCalledWith("nexus_link.whatsapp.media");
  });

  it("nota de voz interna: exige nexus_link.internal_chat.media", async () => {
    createClient.mockReturnValue(sesionFalsa({ kind: "dm", context_id: "CTX-2026-000001", archived_at: null }));
    createAdminClient.mockReturnValue(adminFalso());
    await finalizeAudioMessageAction(RAW(CONV_DM));
    expect(canChannel).toHaveBeenCalledWith("nexus_link.internal_chat.media");
  });

  it("sin la capacidad del canal, se deniega ANTES de tocar storage", async () => {
    canChannel.mockResolvedValue(false);
    createClient.mockReturnValue(sesionFalsa({ kind: "whatsapp", context_id: "wa:+5491131079124", archived_at: null }));
    const admin = adminFalso();
    createAdminClient.mockReturnValue(admin);
    const r = await finalizeAudioMessageAction(RAW(CONV_WA));
    expect(r.ok).toBe(false);
    expect(sendWhatsappMediaForAttachment).not.toHaveBeenCalled();
  });
});

describe("H2 · WhatsApp llama al adaptador con el nombre reenvasado; interno no llama", () => {
  it("hilo de WhatsApp: envía con to/bucket/path/mime y el nombre voz-Ns.ext", async () => {
    createClient.mockReturnValue(sesionFalsa({ kind: "whatsapp", context_id: "wa:+5491131079124", archived_at: null }));
    createAdminClient.mockReturnValue(adminFalso());
    const r = await finalizeAudioMessageAction(RAW(CONV_WA));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.whatsapp).toEqual({ state: "sent" });
    expect(sendWhatsappMediaForAttachment).toHaveBeenCalledWith({
      messageId: MSG_ID,
      to: "+5491131079124",
      bucket: "connect-files",
      path: `${CONV_WA}/audio/x`,
      mimeType: "audio/webm",
      fileName: "voz-4s.webm",
    });
  });

  it("hilo interno: nunca llama al adaptador", async () => {
    createClient.mockReturnValue(sesionFalsa({ kind: "dm", context_id: "CTX-2026-000001", archived_at: null }));
    createAdminClient.mockReturnValue(adminFalso());
    const r = await finalizeAudioMessageAction(RAW(CONV_DM));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.whatsapp).toBeUndefined();
    expect(sendWhatsappMediaForAttachment).not.toHaveBeenCalled();
  });

  it("sin teléfono resoluble en el contexto: falla ANTES del egress, sin excepción", async () => {
    createClient.mockReturnValue(sesionFalsa({ kind: "whatsapp", context_id: "CTX-mal-formado", archived_at: null }));
    createAdminClient.mockReturnValue(adminFalso());
    const r = await finalizeAudioMessageAction(RAW(CONV_WA));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.whatsapp?.state).toBe("failed");
    expect(sendWhatsappMediaForAttachment).not.toHaveBeenCalled();
  });
});
