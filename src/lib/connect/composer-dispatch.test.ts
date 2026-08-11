import { describe, it, expect, vi } from "vitest";

import {
  dispatchComposerSend,
  UNKNOWN_KIND_MESSAGE,
  CONNECT_UNAVAILABLE_MESSAGE,
  type ComposerDispatchPorts,
} from "./composer-dispatch";
import { CONVERSATION_KINDS } from "./composer-policy";

/**
 * LINK-WA WA-8 · Dispatcher por `conversation.kind`.
 *
 * Fakes puros, sin red, sin DB, sin Server Actions reales. Lo que se prueba es
 * la garantía dura del contrato: se ejecuta UN camino, nunca los dos, y jamás
 * se elige por título, teléfono, URL ni contenido.
 */

const CONV = "22222222-3333-4444-8555-666666666666";
const MSG = "11111111-2222-4333-8444-555555555555";
const CID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const MENTIONS = ["99999999-1111-4111-8111-999999999999"];

type ConnectArgs = Parameters<ComposerDispatchPorts["postConnectMessage"]>[0];
type WaArgs = Parameters<ComposerDispatchPorts["sendWhatsappText"]>[0];

function ports(over: Partial<ComposerDispatchPorts> = {}) {
  const postConnectMessage = vi.fn(async (_i: ConnectArgs) => ({
    ok: true as const, messageId: MSG, seq: 7,
  }));
  const sendWhatsappText = vi.fn(async (_i: WaArgs) => ({ ok: true as const, messageId: MSG }));
  return {
    postConnectMessage,
    sendWhatsappText,
    ...over,
  } as ComposerDispatchPorts & {
    postConnectMessage: typeof postConnectMessage;
    sendWhatsappText: typeof sendWhatsappText;
  };
}

const base = { conversationId: CONV, body: "hola", clientMsgId: CID, mentions: MENTIONS };

/** Kinds que NO son WhatsApp: todos deben conservar el camino Connect. */
const CONNECT_KINDS = CONVERSATION_KINDS.filter((k) => k !== "whatsapp");

describe("1 · WhatsApp llama una vez a WhatsApp y cero a Connect", () => {
  it("una sola llamada, al camino correcto", async () => {
    const p = ports();
    const out = await dispatchComposerSend({ ...base, kind: "whatsapp" }, p);

    expect(p.sendWhatsappText).toHaveBeenCalledTimes(1);
    expect(p.postConnectMessage).not.toHaveBeenCalled();
    expect(out).toEqual({ route: "whatsapp", status: "sent", messageId: MSG });
  });
});

describe("2-3 · todo kind no-WhatsApp preserva Connect", () => {
  it.each(CONNECT_KINDS)("%s llama una vez a Connect y cero a WhatsApp", async (kind) => {
    const p = ports();
    const out = await dispatchComposerSend({ ...base, kind }, p);

    expect(p.postConnectMessage).toHaveBeenCalledTimes(1);
    expect(p.sendWhatsappText).not.toHaveBeenCalled();
    expect(out).toEqual({ route: "connect", status: "sent", messageId: MSG, seq: 7 });
  });

  it("dm conserva la semántica actual: menciones incluidas", async () => {
    const p = ports();
    await dispatchComposerSend({ ...base, kind: "dm" }, p);
    expect(p.postConnectMessage).toHaveBeenCalledWith({
      conversationId: CONV,
      body: "hola",
      clientMsgId: CID,
      mentions: MENTIONS,
    });
  });

  it("sin menciones explícitas, Connect recibe un arreglo vacío (no undefined)", async () => {
    const p = ports();
    await dispatchComposerSend(
      { kind: "group", conversationId: CONV, body: "hola", clientMsgId: CID },
      p,
    );
    expect(p.postConnectMessage).toHaveBeenCalledWith(
      expect.objectContaining({ mentions: [] }),
    );
  });
});

describe("4 · kind inválido o ausente ejecuta CERO acciones", () => {
  it.each([
    ["ausente", undefined],
    ["null", null],
    ["cadena vacía", ""],
    ["desconocido", "sms"],
    ["mayúsculas", "WHATSAPP"],
    ["con espacio", " whatsapp"],
    ["número", 1],
    ["objeto", { kind: "whatsapp" }],
    ["arreglo", ["whatsapp"]],
    ["booleano", true],
  ])("kind %s → cero llamadas", async (_l, kind) => {
    const p = ports();
    const out = await dispatchComposerSend({ ...base, kind }, p);

    expect(p.postConnectMessage).not.toHaveBeenCalled();
    expect(p.sendWhatsappText).not.toHaveBeenCalled();
    expect(out).toEqual({ route: "none", status: "failed", message: UNKNOWN_KIND_MESSAGE });
  });
});

