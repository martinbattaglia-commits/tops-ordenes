/* ── Recorridos Virtuales · fuente de verdad ───────────────────────────────
 *
 * Registro único de los recorridos virtuales 360° de los depósitos de
 * Logística TOPS. La landing de Herramientas lee de acá.
 *
 * Los tours NO se embeben en <iframe> (las plataformas lo bloquean) — las
 * tarjetas abren el tour en una pestaña nueva.
 */

export type TourStatus = "available" | "coming_soon";

export interface VirtualTour {
  /** Identificador estable de la sede (key de React / orden). */
  slug: string;
  /** Título completo de la sede. */
  title: string;
  /** Nombre corto para la tarjeta. */
  shortTitle: string;
  description: string;
  status: TourStatus;
  /** URL del tour 360° (se abre en pestaña nueva). Vacío → "en preparación". */
  tourUrl: string;
}

export const VIRTUAL_TOURS: VirtualTour[] = [
  {
    slug: "lujan",
    title: "Sede Anexa Luján — ANMAT",
    shortTitle: "Sede Anexa Luján",
    description:
      "Recorrido virtual 360° del depósito habilitado ANMAT en la sede anexa de Luján.",
    status: "available",
    tourUrl: "https://realsee.ai/49kkW65w",
  },
  {
    slug: "barracas-anmat",
    title: "Sede Central Barracas — ANMAT",
    shortTitle: "Sede Central Barracas — ANMAT",
    description:
      "Recorrido virtual 360° del depósito habilitado ANMAT en Agustín Magaldi 1765.",
    status: "available",
    tourUrl:
      "https://tour.klapty.com/BW20OJ5Iae/?deeplinking=true&startscene=84&startactions=lookat(0,0,90,0,0)",
  },
  {
    slug: "barracas-general",
    title: "Sede Central Barracas — Cargas Generales",
    shortTitle: "Sede Central Barracas — Cargas Generales",
    description: "Recorrido virtual 360° del depósito de cargas generales.",
    status: "available",
    tourUrl:
      "https://tour.klapty.com/BW20OJ5Iae/?deeplinking=true&startscene=0&startactions=lookat(0,0,89.02,0,0)",
  },
];
