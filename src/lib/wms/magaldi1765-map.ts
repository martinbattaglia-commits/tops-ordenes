/**
 * magaldi1765-map.ts — Modelo de datos LOCAL y tipado de la Sede Central
 * Corporativa Agustín Magaldi 1765 / Osvaldo de la Cruz 3201 (CABA).
 * Logística TOPS / VEROTIN S.A.
 *
 * FASE 1 del MASTER PROMPT "Digital Twin Premium Corporativo · Magaldi 1765".
 * Fuente de verdad: croquis comercial (Croquis-2-Comercial-CD-Magaldi) + INVENTARIO
 * OFICIAL del master prompt (cruzados y validados: ANMAT 1.441 m², CG 2.520 m²,
 * racks 964 selectivas, coworking 50 m² + 11 islas). Plano incendio Cert. 460/19.
 *
 * ⚠️ Capa local, additive-only. NO toca Supabase ni el seed (0020 usa S1–S5,
 * superseded por la codificación comercial PB/OF/PA — ver inconsistencia M-1 en
 * docs/magaldi/MAGALDI_DIGITAL_MAP_CODE_AUDIT.md). NO reemplaza el mapa operativo.
 *
 * Confianza (`confidence`): 'exact' (croquis/inventario) · 'approximate' · 'pending'.
 */

// ───────────────────────────────────────────────────────────────────────────
// Tipos
// ───────────────────────────────────────────────────────────────────────────

export type ConfidenceLevel = "exact" | "approximate" | "pending";

/** Categoría de espacio (sede corporativa, más amplia que un depósito). */
export type SpaceCategory =
  | "anmat"
  | "general"
  | "oficina"
  | "coworking"
  | "publica"
  | "servicio"
  | "maniobra";

/** Estado comercial. interno = oficina propia no comercial · na = no comercializable. */
export type CommercialStatus = "disponible" | "ocupado" | "interno" | "na";

export type FloorCode = "PA" | "PB";

export interface MagaldiSpace {
  /** id único (desambigua la colisión PB1 depósito vs OFPB1 oficina). */
  id: string;
  /** Etiqueta visible del croquis. */
  name: string;
  category: SpaceCategory;
  status: CommercialStatus;
  floor: FloorCode;
  /** Superficie m² (null = sin dato en croquis / no medido). */
  m2: number | null;
  /** Posiciones de rack selectivo, si el sector las tiene. */
  rackPositions?: number;
  note?: string;
  confidence: ConfidenceLevel;
}

export interface CoworkingComposition {
  tipo: string;
  islas: number;
  puestosPorIsla: number;
}

export interface CoworkingPremium {
  islasTotal: number;
  puestosTotal: number;
  disponiblePct: number;
  composicion: CoworkingComposition[];
  incluye: string[];
}

export interface MagaldiTotals {
  /** Superficie cubierta registrada (Expte. 35391367/2018, Cert. 460/19). */
  cubiertaM2: number;
  anmatM2: number;
  anmatDisponibleM2: number;
  generalM2: number;
  generalDisponibleM2: number;
  oficinaVendibleM2: number;
  rackPositionsTotal: number;
  rackPositionsDisponibles: number;
  /** Cubierta no desglosada en el croquis (oficinas internas, públicas, servicios, circulación). */
  cubiertaNoDesglosadaM2Approx: number;
  /** Maniobra descubierta (NO computa en cubierta ni en vendible). */
  maniobraDescubiertaM2: number;
}

export interface MagaldiMeta {
  code: string;
  name: string;
  address: string;
  owner: string;
  destino: string;
  expediente: string;
  certificado: string;
  totals: MagaldiTotals;
  totalsConfidence: ConfidenceLevel;
  relevamiento: string;
  sources: string[];
}

export interface MagaldiSiteModel {
  meta: MagaldiMeta;
  spaces: MagaldiSpace[];
  coworkingPremium: CoworkingPremium;
}

// ───────────────────────────────────────────────────────────────────────────
// Metadatos de presentación (categoría / estado)
// ───────────────────────────────────────────────────────────────────────────

