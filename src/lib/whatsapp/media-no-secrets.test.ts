/**
 * H2 · NEXUS LINK FASE B — cero secretos en logs o respuestas del envío de
 * media. Estructural, sobre el CÓDIGO REAL en disco — mismo método que
 * `reply.runtime.test.ts` («el módulo no contiene el selector roto»): una
 * ausencia se demuestra leyendo la fuente, no simulándola.
 *
 * Lo que se afirma es preciso a propósito: `process.env.META_WA_TOKEN` como
 * REFERENCIA de configuración es correcto y aparece en `media-send.ts`. Lo
 * que NUNCA debe aparecer es un `console.*` en la ruta de envío —no hay dónde
 * filtrar nada si no hay ningún punto de log— ni el token concatenado dentro
 * de un template literal que lo haría viajar en un mensaje de error.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ARCHIVOS_ENVIO = [
  "src/lib/whatsapp/media-send.ts",
  "src/lib/whatsapp/media-send-core.ts",
  "src/lib/whatsapp/media-transport.ts",
  "src/lib/connect/adapters/driving/attachment-actions.ts",
  "src/lib/connect/adapters/driving/audio-actions.ts",
];

const leer = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("H2 · cero console.* en toda la ruta de envío de media", () => {
  it.each(ARCHIVOS_ENVIO)("%s no tiene ningún console.log/warn/error/info/debug", (rel) => {
    const src = leer(rel);
    expect(src).not.toMatch(/console\.(log|warn|error|info|debug)/);
  });
});

describe("H2 · el token nunca viaja concatenado en un mensaje", () => {
  it("media-transport.ts sólo USA el token para el header Authorization, nunca lo interpola en un string devuelto", () => {
    const src = leer("src/lib/whatsapp/media-transport.ts");
    // Única forma legítima: el header Bearer, construido con backtick e
    // interpolación directa del token — se permite EXACTAMENTE esa línea.
    const usosDeToken = [...src.matchAll(/\bcred\.token\b|\btoken\b/g)];
    expect(usosDeToken.length).toBeGreaterThan(0); // el archivo sí usa el token…
    // …pero nunca dentro de un `detail:`/`message:`/`reason:` de retorno.
    const lineasSensibles = src.split("\n").filter((l) => /detail:|message:|reason:/.test(l));
    for (const l of lineasSensibles) {
      expect(l, l).not.toMatch(/\btoken\b/i);
    }
  });

  it("ningún archivo de la ruta de envío arma un string con el valor crudo de META_WA_TOKEN", () => {
    for (const rel of ARCHIVOS_ENVIO) {
      const src = leer(rel);
      // Referenciar la variable de entorno para CONFIGURAR el transporte es
      // correcto (`token: process.env.META_WA_TOKEN`); lo prohibido es
      // interpolarla dentro de un template literal, que la pegaría a un texto
      // que puede terminar en un log o en una respuesta.
      expect(src, rel).not.toMatch(/`[^`]*\$\{[^}]*META_WA_TOKEN[^}]*\}[^`]*`/);
    }
  });
});

describe("H2 · el resultado que llega al cliente no lleva más que estado y un mensaje fijo", () => {
  it("MediaSendResult sólo expone wamid en el caso `sent` — nunca el media_id crudo de Meta como campo aparte", async () => {
    const { sendWhatsappMedia } = await import("./media-send-core");
    const bytes = new Uint8Array([1, 2, 3]);
    const ports = {
      state: {
        claimSending: async () => true,
        sealSent: async () => true,
        stamp: async () => true,
      },
      objects: { read: async () => bytes },
      transport: {
        uploadMedia: async () => ({ kind: "uploaded" as const, mediaId: "media-secreto-9" }),
        sendMedia: async () => ({ kind: "accepted" as const, wamid: "wamid.OK" }),
      },
      sandbox: { isAllowed: () => true },
    };
    const r = await sendWhatsappMedia(
      { messageId: "m-1", to: "+5491131079124", bucket: "b", path: "p", mimeType: "image/jpeg", fileName: "f.jpg" },
      ports,
    );
    expect(r).toEqual({ ok: true, state: "sent", wamid: "wamid.OK" });
    // El media_id (identificador interno de Meta, de vida corta) no forma
    // parte del contrato de salida: sólo el wamid, que es lo que el resto del
    // sistema —incluida la reconciliación de status— ya sabe usar.
    expect(JSON.stringify(r)).not.toContain("media-secreto-9");
  });
});
