import { describe, it, expect } from "vitest";
import { parseInboundPayload, toE164, metaTimestampToIso } from "./inbound";

/**
 * LINK-WA S1 · Normalización del inbound de Meta.
 *
 * Todas las fixtures son SINTÉTICAS: los números pertenecen al rango de prueba
 * +54911000000xx y no corresponden a ningún destinatario real. No hay red.
 */

const TENANT = "111111111111111";
const OTHER_TENANT = "999999999999999";
const FROM = "5491100000001";
const FROM_E164 = "+5491100000001";

function messageEvent(over: Partial<Record<string, unknown>> = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-TEST",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "5491100000000", phone_number_id: TENANT },
              contacts: [{ profile: { name: "Contacto Sintético" }, wa_id: FROM }],
              messages: [
                {
                  from: FROM,
                  id: "wamid.TEST001",
                  timestamp: "1760000000",
                  type: "text",
                  text: { body: "hola" },
                  ...over,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function statusEvent(status: string, id = "wamid.OUT001", errors?: unknown[]) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA-TEST",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: TENANT },
              statuses: [
                {
                  id,
                  status,
                  timestamp: "1760000100",
                  recipient_id: FROM,
                  ...(errors ? { errors } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe("toE164", () => {
  it("normaliza a E.164 con '+'", () => {
    expect(toE164(FROM)).toBe(FROM_E164);
    expect(toE164("+54 9 11 0000-0001")).toBe(FROM_E164);
  });

  it("rechaza longitudes fuera de rango y no-strings", () => {
    expect(toE164("123")).toBeNull();
    expect(toE164("1".repeat(16))).toBeNull();
    expect(toE164(null)).toBeNull();
    expect(toE164({})).toBeNull();
  });
});

describe("metaTimestampToIso", () => {
  it("convierte unix segundos a ISO", () => {
    expect(metaTimestampToIso("1760000000")).toBe(new Date(1760000000000).toISOString());
  });

  it("rechaza basura", () => {
    expect(metaTimestampToIso("abc")).toBeNull();
    expect(metaTimestampToIso("0")).toBeNull();
    expect(metaTimestampToIso(undefined)).toBeNull();
  });
});

describe("parseInboundPayload · mapeo cuenta/número → tenant", () => {
  it("falla cerrado si no hay número comercial configurado", () => {
    const r = parseInboundPayload(messageEvent(), undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tenant_unresolved");
  });

  it("falla cerrado si el evento es de OTRO phone_number_id", () => {
    const r = parseInboundPayload(messageEvent(), OTHER_TENANT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tenant_mismatch");
  });

  it("rechaza un objeto que no es de WhatsApp", () => {
    const r = parseInboundPayload({ object: "page", entry: [] }, TENANT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_whatsapp_object");
  });

  it("ignora sólo el change ajeno cuando conviven varios tenants", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: OTHER_TENANT },
                messages: [
                  { from: FROM, id: "wamid.AJENO", timestamp: "1760000000", type: "text", text: { body: "ajeno" } },
                ],
              },
            },
            messageEvent().entry[0].changes[0],
          ],
        },
      ],
    };
    const r = parseInboundPayload(payload, TENANT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.messages).toHaveLength(1);
      expect(r.messages[0].wamid).toBe("wamid.TEST001");
    }
  });
});

describe("parseInboundPayload · mensajes de texto", () => {
  it("normaliza un mensaje de texto completo", () => {
    const r = parseInboundPayload(messageEvent(), TENANT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.messages).toEqual([
      {
        wamid: "wamid.TEST001",
        fromE164: FROM_E164,
        text: "hola",
        sentAt: new Date(1760000000000).toISOString(),
        profileName: "Contacto Sintético",
        // H-7 · un texto no trae media, y lo dice explícitamente.
        media: null,
      },
    ]);
  });

  /**
   * H-7 · ESTE COMPORTAMIENTO CAMBIÓ A PROPÓSITO.
   *
   * La prueba anterior afirmaba que una imagen entrante se descartaba
   * («S1 sólo proyecta texto»). Era cierto y era el defecto: entre el 13 y el
   * 18 de agosto de 2026 se perdieron así 6 documentos, 5 imágenes y 3 audios
   * de clientes. Ahora la imagen ENTRA; lo que sigue descartándose son los
   * tipos que este ingreso no sabe guardar, y ésos se nombran.
   */
  it("una imagen entrante YA NO se descarta: entra con su media", () => {
    const r = parseInboundPayload(
      messageEvent({
        type: "image", text: undefined,
        image: { id: "media", mime_type: "image/jpeg", sha256: "x", url: "https://cdn/x" },
      }),
      TENANT,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].media).toMatchObject({ kind: "image", mediaId: "media" });
    // El cuerpo dice QUÉ llegó: el hilo no muestra una burbuja muda.
    expect(r.messages[0].text).toBe("📷 Foto");
    expect(r.skipped.nonText).toBe(0);
  });

  it("lo que todavía no se sabe guardar se descarta CON NOMBRE, no como número mudo", () => {
    const r = parseInboundPayload(
      messageEvent({ type: "sticker", text: undefined, sticker: { id: "s" } }),
      TENANT,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.messages).toHaveLength(0);
    expect(r.skipped.nonText).toBe(1);
    expect(r.skipped.unsupportedTypes).toEqual(["sticker"]);
  });

  it("descarta mensajes sin wamid, sin from o sin timestamp", () => {
    for (const broken of [{ id: "" }, { from: "x" }, { timestamp: "nope" }]) {
      const r = parseInboundPayload(messageEvent(broken), TENANT);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.messages).toHaveLength(0);
      expect(r.skipped.malformed).toBe(1);
    }
  });

  it("deduplica el mismo wamid repetido dentro del mismo POST", () => {
    const payload = messageEvent();
    const change = payload.entry[0].changes[0] as { value: { messages: unknown[] } };
    change.value.messages = [change.value.messages[0], change.value.messages[0]];
    const r = parseInboundPayload(payload, TENANT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.messages).toHaveLength(1);
  });
});

describe("parseInboundPayload · estados", () => {
  it.each(["sent", "delivered", "read", "failed"])("acepta el estado %s", (status) => {
    const r = parseInboundPayload(statusEvent(status), TENANT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.statuses).toHaveLength(1);
    expect(r.statuses[0]).toMatchObject({
      wamid: "wamid.OUT001",
      status,
      recipientE164: FROM_E164,
    });
  });

  it("captura el código de error en failed", () => {
    const r = parseInboundPayload(statusEvent("failed", "wamid.OUT002", [{ code: 131047 }]), TENANT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.statuses[0].errorCode).toBe(131047);
  });

  it("descarta estados desconocidos en lugar de proyectarlos", () => {
    const r = parseInboundPayload(statusEvent("deleted"), TENANT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.statuses).toHaveLength(0);
    expect(r.skipped.unknownStatus).toBe(1);
  });
});
