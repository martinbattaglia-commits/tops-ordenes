// NEXUS-LINK-NOTIFICATIONS-MEDIA-001 · FASE A · reglas de clasificación.
//
// Las tres categorías son independientes y el color no puede ser el único
// portador de información. Estas reglas son puras: se prueban acá, sin DB.

import { describe, expect, it } from "vitest";
import {
  BADGE_VISUAL_CAP,
  CATEGORY_STYLE,
  INTERNAL_CONVERSATION_KINDS,
  bellAriaLabel,
  categoryAriaLabel,
  categoryForConversationKind,
  formatBadgeCount,
} from "./categories";

describe("categoryForConversationKind", () => {
  it("WhatsApp es verde", () => {
    expect(categoryForConversationKind("whatsapp")).toBe("green_whatsapp");
  });

  it("todo el chat nativo es amarillo, incluidos tarea, incidente, ERP e IA", () => {
    for (const kind of INTERNAL_CONVERSATION_KINDS) {
      expect(categoryForConversationKind(kind)).toBe("yellow_internal");
    }
  });

  it("un kind desconocido cae en amarillo, no en verde (fail-safe)", () => {
    // Nunca debe inventar un pendiente de WhatsApp donde no lo hay.
    expect(categoryForConversationKind("kind-que-no-existe")).toBe("yellow_internal");
  });
});

describe("formatBadgeCount", () => {
  it("muestra la cifra exacta hasta el tope visual", () => {
    expect(formatBadgeCount(0)).toBe("0");
    expect(formatBadgeCount(1)).toBe("1");
    expect(formatBadgeCount(42)).toBe("42");
    expect(formatBadgeCount(BADGE_VISUAL_CAP)).toBe("99");
  });

  it("recorta a 99+ sólo por encima del tope", () => {
    expect(formatBadgeCount(100)).toBe("99+");
    expect(formatBadgeCount(1572)).toBe("99+");
  });
});

describe("etiquetas accesibles", () => {
  it("el aria-label lleva la cantidad EXACTA aunque el badge muestre 99+", () => {
    expect(formatBadgeCount(1572)).toBe("99+");
    expect(categoryAriaLabel("green_whatsapp", 1572)).toContain("1572");
  });

  it("singular y plural", () => {
    expect(categoryAriaLabel("red_system", 1)).toBe("Notificaciones del sistema: 1 pendiente");
    expect(categoryAriaLabel("red_system", 2)).toBe("Notificaciones del sistema: 2 pendientes");
  });

  it("el resumen de la campanita enumera SÓLO las categorías con pendientes", () => {
    const label = bellAriaLabel({ red: 3, green: 0, yellow: 7 });
    expect(label).toContain("Notificaciones del sistema: 3");
    expect(label).toContain("Chat interno: 7");
    expect(label).not.toContain("WhatsApp");
  });

  it("sin pendientes lo dice explícitamente", () => {
    expect(bellAriaLabel({ red: 0, green: 0, yellow: 0 })).toBe("Notificaciones: sin pendientes");
  });

  it("con las tres categorías activas las nombra a las tres", () => {
    const label = bellAriaLabel({ red: 1, green: 2, yellow: 3 });
    expect(label).toContain("Notificaciones del sistema: 1");
    expect(label).toContain("WhatsApp: 2");
    expect(label).toContain("Chat interno: 3");
  });
});

describe("estilos: el color no es el único portador de información", () => {
  it("cada categoría tiene icono propio", () => {
    const iconos = Object.values(CATEGORY_STYLE).map((s) => s.icon);
    expect(new Set(iconos).size).toBe(iconos.length);
  });

  it("el rojo se distingue por forma; verde y amarillo comparten forma y se separan por icono", () => {
    // Honestidad sobre lo que la forma aporta: el círculo separa al rojo de los
    // otros dos, pero verde y amarillo son ambos cuadrados. Entre esos dos el
    // portador no cromático es el ICONO, verificado arriba, no el radio.
    expect(CATEGORY_STYLE.red_system.badgeClass).toContain("rounded-full");
    expect(CATEGORY_STYLE.green_whatsapp.badgeClass).toContain("rounded-[4px]");
    expect(CATEGORY_STYLE.yellow_internal.badgeClass).toContain("rounded-[4px]");
    expect(CATEGORY_STYLE.green_whatsapp.icon).not.toBe(CATEGORY_STYLE.yellow_internal.icon);
  });

  it("cada categoría tiene etiqueta legible propia", () => {
    const labels = Object.values(CATEGORY_STYLE).map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("el amarillo usa texto oscuro: blanco sobre amarillo no alcanza el contraste AA", () => {
    expect(CATEGORY_STYLE.yellow_internal.badgeClass).toContain("text-[#1f1a00]");
    expect(CATEGORY_STYLE.yellow_internal.badgeClass).not.toContain("text-white");
  });
});
