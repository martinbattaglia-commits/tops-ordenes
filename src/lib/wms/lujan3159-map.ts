/**
 * lujan3159-map.ts — Modelo de datos LOCAL y tipado de la sede anexa
 * Pedro Luján 3159 (Barracas, CABA) · Logística TOPS / VEROTIN S.A.
 *
 * FASE 1 del MASTER PROMPT "Mapa Digital Premium · Sede Anexa Pedro Luján 3159".
 * Fuente de verdad: Informe_Auditoria_Deposito_Lujan_3159_rev2.pdf (relevamiento
 * Dirección 04/06/2026), complementado por los cuadros sinópticos de Ocupación y
 * Superficies y los planos "Conforme cliente" de Mecalux Argentina S.A.
 *
 * ⚠️ Este archivo NO toca Supabase ni el seed del Digital Twin (0020/0023). Es una
 * capa de datos local, additive-only, para alimentar la UI premium y, más tarde,
 * el CRM Comercial (forecast / cotización / validación de capacidad).
 *
 * ⚠️ INCONSISTENCIA ESTRUCTURAL CONOCIDA: el seed actual de Supabase usa códigos
 * de sector D1–D8 ("provisional s/plano 717/11"), que NO coinciden con la
 * codificación comercial PB1–PB15 / PA de este relevamiento. Ver
 * docs/lujan/LUJAN_3159_DATA_INCONSISTENCIES.md (#1). La reconciliación con la
 * tabla warehouse_sectors está pendiente de decisión y NO se ejecuta aquí.
 *
 * Confianza del dato (campo `confidence` / `surfaceConfidence`):
 *   - 'exact'       : verificado contra informe rev2 / plano Mecalux / cuadro de superficies.
 *   - 'approximate' : estimado por Dirección (p. ej. PB3 ~50/50, PB6 30/70).
 *   - 'pending'     : a confirmar por relevamiento de calle/posición o por documento.
 */

// ───────────────────────────────────────────────────────────────────────────
// Tipos
// ───────────────────────────────────────────────────────────────────────────

export type ConfidenceLevel = "exact" | "approximate" | "pending";

/** Estado COMERCIAL (distinto del operativo `PositionStatus` del WMS). */
export type CommercialStatus = "ocupado" | "parcial" | "disponible";

/** Habilitación regulatoria del sector. */
export type HabilitationCategory = "general" | "anmat";

export type FloorCode = "PB" | "P1" | "P2";

export type RackSystem = "penetrable" | "selectivo" | "penetrable+selectivo";

export interface SourceRef {
  /** Documento de origen. */
  doc: string;
  /** Detalle / nº de plano / página. */
  detail?: string;
}

export interface RackInfo {
  /** Nº de plano Mecalux. */
  plano: string;
  rev?: string;
  /** Fecha del plano (ISO). */
  fecha?: string;
  system: RackSystem;
  /** Posiciones de paleta totales. */
  positions: number;
  /** Desglose textual, p. ej. "410 penetrable + 24 selectivo". */
  positionsDetail?: string;
  /** Posiciones comercialmente disponibles (null = no determinado). */
  positionsAvailable?: number | null;
  /** Unidad de carga (kg por paleta). */
  unidadCargaKg?: number;
}

export interface SectorOccupancy {
  status: CommercialStatus;
  /** Cliente activo; null si está libre o es multi-cliente sin titular único. */
  client: string | null;
  /** m² ocupados; null cuando el sector ocupa racks pero no superficie de piso. */
  occupiedM2: number | null;
  /** m² disponibles para comercializar. */
  availableM2: number | null;
  confidence: ConfidenceLevel;
  note?: string;
}

export interface Sector {
  /** Código comercial: 'PB1'..'PB15', 'PA1', 'PA2'. */
  code: string;
  name: string;
  category: HabilitationCategory;
  floor: FloorCode;
  /** Superficie total del sector (m²). */
  surfaceM2: number;
  surfaceConfidence: ConfidenceLevel;
  occupancy: SectorOccupancy;
  /** Infraestructura de racks Mecalux, si el sector la tiene. */
  rack?: RackInfo;
  sources: SourceRef[];
}

export interface Cubicle {
  /** 'C01'..'C12'. */
  code: string;
  surfaceM2: number;
  status: Extract<CommercialStatus, "ocupado" | "disponible">;
  client: string | null;
}