describe("5 · WhatsApp no transporta mentions ni adjuntos", () => {
  it("la llamada WhatsApp lleva exactamente tres claves y ninguna mención", async () => {
    const p = ports();
    await dispatchComposerSend({ ...base, kind: "whatsapp" }, p);

    const arg = p.sendWhatsappText.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(arg).sort()).toEqual(["clientMsgId", "conversationId", "text"]);
    expect(arg).toEqual({ conversationId: CONV, text: "hola", clientMsgId: CID });
    // Ni menciones, ni adjuntos, ni audio: no existen en esta superficie.
    expect(JSON.stringify(arg)).not.toContain(MENTIONS[0]);
    for (const clave of ["mentions", "attachmentIds", "attachments", "audio", "replyTo"]) {
      expect(arg).not.toHaveProperty(clave);
    }
  });
});

describe("6 · nunca se ejecutan los dos caminos", () => {
  it.each([...CONVERSATION_KINDS, "sms", undefined, null] as unknown[])(
    "kind %s ejecuta a lo sumo una acción",
    async (kind) => {
      const p = ports();
      await dispatchComposerSend({ ...base, kind }, p);
      const total =
        p.postConnectMessage.mock.calls.length + p.sendWhatsappText.mock.calls.length;
      expect(total).toBeLessThanOrEqual(1);
    },
  );

  /**
   * El ruteo NO puede depender del contenido: el mismo cuerpo, teléfono o URL
   * en un DM debe seguir yendo por Connect, y en WhatsApp por WhatsApp.
   */
  it.each([
    ["cuerpo que menciona whatsapp", "mandame un whatsapp al +54 9 11 0000-0001"],
    ["cuerpo con URL", "https://wa.me/5491100000001"],
    ["cuerpo con teléfono", "+5491100000001"],
    ["cuerpo vacío de pistas", "hola"],
  ])("%s no altera el ruteo", async (_l, body) => {
    const dm = ports();
    await dispatchComposerSend({ ...base, body, kind: "dm" }, dm);
    expect(dm.postConnectMessage).toHaveBeenCalledTimes(1);
    expect(dm.sendWhatsappText).not.toHaveBeenCalled();

    const wa = ports();
    await dispatchComposerSend({ ...base, body, kind: "whatsapp" }, wa);
    expect(wa.sendWhatsappText).toHaveBeenCalledTimes(1);
    expect(wa.postConnectMessage).not.toHaveBeenCalled();
  });
});

describe("propagación de resultados", () => {
  it("WhatsApp pendiente se propaga como pending, no como failed", async () => {
    const p = ports({
      sendWhatsappText: vi.fn(async (_i: WaArgs) => ({
        ok: false as const,
        state: "pending" as const,
        message: "Envío pendiente de confirmación. No lo reintentes.",
      })),
    });
    const out = await dispatchComposerSend({ ...base, kind: "whatsapp" }, p);
    expect(out.status).toBe("pending");
    expect(out).toMatchObject({ route: "whatsapp" });
  });

  it("WhatsApp rechazado se propaga como failed", async () => {
    const p = ports({
      sendWhatsappText: vi.fn(async (_i: WaArgs) => ({
        ok: false as const,
        state: "rejected" as const,
        message: "WhatsApp rechazó el mensaje.",
      })),
    });
    const out = await dispatchComposerSend({ ...base, kind: "whatsapp" }, p);
    expect(out).toEqual({
      route: "whatsapp",
      status: "failed",
      message: "WhatsApp rechazó el mensaje.",
    });
  });

  it("Connect fallido se propaga como failed sin tocar WhatsApp", async () => {
    const p = ports({
      postConnectMessage: vi.fn(async (_i: ConnectArgs) => ({ ok: false as const, message: "Datos inválidos." })),
    });
    const out = await dispatchComposerSend({ ...base, kind: "dm" }, p);
    expect(out).toEqual({ route: "connect", status: "failed", message: "Datos inválidos." });
    expect(p.sendWhatsappText).not.toHaveBeenCalled();
  });

  /** Connect nunca produce `pending`: ese estado es exclusivo del outbound ambiguo. */
  it("Connect no puede devolver pending", async () => {
    for (const ok of [true, false]) {
      const p = ports({
        postConnectMessage: vi.fn(async (_i: ConnectArgs) =>
          ok ? { ok: true as const, messageId: MSG, seq: 1 } : { ok: false as const, message: "x" },
        ),
      });
      const out = await dispatchComposerSend({ ...base, kind: "dm" }, p);
      expect(out.status).not.toBe("pending");
    }
  });
});