export const CATEGORY_META: Record<SpaceCategory, { label: string; color: string }> = {
  anmat: { label: "ANMAT (regulados)", color: "#2563eb" },
  general: { label: "Cargas Generales", color: "#dc2626" },
  oficina: { label: "Oficinas / Coworking", color: "#16a34a" },
  coworking: { label: "Coworking Premium", color: "#0d9488" },
  publica: { label: "Áreas públicas", color: "#ca8a04" },
  servicio: { label: "Servicios", color: "#9333ea" },
  maniobra: { label: "Maniobras (descubierto)", color: "#64748b" },
};

export const STATUS_META: Record<CommercialStatus, { label: string; color: string }> = {
  disponible: { label: "Disponible", color: "#15803d" },
  ocupado: { label: "Ocupado", color: "#b91c1c" },
  interno: { label: "Uso interno (no comercial)", color: "#475569" },
  na: { label: "No comercializable", color: "#94a3b8" },
};

export const FLOOR_LABEL: Record<FloorCode, string> = {
  PA: "Planta Alta",
  PB: "Planta Baja",
};

// ───────────────────────────────────────────────────────────────────────────
// Modelo canónico (tomado del croquis comercial · cruzado con inventario oficial)
// ───────────────────────────────────────────────────────────────────────────

export const MAGALDI_1765: MagaldiSiteModel = {
  meta: {
    code: "MAGALDI_1765",
    name: "Centro de Distribución Central — Agustín Magaldi 1765",
    address: "Agustín Magaldi 1765 / Osvaldo de la Cruz 3201, CABA",
    owner: "VEROTIN S.A.",
    destino: "Depósito de consignatarios en general",
    expediente: "35391367/2018",
    certificado: "460/19",
    relevamiento: "2026-06-04",
    totals: {
      cubiertaM2: 6893.87,
      anmatM2: 1441,
      anmatDisponibleM2: 107, // PB30
      generalM2: 2520,
      generalDisponibleM2: 0,
      oficinaVendibleM2: 50, // OF PA1–PA4
      rackPositionsTotal: 964,
      rackPositionsDisponibles: 0, // PB1 y PB4 ocupados
      cubiertaNoDesglosadaM2Approx: 2722,
      maniobraDescubiertaM2: 1700, // Playa 820 + Playón 880
    },
    totalsConfidence: "exact",
    sources: ["Croquis-2-Comercial-CD-Magaldi", "Master prompt · Inventario Oficial", "Plano incendio Cert. 460/19"],
  },

  spaces: [
    // ── PLANTA ALTA ─────────────────────────────────────────────────────────
    { id: "OF-PA1", name: "OF PA1", category: "oficina", status: "disponible", floor: "PA", m2: 10, confidence: "exact", note: "Coworking · oficina vendible" },
    { id: "OF-PA2", name: "OF PA2", category: "oficina", status: "disponible", floor: "PA", m2: 10, confidence: "exact", note: "Coworking · oficina vendible" },
    { id: "OF-PA3", name: "OF PA3", category: "oficina", status: "disponible", floor: "PA", m2: 15, confidence: "exact", note: "Coworking · oficina vendible" },
    { id: "OF-PA4", name: "OF PA4", category: "oficina", status: "disponible", floor: "PA", m2: 15, confidence: "exact", note: "Coworking · oficina vendible" },
    { id: "CWP", name: "Coworking Premium", category: "coworking", status: "disponible", floor: "PA", m2: null, confidence: "exact", note: "Se comercializa por isla · 11 islas · 56 puestos · 100% disponible" },
    { id: "CEO", name: "CEO", category: "oficina", status: "interno", floor: "PA", m2: null, confidence: "exact" },
    { id: "GER", name: "Gerencia Comercial", category: "oficina", status: "interno", floor: "PA", m2: null, confidence: "exact" },
    { id: "DIROP", name: "Dirección Operativa", category: "oficina", status: "interno", floor: "PA", m2: null, confidence: "exact" },
    { id: "CONF", name: "Sala de Conferencias", category: "oficina", status: "interno", floor: "PA", m2: null, confidence: "exact" },
    { id: "ASIST", name: "Of. Asistencia Ejecutiva", category: "oficina", status: "interno", floor: "PA", m2: null, confidence: "exact" },
    { id: "ARCH", name: "Sala Archivo Documentación", category: "oficina", status: "interno", floor: "PA", m2: null, confidence: "exact" },
    { id: "CCOW", name: "Comedor Coworking", category: "publica", status: "na", floor: "PA", m2: null, confidence: "exact" },
    { id: "VEST", name: "Comedor / Vestuarios / Escalera", category: "publica", status: "na", floor: "PA", m2: null, confidence: "exact" },

    // ── PLANTA BAJA · Cargas Generales ───────────────────────────────────────
    { id: "PB1", name: "Depósito PB1", category: "general", status: "ocupado", floor: "PB", m2: 900, rackPositions: 400, confidence: "exact", note: "400 posiciones racks selectivos" },
    { id: "PB2", name: "Depósito PB2", category: "general", status: "ocupado", floor: "PB", m2: 300, confidence: "exact", note: "150 m² 1er piso + 150 m² altillo" },
    { id: "PB3", name: "Depósito PB3", category: "general", status: "ocupado", floor: "PB", m2: 100, confidence: "exact" },
    { id: "PB4", name: "Depósito PB4", category: "general", status: "ocupado", floor: "PB", m2: 1000, rackPositions: 564, confidence: "exact", note: "564 posiciones racks selectivos" },
    { id: "PB5", name: "Depósito PB5", category: "general", status: "ocupado", floor: "PB", m2: 100, confidence: "exact" },
    { id: "PB5A", name: "PB5A (Tinglado)", category: "general", status: "ocupado", floor: "PB", m2: 120, confidence: "exact" },

    // ── PLANTA BAJA · ANMAT (PB6–PB32) ───────────────────────────────────────
    { id: "PB6", name: "Depósito PB6", category: "anmat", status: "ocupado", floor: "PB", m2: 400, confidence: "exact" },
    { id: "PB7", name: "ANMAT PB7", category: "anmat", status: "ocupado", floor: "PB", m2: 70, confidence: "exact" },
    { id: "PB8", name: "ANMAT PB8", category: "anmat", status: "ocupado", floor: "PB", m2: 50, confidence: "exact" },
    { id: "PB9", name: "ANMAT PB9", category: "anmat", status: "ocupado", floor: "PB", m2: 50, confidence: "exact" },
    { id: "PB10", name: "ANMAT PB10", category: "anmat", status: "ocupado", floor: "PB", m2: 50, confidence: "exact" },
    { id: "PB11", name: "ANMAT PB11", category: "anmat", status: "ocupado", floor: "PB", m2: 50, confidence: "exact" },
    { id: "PB12", name: "ANMAT PB12", category: "anmat", status: "ocupado", floor: "PB", m2: 70, confidence: "exact" },
    { id: "PB13", name: "PB13", category: "anmat", status: "ocupado", floor: "PB", m2: 30, confidence: "exact" },
    { id: "PB14", name: "PB14", category: "anmat", status: "ocupado", floor: "PB", m2: 15, confidence: "exact" },
    { id: "PB15", name: "PB15", category: "anmat", status: "ocupado", floor: "PB", m2: 17, confidence: "exact" },
    { id: "PB16", name: "PB16", category: "anmat", status: "ocupado", floor: "PB", m2: 17, confidence: "exact" },
    { id: "PB17", name: "PB17", category: "anmat", status: "ocupado", floor: "PB", m2: 25, confidence: "exact" },
    { id: "PB18", name: "PB18", category: "anmat", status: "ocupado", floor: "PB", m2: 30, confidence: "exact" },
    { id: "PB19", name: "PB19", category: "anmat", status: "ocupado", floor: "PB", m2: 17, confidence: "exact" },
    { id: "PB20", name: "PB20", category: "anmat", status: "ocupado", floor: "PB", m2: 20, confidence: "exact" },
    { id: "PB21", name: "PB21", category: "anmat", status: "ocupado", floor: "PB", m2: 17, confidence: "exact" },
    { id: "PB22", name: "PB22", category: "anmat", status: "ocupado", floor: "PB", m2: 17, confidence: "exact" },
    { id: "PB23", name: "PB23", category: "anmat", status: "ocupado", floor: "PB", m2: 35, confidence: "exact" },
    { id: "PB24", name: "PB24", category: "anmat", status: "ocupado", floor: "PB", m2: 17, confidence: "exact" },
    { id: "PB25", name: "PB25", category: "anmat", status: "ocupado", floor: "PB", m2: 17, confidence: "exact" },
    { id: "PB26", name: "PB26", category: "anmat", status: "ocupado", floor: "PB", m2: 50, confidence: "exact" },
    { id: "PB27", name: "PB27", category: "anmat", status: "ocupado", floor: "PB", m2: 70, confidence: "exact" },
    { id: "PB28", name: "PB28", category: "anmat", status: "ocupado", floor: "PB", m2: 60, confidence: "exact" },
    { id: "PB29", name: "PB29", category: "anmat", status: "ocupado", floor: "PB", m2: 60, confidence: "exact" },
    { id: "PB30", name: "Depósito PB30", category: "anmat", status: "disponible", floor: "PB", m2: 107, confidence: "exact", note: "Único sector ANMAT disponible" },
    { id: "PB31", name: "Depósito PB31", category: "anmat", status: "ocupado", floor: "PB", m2: 70, confidence: "exact" },
    { id: "PB32", name: "Depósito PB32", category: "anmat", status: "ocupado", floor: "PB", m2: 10, confidence: "exact" },

    // ── PLANTA BAJA · Oficinas (colisión de código resuelta por id OF-PBn) ────
    { id: "OF-PB1", name: "Oficinas PB1", category: "oficina", status: "ocupado", floor: "PB", m2: 50, confidence: "exact" },
    { id: "OF-PB2", name: "Oficinas PB2", category: "oficina", status: "ocupado", floor: "PB", m2: 10, confidence: "exact" },
    { id: "OF-PB3", name: "Oficinas PB3", category: "oficina", status: "ocupado", floor: "PB", m2: 50, confidence: "exact" },
    { id: "RECEP", name: "Recepción", category: "oficina", status: "interno", floor: "PB", m2: null, confidence: "exact" },

    // ── PLANTA BAJA · Servicios y no vendible ────────────────────────────────
    { id: "SCOMP", name: "Sala de Cómputos", category: "servicio", status: "na", floor: "PB", m2: null, confidence: "exact" },
    { id: "ASERV", name: "Área Servicio Mantenimiento de Máquinas", category: "servicio", status: "na", floor: "PB", m2: null, confidence: "exact" },
    { id: "PLAYA", name: "Playa de Maniobras", category: "maniobra", status: "na", floor: "PB", m2: 820, confidence: "exact", note: "Descubierto · no vendible" },
    { id: "PLAYON", name: "Playón de Maniobras", category: "maniobra", status: "na", floor: "PB", m2: 880, confidence: "exact", note: "Descubierto · no vendible" },
    { id: "PLZ", name: "Plazoleta de Desconsolidado", category: "maniobra", status: "na", floor: "PB", m2: null, confidence: "exact", note: "Descubierto" },
  ],

  coworkingPremium: {
    islasTotal: 11,
    puestosTotal: 56,
    disponiblePct: 100,
    composicion: [
      { tipo: "Islas de 6 personas", islas: 6, puestosPorIsla: 6 },
      { tipo: "Islas bajas de 4 personas", islas: 3, puestosPorIsla: 4 },
      { tipo: "Islas mesa alta de 4 personas", islas: 2, puestosPorIsla: 4 },
    ],
    incluye: [
      "Wi-Fi Starlink simétrico",
      "Recepción y recepcionista",
      "Recepción/archivo de documentación",
      "Comedor",
      "Vestuarios",
      "Fotocopiado/escaneo",
      "Sala de conferencias con proyector",
      "Espacio de relax",
      "Estacionamiento exclusivo en el playón",
    ],
  },
};