export interface CubicleBlock {
  /** Código del bloque: 'PA3+PA7' (1º piso) / 'PA4-PA5' (2º piso). */
  code: string;
  name: string;
  floor: Extract<FloorCode, "P1" | "P2">;
  category: "anmat";
  totalM2: number;
  cubicles: Cubicle[];
  confidence: ConfidenceLevel;
  note?: string;
  sources: SourceRef[];
}

export interface SiteTotals {
  /** Superficie de ALMACENAMIENTO total (no incluye playón/maniobra). */
  storageM2: number;
  generalM2: number;
  anmatM2: number;
  occupiedM2Approx: number;
  availableM2Approx: number;
  occupiedPct: number;
  availablePct: number;
  rackPositionsTotal: number;
  rackPositionsPenetrable: number;
  rackPositionsSelective: number;
  activeClients: number;
}

export interface SiteMeta {
  code: string;
  name: string;
  address: string;
  owner: string;
  /** Superficie del inmueble (cubierta + descubierta + playones) ~7.500 m².
   *  NO es superficie vendible. `confidence: 'approximate'`. */
  buildingM2Approx: number;
  totals: SiteTotals;
  totalsConfidence: ConfidenceLevel;
  relevamiento: string; // fecha de relevamiento
  sources: SourceRef[];
}

export interface LujanSiteModel {
  meta: SiteMeta;
  sectors: Sector[];
  cubicleBlocks: CubicleBlock[];
}

// ───────────────────────────────────────────────────────────────────────────
// Referencias de fuente reutilizables
// ───────────────────────────────────────────────────────────────────────────

const SRC_INFORME: SourceRef = { doc: "Informe_Auditoria_Deposito_Lujan_3159_rev2.pdf" };
const SRC_SUPERFICIES: SourceRef = { doc: "Cuadro sinóptico de superficies (04/06/2026)" };
const SRC_OCUPACION: SourceRef = { doc: "Cuadro sinóptico de ocupación comercial (04/06/2026)" };

// ───────────────────────────────────────────────────────────────────────────
// Modelo canónico
// ───────────────────────────────────────────────────────────────────────────

