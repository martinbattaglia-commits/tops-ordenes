/**
 * Constantes geográficas — client-safe (sin dependencias server).
 * Usado por AmbaMap (client component) y por el data layer ejecutivo.
 *
 * QW Fase 1 (2026-05-29):
 *  - Se eliminaron los valores ficticios de `occupancyPct` y `activeOps`.
 *  - Ambos campos ahora son `null` hasta que exista una fuente real
 *    (entrada operativa o sondas IoT). La UI debe renderizar "—" o
 *    "Dato no disponible" cuando estén en null.
 *  - Los datos estables y verificables (id, name, address, tag, m2)
 *    se mantienen — son configuración corporativa de Verotin S.A.
 */

export interface LocationStatus {
  id: string;
  name: string;
  address: string;
  tag: "ANMAT" | "General" | "Distribución";
  /** Ocupación real-time en %. null hasta que haya fuente verificable. */
  occupancyPct: number | null;
  /** Superficie útil en m² — dato estable de planimetría corporativa. */
  m2: number;
  /** Operaciones activas en este momento. null hasta integración real. */
  activeOps: number | null;
  online: boolean;
}

export const LOCATIONS: LocationStatus[] = [
  {
    id: "magaldi",
    name: "Magaldi",
    address: "Agustín Magaldi 1765 · Barracas, CABA",
    tag: "ANMAT",
    occupancyPct: null,
    m2: 6800,
    activeOps: null,
    online: true,
  },
  {
    id: "barracas",
    name: "Barracas",
    address: "Av. Vélez Sarsfield · CABA",
    tag: "General",
    occupancyPct: null,
    m2: 5400,
    activeOps: null,
    online: true,
  },
  {
    id: "lujan",
    name: "Pedro de Luján",
    address: "Pedro de Luján 3159 · CABA",
    tag: "Distribución",
    occupancyPct: null,
    m2: 2800,
    activeOps: null,
    online: true,
  },
];