// ───────────────────────────────────────────────────────────────────────────
// Selectores de Comercial Readiness (FASE 3) — derivaciones puras.
// Reutilizables por el CRM Comercial Nexus y el Dashboard Corporativo de Vacancia.
// ───────────────────────────────────────────────────────────────────────────

const sumM2 = (spaces: MagaldiSpace[], pred: (s: MagaldiSpace) => boolean): number =>
  spaces.filter(pred).reduce((acc, s) => acc + (s.m2 ?? 0), 0);

/** m² ANMAT disponibles para comercializar. */
export function getAvailableAnmatM2(m: MagaldiSiteModel = MAGALDI_1765): number {
  return sumM2(m.spaces, (s) => s.category === "anmat" && s.status === "disponible");
}

/** m² de Cargas Generales disponibles. */
export function getAvailableGeneralM2(m: MagaldiSiteModel = MAGALDI_1765): number {
  return sumM2(m.spaces, (s) => s.category === "general" && s.status === "disponible");
}

/** m² de oficinas vendibles disponibles (OF PA1–PA4). */
export function getAvailableOfficeM2(m: MagaldiSiteModel = MAGALDI_1765): number {
  return sumM2(m.spaces, (s) => s.category === "oficina" && s.status === "disponible");
}

/** Posiciones de rack selectivo disponibles (en sectores disponibles). */
export function getAvailableRackPositions(m: MagaldiSiteModel = MAGALDI_1765): number {
  return m.spaces
    .filter((s) => s.rackPositions != null && s.status === "disponible")
    .reduce((acc, s) => acc + (s.rackPositions ?? 0), 0);
}

