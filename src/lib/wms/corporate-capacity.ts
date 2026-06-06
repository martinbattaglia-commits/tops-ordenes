/**
 * corporate-capacity.ts — Motor corporativo de capacidad TOPS.
 *
 * Consolida los dos Digital Twins (Pedro Luján 3159 + Agustín Magaldi 1765) en una
 * única fuente corporativa de capacidad/vacancia. Diseño en
 * docs/corporate/TOPS_CORPORATE_CAPACITY_ARCHITECTURE.md.
 *
 * Patrón: adapter + aggregator. Los modelos fuente por sede NO se modifican; cada
 * uno se adapta al contrato normalizado `SiteCapacity`. El motor es PURO: recibe un
 * `CommittedSnapshot` (compromisos del CRM) por parámetro y NO accede a Supabase.
 *
 * Base de medición: **superficie comercializable** = ANMAT + Cargas Generales +
 * Oficinas vendibles. Lo no vendible se reporta aparte en `excluded`.
 *
 * F2.1-4 — HOOK DE CAPACIDAD ACTIVO (`COMMITTED_M2_ENABLED=true`):
 *   reservado  = oportunidades CRM en propuesta/negociación (committed_state='reservado')
 *   comprometido = oportunidades ganadas no onboardeadas (committed_state='comprometido')
 *   ocupado    = onboardeadas → su m² ya vive en la ocupación física del Twin
 *                (committed_state='ocupado' NO se cuenta acá: regla anti-doble-conteo).
 *   vacancia física     = comercializable − ocupado
 *   vacancia comercial  = comercializable − ocupado − comprometido
 *   vacancia proyectada = vacancia comercial − reservado
 *
 * El snapshot lo construye `src/lib/comercial/committed-capacity.ts` desde
 * `crm_opportunities`. Sin snapshot (default {}), reservado=comprometido=0 → el motor
 * devuelve exactamente la vacancia física (activación segura, no-op sin datos CRM).
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

/** F2.1-4: hook de capacidad ACTIVO. El motor consulta el CommittedSnapshot del CRM. */
export const COMMITTED_M2_ENABLED = true;

/** Compromisos del CRM para una (sede, categoría). */
export interface CommittedAmounts {
  /** m² reservados (propuesta/negociación) — vacancia proyectada. */
  reservedM2: number;
  /** m² comprometidos (ganado no onboardeado) — vacancia comercial. */
  committedM2: number;
}

/** Snapshot inyectable: por sede → por categoría → compromisos. */
export type CommittedSnapshot = Record<string, Partial<Record<CapacityCategory, CommittedAmounts>>>;

export interface CategoryCapacity {
  capacityM2: number;
  occupiedM2: number;
  /** Disponible FÍSICO (capacity − occupied), sin descontar compromisos del CRM. */
  availableM2: number;
  /** Reservado por el CRM (propuesta/negociación). */
  reservedM2: number;
  /** Comprometido por el CRM (ganado no onboardeado). */
  committedM2: number;
}

export interface SiteRacks {
  totalPositions: number;
  availablePositions: number;
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
  maniobraM2: number;
  internoM2: number;
  noDesglosadoM2: number;
}

export type SiteConfidence = "exact" | "mixed" | "pending";

export interface CapacityTotals {
  comercializableM2: number;
  ocupadoM2: number;
  /** Disponible físico. */
  disponibleM2: number;
  reservadoM2: number;
  /** Comprometido (alias histórico: committedM2). */
  committedM2: number;
  /** Disponible comercial = disponible físico − comprometido. */
  disponibleComercialM2: number;
  /** Disponible proyectado = comercial − reservado. */
  disponibleProyectadoM2: number;
  /** Vacancia física (disponible físico / comercializable). */
  vacanciaPct: number;
  vacanciaComercialPct: number;
  vacanciaProyectadaPct: number;
}

export interface SiteCapacity {
  siteCode: string;
  siteName: string;
  categories: Record<CapacityCategory, CategoryCapacity>;
  racks: SiteRacks;
  coworking?: SiteCoworking;
  cubiculos?: SiteCubicles;
  totals: CapacityTotals;
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
  totals: CapacityTotals;
}

// ───────────────────────────────────────────────────────────────────────────
// Utilidades
// ───────────────────────────────────────────────────────────────────────────

const round = (n: number) => Math.round(n * 10) / 10;
const pct = (part: number, whole: number) => (whole > 0 ? round((part / whole) * 100) : 0);
const nonNeg = (n: number) => (n < 0 ? 0 : round(n));

function emptyCategory(): CategoryCapacity {
  return { capacityM2: 0, occupiedM2: 0, availableM2: 0, reservedM2: 0, committedM2: 0 };
}

