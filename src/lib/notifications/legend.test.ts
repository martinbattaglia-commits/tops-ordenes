// INC-06 · la leyenda de colores, MEDIDA contra la fuente del color.
//
// Una leyenda que declare un significado que el sistema no cumple es peor que
// no tenerla. Estas pruebas impiden que se separe de `CATEGORY_STYLE`.

import { describe, it, expect } from "vitest";
import {
  CATEGORY_LEGEND,
  LEGEND_FOOTNOTE,
  CATEGORY_STYLE,
  categoryForConversationKind,
  type NotificationCategory,
} from "./categories";

describe("INC-06 · la leyenda cubre las tres categorías, sin sobrar ni faltar", () => {
  it("hay exactamente una entrada por categoría de `CATEGORY_STYLE`", () => {
    const enLeyenda = CATEGORY_LEGEND.map((e) => e.category).sort();
    const enEstilo = (Object.keys(CATEGORY_STYLE) as NotificationCategory[]).sort();
    expect(enLeyenda).toEqual(enEstilo);
  });

  it("ninguna categoría aparece dos veces", () => {
    expect(new Set(CATEGORY_LEGEND.map((e) => e.category)).size).toBe(CATEGORY_LEGEND.length);
  });

  it("cada entrada nombra su color EN TEXTO: el color no es el único portador", () => {
    for (const e of CATEGORY_LEGEND) {
      expect(e.colorName.trim().length).toBeGreaterThan(0);
      expect(e.meaning.trim().length).toBeGreaterThan(0);
      // Y el nombre de la categoría que el sistema ya usa sigue disponible.
      expect(CATEGORY_STYLE[e.category].label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("INC-06 · lo que la leyenda AFIRMA es lo que el sistema hace", () => {
  it("el amarillo declara incluir los hilos de Tareas e Incidentes, y así los clasifica el sistema", () => {
    // La afirmación de la leyenda…
    const amarillo = CATEGORY_LEGEND.find((e) => e.category === "yellow_internal")!;
    expect(amarillo.meaning).toMatch(/Tareas e Incidentes/i);
    // …coincide con la clasificación real de esos hilos.
    expect(categoryForConversationKind("task")).toBe("yellow_internal");
    expect(categoryForConversationKind("incident")).toBe("yellow_internal");
  });

  it("el verde es WhatsApp y sólo WhatsApp", () => {
    expect(categoryForConversationKind("whatsapp")).toBe("green_whatsapp");
    const verde = CATEGORY_LEGEND.find((e) => e.category === "green_whatsapp")!;
    expect(verde.meaning).toMatch(/WhatsApp/);
  });

  it("el rojo NO se describe como mensajes de conversación", () => {
    const rojo = CATEGORY_LEGEND.find((e) => e.category === "red_system")!;
    expect(rojo.meaning).toMatch(/[Aa]visos/);
    expect(rojo.meaning).not.toMatch(/mensajes sin leer/i);
  });
});

describe("C4/LOW-2 · la leyenda no promete lo que la vista excluye", () => {
  it("el rojo dice que cuenta lo VENCIDO, no toda notificación sin leer", () => {
    const rojo = CATEGORY_LEGEND.find((e) => e.category === "red_system")!;
    // `v_link_notification_badges` filtra `not is_read AND is_due`.
    expect(rojo.meaning).toMatch(/vencier|vencid/i);
  });

  it("el pie declara los dos filtros que comparten verde y amarillo", () => {
    expect(LEGEND_FOOTNOTE).toMatch(/silenciad/i);
    expect(LEGEND_FOOTNOTE).toMatch(/archivad/i);
  });
});
