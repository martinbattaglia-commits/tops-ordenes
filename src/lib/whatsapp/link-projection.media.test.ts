// H-7 · el media entrante LLEGA al hilo. Fakes en memoria: sin red, sin DB.
//
// Lo que estas pruebas fijan es la consecuencia medida en producción: entre el
// 13 y el 18 de agosto de 2026 llegaron 6 documentos, 5 imágenes y 3 audios de
// clientes y Nexus los descartó contra un contador que no se persistía. Acá el
// adjunto tiene que quedar guardado y ligado a su mensaje.

import { describe, it, expect, vi } from "vitest";
import { projectInbound, isProjectionComplete, type LinkProjectionPort } from "./link-projection";
import type { WaInboundMessage } from "./inbound";

const CONV = { id: "conv-1", archivedAt: null };

function puerto(over: Partial<LinkProjectionPort> = {}) {
  const ingest = vi.fn(async () => "stored" as const);
  const port: LinkProjectionPort = {
    findConversationByContext: async () => CONV,
    createConversation: async () => CONV,
    unarchiveConversation: async () => {},
    listParticipants: async () => [{ id: "p-ext", profileId: null, phone: "+5491100000000" }],
    addStaffParticipant: async () => {},
    addWhatsappParticipant: async () => "p-ext",
    insertMessage: async () => "inserted",
    resolveEligibleOperators: async () => [],
    applyOutboundStatus: async () => "applied",
    ingestInboundMedia: ingest,
    ...over,
  };
  return { port, ingest };
}

const mensaje = (over: Partial<WaInboundMessage> = {}): WaInboundMessage => ({
  wamid: "wamid.A",
  fromE164: "+5491100000000",
  text: "📷 Foto",
  sentAt: "2026-08-18T12:00:00.000Z",
  profileName: null,
  media: { kind: "image", mediaId: "media-1", declaredMime: "image/jpeg", fileName: null, voice: false },
  ...over,
});

const entrada = (msgs: WaInboundMessage[]) => ({
  phoneNumberId: "pn-1", messages: msgs, statuses: [],
});

describe("H-7 · el adjunto entrante se guarda", () => {
  it("una foto del cliente pasa por el ingreso, con su conversación y su wamid", async () => {
    const { port, ingest } = puerto();
    const r = await projectInbound(entrada([mensaje()]), port, []);

    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest).toHaveBeenCalledWith({
      conversationId: "conv-1",
      externalMsgId: "wamid.A",
      media: expect.objectContaining({ kind: "image", mediaId: "media-1" }),
    });
    expect(r.mediaStored).toBe(1);
    expect(r.errors).toEqual([]);
  });

  it("un texto NO llama al ingreso", async () => {
    const { port, ingest } = puerto();
    await projectInbound(entrada([mensaje({ media: null, text: "hola" })]), port, []);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("si el mensaje ya existía, el adjunto SE INTENTA IGUAL", async () => {
    // Un intento anterior pudo insertar la fila y morir antes de bajar el
    // binario. Saltear el ingreso ahí perdería el archivo para siempre.
    const { port, ingest } = puerto({ insertMessage: async () => "duplicate" });
    await projectInbound(entrada([mensaje()]), port, []);
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("un adjunto ya guardado no se cuenta dos veces", async () => {
    const { port } = puerto({ ingestInboundMedia: async () => "duplicate" });
    const r = await projectInbound(entrada([mensaje()]), port, []);
    expect(r.mediaStored).toBe(0);
    expect(r.errors).toEqual([]);
  });
});

describe("H-7 · el archivo no se pierde en silencio NUNCA", () => {
  it("un puerto sin ingreso de media deja el evento incompleto, no lo traga", async () => {
    const { port } = puerto({ ingestInboundMedia: undefined });
    const r = await projectInbound(entrada([mensaje()]), port, []);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toMatch(/no ingresa adjuntos/);
  });

  it("si la descarga falla, el error queda registrado y el evento reprocesable", async () => {
    const { port } = puerto({
      ingestInboundMedia: async () => { throw new Error("media wamid.A: descarga http_error"); },
    });
    const r = await projectInbound(entrada([mensaje()]), port, []);
    expect(r.errors.length).toBe(1);
    expect(r.mediaStored).toBe(0);
  });

  it("el error NO lleva el teléfono ni el texto del cliente", async () => {
    const { port } = puerto({
      ingestInboundMedia: async () => { throw new Error("media wamid.A: descarga http_error"); },
    });
    const r = await projectInbound(
      entrada([mensaje({ text: "dato-privado-del-cliente" })]), port, [],
    );
    const todo = r.errors.join(" | ");
    expect(todo).not.toContain("dato-privado-del-cliente");
    expect(todo).not.toContain("+5491100000000");
  });
});

describe("C4/HIGH-1 · un formato no soportado NO deja el evento incompleto", () => {
  it("se cuenta aparte y `errors` queda vacío: el evento se marca procesado", async () => {
    const { port } = puerto({ ingestInboundMedia: async () => "unsupported" });
    const r = await projectInbound(entrada([mensaje()]), port, []);
    expect(r.mediaUnsupported).toBe(1);
    expect(r.mediaStored).toBe(0);
    // La condición que evita el bucle de reproceso contra la Graph API.
    expect(r.errors).toEqual([]);
    expect(isProjectionComplete(r)).toBe(true);
  });
});
