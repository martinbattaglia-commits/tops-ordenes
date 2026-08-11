import { describe, it, expect } from "vitest";

import {
  CONVERSATION_KINDS,
  composerCapabilities,
  isConversationKind,
  isWhatsappKind,
  bubbleStatusFor,
  ownBubbleClass,
  sendButtonClass,
} from "./composer-policy";

/**
 * LINK-WA WA-8 · Capacidades del composer por tipo de conversación.
 *
 * Esta es la restricción que el mandato exige que exista en la LÓGICA y no sólo
 * en CSS: ocultar el botón del micrófono no impide que un atajo, un dictado o un
 * re-render disparen la acción igual.
 */

const CONNECT_KINDS = CONVERSATION_KINDS.filter((k) => k !== "whatsapp");

describe("19-20 · WhatsApp es TEXT-ONLY", () => {
  it("permite texto y bloquea audio y menciones", () => {
    expect(composerCapabilities("whatsapp")).toEqual({
      canSendText: true,
      canSendAudio: false,
      canMention: false,
    });
  });
});

describe("21 · audio y menciones siguen operativos en Connect", () => {
  it.each(CONNECT_KINDS)("%s conserva texto, audio y menciones", (kind) => {
    expect(composerCapabilities(kind)).toEqual({
      canSendText: true,
      canSendAudio: true,
      canMention: true,
    });
  });
});

describe("22 · archived/readOnly bloquea todo, en cualquier kind", () => {
  it.each(CONVERSATION_KINDS)("%s en solo-lectura no puede nada", (kind) => {
    expect(composerCapabilities(kind, { readOnly: true })).toEqual({
      canSendText: false,
      canSendAudio: false,
      canMention: false,
    });
  });

  it("readOnly gana sobre el kind, incluso en WhatsApp", () => {
    expect(composerCapabilities("whatsapp", { readOnly: true }).canSendText).toBe(false);
  });

  it("readOnly false o ausente no bloquea", () => {
    expect(composerCapabilities("dm", { readOnly: false }).canSendText).toBe(true);
    expect(composerCapabilities("dm", {}).canSendText).toBe(true);
    expect(composerCapabilities("dm").canSendText).toBe(true);
  });
});

describe("kind desconocido o ausente ⇒ fail-closed", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["cadena vacía", ""],
    ["desconocido", "sms"],
    ["mayúsculas", "WhatsApp"],
    ["con espacios", " whatsapp "],
    ["número", 7],
    ["objeto", {}],
    ["arreglo", []],
    ["booleano", false],
  ])("%s no habilita nada", (_l, kind) => {
    expect(composerCapabilities(kind)).toEqual({
      canSendText: false,
      canSendAudio: false,
      canMention: false,
    });
  });
});

describe("reconocimiento de kind", () => {
  it.each(CONVERSATION_KINDS)("%s es un kind válido", (kind) => {
    expect(isConversationKind(kind)).toBe(true);
  });

  it.each(["sms", "email", "WHATSAPP", "whats app", "", " dm"])(
    "%s no es un kind válido",
    (kind) => {
      expect(isConversationKind(kind)).toBe(false);
    },
  );

  it("sólo el literal exacto `whatsapp` rutea al outbound", () => {
    expect(isWhatsappKind("whatsapp")).toBe(true);
    for (const otro of [...CONNECT_KINDS, "WhatsApp", "whatsapp ", "wa", null, undefined]) {
      expect(isWhatsappKind(otro)).toBe(false);
    }
  });
});

describe("17 · pendiente no se muestra como fallo definitivo", () => {
  it("cada resultado tiene su estado visual propio", () => {
    expect(bubbleStatusFor({ status: "sent" })).toBeUndefined();
    expect(bubbleStatusFor({ status: "pending" })).toBe("pending");
    expect(bubbleStatusFor({ status: "failed" })).toBe("failed");
  });

  it("pending NUNCA colapsa a failed", () => {
    expect(bubbleStatusFor({ status: "pending" })).not.toBe("failed");
  });
});

// ══ VISUAL · la burbuja propia distingue el canal ══════════════════════════
/**
 * El verde es el distintivo de WhatsApp: un operador que mira el hilo debe
 * saber por el color en qué canal está escribiendo. La decisión vive acá y no
 * en la vista, que tiene prohibido comparar `kind`.
 */
describe("ownBubbleClass · el color de la burbuja propia depende del canal", () => {
  it("WhatsApp usa el verde distintivo, nunca el rosa de marca", () => {
    const c = ownBubbleClass("whatsapp");
    expect(c).toContain("bg-wa-bubble");
    expect(c).not.toContain("tops-red");
  });

  it.each(["dm", "group", "incident", "task", null, undefined, "", "WHATSAPP"])(
    "`%s` conserva el rosa de Connect",
    (kind) => {
      const c = ownBubbleClass(kind as never);
      expect(c).toContain("bg-tops-red/10");
      expect(c).not.toContain("wa-bubble");
    },
  );

  it("el token es una CSS var: nunca lleva modificador de opacidad", () => {
    // `bg-wa-bubble/60` caería a un gris fijo y perdería el modo oscuro.
    expect(ownBubbleClass("whatsapp")).not.toMatch(/wa-bubble\/\d/);
    expect(ownBubbleClass("whatsapp")).not.toMatch(/wa-stroke\/\d/);
  });

  it("ambas ramas fijan el color de texto", () => {
    for (const k of ["whatsapp", "dm"]) {
      expect(ownBubbleClass(k)).toContain("text-fg-primary");
    }
  });
});

// ══ VISUAL · el botón de envío también identifica el canal ═════════════════
describe("sendButtonClass · la acción declara por qué canal se escribe", () => {
  it("WhatsApp usa el botón verde del canal", () => {
    expect(sendButtonClass("whatsapp")).toBe("btn-wa");
  });

  it.each(["dm", "group", "incident", "task", null, undefined, "", "WhatsApp"])(
    "`%s` conserva el botón de acción de Nexus",
    (kind) => {
      expect(sendButtonClass(kind as never)).toBe("btn-nexus");
    },
  );

  it("nunca devuelve ambas clases a la vez", () => {
    for (const k of ["whatsapp", "dm"]) {
      const c = sendButtonClass(k);
      expect(c.includes("btn-wa") && c.includes("btn-nexus")).toBe(false);
    }
  });
});
