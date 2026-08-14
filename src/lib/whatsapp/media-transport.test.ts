/**
 * NEXUS LINK · FASE B — transporte de media hacia Meta.
 *
 * Ninguna prueba toca la red: el `fetch` es inyectado. Lo que se demuestra es
 * el CONTRATO, que es donde se pierde plata:
 *
 *   · la subida es binaria y reintentable —nadie recibió nada—;
 *   · el envío conserva los tres estados, porque un resultado incierto pudo
 *     llegarle al cliente y reintentarlo duplicaría;
 *   · el formato se decide ANTES de subir el binario, con un motivo concreto;
 *   · el token nunca aparece en un resultado.
 */

import { describe, it, expect, vi } from "vitest";
import {
  WHATSAPP_MEDIA_MAX_BYTES, checkWhatsappMedia, createMetaMediaTransport,
  extractMediaId, whatsappKindForMime,
} from "./media-transport";

const TOKEN = "token-de-meta-que-no-debe-filtrarse";
const CFG = { token: TOKEN, phoneNumberId: "5551234", graphBase: "https://graph.test/v22.0" };

const respuesta = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

const bytes = (n = 64) => new Uint8Array(n).fill(7);

// ═══════════════════ política de formato ═══════════════════

describe("qué acepta WhatsApp y qué no", () => {
  it("reconoce las tres familias", () => {
    expect(whatsappKindForMime("image/jpeg")).toBe("image");
    expect(whatsappKindForMime("application/pdf")).toBe("document");
    expect(whatsappKindForMime("audio/ogg")).toBe("audio");
    expect(whatsappKindForMime("audio/mp4")).toBe("audio");
  });

  it("tolera parámetros en el MIME", () => {
    expect(whatsappKindForMime("audio/ogg; codecs=opus")).toBe("audio");
    expect(whatsappKindForMime("IMAGE/JPEG")).toBe("image");
  });

  it("HALLAZGO · audio/webm NO es enviable, y el motivo se dice", () => {
    // Es el formato que el grabador elige en Chrome/Android. Si esto pasara,
    // el rechazo llegaría de Meta, opaco y después de subir el binario entero.
    expect(whatsappKindForMime("audio/webm")).toBeNull();
    const r = checkWhatsappMedia("audio/webm", 1024);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("unsupported_format");
      expect(r.detail).toMatch(/WebM/);
    }
  });

  it("las imágenes que WhatsApp no muestra dicen a qué convertirlas", () => {
    for (const m of ["image/webp", "image/gif", "image/heic", "image/heif"]) {
      const r = checkWhatsappMedia(m, 1024);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.detail).toMatch(/JPEG o PNG/);
    }
  });

  it("aplica el tope de cada familia", () => {
    expect(checkWhatsappMedia("image/jpeg", WHATSAPP_MEDIA_MAX_BYTES.image + 1).ok).toBe(false);
    expect(checkWhatsappMedia("image/jpeg", WHATSAPP_MEDIA_MAX_BYTES.image).ok).toBe(true);
    const r = checkWhatsappMedia("audio/mp4", WHATSAPP_MEDIA_MAX_BYTES.audio + 1);
    if (!r.ok) expect(r.reason).toBe("too_large");
  });

  it("extractMediaId exige un id real", () => {
    expect(extractMediaId({ id: "  abc  " })).toBe("abc");
    expect(extractMediaId({ id: "" })).toBeNull();
    expect(extractMediaId({})).toBeNull();
    expect(extractMediaId(null)).toBeNull();
    expect(extractMediaId("texto")).toBeNull();
  });
});

// ═══════════════════ subida ═══════════════════