/** Disponibilidad de Coworking Premium (islas/puestos/%). */
export function getCoworkingAvailability(m: MagaldiSiteModel = MAGALDI_1765): CoworkingPremium {
  return m.coworkingPremium;
}

export interface MagaldiCommercialSummary {
  cubiertaM2: number;
  anmatM2: number;
  anmatDisponibleM2: number;
  generalM2: number;
  generalDisponibleM2: number;
  oficinaVendibleDisponibleM2: number;
  rackPositionsTotal: number;
  rackPositionsDisponibles: number;
  coworking: { islas: number; puestos: number; disponiblePct: number };
  /** m² vendibles disponibles hoy (ANMAT + CG + oficinas). */
  vendibleDisponibleM2: number;
  availableSpaces: string[];
}

/** Resumen ejecutivo comercial para Dirección / CRM / Dashboard Corporativo. */
export function getMagaldiCommercialSummary(m: MagaldiSiteModel = MAGALDI_1765): MagaldiCommercialSummary {
  const anmatDisp = getAvailableAnmatM2(m);
  const genDisp = getAvailableGeneralM2(m);
  const ofDisp = getAvailableOfficeM2(m);
  return {
    cubiertaM2: m.meta.totals.cubiertaM2,
    anmatM2: m.meta.totals.anmatM2,
    anmatDisponibleM2: anmatDisp,
    generalM2: m.meta.totals.generalM2,
    generalDisponibleM2: genDisp,
    oficinaVendibleDisponibleM2: ofDisp,
    rackPositionsTotal: m.meta.totals.rackPositionsTotal,
    rackPositionsDisponibles: getAvailableRackPositions(m),
    coworking: {
      islas: m.coworkingPremium.islasTotal,
      puestos: m.coworkingPremium.puestosTotal,
      disponiblePct: m.coworkingPremium.disponiblePct,
    },
    vendibleDisponibleM2: anmatDisp + genDisp + ofDisp,
    availableSpaces: m.spaces.filter((s) => s.status === "disponible").map((s) => s.id),
  };
}
