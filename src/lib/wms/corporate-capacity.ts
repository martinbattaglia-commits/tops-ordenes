/**
 * corporate-capacity.ts — Primer motor corporativo de capacidad TOPS.
 *
 * Consolida los dos Digital Twins (Pedro Luján 3159 + Agustín Magaldi 1765) en una
 * única fuente corporativa de capacidad/vacancia. Diseño en
 * docs/corporate/TOPS_CORPORATE_CAPACITY_ARCHITECTURE.md (Fase 0, ratificada).
 *
 * Patrón: adapter + aggregator. Los modelos fuente por sede NO se modifican; cada
 * uno se adapta al contrato normalizado `SiteCapacity`. El dashboard / CRM consumen
 * solo la forma normalizada, nunca los modelos crudos.
 *
 * Base de medición (C-2): **superficie comercializable** = ANMAT + Cargas Generales
 * + Oficinas vendibles. NO la superficie cubierta total. Lo no vendible (maniobra
 * descubierta, cubierta no desglosada, uso interno) se reporta aparte en `excluded`.
 *
 * committed_m2 (C-4 ajustado): el contrato lo soporta, pero el cálculo lo mantiene
 * en 0 hasta F2.1. El dashboard muestra solo capacidad / ocupado físico / disponible
 * físico, y deja el hook listo para el CRM (ver `COMMITTED_M2_ENABLED`).
 */

import { LUJAN_3159, getAvailableAreaByCategory, getAvailableRackCapacity, getAvailableAnmatCubicles } from "./lujan3159-map";
import {
  MAGALDI_1765,
  getAvailableAnmatM2,
  getAvailableGeneralM2,
  getAvailableOfficeM2,
  getAvailableRackPositions,
} from "./magaldi1765-map";

// ───────────────────────────────────────────────────────────────────────────
// Contrato normalizado
// ───────────────────────────────────────────────────────────────────────────

export type CapacityCategory = "anmat" | "general" | "oficina";
export const CAPACITY_CATEGORIES: CapacityCategory[] = ["anmat", "general", "oficina"];

export const CATEGORY_LABEL: Record<CapacityCategory, string> = {
  anmat: "ANMAT",
  general: "Cargas Generales",
  oficina: "Oficinas",
};

/**
 * Hook CRM (C-4): cuando F2.1 exista, poner en true y poblar committedM2 desde
 * crm_opportunities (ganadas no onboardeadas). Hasta entonces committed = 0 y el
 * disponible mostrado es 100% físico.
 */
export const COMMITTED_M2_ENABLED = false;

export interface CategoryCapacity {
  capacityM2: number;
  occupiedM2: number;
  /** Disponible físico (sin descontar compromisos del CRM). */
  availableM2: number;
  /** Comprometido por el CRM. 0 hasta F2.1 (COMMITTED_M2_ENABLED=false). */
  committedM2: number;
}

export interface SiteRacks {
  totalPositions: number;
  availablePositions: number;
  /** Sectores con disponibilidad de racks aún por confirmar (p.ej. Luján PB3). */
  pendingSectors: string[];
}

export interface SiteCoworking {
  islas: number;
  puestos: number;
  disponiblePct: number;
}

export interface SiteCubicles {
  total: number;
  available: number;
}

export interface SiteExcluded {
  /** Playas/playón descubierto — no vendible, no cubierta. */
  maniobraM2: number;
  /** Oficinas de uso interno corporativo (no comercializable). */
  internoM2: number;
  /** Cubierta no desglosada en el croquis (circulación, públicas, servicios). */
  noDesglosadoM2: number;
}

export type SiteConfidence = "exact" | "mixed" | "pending";

export interface SiteCapacity {
  siteCode: string;
  siteName: string;
  categories: Record<CapacityCategory, CategoryCapacity>;
  racks: SiteRacks;
  coworking?: SiteCoworking;
  cubiculos?: SiteCubicles;
  totals: {
    comercializableM2: number;
    ocupadoM2: number;
    disponibleM2: number;
    committedM2: number;
    vacanciaPct: number;
  };
  excluded: SiteExcluded;
  confidence: SiteConfidence;
  sources: string[];
}