// ── WA-8R1 · §6 · excepciones de Server Action ─────────────────────────────
/**
 * Una Server Action invocada desde el cliente puede RECHAZAR la promesa: red
 * caída, request abortado, error de transporte del framework. Antes eso escapaba
 * del `await` y dejaba la burbuja congelada en «enviando…», con el operador
 * tentado a reintentar un mensaje que quizá ya había salido.
 */
describe("12 · una Promise rechazada en el camino WhatsApp deja `pending`", () => {
  const RECHAZOS: Array<[string, unknown]> = [
    ["Error común", new Error("Failed to fetch")],
    ["TypeError de red", new TypeError("NetworkError when attempting to fetch resource.")],
    ["error con stack", Object.assign(new Error("boom"), { stack: "at reply (/app/src/lib/whatsapp/reply.ts:42:1)" })],
    ["string suelto", "network down"],
    ["objeto con detalle", { detail: "secreto-del-proveedor", wamid: "wamid.HBgNNTQ5MTEwMDAwMDAwMRUCABIYFjNBMDA" }],
    ["null", null],
    ["undefined", undefined],
  ];

  it.each(RECHAZOS)("%s ⇒ pending, sin filtrar nada", async (_l, causa) => {
    const p = ports({
      sendWhatsappText: vi.fn(async (_i: WaArgs) => {
        throw causa;
      }),
    });
    const out = await dispatchComposerSend({ ...base, kind: "whatsapp" }, p);

    expect(out.status).toBe("pending");
    expect(out).toEqual({
      route: "whatsapp",
      status: "pending",
      message: "Envío pendiente de confirmación. No lo reintentes.",
    });

    const dump = JSON.stringify(out);
    for (const marca of [
      "Failed to fetch", "NetworkError", "boom", "at reply", "network down",
      "secreto-del-proveedor", "wamid.", "/app/src",
    ]) {
      expect(dump).not.toContain(marca);
    }
  });

  it("NUNCA se convierte en `failed`: la ausencia de respuesta es ambigua", async () => {
    const p = ports({
      sendWhatsappText: vi.fn(async (_i: WaArgs) => {
        throw new Error("timeout");
      }),
    });
    const out = await dispatchComposerSend({ ...base, kind: "whatsapp" }, p);
    expect(out.status).not.toBe("failed");
    expect(out.status).not.toBe("sent");
  });

  it("14 · una excepción NO dispara un segundo envío automático", async () => {
    const sendWhatsappText = vi.fn(async (_i: WaArgs) => {
      throw new Error("boom");
    });
    const p = ports({ sendWhatsappText });
    await dispatchComposerSend({ ...base, kind: "whatsapp" }, p);

    expect(sendWhatsappText).toHaveBeenCalledTimes(1);
    expect(p.postConnectMessage).not.toHaveBeenCalled();
  });

  it("el dispatcher no propaga la excepción: siempre resuelve", async () => {
    const p = ports({
      sendWhatsappText: vi.fn(async (_i: WaArgs) => {
        throw new Error("boom");
      }),
    });
    await expect(dispatchComposerSend({ ...base, kind: "whatsapp" }, p)).resolves.toBeDefined();
  });
});

describe("§6.8 · una excepción de Connect sí puede mostrarse como fallo seguro", () => {
  it("devuelve failed con un mensaje estable, sin filtrar el error", async () => {
    const p = ports({
      postConnectMessage: vi.fn(async (_i: ConnectArgs) => {
        throw new Error("Failed to fetch /connect");
      }),
    });
    const out = await dispatchComposerSend({ ...base, kind: "dm" }, p);

    expect(out).toEqual({
      route: "connect",
      status: "failed",
      message: CONNECT_UNAVAILABLE_MESSAGE,
    });
    expect(JSON.stringify(out)).not.toContain("Failed to fetch");
  });

  it("y tampoco reintenta ni cruza de camino", async () => {
    const postConnectMessage = vi.fn(async (_i: ConnectArgs) => {
      throw new Error("boom");
    });
    const p = ports({ postConnectMessage });
    await dispatchComposerSend({ ...base, kind: "group" }, p);

    expect(postConnectMessage).toHaveBeenCalledTimes(1);
    expect(p.sendWhatsappText).not.toHaveBeenCalled();
  });
});