/** Compromisos CRM para (sede, categoría) desde el snapshot. 0 si el hook está off o no hay dato. */
function committedFor(category: CapacityCategory, siteCode: string, snapshot: CommittedSnapshot): CommittedAmounts {
  if (!COMMITTED_M2_ENABLED) return { reservedM2: 0, committedM2: 0 };
  const a = snapshot[siteCode]?.[category];
  return { reservedM2: a?.reservedM2 ?? 0, committedM2: a?.committedM2 ?? 0 };
}

function totalsFrom(categories: Record<CapacityCategory, CategoryCapacity>): CapacityTotals {
  let comercializableM2 = 0, ocupadoM2 = 0, disponibleM2 = 0, reservadoM2 = 0, committedM2 = 0;
  for (const c of CAPACITY_CATEGORIES) {
    comercializableM2 += categories[c].capacityM2;
    ocupadoM2 += categories[c].occupiedM2;
    disponibleM2 += categories[c].availableM2;
    reservadoM2 += categories[c].reservedM2;
    committedM2 += categories[c].committedM2;
  }
  const disponibleComercialM2 = nonNeg(disponibleM2 - committedM2);
  const disponibleProyectadoM2 = nonNeg(disponibleM2 - committedM2 - reservadoM2);
  return {
    comercializableM2: round(comercializableM2),
    ocupadoM2: round(ocupadoM2),
    disponibleM2: round(disponibleM2),
    reservadoM2: round(reservadoM2),
    committedM2: round(committedM2),
    disponibleComercialM2,
    disponibleProyectadoM2,
    vacanciaPct: pct(disponibleM2, comercializableM2),
    vacanciaComercialPct: pct(disponibleComercialM2, comercializableM2),
    vacanciaProyectadaPct: pct(disponibleProyectadoM2, comercializableM2),
  };
}

