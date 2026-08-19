// NEXUS-LINK-NOTIFICATIONS-MEDIA-001 · FASE A · clasificación de la campanita.
//
// Tres categorías INDEPENDIENTES, nunca fusionadas en un cuarto color y nunca
// suprimidas entre sí (A.1/A.2). Este módulo es la única definición del mapeo
// categoría → color/forma/icono/etiqueta: la campanita, la bandeja y la lista
// de conversaciones lo consumen, de modo que no puedan divergir.
//
// El color NO es el único portador de información (A.4): cada categoría lleva
// además su propio icono, su propia forma (radio de borde) y su texto
// accesible. Los pares de color cumplen contraste AA para texto pequeño:
//   rojo    #c90812 sobre blanco  ≈ 6.0:1
//   verde   #0f6b39 sobre blanco  ≈ 6.5:1
//   amarillo #f2c200 con texto #1f1a00 ≈ 10.6:1

import type { IconName } from "@/components/Icon";

export type NotificationCategory = "red_system" | "green_whatsapp" | "yellow_internal";

/** Tipos de conversación que son chat interno nativo de Nexus Link. */
export const INTERNAL_CONVERSATION_KINDS = [
  "dm", "group", "channel", "erp", "incident", "ai", "task",
] as const;

/**
 * Categoría del badge de una conversación. WhatsApp es verde; todo el resto
 * del chat nativo —incluidos los hilos de tarea, incidente, ERP e IA— es
 * amarillo. Las notificaciones del sistema (rojo) NO son conversaciones y por
 * eso no se resuelven acá.
 */
export function categoryForConversationKind(
  kind: string,
): Extract<NotificationCategory, "green_whatsapp" | "yellow_internal"> {
  return kind === "whatsapp" ? "green_whatsapp" : "yellow_internal";
}

export interface CategoryStyle {
  /** Nombre corto para el usuario. */
  label: string;
  /** Icono propio: la forma distingue la categoría sin depender del color. */
  icon: IconName;
  /** Clases del badge (color + forma). */
  badgeClass: string;
  /** Clases del punto/indicador compacto. */
  dotClass: string;
}

export const CATEGORY_STYLE: Record<NotificationCategory, CategoryStyle> = {
  // Círculo: notificaciones generales del sistema.
  red_system: {
    label: "Notificaciones del sistema",
    icon: "bell",
    badgeClass: "rounded-full bg-[#c90812] text-white",
    dotClass: "rounded-full bg-[#c90812]",
  },
  // Cuadrado redondeado: WhatsApp.
  green_whatsapp: {
    label: "WhatsApp",
    icon: "whatsapp",
    badgeClass: "rounded-[4px] bg-[#0f6b39] text-white",
    dotClass: "rounded-[3px] bg-[#0f6b39]",
  },
  // Cuadrado redondeado con texto oscuro: chat interno.
  yellow_internal: {
    label: "Chat interno",
    icon: "chat",
    badgeClass: "rounded-[4px] bg-[#f2c200] text-[#1f1a00]",
    dotClass: "rounded-[3px] bg-[#f2c200]",
  },
};