export interface CorporateCapacity {
  sites: SiteCapacity[];
  byCategory: Record<CapacityCategory, CategoryCapacity>;
  racks: SiteRacks;
  coworking: SiteCoworking;
  cubiculos: SiteCubicles;
  totals: {
    comercializableM2: number;
    ocupadoM2: number;
    disponibleM2: number;
    committedM2: number;
    vacanciaPct: number;
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Utilidades
// ───────────────────────────────────────────────────────────────────────────

const round = (n: number) => Math.round(n * 10) / 10;
const pct = (part: number, whole: number) => (whole > 0 ? round((part / whole) * 100) : 0);

function emptyCategory(): CategoryCapacity {
  return { capacityM2: 0, occupiedM2: 0, availableM2: 0, committedM2: 0 };
}

/** committed se mantiene en 0 hasta F2.1 (C-4). */
const committedFor = (_category: CapacityCategory, _siteCode: string): number =>
  COMMITTED_M2_ENABLED ? 0 /* TODO F2.1: leer de crm_opportunities */ : 0;

function siteTotals(categories: Record<CapacityCategory, CategoryCapacity>) {
  const comercializableM2 = CAPACITY_CATEGORIES.reduce((a, c) => a + categories[c].capacityM2, 0);
  const ocupadoM2 = CAPACITY_CATEGORIES.reduce((a, c) => a + categories[c].occupiedM2, 0);
  const disponibleM2 = CAPACITY_CATEGORIES.reduce((a, c) => a + categories[c].availableM2, 0);
  const committedM2 = CAPACITY_CATEGORIES.reduce((a, c) => a + categories[c].committedM2, 0);
  return {
    comercializableM2: round(comercializableM2),
    ocupadoM2: round(ocupadoM2),
    disponibleM2: round(disponibleM2),
    committedM2: round(committedM2),
    vacanciaPct: pct(disponibleM2, comercializableM2),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Adapter · Pedro Luján 3159
// ───────────────────────────────────────────────────────────────────────────

export function lujanToSiteCapacity(): SiteCapacity {
  const sectorsBy = (cat: "anmat" | "general") =>
    LUJAN_3159.sectors.filter((s) => s.category === cat);

  // ANMAT = sectores anmat + bloques de cubículos
  const anmatSectorCap = sectorsBy("anmat").reduce((a, s) => a + s.surfaceM2, 0);
  const cubicleCap = LUJAN_3159.cubicleBlocks.reduce((a, b) => a + b.totalM2, 0);
  const anmatCap = anmatSectorCap + cubicleCap;
  const anmatAvail = getAvailableAreaByCategory("anmat");

  const generalCap = sectorsBy("general").reduce((a, s) => a + s.surfaceM2, 0);
  const generalAvail = getAvailableAreaByCategory("general");

  const categories: Record<CapacityCategory, CategoryCapacity> = {
    anmat: { capacityM2: anmatCap, availableM2: anmatAvail, occupiedM2: round(anmatCap - anmatAvail), committedM2: committedFor("anmat", "PEDRO_LUJAN_3159") },
    general: { capacityM2: generalCap, availableM2: generalAvail, occupiedM2: round(generalCap - generalAvail), committedM2: committedFor("general", "PEDRO_LUJAN_3159") },
    oficina: emptyCategory(), // Luján no modela oficinas vendibles
  };

  const rackTotal = LUJAN_3159.sectors.reduce((a, s) => a + (s.rack?.positions ?? 0), 0);
  const racks = getAvailableRackCapacity();
  const cubicles = LUJAN_3159.cubicleBlocks.flatMap((b) => b.cubicles);

  return {
    siteCode: "PEDRO_LUJAN_3159",
    siteName: "Pedro Luján 3159",
    categories,
    racks: { totalPositions: rackTotal, availablePositions: racks.positions, pendingSectors: racks.pendingSectors },
    cubiculos: { total: cubicles.length, available: getAvailableAnmatCubicles().length },
    totals: siteTotals(categories),
    excluded: { maniobraM2: 0, internoM2: 0, noDesglosadoM2: 0 },
    confidence: "mixed", // PB3/PB6 estimados (C-3)
    sources: LUJAN_3159.meta.sources.map((s) => s.doc),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Adapter · Agustín Magaldi 1765
// ───────────────────────────────────────────────────────────────────────────

export function magaldiToSiteCapacity(): SiteCapacity {
  const sumM2 = (pred: (s: (typeof MAGALDI_1765.spaces)[number]) => boolean) =>
    MAGALDI_1765.spaces.filter(pred).reduce((a, s) => a + (s.m2 ?? 0), 0);

  const anmatCap = sumM2((s) => s.category === "anmat");
  const generalCap = sumM2((s) => s.category === "general");
  // Oficinas comercializables = vendibles (disponible) + rentadas (ocupado); excluye interno.
  const oficinaCap = sumM2((s) => s.category === "oficina" && (s.status === "disponible" || s.status === "ocupado"));

  const anmatAvail = getAvailableAnmatM2();
  const generalAvail = getAvailableGeneralM2();
  const oficinaAvail = getAvailableOfficeM2();

  const categories: Record<CapacityCategory, CategoryCapacity> = {
    anmat: { capacityM2: anmatCap, availableM2: anmatAvail, occupiedM2: round(anmatCap - anmatAvail), committedM2: committedFor("anmat", "MAGALDI_1765") },
    general: { capacityM2: generalCap, availableM2: generalAvail, occupiedM2: round(generalCap - generalAvail), committedM2: committedFor("general", "MAGALDI_1765") },
    oficina: { capacityM2: oficinaCap, availableM2: oficinaAvail, occupiedM2: round(oficinaCap - oficinaAvail), committedM2: committedFor("oficina", "MAGALDI_1765") },
  };

  const internoM2 = sumM2((s) => s.category === "oficina" && s.status === "interno");
  const maniobraM2 = sumM2((s) => s.category === "maniobra");

  return {
    siteCode: "MAGALDI_1765",
    siteName: "Agustín Magaldi 1765",
    categories,
    racks: { totalPositions: MAGALDI_1765.meta.totals.rackPositionsTotal, availablePositions: getAvailableRackPositions(), pendingSectors: [] },
    coworking: {
      islas: MAGALDI_1765.coworkingPremium.islasTotal,
      puestos: MAGALDI_1765.coworkingPremium.puestosTotal,
      disponiblePct: MAGALDI_1765.coworkingPremium.disponiblePct,
    },
    totals: siteTotals(categories),
    excluded: { maniobraM2, internoM2, noDesglosadoM2: MAGALDI_1765.meta.totals.cubiertaNoDesglosadaM2Approx },
    confidence: "mixed", // cubierta no desglosada (C-3)
    sources: MAGALDI_1765.meta.sources,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Aggregator corporativo
// ───────────────────────────────────────────────────────────────────────────

/** Todas las sedes adaptadas al contrato normalizado. */
export function getSiteCapacities(): SiteCapacity[] {
  return [lujanToSiteCapacity(), magaldiToSiteCapacity()];
}

/** Capacidad corporativa consolidada (oferta física total). */
export function getCorporateCapacity(): CorporateCapacity {
  const sites = getSiteCapacities();

  const byCategory = CAPACITY_CATEGORIES.reduce((acc, cat) => {
    acc[cat] = sites.reduce<CategoryCapacity>(
      (a, s) => ({
        capacityM2: round(a.capacityM2 + s.categories[cat].capacityM2),
        occupiedM2: round(a.occupiedM2 + s.categories[cat].occupiedM2),
        availableM2: round(a.availableM2 + s.categories[cat].availableM2),
        committedM2: round(a.committedM2 + s.categories[cat].committedM2),
      }),
      emptyCategory(),
    );
    return acc;
  }, {} as Record<CapacityCategory, CategoryCapacity>);

  const racks: SiteRacks = sites.reduce<SiteRacks>(
    (a, s) => ({
      totalPositions: a.totalPositions + s.racks.totalPositions,
      availablePositions: a.availablePositions + s.racks.availablePositions,
      pendingSectors: [...a.pendingSectors, ...s.racks.pendingSectors.map((p) => `${s.siteCode}:${p}`)],
    }),
    { totalPositions: 0, availablePositions: 0, pendingSectors: [] },
  );

  const coworking: SiteCoworking = sites.reduce<SiteCoworking>(
    (a, s) => (s.coworking ? { islas: a.islas + s.coworking.islas, puestos: a.puestos + s.coworking.puestos, disponiblePct: s.coworking.disponiblePct } : a),
    { islas: 0, puestos: 0, disponiblePct: 0 },
  );

  const cubiculos: SiteCubicles = sites.reduce<SiteCubicles>(
    (a, s) => (s.cubiculos ? { total: a.total + s.cubiculos.total, available: a.available + s.cubiculos.available } : a),
    { total: 0, available: 0 },
  );

  return { sites, byCategory, racks, coworking, cubiculos, totals: siteTotals(byCategory) };
}

// ───────────────────────────────────────────────────────────────────────────
// Selectores reutilizables (dashboard + CRM)
// ───────────────────────────────────────────────────────────────────────────

export interface CorporateVacancySummary {
  comercializableM2: number;
  ocupadoM2: number;
  disponibleM2: number;
  committedM2: number;
  vacanciaPct: number;
  byCategory: Record<CapacityCategory, { capacityM2: number; availableM2: number; vacanciaPct: number }>;
  rackPositionsDisponibles: number;
  rackPositionsTotal: number;
  coworkingIslas: number;
  cubiculosDisponibles: number;
}

/** KPIs de cabecera del dashboard corporativo. */
export function getCorporateVacancySummary(): CorporateVacancySummary {
  const c = getCorporateCapacity();
  const byCategory = CAPACITY_CATEGORIES.reduce((acc, cat) => {
    acc[cat] = {
      capacityM2: c.byCategory[cat].capacityM2,
      availableM2: c.byCategory[cat].availableM2,
      vacanciaPct: pct(c.byCategory[cat].availableM2, c.byCategory[cat].capacityM2),
    };
    return acc;
  }, {} as CorporateVacancySummary["byCategory"]);

  return {
    comercializableM2: c.totals.comercializableM2,
    ocupadoM2: c.totals.ocupadoM2,
    disponibleM2: c.totals.disponibleM2,
    committedM2: c.totals.committedM2,
    vacanciaPct: c.totals.vacanciaPct,
    byCategory,
    rackPositionsDisponibles: c.racks.availablePositions,
    rackPositionsTotal: c.racks.totalPositions,
    coworkingIslas: c.coworking.islas,
    cubiculosDisponibles: c.cubiculos.available,
  };
}

/** Capacidad consolidada de una categoría en todas las sedes. */
export function getCapacityByCategory(category: CapacityCategory): CategoryCapacity {
  return getCorporateCapacity().byCategory[category];
}

/** Comparativa por sede (oferta de cada CD). */
export function getCapacityBySite(): SiteCapacity[] {
  return getSiteCapacities();
}

/** m² disponibles de una categoría en todas las sedes. */
export function getAvailableByCategory(category: CapacityCategory): number {
  return getCapacityByCategory(category).availableM2;
}

// ───────────────────────────────────────────────────────────────────────────
// findAvailability() — motor de matching (puente con el CRM)
// ───────────────────────────────────────────────────────────────────────────

export interface AvailabilityRequest {
  category: CapacityCategory;
  /** m² requeridos (opcional). Si se omite, devuelve todo lo disponible. */
  m2?: number;
  /** Restringir a una sede (opcional). */
  siteCode?: string;
}

export interface AvailabilityOption {
  siteCode: string;
  siteName: string;
  availableM2: number;
  /** ¿La sede sola cubre el m² pedido? */
  fitsSingleSite: boolean;
}

export interface AvailabilityResult {
  request: AvailabilityRequest;
  /** ¿Hay disponibilidad total suficiente (sumando sedes)? */
  feasible: boolean;
  /** ¿Alguna sede sola cubre el pedido? */
  fitsSingleSite: boolean;
  totalAvailableM2: number;
  options: AvailabilityOption[];
  note: string;
}

/**
 * Motor de disponibilidad para el CRM: dada una demanda (categoría + m²), devuelve
 * las sedes que pueden cubrirla, si entra en una sola o requiere combinación, o si
 * no hay disponibilidad. Es el hook que cotización/propuesta/onboarding consumirán.
 */
export function findAvailability(request: AvailabilityRequest): AvailabilityResult {
  const sites = getSiteCapacities().filter((s) => !request.siteCode || s.siteCode === request.siteCode);
  const options: AvailabilityOption[] = sites.map((s) => {
    const availableM2 = s.categories[request.category].availableM2;
    return {
      siteCode: s.siteCode,
      siteName: s.siteName,
      availableM2,
      fitsSingleSite: request.m2 != null ? availableM2 >= request.m2 : availableM2 > 0,
    };
  });

  const totalAvailableM2 = round(options.reduce((a, o) => a + o.availableM2, 0));
  const fitsSingleSite = options.some((o) => o.fitsSingleSite);
  const need = request.m2;
  const feasible = need != null ? totalAvailableM2 >= need : totalAvailableM2 > 0;
  const catLabel = CATEGORY_LABEL[request.category];

  let note: string;
  if (need == null) {
    note = `Disponible ${catLabel}: ${totalAvailableM2} m² en ${options.filter((o) => o.availableM2 > 0).length} sede(s).`;
  } else if (fitsSingleSite) {
    const best = options.filter((o) => o.fitsSingleSite).sort((a, b) => a.availableM2 - b.availableM2)[0];
    note = `${need} m² ${catLabel} entran en ${best.siteName} (${best.availableM2} m² disponibles).`;
  } else if (feasible) {
    note = `${need} m² ${catLabel} no entran en una sola sede; requiere combinación (total disponible ${totalAvailableM2} m²).`;
  } else {
    note = `Sin disponibilidad para ${need} m² ${catLabel} (solo ${totalAvailableM2} m² disponibles). Sugerir alternativa de categoría/sede.`;
  }

  return { request, feasible, fitsSingleSite, totalAvailableM2, options, note };
}
