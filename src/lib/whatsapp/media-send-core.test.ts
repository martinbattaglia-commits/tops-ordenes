// Nexus Link · FASE B — decisión del envío de media por WhatsApp.
//
// Todo por inyección: estado, objetos, transporte y sandbox. Lo que se prueba
// es la parte que, si falla, le llega al cliente y no se puede retirar: que el
// CAS impida el segundo envío, que el orden sea reclamar-antes-de-subir, y que
// un resultado incierto NUNCA vuelva a intentarse.

import { describe, expect, it, vi } from "vitest";
import { prepararParaWhatsapp, sendWhatsappMedia, type MediaSendPorts } from "./media-send-core";
import type { OutboundStateSnapshot } from "./reply-core";

const ENTRADA = {
  messageId: "m-1",
  to: "5491131079124",
  bucket: "connect-files",
  path: "conv/files/u1",
  mimeType: "image/jpeg",
  fileName: "remito.jpg",
  caption: "Remito de hoy",
};

function puertos(over: Partial<{
  claimSending: boolean;
  sealSent: boolean;
  bytes: Uint8Array | null;
  upload: unknown;
  send: unknown;
  sandbox: boolean;
  state: OutboundStateSnapshot;
}> = {}) {
  const claimSending = vi.fn(async () => over.claimSending ?? true);
  const readState = vi.fn(async (): Promise<OutboundStateSnapshot> =>
    over.state ?? { status: "sending", wamid: null, auditedWamid: null });
  const sealSent = vi.fn(async () => over.sealSent ?? true);
  const stamp = vi.fn(async () => true);
  const uploadMedia = vi.fn(async (_i: { bytes: Uint8Array; mimeType: string; fileName: string }) =>
    (over.upload ?? { kind: "uploaded", mediaId: "media-9" }) as never);
  const sendMedia = vi.fn(async (_i: { to: string; kind: string; mediaId: string }) =>
    (over.send ?? { kind: "accepted", wamid: "wamid.OK" }) as never);
  const read = vi.fn(async () => (over.bytes === undefined ? new Uint8Array([1, 2, 3]) : over.bytes));
  const ports: MediaSendPorts = {
    state: { read: readState, claimSending, sealSent, stamp },
    objects: { read },
    transport: { uploadMedia, sendMedia },
    sandbox: { isAllowed: () => over.sandbox ?? true },
  };
  return { ports, readState, claimSending, sealSent, stamp, uploadMedia, sendMedia, read };
}

describe("el CAS decide quién envía", () => {
  it("el ganador sube, envía y sella", async () => {
    const p = puertos();
    const r = await sendWhatsappMedia(ENTRADA, p.ports);
    expect(r).toEqual({ ok: true, state: "sent", wamid: "wamid.OK" });
    expect(p.uploadMedia).toHaveBeenCalledTimes(1);
    expect(p.sealSent).toHaveBeenCalledWith("m-1", "wamid.OK");
    expect(p.claimSending).toHaveBeenCalledWith("m-1", { allowFailed: true });
  });

  it("el PERDEDOR no toca Meta: ni sube ni envía", async () => {
    const p = puertos({ claimSending: false });
    const r = await sendWhatsappMedia(ENTRADA, p.ports);
    expect(r).toEqual({
      ok: false,
      state: "already_claimed",
      message: "Otro intento ya está en curso. Esperá su resultado antes de reintentar.",
    });
    expect(p.uploadMedia).not.toHaveBeenCalled();
    expect(p.sendMedia).not.toHaveBeenCalled();
    // Perder no acredita éxito: el mensaje sigue en curso y la UI no debe ocultarlo.
    expect(p.stamp).not.toHaveBeenCalled();
  });

  it("un CAS perdido relee `failed`: nunca lo disfraza de already_claimed", async () => {
    const p = puertos({
      claimSending: false,
      state: { status: "failed", wamid: null, auditedWamid: null },
    });
    const r = await sendWhatsappMedia(ENTRADA, p.ports);
    expect(r).toMatchObject({ ok: false, state: "failed" });
    expect(p.readState).toHaveBeenCalledWith("m-1");
    expect(p.uploadMedia).not.toHaveBeenCalled();
    expect(p.sendMedia).not.toHaveBeenCalled();
  });

  it.each(["sent", "delivered", "read"] as const)(
    "%s con wamid nunca reenvía y devuelve el sello existente",
    async (status) => {
      const p = puertos({
        claimSending: false,
        state: { status, wamid: "wamid.EXISTENTE", auditedWamid: null },
      });
      const r = await sendWhatsappMedia(ENTRADA, p.ports);
      expect(r).toEqual({ ok: true, state: "sent", wamid: "wamid.EXISTENTE" });
      expect(p.uploadMedia).not.toHaveBeenCalled();
      expect(p.sendMedia).not.toHaveBeenCalled();
    },
  );

  it("reconciliation_required nunca reenvía ni se traduce a éxito", async () => {
    const p = puertos({
      claimSending: false,
      state: { status: "reconciliation_required", wamid: null, auditedWamid: null },
    });
    const r = await sendWhatsappMedia(ENTRADA, p.ports);
    expect(r).toMatchObject({ ok: false, state: "reconciliation_required" });
    expect(p.uploadMedia).not.toHaveBeenCalled();
    expect(p.sendMedia).not.toHaveBeenCalled();
  });

  it("se reclama ANTES de leer y subir el binario", async () => {
    const orden: string[] = [];
    const p = puertos();
    p.claimSending.mockImplementation(async () => { orden.push("claim"); return true; });
    p.read.mockImplementation(async () => { orden.push("read"); return new Uint8Array([1]); });
    p.uploadMedia.mockImplementation(async () => { orden.push("upload"); return { kind: "uploaded", mediaId: "m" } as never; });
    await sendWhatsappMedia(ENTRADA, p.ports);
    // Al revés, dos llamadas concurrentes subirían el mismo archivo dos veces
    // antes de que una descubriera que perdió.
    expect(orden).toEqual(["claim", "read", "upload"]);
  });

  it("el sandbox corta ANTES del CAS: el mensaje queda reintentable", async () => {
    const p = puertos({ sandbox: false });
    const r = await sendWhatsappMedia(ENTRADA, p.ports);
    expect(r.ok).toBe(false);
    expect(p.claimSending).not.toHaveBeenCalled();
    // Si hubiera reclamado, el mensaje quedaría en `sending` y un reintento
    // legítimo —tras habilitar el número— ya no podría ganarlo.
    expect(p.stamp).not.toHaveBeenCalled();
  });
});