/**
 * INC-06 · la LEYENDA que se le muestra al usuario.
 *
 * Dirección pidió «un cartelito con la referencia de qué hace cada color». La
 * condición que hace útil a una leyenda es que sea VERDADERA, así que cada
 * texto de acá se verificó contra lo que el sistema realmente cuenta —la vista
 * `v_link_notification_badges`—, no contra lo que se supone que cuenta:
 *
 *   · rojo     = `v_link_my_notifications` no leídas y vencidas. En producción
 *                son avisos de tarea, incidente, mención y membresía.
 *   · verde    = mensajes sin leer de conversaciones `kind = 'whatsapp'`.
 *   · amarillo = mensajes sin leer de TODA otra conversación. Incluye los hilos
 *                de Tarea y de Incidente, y decirlo importa: el AVISO de una
 *                tarea es rojo, pero un MENSAJE escrito dentro del hilo de esa
 *                misma tarea es amarillo. Una leyenda que callara esa distinción
 *                convertiría una ambigüedad en una afirmación falsa.
 *
 * C4/LOW-2 · los DOS filtros que la vista aplica y la leyenda callaba:
 *   · el rojo cuenta sólo las notificaciones VENCIDAS (`is_due`), no toda
 *     notificación sin leer — por eso el texto dice «que ya vencieron»;
 *   · verde y amarillo excluyen las conversaciones SILENCIADAS y las
 *     ARCHIVADAS. Eso no se mete en la definición de cada color, que quedaría
 *     ilegible, sino en `LEGEND_FOOTNOTE`, que la tarjeta muestra al pie.
 * Una leyenda que promete de más es la misma falla que una que miente, en
 * menor grado: el usuario que silenció un hilo y no ve su badge concluiría que
 * el contador está roto.
 *
 * Deriva de `CATEGORY_STYLE`, que es la única definición del color: la leyenda
 * no puede quedar describiendo un color que la campanita dejó de usar.
 */
export interface CategoryLegendEntry {
  category: NotificationCategory;
  /** Nombre del color, en las palabras del usuario. */
  colorName: string;
  /** Qué cuenta ese color. Verificado contra `v_link_notification_badges`. */
  meaning: string;
}

export const CATEGORY_LEGEND: readonly CategoryLegendEntry[] = [
  {
    category: "red_system",
    colorName: "Rojo",
    meaning: "Avisos del sistema —tareas, incidentes, menciones y membresías— que ya vencieron.",
  },
  {
    category: "yellow_internal",
    colorName: "Amarillo",
    meaning:
      "Mensajes sin leer del chat interno de Nexus Link, incluidos los hilos de Tareas e Incidentes.",
  },
  {
    category: "green_whatsapp",
    colorName: "Verde",
    meaning: "Mensajes sin leer de conversaciones de WhatsApp.",
  },
] as const;

/**
 * C4/LOW-2 · lo que los tres colores tienen en común y no cabe en cada fila.
 * Es parte de la leyenda, no un adorno: sin esto el cartel promete contar cosas
 * que la vista deliberadamente excluye.
 */
export const LEGEND_FOOTNOTE =
  "Las conversaciones silenciadas y las archivadas no suman a ningún contador.";

/** Tope visual del badge. Por encima se muestra `99+`. */
export const BADGE_VISUAL_CAP = 99;

/**
 * Texto que se DIBUJA en el badge. Se recorta a `99+` sólo por espacio: el
 * total exacto viaja siempre en `categoryAriaLabel()` y en el tooltip, como
 * exige el mandato.
 */
export function formatBadgeCount(count: number): string {
  if (count > BADGE_VISUAL_CAP) return `${BADGE_VISUAL_CAP}+`;
  return String(count);
}

/** Etiqueta accesible: categoría + CANTIDAD EXACTA, nunca recortada. */
export function categoryAriaLabel(category: NotificationCategory, count: number): string {
  const { label } = CATEGORY_STYLE[category];
  const unidad = count === 1 ? "pendiente" : "pendientes";
  return `${label}: ${count} ${unidad}`;
}

export interface BadgeCounts {
  red: number;
  green: number;
  yellow: number;
}

export const EMPTY_BADGE_COUNTS: BadgeCounts = { red: 0, green: 0, yellow: 0 };

/**
 * Resumen accesible del botón de la campanita. Enumera SÓLO las categorías con
 * pendientes —una categoría en cero no debe anunciarse ni mostrar badge— con
 * sus cantidades exactas.
 */
export function bellAriaLabel(counts: BadgeCounts): string {
  const partes: string[] = [];
  if (counts.red > 0) partes.push(categoryAriaLabel("red_system", counts.red));
  if (counts.green > 0) partes.push(categoryAriaLabel("green_whatsapp", counts.green));
  if (counts.yellow > 0) partes.push(categoryAriaLabel("yellow_internal", counts.yellow));
  if (partes.length === 0) return "Notificaciones: sin pendientes";
  return `Notificaciones. ${partes.join(". ")}.`;
}
