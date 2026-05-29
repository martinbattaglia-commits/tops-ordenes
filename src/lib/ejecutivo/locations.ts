/**
 * Constantes geográficas — client-safe (sin dependencias server).
 * Usado por AmbaMap (client component) y por el data layer ejecutivo.
 */

export interface LocationStatus {
  id: string;
  name: string;
  address: string;
  tag: "ANMAT" | "General" | "Distribución";
  occupancyPct: number;
  m2: number;
  activeOps: number;
  online: boolean;
}

export const LOCATIONS: LocationStatus[] = [
  {
    id: "magaldi",
    name: "Magaldi",
    address: "Agustín Magaldi 1765 · Barracas, CABA",
    tag: "ANMAT",
    occupancyPct: 87,
    m2: 6800,
    activeOps: 14,
    online: true,
  },
  {
    id: "barracas",
    name: "Barracas",
    address: "Av. Vélez Sarsfield · CABA",
    tag: "General",
    occupancyPct: 72,
    m2: 5400,
    activeOps: 9,
    online: true,
  },
  {
    id: "lujan",
    name: "Pedro de Luján",
    address: "Pedro de Luján 3159 · CABA",
    tag: "Distribución",
    occupancyPct: 61,
    m2: 2800,
    activeOps: 6,
    online: true,
  },
];