describe("fallos deterministas dejan el intento REINTENTABLE", () => {
  const esperarFailed = async (p: ReturnType<typeof puertos>, patron: RegExp) => {
    const r = await sendWhatsappMedia(ENTRADA, p.ports);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.state).toBe("failed");
    if (!r.ok) expect(r.message).toMatch(patron);
    expect(p.stamp).toHaveBeenCalledWith("m-1", expect.objectContaining({ status: "failed" }));
  };

  it("objeto ausente", async () => {
    await esperarFailed(puertos({ bytes: null }), /no está disponible/);
  });

  it("subida fallida —incluso por red— porque nada salió hacia el cliente", async () => {
    const p = puertos({ upload: { kind: "failed", reason: "network", detail: "x" } });
    await esperarFailed(p, /No se pudo subir/);
    expect(p.sendMedia).not.toHaveBeenCalled();
  });

  it("rechazo inequívoco de Meta", async () => {
    await esperarFailed(
      puertos({ send: { kind: "rejected", reason: "http_error", status: 400, detail: "HTTP 400" } }),
      /rechazó/,
    );
  });

  it("formato que WhatsApp no acepta, detectado sin subir nada", async () => {
    const p = puertos();
    const r = await sendWhatsappMedia({ ...ENTRADA, mimeType: "image/gif" }, p.ports);
    expect(r.ok).toBe(false);
    expect(p.uploadMedia).not.toHaveBeenCalled();
  });

  it("un `failed` durable se reabre una vez, acepta Meta y queda sent con su wamid", async () => {
    let state: OutboundStateSnapshot = { status: "failed", wamid: null, auditedWamid: null };
    const sendMedia = vi.fn(async () => ({ kind: "accepted" as const, wamid: "wamid.RETRY" }));
    const ports: MediaSendPorts = {
      state: {
        read: async () => state,
        claimSending: async (_id, options) => {
          if (state.status !== "failed" || options?.allowFailed !== true || state.wamid) return false;
          state = { ...state, status: "sending" };
          return true;
        },
        sealSent: async (_id, wamid) => {
          if (state.status !== "sending" || state.wamid) return false;
          state = { ...state, status: "sent", wamid };
          return true;
        },
        stamp: async (_id, patch) => {
          state = { ...state, status: patch.status };
          return true;
        },
      },
      objects: { read: async () => new Uint8Array([1, 2, 3]) },
      transport: {
        uploadMedia: async () => ({ kind: "uploaded", mediaId: "media.RETRY" }),
        sendMedia,
      },
      sandbox: { isAllowed: () => true },
    };

    const retry = await sendWhatsappMedia(ENTRADA, ports);
    expect(retry).toEqual({ ok: true, state: "sent", wamid: "wamid.RETRY" });
    expect(state).toMatchObject({ status: "sent", wamid: "wamid.RETRY" });
    expect(sendMedia).toHaveBeenCalledTimes(1); // exactamente una llamada nueva a Meta

    const replay = await sendWhatsappMedia(ENTRADA, ports);
    expect(replay).toEqual({ ok: true, state: "sent", wamid: "wamid.RETRY" });
    expect(sendMedia).toHaveBeenCalledTimes(1); // sent nunca vuelve a salir
  });
});