export const LUJAN_3159: LujanSiteModel = {
  meta: {
    code: "PEDRO_LUJAN_3159",
    name: "Depósito Anexo — Pedro Luján 3159",
    address: "Pedro Luján 3159, Barracas, CABA",
    owner: "CLIMAC S.A. / VEROTIN S.A.",
    buildingM2Approx: 7500,
    relevamiento: "2026-06-04",
    totals: {
      storageM2: 5928,
      generalM2: 5284,
      anmatM2: 644,
      occupiedM2Approx: 2315,
      availableM2Approx: 3613,
      occupiedPct: 39,
      availablePct: 61,
      rackPositionsTotal: 1413,
      rackPositionsPenetrable: 1389,
      rackPositionsSelective: 24,
      activeClients: 13,
    },
    totalsConfidence: "exact",
    sources: [SRC_INFORME, SRC_SUPERFICIES, SRC_OCUPACION],
  },

  sectors: [
    // ── Planta Baja · Cargas Generales ──────────────────────────────────────
    {
      code: "PB1",
      name: "Depósito PB1",
      category: "general",
      floor: "PB",
      surfaceM2: 805,
      surfaceConfidence: "exact",
      occupancy: {
        status: "parcial",
        client: "Avantecno",
        occupiedM2: null, // ocupa racks selectivos, no superficie de piso
        availableM2: 805,
        confidence: "exact",
        note: "24 posiciones selectivas en uso por Avantecno (vinculado a PA1). Superficie de piso y 410 posiciones penetrables comercialmente disponibles.",
      },
      rack: {
        plano: "951207-1",
        rev: "00",
        fecha: "2017-05-02",
        system: "penetrable+selectivo",
        positions: 434,
        positionsDetail: "410 penetrable + 24 selectivo",
        positionsAvailable: 410,
        unidadCargaKg: 800,
      },
      sources: [SRC_INFORME, { doc: "Plano Mecalux 951207-1 rev.00" }],
    },
    {
      code: "PB2",
      name: "Depósito PB2",
      category: "general",
      floor: "PB",
      surfaceM2: 997,
      surfaceConfidence: "exact",
      occupancy: {
        status: "disponible",
        client: null,
        occupiedM2: 0,
        availableM2: 997,
        confidence: "exact",
      },
      rack: {
        plano: "1762646-1",
        rev: "00",
        fecha: "2023-07-11",
        system: "penetrable",
        positions: 248,
        positionsAvailable: 248,
        unidadCargaKg: 1200,
      },
      sources: [SRC_INFORME, { doc: "Plano Mecalux 1762646-1 rev.00" }],
    },
    {
      code: "PB3",
      name: "Depósito PB3",
      category: "general",
      floor: "PB",
      surfaceM2: 500,
      surfaceConfidence: "exact",
      occupancy: {
        status: "parcial",
        client: "Divanlito",
        occupiedM2: 250,
        availableM2: 250,
        confidence: "approximate",
        note: "Ala derecha ocupada por Divanlito; ala izquierda disponible. Ocupación ~50/50 a CONFIRMAR por calle/posición contra plano Mecalux 1037501-1.",
      },
      rack: {
        plano: "1037501-1",
        rev: "01",
        fecha: "2018-01-23",
        system: "penetrable",
        positions: 483,
        positionsAvailable: null, // ~media capacidad, a confirmar
        unidadCargaKg: 800,
      },
      sources: [SRC_INFORME, { doc: "Plano Mecalux 1037501-1 rev.01" }],
    },
    {
      code: "PB4",
      name: "Depósito PB4",
      category: "general",
      floor: "PB",
      surfaceM2: 300,
      surfaceConfidence: "exact",
      occupancy: { status: "ocupado", client: "Silica Networks", occupiedM2: 300, availableM2: 0, confidence: "exact" },
      sources: [SRC_INFORME, SRC_OCUPACION],
    },
    {
      code: "PB5",
      name: "Depósito PB5",
      category: "general",
      floor: "PB",
      surfaceM2: 970,
      surfaceConfidence: "exact",
      occupancy: { status: "ocupado", client: "Divanlito", occupiedM2: 970, availableM2: 0, confidence: "exact" },
      sources: [SRC_INFORME, SRC_OCUPACION],
    },
    {
      code: "PB6",
      name: "Depósito PB6",
      category: "general",
      floor: "PB",
      surfaceM2: 506,
      surfaceConfidence: "exact",
      occupancy: {
        status: "parcial",
        client: "Clientes varios",
        occupiedM2: 152,
        availableM2: 354,
        confidence: "approximate",
        note: "Ocupación compartida ~30% (152 m²) / disponible ~70% (354 m²) — ESTIMADO por Dirección.",
      },
      sources: [SRC_INFORME, SRC_OCUPACION],
    },
    {
      code: "PB7",
      name: "Depósito PB7",
      category: "general",
      floor: "PB",
      surfaceM2: 300,
      surfaceConfidence: "exact",
      occupancy: { status: "ocupado", client: "Silica Networks", occupiedM2: 300, availableM2: 0, confidence: "exact" },
      sources: [SRC_INFORME, SRC_OCUPACION],
    },
    {
      code: "PB8",
      name: "Depósito PB8",
      category: "general",
      floor: "PB",
      surfaceM2: 806,
      surfaceConfidence: "exact",
      occupancy: { status: "disponible", client: null, occupiedM2: 0, availableM2: 806, confidence: "exact" },
      rack: {
        plano: "1764929-1",
        rev: "00",
        fecha: "2023-07-13",
        system: "penetrable",
        positions: 248,
        positionsAvailable: 248,
        unidadCargaKg: 1200,
      },
      sources: [SRC_INFORME, { doc: "Plano Mecalux 1764929-1 rev.00" }],
    },

    // ── Planta Baja · ANMAT (m² corregidos por Dirección) ───────────────────
    {
      code: "PB10",
      name: "Depósito PB10",
      category: "anmat",
      floor: "PB",
      surfaceM2: 16,
      surfaceConfidence: "exact",
      occupancy: {
        status: "ocupado",
        client: "Elintec",
        occupiedM2: 16,
        availableM2: 0,
        confidence: "exact",
        note: "Superficie corregida por Dirección (antes 30 m²).",
      },
      sources: [SRC_INFORME, SRC_SUPERFICIES],
    },
    {
      code: "PB11",
      name: "Depósito PB11",
      category: "anmat",
      floor: "PB",
      surfaceM2: 12,
      surfaceConfidence: "exact",
      occupancy: {
        status: "ocupado",
        client: "Cala Med",
        occupiedM2: 12,
        availableM2: 0,
        confidence: "exact",
        note: "Superficie corregida por Dirección (antes 30 m²).",
      },
      sources: [SRC_INFORME, SRC_SUPERFICIES],
    },
    {
      code: "PB15",
      name: "Depósito PB15",
      category: "anmat",
      floor: "PB",
      surfaceM2: 30,
      surfaceConfidence: "exact",
      occupancy: {
        status: "ocupado",
        client: "Q-Advice",
        occupiedM2: 30,
        availableM2: 0,
        confidence: "exact",
        note: "Superficie corregida por Dirección (antes 60 m²).",
      },
      sources: [SRC_INFORME, SRC_SUPERFICIES],
    },

    // ── 1º Piso ─────────────────────────────────────────────────────────────
    {
      code: "PA1",
      name: "Planta Alta 1 (PA1)",
      category: "general",
      floor: "P1",
      surfaceM2: 100,
      surfaceConfidence: "exact",
      occupancy: {
        status: "ocupado",
        client: "Avantecno",
        occupiedM2: 100,
        availableM2: 0,
        confidence: "exact",
        note: "Vinculado al uso de las 24 posiciones selectivas de PB1.",
      },
      sources: [SRC_INFORME, SRC_SUPERFICIES],
    },
    {
      code: "PA2",
      name: "Planta Alta 2 (PA2)",
      category: "anmat",
      floor: "P1",
      surfaceM2: 70,
      surfaceConfidence: "exact",
      occupancy: { status: "ocupado", client: "Vitalis Pharma", occupiedM2: 70, availableM2: 0, confidence: "exact" },
      sources: [SRC_INFORME, SRC_SUPERFICIES],
    },
  ],

  cubicleBlocks: [
    // ── 1º Piso · 12 cubículos ANMAT ────────────────────────────────────────
    {
      code: "PA3+PA7",
      name: "Cubículos ANMAT · 1º Piso",
      floor: "P1",
      category: "anmat",
      totalM2: 258,
      confidence: "exact",
      note: "C01–C06 = 18 m² c/u · C07–C12 = 25 m² c/u. Servidos por montacargas exclusivo. Ocupados: C01–C05 + C12 (s/ pie de cuadro de ocupación). Disponibles: C06–C11 = 143 m².",
      sources: [SRC_INFORME, { doc: "Croquis_Cubiculos_ANMAT_-_Primer_Piso.pdf" }, SRC_OCUPACION],
      cubicles: [
        { code: "C01", surfaceM2: 18, status: "ocupado", client: "Narena SRL" },
        { code: "C02", surfaceM2: 18, status: "ocupado", client: "Tex Argenta SRL" },
        { code: "C03", surfaceM2: 18, status: "ocupado", client: "T.G. Health SRL" },
        { code: "C04", surfaceM2: 18, status: "ocupado", client: "Laboratorios Integrador" },
        { code: "C05", surfaceM2: 18, status: "ocupado", client: "Nicolas Leonardo Company" },
        { code: "C06", surfaceM2: 18, status: "disponible", client: null },
        { code: "C07", surfaceM2: 25, status: "disponible", client: null },
        { code: "C08", surfaceM2: 25, status: "disponible", client: null },
        { code: "C09", surfaceM2: 25, status: "disponible", client: null },
        { code: "C10", surfaceM2: 25, status: "disponible", client: null },
        { code: "C11", surfaceM2: 25, status: "disponible", client: null },
        { code: "C12", surfaceM2: 25, status: "ocupado", client: "Bonfarto Salud SA" },
      ],
    },
    // ── 2º Piso · 12 cubículos ANMAT (todos disponibles) ────────────────────
    {
      code: "PA4-PA5",
      name: "Cubículos ANMAT · 2º Piso",
      floor: "P2",
      category: "anmat",
      totalM2: 258,
      confidence: "pending",
      note: "INCONSISTENCIA DOCUMENTAL: el croquis rotula PA4 y el informe PA5 para el 2º piso. Usar 'PA4-PA5' hasta resolver. C01–C06 = 18 m² · C07–C12 = 25 m². Los 12 disponibles.",
      sources: [SRC_INFORME, { doc: "Croquis_Cubiculos_ANMAT_-_Segundo_Piso.pdf" }],
      cubicles: [
        { code: "C01", surfaceM2: 18, status: "disponible", client: null },
        { code: "C02", surfaceM2: 18, status: "disponible", client: null },
        { code: "C03", surfaceM2: 18, status: "disponible", client: null },
        { code: "C04", surfaceM2: 18, status: "disponible", client: null },
        { code: "C05", surfaceM2: 18, status: "disponible", client: null },
        { code: "C06", surfaceM2: 18, status: "disponible", client: null },
        { code: "C07", surfaceM2: 25, status: "disponible", client: null },
        { code: "C08", surfaceM2: 25, status: "disponible", client: null },
        { code: "C09", surfaceM2: 25, status: "disponible", client: null },
        { code: "C10", surfaceM2: 25, status: "disponible", client: null },
        { code: "C11", surfaceM2: 25, status: "disponible", client: null },
        { code: "C12", surfaceM2: 25, status: "disponible", client: null },
      ],
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// Selectores de Comercial Readiness (FASE 3) — derivaciones puras sobre el modelo.
// Pensados para que el CRM consuma disponibilidad sin recalcular en cada vista.
// ───────────────────────────────────────────────────────────────────────────

export interface CommercialAvailabilitySummary {
  storageM2: number;
  occupiedM2: number;
  availableM2: number;
  occupiedPct: number;
  availablePct: number;
  availableGeneralM2: number;
  availableAnmatM2: number;
  availableRackPositions: number;
  availableAnmatCubicles: number;
  fullyAvailableSectors: string[];
  partialSectors: string[];
}

/** m² disponibles por categoría de habilitación (sectores + cubículos ANMAT). */
export function getAvailableAreaByCategory(
  category: HabilitationCategory,
  model: LujanSiteModel = LUJAN_3159,
): number {
  const sectorM2 = model.sectors
    .filter((s) => s.category === category)
    .reduce((acc, s) => acc + (s.occupancy.availableM2 ?? 0), 0);
  const cubicleM2 =
    category === "anmat"
      ? model.cubicleBlocks
          .flatMap((b) => b.cubicles)
          .filter((c) => c.status === "disponible")
          .reduce((acc, c) => acc + c.surfaceM2, 0)
      : 0;
  return sectorM2 + cubicleM2;
}

/** Posiciones de paleta disponibles (suma de racks con disponibilidad conocida). */
export function getAvailableRackCapacity(
  model: LujanSiteModel = LUJAN_3159,
): { positions: number; pendingSectors: string[] } {
  let positions = 0;
  const pendingSectors: string[] = [];
  for (const s of model.sectors) {
    if (!s.rack) continue;
    if (s.rack.positionsAvailable == null) pendingSectors.push(s.code);
    else positions += s.rack.positionsAvailable;
  }
  return { positions, pendingSectors };
}

/** Cubículos ANMAT disponibles, con m² y piso. */
export function getAvailableAnmatCubicles(
  model: LujanSiteModel = LUJAN_3159,
): Array<{ block: string; floor: FloorCode; code: string; surfaceM2: number }> {
  return model.cubicleBlocks.flatMap((b) =>
    b.cubicles
      .filter((c) => c.status === "disponible")
      .map((c) => ({ block: b.code, floor: b.floor, code: c.code, surfaceM2: c.surfaceM2 })),
  );
}

/** Resumen comercial consolidado para Dirección / CRM. */
export function getCommercialAvailabilitySummary(
  model: LujanSiteModel = LUJAN_3159,
): CommercialAvailabilitySummary {
  const availableGeneralM2 = getAvailableAreaByCategory("general", model);
  const availableAnmatM2 = getAvailableAreaByCategory("anmat", model);
  const availableM2 = availableGeneralM2 + availableAnmatM2;
  const storageM2 = model.meta.totals.storageM2;
  const occupiedM2 = storageM2 - availableM2;

  return {
    storageM2,
    occupiedM2,
    availableM2,
    occupiedPct: Math.round((occupiedM2 / storageM2) * 100),
    availablePct: Math.round((availableM2 / storageM2) * 100),
    availableGeneralM2,
    availableAnmatM2,
    availableRackPositions: getAvailableRackCapacity(model).positions,
    availableAnmatCubicles: getAvailableAnmatCubicles(model).length,
    fullyAvailableSectors: model.sectors
      .filter((s) => s.occupancy.status === "disponible")
      .map((s) => s.code),
    partialSectors: model.sectors
      .filter((s) => s.occupancy.status === "parcial")
      .map((s) => s.code),
  };
}
