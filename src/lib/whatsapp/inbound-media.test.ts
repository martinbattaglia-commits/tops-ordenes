// H-7 · el media entrante, medido contra las formas REALES de producción.

import { describe, it, expect } from "vitest";
import {
  extractInboundMedia, extractInboundCaption, inboundMediaBody, describeUnsupported,
} from "./inbound-media";

// Formas tomadas de `wa_inbound_events` en producción, no de la documentación.
const imagen = {
  id: "wamid.1", from: "5491100000000", timestamp: "1755000000", type: "image",
  image: { id: "media-img", mime_type: "image/jpeg", sha256: "abc", url: "https://cdn/x" },
};
const documento = {
  id: "wamid.2", type: "document",
  document: { id: "media-doc", mime_type: "application/pdf", sha256: "d", url: "https://cdn/y", filename: "remito.pdf" },
};
const audio = {
  id: "wamid.3", type: "audio",
  audio: { id: "media-aud", mime_type: "audio/ogg; codecs=opus", sha256: "e", url: "https://cdn/z", voice: true },
};

describe("H-7 · se reconocen las tres familias que llegaron de verdad", () => {
  it("imagen", () => {
    expect(extractInboundMedia(imagen)).toEqual({
      kind: "image", mediaId: "media-img", declaredMime: "image/jpeg", fileName: null, voice: false,
    });
  });

  it("documento, con su nombre propio", () => {
    expect(extractInboundMedia(documento)).toMatchObject({
      kind: "document", mediaId: "media-doc", fileName: "remito.pdf",
    });
  });

  it("audio, distinguiendo la nota de voz", () => {
    expect(extractInboundMedia(audio)).toMatchObject({
      kind: "audio", mediaId: "media-aud", voice: true,
    });
  });

  it("la URL del CDN de Meta NO se propaga: se resuelve el id contra la Graph API", () => {
    const m = extractInboundMedia(imagen)!;
    expect(JSON.stringify(m)).not.toContain("cdn");
    expect(JSON.stringify(m)).not.toContain("url");
  });
});

describe("H-7 · lo que no se puede ingresar se NOMBRA, no se cuenta en silencio", () => {
  it("un texto no es media y no se reporta como no soportado", () => {
    expect(extractInboundMedia({ type: "text", text: { body: "hola" } })).toBeNull();
    expect(describeUnsupported({ type: "text" })).toBeNull();
  });

  it.each(["video", "sticker", "location", "reaction"])("%s se nombra", (tipo) => {
    expect(extractInboundMedia({ type: tipo, [tipo]: { id: "x" } })).toBeNull();
    expect(describeUnsupported({ type: tipo })).toBe(tipo);
  });

  it("basura no explota", () => {
    expect(extractInboundMedia(null)).toBeNull();
    expect(extractInboundMedia({ type: "image" })).toBeNull();
    expect(extractInboundMedia({ type: "image", image: {} })).toBeNull();
  });
});

describe("H-7 · el mensaje nunca queda vacío en el hilo", () => {
  it("con pie de foto, manda el pie", () => {
    const conPie = { ...imagen, image: { ...imagen.image, caption: "el remito firmado" } };
    expect(extractInboundCaption(conPie)).toBe("el remito firmado");
    expect(inboundMediaBody(extractInboundMedia(conPie)!, "el remito firmado")).toBe("el remito firmado");
  });

  it("sin pie, dice QUÉ llegó — nunca una burbuja muda", () => {
    expect(inboundMediaBody(extractInboundMedia(imagen)!, null)).toBe("📷 Foto");
    expect(inboundMediaBody(extractInboundMedia(audio)!, null)).toBe("🎙️ Mensaje de voz");
    expect(inboundMediaBody(extractInboundMedia(documento)!, null)).toBe("📎 remito.pdf");
  });

  it("un audio que no es nota de voz se distingue del que sí", () => {
    const archivo = { ...audio, audio: { ...audio.audio, voice: false } };
    expect(inboundMediaBody(extractInboundMedia(archivo)!, null)).toBe("🎵 Audio");
  });

  it("un documento sin nombre igual se anuncia", () => {
    const sinNombre = { type: "document", document: { id: "m", mime_type: "application/pdf" } };
    expect(inboundMediaBody(extractInboundMedia(sinNombre)!, null)).toBe("📎 Documento");
  });
});