describe("lo incierto NUNCA se reintenta solo", () => {
  it("un envío ambiguo queda en reconciliación, no en fallo", async () => {
    const p = puertos({ send: { kind: "ambiguous", reason: "server_error", detail: "HTTP 503" } });
    const r = await sendWhatsappMedia(ENTRADA, p.ports);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.state).toBe("reconciliation_required");
      expect(r.message).toMatch(/No lo reenvíes/);
    }
    expect(p.stamp).toHaveBeenCalledWith(
      "m-1", expect.objectContaining({ status: "reconciliation_required" }));
  });

  it("aceptado por Meta pero sin sello local ⇒ reconciliación, no reenvío", async () => {
    // El archivo SALIÓ. Tratarlo como fallo invitaría a mandarlo de nuevo.
    const p = puertos({ sealSent: false });
    const r = await sendWhatsappMedia(ENTRADA, p.ports);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.state).toBe("reconciliation_required");
      expect(r.message).toMatch(/salió pero no se pudo registrar/);
    }
  });
});

describe("el binario se prepara según lo que WhatsApp reproduce", () => {
  it("lo que ya sirve pasa intacto", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const r = prepararParaWhatsapp(bytes, "audio/mp4", "voz.m4a");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mimeType).toBe("audio/mp4");
      expect(r.bytes).toBe(bytes); // ni una copia: no hay nada que hacerle
    }
  });

  it("un WebM inválido no se manda a medias: se explica el motivo", () => {
    const r = prepararParaWhatsapp(new Uint8Array([0, 1, 2]), "audio/webm", "voz.webm");
    expect(r.ok).toBe(false);
  });

  it("el envío de audio informa el MIME REENVASADO, no el original", async () => {
    // Se usa un WebM sintético mínimo con un paquete Opus real.
    const enc = new TextEncoder();
    const size8 = (n: number) => {
      const o = new Uint8Array(8); o[0] = 1;
      for (let i = 7; i >= 1; i--) { o[i] = n & 0xff; n = Math.floor(n / 256); }
      return o;
    };
    const cat = (...p: Uint8Array[]) => {
      const o = new Uint8Array(p.reduce((a, x) => a + x.length, 0));
      let k = 0; for (const x of p) { o.set(x, k); k += x.length; } return o;
    };
    const el = (id: number[], pl: Uint8Array) => cat(new Uint8Array(id), size8(pl.length), pl);
    const head = cat(enc.encode("OpusHead"), new Uint8Array([1, 1, 0x38, 1, 0x80, 0xbb, 0, 0, 0, 0, 0]));
    const webm = cat(
      new Uint8Array([0x18, 0x53, 0x80, 0x67, 0x01, 255, 255, 255, 255, 255, 255, 255]),
      el([0x16, 0x54, 0xae, 0x6b], el([0xae], cat(
        el([0x86], enc.encode("A_OPUS")), el([0x63, 0xa2], head)))),
      new Uint8Array([0x1f, 0x43, 0xb6, 0x75, 0x01, 255, 255, 255, 255, 255, 255, 255]),
      el([0xa3], cat(new Uint8Array([0x81, 0, 0, 0]), new Uint8Array([0xfc, 1, 2, 3]))),
    );

    const p = puertos({ bytes: webm });
    const r = await sendWhatsappMedia(
      { ...ENTRADA, mimeType: "audio/webm", fileName: "voz.webm" }, p.ports);
    expect(r.ok).toBe(true);
    const subido = p.uploadMedia.mock.calls[0]?.[0] as { mimeType: string; bytes: Uint8Array };
    expect(subido.mimeType).toBe("audio/ogg");
    expect(String.fromCharCode(...subido.bytes.subarray(0, 4))).toBe("OggS");
    // Y el audio se manda como AUDIO, sin pie: Meta lo descartaría en silencio.
    const enviado = p.sendMedia.mock.calls[0]?.[0] as { kind: string };
    expect(enviado.kind).toBe("audio");
  });

  // ─── H-2 · el nombre también es parte del contrato con Meta ───────────────
  it("el NOMBRE del archivo acompaña al reenvasado: no queda diciendo .webm", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    // Lo que ya sirve conserva su nombre tal cual.
    const intacto = prepararParaWhatsapp(bytes, "audio/mp4", "voz-12s.m4a");
    expect(intacto.ok).toBe(true);
    if (intacto.ok) expect(intacto.fileName).toBe("voz-12s.m4a");
  });

  it("un WebM reenvasado sube como .ogg, con los tres datos coherentes", async () => {
    const enc = new TextEncoder();
    const size8 = (n: number) => {
      const o = new Uint8Array(8); o[0] = 1;
      for (let i = 7; i >= 1; i--) { o[i] = n & 0xff; n = Math.floor(n / 256); }
      return o;
    };
    const cat = (...pz: Uint8Array[]) => {
      const o = new Uint8Array(pz.reduce((a, x) => a + x.length, 0));
      let k = 0; for (const x of pz) { o.set(x, k); k += x.length; } return o;
    };
    const el = (id: number[], pl: Uint8Array) => cat(new Uint8Array(id), size8(pl.length), pl);
    const head = cat(enc.encode("OpusHead"), new Uint8Array([1, 1, 0x38, 1, 0x80, 0xbb, 0, 0, 0, 0, 0]));
    const webm = cat(
      new Uint8Array([0x18, 0x53, 0x80, 0x67, 0x01, 255, 255, 255, 255, 255, 255, 255]),
      el([0x16, 0x54, 0xae, 0x6b], el([0xae], cat(
        el([0x86], enc.encode("A_OPUS")), el([0x63, 0xa2], head)))),
      new Uint8Array([0x1f, 0x43, 0xb6, 0x75, 0x01, 255, 255, 255, 255, 255, 255, 255]),
      el([0xa3], cat(new Uint8Array([0x81, 0, 0, 0]), new Uint8Array([0xfc, 1, 2, 3]))),
    );

    const p = puertos({ bytes: webm });
    const r = await sendWhatsappMedia(
      { ...ENTRADA, mimeType: "audio/webm", fileName: "voz-12s.webm" }, p.ports);
    expect(r.ok).toBe(true);

    const subido = p.uploadMedia.mock.calls[0]?.[0] as {
      mimeType: string; bytes: Uint8Array; fileName: string;
    };
    // LOS TRES TIENEN QUE DECIR LO MISMO. Ésta es la diferencia exacta contra el
    // camino de imágenes, que sí funciona: ahí tipo, nombre y bytes coinciden.
    expect(subido.mimeType).toBe("audio/ogg");
    expect(String.fromCharCode(...subido.bytes.subarray(0, 4))).toBe("OggS");
    expect(subido.fileName).toBe("voz-12s.ogg");
    expect(subido.fileName.endsWith(".webm")).toBe(false);
  });
});