function cat(capacityM2: number, availableM2: number, com: CommittedAmounts): CategoryCapacity {
  return {
    capacityM2: round(capacityM2),
    availableM2: round(availableM2),
    occupiedM2: round(capacityM2 - availableM2),
    reservedM2: com.reservedM2,
    committedM2: com.committedM2,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Adapter · Pedro Luján 3159
// ───────────────────────────────────────────────────────────────────────────

export function lujanToSiteCapacity(snapshot: CommittedSnapshot = {}): SiteCapacity {
  const SITE = "PEDRO_LUJAN_3159";
  const sectorsBy = (c: "anmat" | "general") => LUJAN_3159.sectors.filter((s) => s.category === c);

  const anmatCap = sectorsBy("anmat").reduce((a, s) => a + s.surfaceM2, 0) +
    LUJAN_3159.cubicleBlocks.reduce((a, b) => a + b.totalM2, 0);
  const generalCap = sectorsBy("general").reduce((a, s) => a + s.surfaceM2, 0);

  const categories: Record<CapacityCategory, CategoryCapacity> = {
    anmat: cat(anmatCap, getAvailableAreaByCategory("anmat"), committedFor("anmat", SITE, snapshot)),
    general: cat(generalCap, getAvailableAreaByCategory("general"), committedFor("general", SITE, snapshot)),
    oficina: { ...emptyCategory(), ...committedFor("oficina", SITE, snapshot) }, // Luján sin oficinas vendibles
  };

  const rackTotal = LUJAN_3159.sectors.reduce((a, s) => a + (s.rack?.positions ?? 0), 0);
  const racks = getAvailableRackCapacity();
  const cubicles = LUJAN_3159.cubicleBlocks.flatMap((b) => b.cubicles);

  return {
    siteCode: SITE,
    siteName: "Pedro Luján 3159",
    categories,
    racks: { totalPositions: rackTotal, availablePositions: racks.positions, pendingSectors: racks.pendingSectors },
    cubiculos: { total: cubicles.length, available: getAvailableAnmatCubicles().length },
    totals: totalsFrom(categories),
    excluded: { maniobraM2: 0, internoM2: 0, noDesglosadoM2: 0 },
    confidence: "mixed",
    sources: LUJAN_3159.meta.sources.map((s) => s.doc),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Adapter · Agustín Magaldi 1765
// ───────────────────────────────────────────────────────────────────────────

export function magaldiToSiteCapacity(snapshot: CommittedSnapshot = {}): SiteCapacity {
  const SITE = "MAGALDI_1765";
  const sumM2 = (pred: (s: (typeof MAGALDI_1765.spaces)[number]) => boolean) =>
    MAGALDI_1765.spaces.filter(pred).reduce((a, s) => a + (s.m2 ?? 0), 0);

  const anmatCap = sumM2((s) => s.category === "anmat");
  const generalCap = sumM2((s) => s.category === "general");
  const oficinaCap = sumM2((s) => s.category === "oficina" && (s.status === "disponible" || s.status === "ocupado"));

  const categories: Record<CapacityCategory, CategoryCapacity> = {
    anmat: cat(anmatCap, getAvailableAnmatM2(), committedFor("anmat", SITE, snapshot)),
    general: cat(generalCap, getAvailableGeneralM2(), committedFor("general", SITE, snapshot)),
    oficina: cat(oficinaCap, getAvailableOfficeM2(), committedFor("oficina", SITE, snapshot)),
  };

  return {
    siteCode: SITE,
    siteName: "Agustín Magaldi 1765",
    categories,
    racks: { totalPositions: MAGALDI_1765.meta.totals.rackPositionsTotal, availablePositions: getAvailableRackPositions(), pendingSectors: [] },
    coworking: {
      islas: MAGALDI_1765.coworkingPremium.islasTotal,
      puestos: MAGALDI_1765.coworkingPremium.puestosTotal,
      disponiblePct: MAGALDI_1765.coworkingPremium.disponiblePct,
    },
    totals: totalsFrom(categories),
    excluded: {
      maniobraM2: sumM2((s) => s.category === "maniobra"),
      internoM2: sumM2((s) => s.category === "oficina" && s.status === "interno"),
      noDesglosadoM2: MAGALDI_1765.meta.totals.cubiertaNoDesglosadaM2Approx,
    },
    confidence: "mixed",
    sources: MAGALDI_1765.meta.sources,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Aggregator corporativo
// ───────────────────────────────────────────────────────────────────────────

export function getSiteCapacities(snapshot: CommittedSnapshot = {}): SiteCapacity[] {
  return [lujanToSiteCapacity(snapshot), magaldiToSiteCapacity(snapshot)];
}

export function getCorporateCapacity(snapshot: CommittedSnapshot = {}): CorporateCapacity {
  const sites = getSiteCapacities(snapshot);

  const byCategory = CAPACITY_CATEGORIES.reduce((acc, c) => {
    acc[c] = sites.reduce<CategoryCapacity>(
      (a, s) => ({
        capacityM2: round(a.capacityM2 + s.categories[c].capacityM2),
        occupiedM2: round(a.occupiedM2 + s.categories[c].occupiedM2),
        availableM2: round(a.availableM2 + s.categories[c].availableM2),
        reservedM2: round(a.reservedM2 + s.categories[c].reservedM2),
        committedM2: round(a.committedM2 + s.categories[c].committedM2),
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

  return { sites, byCategory, racks, coworking, cubiculos, totals: totalsFrom(byCategory) };
}

// ───────────────────────────────────────────────────────────────────────────
// Selectores reutilizables (dashboard + CRM)
// ───────────────────────────────────────────────────────────────────────────

export interface CategoryVacancy {
  capacityM2: number;
  availableM2: number;
  reservedM2: number;
  committedM2: number;
  disponibleComercialM2: number;
  disponibleProyectadoM2: number;
  vacanciaPct: number;
  vacanciaComercialPct: number;
  vacanciaProyectadaPct: number;
}

export interface CorporateVacancySummary {
  comercializableM2: number;
  ocupadoM2: number;
  disponibleM2: number;
  reservadoM2: number;
  committedM2: number;
  disponibleComercialM2: number;
  disponibleProyectadoM2: number;
  vacanciaPct: number;
  vacanciaComercialPct: number;
  vacanciaProyectadaPct: number;
  byCategory: Record<CapacityCategory, CategoryVacancy>;
  rackPositionsDisponibles: number;
  rackPositionsTotal: number;
  coworkingIslas: number;
  cubiculosDisponibles: number;
  /** true si el snapshot trajo compromisos (>0); permite al dashboard mostrar/ocultar el detalle CRM. */
  hasCommitments: boolean;
}

function categoryVacancy(cc: CategoryCapacity): CategoryVacancy {
  const com = nonNeg(cc.availableM2 - cc.committedM2);
  const proy = nonNeg(cc.availableM2 - cc.committedM2 - cc.reservedM2);
  return {
    capacityM2: cc.capacityM2,
    availableM2: cc.availableM2,
    reservedM2: cc.reservedM2,
    committedM2: cc.committedM2,
    disponibleComercialM2: com,
    disponibleProyectadoM2: proy,
    vacanciaPct: pct(cc.availableM2, cc.capacityM2),
    vacanciaComercialPct: pct(com, cc.capacityM2),
    vacanciaProyectadaPct: pct(proy, cc.capacityM2),
  };
}

/** KPIs de cabecera del dashboard corporativo (físico + comercial + proyectado). */
export function getCorporateVacancySummary(snapshot: CommittedSnapshot = {}): CorporateVacancySummary {
  const c = getCorporateCapacity(snapshot);
  const byCategory = CAPACITY_CATEGORIES.reduce((acc, k) => {
    acc[k] = categoryVacancy(c.byCategory[k]);
    return acc;
  }, {} as Record<CapacityCategory, CategoryVacancy>);

  return {
    comercializableM2: c.totals.comercializableM2,
    ocupadoM2: c.totals.ocupadoM2,
    disponibleM2: c.totals.disponibleM2,
    reservadoM2: c.totals.reservadoM2,
    committedM2: c.totals.committedM2,
    disponibleComercialM2: c.totals.disponibleComercialM2,
    disponibleProyectadoM2: c.totals.disponibleProyectadoM2,
    vacanciaPct: c.totals.vacanciaPct,
    vacanciaComercialPct: c.totals.vacanciaComercialPct,
    vacanciaProyectadaPct: c.totals.vacanciaProyectadaPct,
    byCategory,
    rackPositionsDisponibles: c.racks.availablePositions,
    rackPositionsTotal: c.racks.totalPositions,
    coworkingIslas: c.coworking.islas,
    cubiculosDisponibles: c.cubiculos.available,
    hasCommitments: c.totals.committedM2 + c.totals.reservadoM2 > 0,
  };
}

export function getCapacityByCategory(category: CapacityCategory, snapshot: CommittedSnapshot = {}): CategoryCapacity {
  return getCorporateCapacity(snapshot).byCategory[category];
}

export function getCapacityBySite(snapshot: CommittedSnapshot = {}): SiteCapacity[] {
  return getSiteCapacities(snapshot);
}

/** m² disponibles FÍSICOS de una categoría en todas las sedes. */
export function getAvailableByCategory(category: CapacityCategory): number {
  return getCapacityByCategory(category).availableM2;
}

// ───────────────────────────────────────────────────────────────────────────
// findAvailability() — motor de matching (puente con el CRM)
// ───────────────────────────────────────────────────────────────────────────

export interface AvailabilityRequest {
  category: CapacityCategory;
  m2?: number;
  siteCode?: string;
  /** Base de disponibilidad: 'fisica' (default) | 'comercial' (− comprometido) | 'proyectada' (− comprometido − reservado). */
  basis?: "fisica" | "comercial" | "proyectada";
}

export interface AvailabilityOption {
  siteCode: string;
  siteName: string;
  availableM2: number;
  fitsSingleSite: boolean;
}

export interface AvailabilityResult {
  request: AvailabilityRequest;
  feasible: boolean;
  fitsSingleSite: boolean;
  totalAvailableM2: number;
  options: AvailabilityOption[];
  note: string;
}

/**
 * Motor de disponibilidad para el CRM. Por defecto usa disponibilidad FÍSICA;
 * con `basis: 'comercial'|'proyectada'` descuenta compromisos del snapshot.
 */
export function findAvailability(request: AvailabilityRequest, snapshot: CommittedSnapshot = {}): AvailabilityResult {
  const sites = getSiteCapacities(snapshot).filter((s) => !request.siteCode || s.siteCode === request.siteCode);
  const basis = request.basis ?? "fisica";
  const avail = (cc: CategoryCapacity): number =>
    basis === "comercial" ? nonNeg(cc.availableM2 - cc.committedM2)
      : basis === "proyectada" ? nonNeg(cc.availableM2 - cc.committedM2 - cc.reservedM2)
      : cc.availableM2;

  const options: AvailabilityOption[] = sites.map((s) => {
    const availableM2 = avail(s.categories[request.category]);
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
    note = `Disponible ${catLabel} (${basis}): ${totalAvailableM2} m² en ${options.filter((o) => o.availableM2 > 0).length} sede(s).`;
  } else if (fitsSingleSite) {
    const best = options.filter((o) => o.fitsSingleSite).sort((a, b) => a.availableM2 - b.availableM2)[0];
    note = `${need} m² ${catLabel} entran en ${best.siteName} (${best.availableM2} m² ${basis}).`;
  } else if (feasible) {
    note = `${need} m² ${catLabel} no entran en una sola sede; requiere combinación (total ${basis} ${totalAvailableM2} m²).`;
  } else {
    note = `Sin disponibilidad para ${need} m² ${catLabel} (solo ${totalAvailableM2} m² ${basis}). Sugerir alternativa.`;
  }

  return { request, feasible, fitsSingleSite, totalAvailableM2, options, note };
}
