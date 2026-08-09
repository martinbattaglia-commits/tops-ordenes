/**
 * Design system documental TOPS Nexus — tokens únicos de color y tipografía.
 * Fuente: referencias de Dirección (2026-07-28) + manual de identidad TOPS.
 * Todo PDF, email o vista imprimible debe consumir estos valores; no
 * hardcodear hex por documento.
 */

export const DOC = {
  /** Navy institucional: bandas de header/footer, bloque total, texto fuerte. */
  navy: "#050555",
  /** Texto principal del cuerpo. */
  ink: "#0B1220",
  /** Rojo TOPS: labels de sección, acentos, advertencias. */
  red: "#C90812",
  /** Etiquetas de campo (gris azulado). */
  label: "#8A94A6",
  labelSoft: "#69738A",
  /** Texto secundario. */
  textSec: "#5A6577",
  /** Reglas y bordes. */
  rule: "#DDE3EC",
  ruleSoft: "#EEF1F6",
  /** Fondos suaves. */
  bgSoft: "#F7F8FB",
  white: "#FFFFFF",
  /** Texto tenue sobre navy (footer/header). */
  onNavySoft: "#B8C0D8",
  /** Semántico de integridad verificada (POD / hash-chain). */
  ok: "#16A34A",
} as const;

export const FONT = {
  /** Sans institucional embebible (sustituto OFL de Gotham, decisión Dirección 2026-07-28). */
  sans: "Montserrat",
  /** Datos duros: numeración, CUIT, importes, hashes, CAE. */
  mono: "JetBrains Mono",
} as const;