describe("nada sale hacia Meta sin que se le mire el códec adentro", () => {
  /** MP4 mínimo cuyo `stsd` declara el códec dado. Misma forma que el real. */
  function mp4Con(codec: string): Uint8Array {
    const enc = new TextEncoder();
    const cat = (...p: Uint8Array[]) => {
      const o = new Uint8Array(p.reduce((a, x) => a + x.length, 0));
      let k = 0; for (const x of p) { o.set(x, k); k += x.length; }
      return o;
    };
    const be32 = (n: number) =>
      new Uint8Array([n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255]);
    const box = (t: string, ...h: Uint8Array[]) => {
      const c = cat(...h);
      return cat(be32(c.length + 8), enc.encode(t), c);
    };
    const stsd = box("stsd", be32(0), be32(1),
      cat(be32(16), enc.encode(codec), new Uint8Array(8)));
    return cat(
      box("ftyp", enc.encode("isom"), be32(0x200), enc.encode("isomvp09")),
      box("moov", box("trak", box("mdia", box("minf", box("stbl", stsd))))),
    );
  }

  it("un MP4 con Opus se detiene ACÁ y no llega a /media", async () => {
    // Es el binario que producía Chromium y que Meta rechazaba con 131053,
    // asincrónico, después de haber aceptado la subida.
    const p = puertos({ bytes: mp4Con("Opus") });
    const r = await sendWhatsappMedia(
      { ...ENTRADA, mimeType: "audio/mp4", fileName: "voz-3s.m4a" }, p.ports);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.state).toBe("failed");
    expect(r.message).toContain("Opus");
    expect(r.message).toContain("AAC");
    // Lo que importa: NO se gastó una subida ni salió nada.
    expect(p.uploadMedia).not.toHaveBeenCalled();
    expect(p.sendMedia).not.toHaveBeenCalled();
  });

  it("un MP4 con AAC —el de Safari— sí sale", async () => {
    const p = puertos({ bytes: mp4Con("mp4a") });
    const r = await sendWhatsappMedia(
      { ...ENTRADA, mimeType: "audio/mp4", fileName: "voz-3s.m4a" }, p.ports);
    expect(r.ok).toBe(true);
    expect(p.uploadMedia).toHaveBeenCalledTimes(1);
  });

  it("una imagen no pasa por este guarda: tiene su propia admisión", async () => {
    const p = puertos({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]) });
    const r = await sendWhatsappMedia({ ...ENTRADA, mimeType: "image/jpeg" }, p.ports);
    expect(r.ok).toBe(true);
  });
});
