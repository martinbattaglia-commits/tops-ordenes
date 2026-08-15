/**
 * H2 · NEXUS LINK FASE B — cableado de `finalizeAttachmentAction` hacia
 * WhatsApp: la DECISIÓN de cuándo llamar al adaptador productivo
 * (`sendWhatsappMediaForAttachment`) y con qué argumentos exactos.
 *
 * No repite lo que ya está probado en otro nivel:
 *   · el CAS, el orden reclamar→leer→remuxar→revisar→subir→enviar y el
 *     tratamiento de `failed`/`reconciliation_required` → `media-send-core.test.ts`;
 *   · que la costura reutilice el mismo `state` que el texto y arme el
 *     transporte real → `media-send.runtime.test.ts`;
 *   · la firma binaria, límites y nombres → `validate.test.ts`;
 *   · el resto del flujo de adjuntos (idempotencia del mensaje, limpieza de
 *     huérfanos, conflictos de unicidad) → `AttachmentComposer.dom.test.tsx`.
 *
 * Lo que se prueba ACÁ es sólo la bisagra: WhatsApp llama, interno no llama,
 * un archivo rechazado nunca llega a Meta, un teléfono inválido falla ANTES
 * de intentar el egress, y el camino de adopción por carrera (retry) también
 * lo intenta.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// bytes JPEG reales (misma firma que validate.test.ts) — la validación es
// real, no se mockea: es la propiedad "archivo rechazado nunca sale" la que
// hay que demostrar con datos que la firma real rechazaría.
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(16).fill(0)]);
const ELF = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, ...new Array(16).fill(0)]); // ejecutable, rechazado

const USER_ID = "99999999-9999-4999-8999-999999999999";
const CONV_WA = "11111111-1111-4111-8111-111111111111";
const CONV_DM = "22222222-2222-4222-8222-222222222222";
const MSG_ID = "33333333-3333-4333-8333-333333333333";
const ATT_ID = "44444444-4444-4444-8444-444444444444";

interface Escenario {
  conv: { kind: string; context_id: string | null; archived_at: string | null };
  yaLigado?: { id: string; message_id: string | null } | null;
}

/** Cliente de SESIÓN mínimo: sólo lo que assertPuedeAdjuntar/obtenerOCrearMensaje tocan. */
function sesionFalsa(esc: Escenario) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: (tabla: string) => {
      if (tabla === "connect_conversations") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: esc.conv, error: null }),
                }),
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
      throw new Error(`sesionFalsa: tabla no cableada en el test: ${tabla}`);
    },
    rpc: async (nombre: string) => {
      if (nombre === "connect_upload_claim_finalize") return { data: "claimed", error: null };
      throw new Error(`sesionFalsa.rpc: no cableado: ${nombre}`);
    },
  };
}

/** Cliente ADMIN mínimo: storage + inserts/updates que finalize necesita. */
function adminFalso(esc: Escenario, bytes: Uint8Array = JPG) {
  const attInsert = {
    select: () => ({
      single: async () => {
        if (esc.yaLigado !== undefined) {
          return { data: null, error: { message: "duplicate key value violates unique constraint" } };
        }
        return { data: { id: ATT_ID }, error: null };
      },
    }),
  };
  // connect_messages: `obtenerOCrearMensaje` primero LEE (por si otro adjunto
  // del mismo lote ya creó el mensaje) y sólo si no está, inserta.
  const mensajesTabla = {
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      }),
    }),
    insert: () => ({
      select: () => ({ single: async () => ({ data: { id: MSG_ID }, error: null }) }),
    }),
  };
  return {
    storage: {
      from: () => ({
        download: async () => ({
          data: { arrayBuffer: async () => bytes.buffer },
          error: null,
        }),
        remove: async () => ({ data: null, error: null }),
      }),
    },
    from: (tabla: string) => {
      if (tabla === "connect_attachments") {
        return {
          insert: () => attInsert,
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: esc.yaLigado ?? null, error: null }),
              }),
            }),
          }),
          update: () => ({ eq: () => ({ is: async () => ({ data: null, error: null }) }) }),
          delete: () => ({ eq: async () => ({ data: null, error: null }) }),
        };
      }
      if (tabla === "connect_messages") return mensajesTabla;
      throw new Error(`adminFalso: tabla no cableada en el test: ${tabla}`);
    },
  };
}

const createClient = vi.fn();
const createAdminClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
  createAdminClient: () => createAdminClient(),
}));

const canAccess = vi.fn(async (_slug: string) => true);
vi.mock("@/lib/rbac/guard", () => ({ canAccess: (slug: string) => canAccess(slug) }));

const canChannel = vi.fn(async (_cap: string) => true);
vi.mock("@/lib/rbac/nexus-link", () => ({ canChannel: (cap: string) => canChannel(cap) }));

import type { MediaSendResult } from "@/lib/whatsapp/media-send";

const sendWhatsappMediaForAttachment = vi.fn(
  async (_input: unknown): Promise<MediaSendResult> => ({ ok: true, state: "sent", wamid: "wamid.TEST" }),
);
vi.mock("@/lib/whatsapp/media-send", () => ({
  sendWhatsappMediaForAttachment: (input: unknown) => sendWhatsappMediaForAttachment(input),
}));

import { finalizeAttachmentAction } from "./attachment-actions";

const RAW = (conversationId: string) => ({
  conversationId, path: `${conversationId}/files/x`, fileName: "remito.jpg",
  clientMsgId: "55555555-5555-4555-8555-555555555555",
});

beforeEach(() => {
  vi.clearAllMocks();
  canAccess.mockResolvedValue(true);
  canChannel.mockResolvedValue(true);
  sendWhatsappMediaForAttachment.mockResolvedValue({ ok: true, state: "sent", wamid: "wamid.TEST" });
});