describe("uploadMedia · binaria y reintentable", () => {
  it("sube por multipart al endpoint /media y devuelve el media_id", async () => {
    const fetchImpl = vi.fn(async () => respuesta(200, { id: "media-123" }));
    const t = createMetaMediaTransport({ ...CFG, fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await t.uploadMedia({ bytes: bytes(), mimeType: "image/jpeg", fileName: "foto.jpg" });
    expect(r).toEqual({ kind: "uploaded", mediaId: "media-123" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.test/v22.0/5551234/media");
    expect(init.body).toBeInstanceOf(FormData);
    const forma = init.body as FormData;
    expect(forma.get("messaging_product")).toBe("whatsapp");
    expect(forma.get("type")).toBe("image/jpeg");
    // El Content-Type lo pone fetch con su boundary: fijarlo a mano lo rompe.
    expect(Object.keys(init.headers as object)).toEqual(["Authorization"]);
  });

  it("un formato inadmisible NO llega a la red", async () => {
    const fetchImpl = vi.fn();
    const t = createMetaMediaTransport({ ...CFG, fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await t.uploadMedia({ bytes: bytes(), mimeType: "audio/webm", fileName: "voz.webm" });
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.reason).toBe("unsupported_format");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sin credenciales falla antes de intentar nada", async () => {
    const fetchImpl = vi.fn();
    const t = createMetaMediaTransport({
      token: undefined, phoneNumberId: undefined, fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const r = await t.uploadMedia({ bytes: bytes(), mimeType: "image/jpeg", fileName: "f.jpg" });
    if (r.kind === "failed") expect(r.reason).toBe("not_configured");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["4xx", 400, "http_error"],
    ["5xx", 503, "http_error"],
  ])("%s de Meta ⇒ fallo simple, seguro de reintentar", async (_l, status, reason) => {
    const t = createMetaMediaTransport({
      ...CFG, fetchImpl: (async () => respuesta(status, { error: {} })) as unknown as typeof fetch,
    });
    const r = await t.uploadMedia({ bytes: bytes(), mimeType: "image/jpeg", fileName: "f.jpg" });
    // A diferencia del ENVÍO, acá un 5xx no es ambiguo: no hay mensaje en vuelo,
    // como mucho un media_id colgado que caduca solo.
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.reason).toBe(reason);
  });

  it("un 2xx sin id es respuesta inválida, no un éxito silencioso", async () => {
    const t = createMetaMediaTransport({
      ...CFG, fetchImpl: (async () => respuesta(200, { ok: true })) as unknown as typeof fetch,
    });
    const r = await t.uploadMedia({ bytes: bytes(), mimeType: "image/jpeg", fileName: "f.jpg" });
    if (r.kind === "failed") expect(r.reason).toBe("invalid_response");
  });

  it("timeout y red se distinguen", async () => {
    const abortar = async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); };
    const caer = async () => { throw new Error("ECONNRESET"); };
    for (const [impl, reason] of [[abortar, "timeout"], [caer, "network"]] as const) {
      const t = createMetaMediaTransport({ ...CFG, fetchImpl: impl as unknown as typeof fetch });
      const r = await t.uploadMedia({ bytes: bytes(), mimeType: "image/jpeg", fileName: "f.jpg" });
      if (r.kind === "failed") expect(r.reason).toBe(reason);
    }
  });
});

// ═══════════════════ envío ═══════════════════

describe("sendMedia · conserva los tres estados del contrato", () => {
  const enviar = async (
    resp: () => Promise<Response>,
    input: Parameters<ReturnType<typeof createMetaMediaTransport>["sendMedia"]>[0],
  ) => createMetaMediaTransport({ ...CFG, fetchImpl: resp as unknown as typeof fetch })
    .sendMedia(input);

  it("2xx con wamid ⇒ accepted", async () => {
    const r = await enviar(async () => respuesta(200, { messages: [{ id: "wamid.AA" }] }),
      { to: "5491131079124", kind: "image", mediaId: "m1", caption: "Remito" });
    expect(r).toEqual({ kind: "accepted", wamid: "wamid.AA" });
  });

  it("arma el cuerpo con el media_id, nunca con un link", async () => {
    const fetchImpl = vi.fn(async () => respuesta(200, { messages: [{ id: "w" }] }));
    await createMetaMediaTransport({ ...CFG, fetchImpl: fetchImpl as unknown as typeof fetch })
      .sendMedia({ to: "+54 9 11 3107-9124", kind: "document", mediaId: "m9", fileName: "remito.pdf", caption: "Hoy" });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({
      messaging_product: "whatsapp",
      to: "5491131079124",           // normalizado a dígitos
      type: "document",
      document: { id: "m9", caption: "Hoy", filename: "remito.pdf" },
    });
    expect(JSON.stringify(body)).not.toContain("http");
  });

  it("el AUDIO no lleva pie: Meta lo descartaría en silencio", async () => {
    const fetchImpl = vi.fn(async () => respuesta(200, { messages: [{ id: "w" }] }));
    await createMetaMediaTransport({ ...CFG, fetchImpl: fetchImpl as unknown as typeof fetch })
      .sendMedia({ to: "5491131079124", kind: "audio", mediaId: "m2", caption: "escuchá esto" });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.audio).toEqual({ id: "m2" });
    // Si viajara, el operador creería haber escrito algo que el cliente no vio.
    expect(JSON.stringify(body)).not.toContain("escuchá esto");
  });

  it.each([
    ["408", 408], ["500", 500], ["502", 502], ["503", 503],
  ])("%s ⇒ AMBIGUO: el mensaje pudo salir, jamás se reintenta solo", async (_l, status) => {
    const r = await enviar(async () => respuesta(status, { error: {} }),
      { to: "5491131079124", kind: "image", mediaId: "m1" });
    expect(r.kind).toBe("ambiguous");
  });

  it("un 4xx inequívoco ⇒ rejected", async () => {
    const r = await enviar(async () => respuesta(400, { error: {} }),
      { to: "5491131079124", kind: "image", mediaId: "m1" });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.status).toBe(400);
  });

  it("2xx sin wamid ⇒ AMBIGUO, no rechazo: devolverlo rechazado invitaría a duplicar", async () => {
    const r = await enviar(async () => respuesta(200, { messages: [] }),
      { to: "5491131079124", kind: "image", mediaId: "m1" });
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.reason).toBe("contract_unknown");
  });

  it("2xx vacío o no parseable ⇒ ambiguo", async () => {
    for (const cuerpo of ["", "no es json"]) {
      const r = await enviar(async () => respuesta(200, cuerpo),
        { to: "5491131079124", kind: "image", mediaId: "m1" });
      expect(r.kind).toBe("ambiguous");
      if (r.kind === "ambiguous") expect(r.reason).toBe("invalid_2xx");
    }
  });
});

// ═══════════════════ el token no se filtra ═══════════════════

describe("ningún resultado arrastra la credencial", () => {
  it("ni en éxito, ni en rechazo, ni en fallo de red", async () => {
    const casos: Array<() => Promise<Response>> = [
      async () => respuesta(200, { id: "m1" }),
      async () => respuesta(401, { error: { message: `token ${TOKEN} inválido` } }),
      async () => respuesta(500, {}),
      async () => { throw new Error(`fallo con ${TOKEN}`); },
    ];
    for (const impl of casos) {
      const t = createMetaMediaTransport({ ...CFG, fetchImpl: impl as unknown as typeof fetch });
      const subida = await t.uploadMedia({ bytes: bytes(), mimeType: "image/jpeg", fileName: "f.jpg" });
      const envio = await t.sendMedia({ to: "5491131079124", kind: "image", mediaId: "m1" });
      expect(JSON.stringify(subida)).not.toContain(TOKEN);
      expect(JSON.stringify(envio)).not.toContain(TOKEN);
    }
  });
});
