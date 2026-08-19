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
 * Capacidades del composer por tipo de conversación.
 *
 * Esta es la restricción que el mandato exige que exista en la LÓGICA y no sólo
 * en CSS: ocultar el botón del micrófono no impide que un atajo, un dictado o un
 * re-render disparen la acción igual.
 *
 * ─── CAMBIO DE CONTRATO EN FASE B ──────────────────────────────────────────
 *
 * WA-8 fijaba WhatsApp como TEXT-ONLY y estas pruebas lo exigían. La razón no
 * era de negocio: no existía camino de salida para media. FASE B lo construye
 * sobre los endpoints oficiales de Meta, así que audio y adjuntos quedan
 * habilitados también en WhatsApp y las expectativas se reescriben a propósito.
 *
 * Lo que NO cambia es la prohibición de MENCIONES en WhatsApp, porque su motivo
 * sigue en pie: filtrarían nombres del tenant a un tercero. Se conserva como
 * caso propio para que aflojar eso siga costando romper una prueba.
 */

const CONNECT_KINDS = CONVERSATION_KINDS.filter((k) => k !== "whatsapp");

describe("WhatsApp · media habilitada, menciones NO", () => {
  it("permite texto, audio y adjuntos, y sigue bloqueando menciones", () => {
    expect(composerCapabilities("whatsapp")).toEqual({
      canSendText: true,
      canSendAudio: true,
      canAttachFile: true,
      canMention: false,
    });
  });

  it("la mención sigue prohibida: es la única restricción de canal que queda", () => {
    expect(composerCapabilities("whatsapp").canMention).toBe(false);
  });
});

describe("21 · audio, adjuntos y menciones operativos en Connect", () => {
  it.each(CONNECT_KINDS)("%s conserva texto, audio, adjuntos y menciones", (kind) => {
    expect(composerCapabilities(kind)).toEqual({
      canSendText: true,
      canSendAudio: true,
      canAttachFile: true,
      canMention: true,
    });
  });
});

// INC-04-R2 · el chat de una TAREA no dejaba escribir.
//
// `task` existe en el enum `connect_conversation_kind_t` desde
// `0167_connect_tasks_enums_permissions.sql`, pero el universo cerrado de este
// módulo se quedó en siete y nunca se enteró. Con el kind fuera de la lista,
// `composerCapabilities` devolvía NONE y el composer quedaba mudo: 22
// conversaciones de tarea sin poder enviar un mensaje durante ocho días.
//
// LAS CAPACIDADES DE UNA TAREA SON LAS DE UN INCIDENTE, y se declara acá en vez
// de dejarlo implícito: un hilo de tarea es chat interno del tenant igual que
// uno de incidente —mismos participantes, misma FK de menciones, mismo destino
// de adjuntos—, así que texto, audio, adjuntos y menciones. No hay ninguna
// razón de canal para recortarle nada; la única restricción que existe en este
// módulo es la de WhatsApp, y una tarea no sale del tenant.
describe("INC-04-R2 · una tarea escribe igual que un incidente", () => {
  it("`task` es un kind reconocido", () => {
    expect(isConversationKind("task")).toBe(true);
  });

  it("una tarea tiene EXACTAMENTE las capacidades de un incidente", () => {
    expect(composerCapabilities("task")).toEqual(composerCapabilities("incident"));
  });

  it("y esas capacidades son texto, audio, adjuntos y menciones", () => {
    expect(composerCapabilities("task")).toEqual({
      canSendText: true,
      canSendAudio: true,
      canAttachFile: true,
      canMention: true,
    });
  });

  it("una tarea NO rutea por el outbound de WhatsApp", () => {
    expect(isWhatsappKind("task")).toBe(false);
  });

  it("readOnly la sigue bloqueando, como a cualquier otro kind", () => {
    expect(composerCapabilities("task", { readOnly: true })).toEqual({
      canSendText: false,
      canSendAudio: false,
      canAttachFile: false,
      canMention: false,
    });
  });
});

describe("22 · archived/readOnly bloquea todo, en cualquier kind", () => {
  it.each(CONVERSATION_KINDS)("%s en solo-lectura no puede nada", (kind) => {
    expect(composerCapabilities(kind, { readOnly: true })).toEqual({
      canSendText: false,
      canSendAudio: false,
      canAttachFile: false,
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
      canAttachFile: false,
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