function montar(esc: Escenario) {
  createClient.mockReturnValue(sesionFalsa(esc));
  createAdminClient.mockReturnValue(adminFalso(esc));
}

describe("H2 · WhatsApp llama al adaptador; interno no", () => {
  it("hilo de WhatsApp con archivo válido: envía con to/bucket/path/mime/fileName correctos", async () => {
    montar({ conv: { kind: "whatsapp", context_id: "wa:+5491131079124", archived_at: null } });
    const r = await finalizeAttachmentAction(RAW(CONV_WA));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.whatsapp).toEqual({ state: "sent" });
    expect(sendWhatsappMediaForAttachment).toHaveBeenCalledTimes(1);
    expect(sendWhatsappMediaForAttachment).toHaveBeenCalledWith({
      messageId: MSG_ID,
      to: "+5491131079124",
      bucket: "connect-files",
      path: `${CONV_WA}/files/x`,
      mimeType: "image/jpeg",
      fileName: "remito.jpg",
    });
  });

  it("hilo interno: NUNCA llama al adaptador, y `whatsapp` no viaja en la respuesta", async () => {
    montar({ conv: { kind: "dm", context_id: "CTX-2026-000001", archived_at: null } });
    const r = await finalizeAttachmentAction(RAW(CONV_DM));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.whatsapp).toBeUndefined();
    expect(sendWhatsappMediaForAttachment).not.toHaveBeenCalled();
  });
});

describe("H2 · un archivo rechazado nunca llega a Meta", () => {
  it("firma binaria de ejecutable: falla la validación y el adaptador no se toca", async () => {
    const esc: Escenario = { conv: { kind: "whatsapp", context_id: "wa:+5491131079124", archived_at: null } };
    createClient.mockReturnValue(sesionFalsa(esc));
    createAdminClient.mockReturnValue(adminFalso(esc, ELF));

    const r = await finalizeAttachmentAction(RAW(CONV_WA));
    expect(r.ok).toBe(false);
    expect(sendWhatsappMediaForAttachment).not.toHaveBeenCalled();
  });
});

describe("H2 · sin teléfono resoluble, falla ANTES del egress", () => {
  it("context_id sin la forma wa:+E164: whatsapp.state='failed', sin llamar al adaptador", async () => {
    montar({ conv: { kind: "whatsapp", context_id: "CTX-mal-formado", archived_at: null } });
    const r = await finalizeAttachmentAction(RAW(CONV_WA));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.whatsapp?.state).toBe("failed");
      expect(r.whatsapp?.message).toMatch(/teléfono/);
    }
    expect(sendWhatsappMediaForAttachment).not.toHaveBeenCalled();
  });

  it("context_id nulo: mismo resultado, sin excepción", async () => {
    montar({ conv: { kind: "whatsapp", context_id: null, archived_at: null } });
    const r = await finalizeAttachmentAction(RAW(CONV_WA));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.whatsapp?.state).toBe("failed");
    expect(sendWhatsappMediaForAttachment).not.toHaveBeenCalled();
  });
});

describe("H2 · reintento (adopción por carrera) también intenta el envío", () => {
  it("client_msg_id repetido, adjunto YA ligado: igual invoca al adaptador (el CAS decide si reenvía)", async () => {
    montar({
      conv: { kind: "whatsapp", context_id: "wa:+5491131079124", archived_at: null },
      yaLigado: { id: ATT_ID, message_id: MSG_ID },
    });
    const r = await finalizeAttachmentAction(RAW(CONV_WA));
    expect(r.ok).toBe(true);
    // Esta rama devuelve el messageId YA ligado, no uno nuevo.
    if (r.ok) expect(r.messageId).toBe(MSG_ID);
    expect(sendWhatsappMediaForAttachment).toHaveBeenCalledTimes(1);
    expect(sendWhatsappMediaForAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: MSG_ID, to: "+5491131079124" }),
    );
  });

  it("la misma adopción en chat interno NO invoca al adaptador", async () => {
    montar({
      conv: { kind: "dm", context_id: "CTX-2026-000001", archived_at: null },
      yaLigado: { id: ATT_ID, message_id: MSG_ID },
    });
    await finalizeAttachmentAction(RAW(CONV_DM));
    expect(sendWhatsappMediaForAttachment).not.toHaveBeenCalled();
  });
});

describe("H2 · el desenlace de Meta se refleja tal cual, nunca como éxito ficticio", () => {
  it("si el adaptador devuelve failed, la respuesta lo propaga sin reinterpretarlo", async () => {
    sendWhatsappMediaForAttachment.mockResolvedValue({ ok: false, state: "failed", message: "not_configured" });
    montar({ conv: { kind: "whatsapp", context_id: "wa:+5491131079124", archived_at: null } });
    const r = await finalizeAttachmentAction(RAW(CONV_WA));
    expect(r.ok).toBe(true); // el adjunto SÍ quedó en Connect
    if (r.ok) expect(r.whatsapp).toEqual({ state: "failed", message: "not_configured" });
  });

  it("si el adaptador devuelve reconciliation_required, no se disfraza de sent", async () => {
    sendWhatsappMediaForAttachment.mockResolvedValue({
      ok: false, state: "reconciliation_required", message: "No se sabe si Meta lo aceptó.",
    });
    montar({ conv: { kind: "whatsapp", context_id: "wa:+5491131079124", archived_at: null } });
    const r = await finalizeAttachmentAction(RAW(CONV_WA));
    if (r.ok) expect(r.whatsapp?.state).toBe("reconciliation_required");
  });
});
