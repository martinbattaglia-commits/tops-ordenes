// Nexus Link · PALETA SEMÁNTICA CANÓNICA (sellada por Dirección 2026-07-26 · UX-005).
// El color es información, no decoración:
//
//   ROJO TOPS   (text-tops-red / bg-tops-red)          → acción operativa e identidad del módulo
//                                                        (botones .btn-nexus, íconos de bandeja).
//   ÁMBAR acción (text-amber-400, hover text-amber-300) → la acción "Archivar".
//   ÁMBAR estado (bg-amber-400/15 text-amber-500)       → chips/avisos de archivado, prioridad media,
//                                                        en_espera, presencia idle (bg-amber-400).
//   VERDE       (text/bg-emerald-500 · chip bg-emerald-400/15 text-emerald-500)
//                                                       → éxito/completado/resuelto/online; WhatsApp futuro.
//   VIOLETA     (text-violet-400)                       → IA futura.
//   AZUL institucional (tops-blue / fg-link)            → identidad NEXUS OS y links; NO es color de acción
//                                                        primaria dentro de Link.
//
// Escala tipográfica del módulo: título 13px/semibold · cuerpo text-xs (12px) u 11px en paneles
// densos · metadata 10px (font-mono para IDs). No introducir tamaños px nuevos.

import type { ConversationKind } from "./types";

/** Color del ícono por tipo de conversación en la bandeja (resolución 07-26: todo rojo TOPS;
 *  los canales futuros conservan su identidad propia). */
export const KIND_COLOR: Record<ConversationKind, string> = {
  dm: "text-tops-red",
  group: "text-tops-red",
  channel: "text-tops-red",
  erp: "text-tops-red",
  incident: "text-tops-red",
  whatsapp: "text-emerald-500",
  ai: "text-violet-400",
};

/** Chip de estado "Archivado" (único par ámbar-estado canónico). */
export const ARCHIVED_CHIP = "bg-amber-400/15 text-amber-500";
