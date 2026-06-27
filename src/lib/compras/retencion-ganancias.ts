/**
 * Motor de cálculo — Retención de Impuesto a las Ganancias (Argentina)
 *
 * Lógica pura, sin efectos secundarios ni valores hardcodeados.
 * Toda la parametrización (mínimos, alícuotas, escala) llega desde la DB.
 * Los defaults que figuran aquí se usan ÚNICAMENTE en modo demo / tests.
 *
 * Métodos:
 *  - Honorarios:   escala progresiva por tramos (tabla en DB)
 *  - Mercaderías:  % lineal sobre excedente del mínimo
 *  - Servicios:    % lineal sobre excedente del mínimo
 *  - Alquileres:   % lineal sobre excedente del mínimo
 *  - Factura C:    exenta (monotributista u otro régimen simplificado)
 *  - Excluidos:    luz, gas, telefonía, internet, seguros
 *  - Exento:       proveedor con exención individual
 */

// ─── Tipos ────────────────────────────────────────────────────

export interface EscalaTramo {
  desde: number;
  hasta: number | null; // null = sin límite superior
  fijo:  number;
  pct:   number;
}

export type ConceptoGravado  = "honorarios" | "mercaderias" | "servicios" | "alquileres";
export type ConceptoExcluido = "luz" | "gas" | "telefonia" | "internet" | "seguros";
export type Concepto         = ConceptoGravado | ConceptoExcluido | "excluido";

export const CONCEPTO_LABEL: Record<Concepto, string> = {
  honorarios:  "Honorarios Profesionales",
  mercaderias: "Compra de Mercaderías",
  servicios:   "Prestación de Servicios",
  alquileres:  "Alquileres",
  excluido:    "Concepto Excluido",
  luz:         "Luz",
  gas:         "Gas",
  telefonia:   "Telefonía",
  internet:    "Internet",
  seguros:     "Seguros",
};

export const CONCEPTOS_GRAVADOS: ConceptoGravado[] = [
  "honorarios", "mercaderias", "servicios", "alquileres",
];

export const CONCEPTOS_EXCLUIDOS_AUTOMATICO: ConceptoExcluido[] = [
  "luz", "gas", "telefonia", "internet", "seguros",
];

// ─── Configuración (viene de DB, never hardcodeada en producción) ─

export interface RetenciónConfig {
  minHonorarios:   number;
  minMercaderias:  number;
  minServicios:    number;
  minAlquileres:   number;
  rateMercaderias: number;
  rateServicios:   number;
  rateAlquileres:  number;
}

/** Solo para tests / demo mode. En producción siempre llega de DB. */
export const DEFAULT_CONFIG: RetenciónConfig = {
  minHonorarios:   160_000,
  minMercaderias:  224_000,
  minServicios:     67_170,
  minAlquileres:    11_200,
  rateMercaderias:       2,
  rateServicios:         2,
  rateAlquileres:        6,
};

/** Solo para tests / demo mode. En producción siempre llega de DB. */
export const DEFAULT_ESCALA: EscalaTramo[] = [
  { desde: 0,       hasta: 71_000,   fijo: 0,       pct: 5  },
  { desde: 71_000,  hasta: 142_000,  fijo: 3_550,   pct: 9  },
  { desde: 142_000, hasta: 213_000,  fijo: 9_940,   pct: 12 },
  { desde: 213_000, hasta: 284_000,  fijo: 18_460,  pct: 15 },
  { desde: 284_000, hasta: 426_000,  fijo: 29_110,  pct: 19 },
  { desde: 426_000, hasta: 568_000,  fijo: 56_090,  pct: 23 },
  { desde: 568_000, hasta: 852_000,  fijo: 88_750,  pct: 27 },
  { desde: 852_000, hasta: null,     fijo: 165_430, pct: 31 },
];

// ─── Parámetros de entrada ────────────────────────────────────

export interface RetenciónParams {
  tipoComprobante:  string;
  concepto:         Concepto;
  netoGravado:      number;
  acumuladoPrevio:  number;
  totalFactura?:    number;
  exentoProveedor?: boolean;
  config:           RetenciónConfig;
  escala:           EscalaTramo[];
  normativaVersion: string;
}

// ─── Resultado ────────────────────────────────────────────────

export interface RetenciónResult {
  tipoComprobante:  string;
  concepto:         Concepto;
  conceptoLabel:    string;
  metodo:           "escala" | "lineal" | "excluido";
  netoGravado:      number;
  acumuladoPrevio:  number;
  acumuladoTotal:   number;
  totalFactura:     number;
  basePago:         number;
  minimo:           number;
  baseImponible:    number;
  excedente:        number;
  alicuota:         number;
  fijo:             number;
  pctMonto:         number;
  tramoTxt:         string;
  retencion:        number;
  netoPagar:        number;
  corresponde:      boolean;
  estado:           "ok" | "warn";
  motivo:           string;
  normativaVersion: string;
}

// ─── Helpers ──────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function pesos(n: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency: "ARS",
  }).format(n);
}

function pesos0(n: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency: "ARS", maximumFractionDigits: 0,
  }).format(n);
}

function esFacturaA(tipo: string): boolean {
  return tipo === "FACTURA_A";
}

function esConceptoExcluido(c: Concepto): boolean {
  return (CONCEPTOS_EXCLUIDOS_AUTOMATICO as string[]).includes(c) || c === "excluido";
}

function buscarTramo(base: number, escala: EscalaTramo[]): EscalaTramo {
  for (const t of escala) {
    const hasta = t.hasta ?? Infinity;
    if (base > t.desde && base <= hasta) return t;
  }
  return escala[escala.length - 1];
}

function tramoLabel(t: EscalaTramo): string {
  return t.hasta == null
    ? `Más de ${pesos0(t.desde)} (sin límite)`
    : `Más de ${pesos0(t.desde)} y hasta ${pesos0(t.hasta)}`;
}

function minimoFor(c: ConceptoGravado, cfg: RetenciónConfig): number {
  switch (c) {
    case "honorarios":  return cfg.minHonorarios;
    case "mercaderias": return cfg.minMercaderias;
    case "servicios":   return cfg.minServicios;
    case "alquileres":  return cfg.minAlquileres;
  }
}

function alicuotaFor(c: Exclude<ConceptoGravado, "honorarios">, cfg: RetenciónConfig): number {
  switch (c) {
    case "mercaderias": return cfg.rateMercaderias;
    case "servicios":   return cfg.rateServicios;
    case "alquileres":  return cfg.rateAlquileres;
  }
}

// ─── Motor principal ──────────────────────────────────────────

export function calculateIncomeTaxRetention(p: RetenciónParams): RetenciónResult {
  const totalFactura   = p.totalFactura ?? 0;
  const acumuladoTotal = round2(p.acumuladoPrevio + p.netoGravado);
  const basePago       = totalFactura > 0 ? totalFactura : p.netoGravado;

  const base: RetenciónResult = {
    tipoComprobante:  p.tipoComprobante,
    concepto:         p.concepto,
    conceptoLabel:    CONCEPTO_LABEL[p.concepto] ?? p.concepto,
    metodo:           "excluido",
    netoGravado:      p.netoGravado,
    acumuladoPrevio:  p.acumuladoPrevio,
    acumuladoTotal,
    totalFactura,
    basePago,
    minimo:           0,
    baseImponible:    0,
    excedente:        0,
    alicuota:         0,
    fijo:             0,
    pctMonto:         0,
    tramoTxt:         "",
    retencion:        0,
    netoPagar:        basePago,
    corresponde:      false,
    estado:           "ok",
    motivo:           "",
    normativaVersion: p.normativaVersion,
  };

  // Regla 1: proveedor exento individualmente
  if (p.exentoProveedor) {
    return { ...base, motivo: "Proveedor exento de retención de Ganancias (resolución individual)." };
  }

  // Regla 2: Factura distinta de A → no retiene
  if (!esFacturaA(p.tipoComprobante)) {
    const label = p.tipoComprobante.replace("_", " ");
    return { ...base, motivo: `${label}. No corresponde practicar retención de Ganancias.` };
  }

  // Regla 3: concepto excluido
  if (esConceptoExcluido(p.concepto)) {
    return { ...base, motivo: "Concepto excluido de retención de Ganancias." };
  }

  // Factura A + concepto gravado
  const concepto     = p.concepto as ConceptoGravado;
  const minimo       = minimoFor(concepto, p.config);
  const baseImponible = round2(acumuladoTotal - minimo);

  if (baseImponible <= 0) {
    return {
      ...base,
      metodo:        concepto === "honorarios" ? "escala" : "lineal",
      minimo,
      baseImponible: 0,
      motivo: `Acumulado mensual (${pesos(acumuladoTotal)}) no supera el mínimo no sujeto (${pesos(minimo)}). No corresponde retención.`,
    };
  }

  // ─ Honorarios: escala progresiva ─
  if (concepto === "honorarios") {
    const t        = buscarTramo(baseImponible, p.escala);
    const excedente = round2(baseImponible - t.desde);
    const pctMonto  = round2(excedente * t.pct / 100);
    const retencion = round2(t.fijo + pctMonto);
    return {
      ...base,
      metodo:        "escala",
      minimo,
      baseImponible,
      excedente,
      alicuota:      t.pct,
      fijo:          t.fijo,
      pctMonto,
      tramoTxt:      tramoLabel(t),
      retencion,
      netoPagar:     round2(basePago - retencion),
      corresponde:   true,
      estado:        "warn",
      motivo: `Base imponible ${pesos(baseImponible)} — tramo «${tramoLabel(t)}»: fijo ${pesos(t.fijo)} + ${t.pct}% sobre excedente de ${pesos(excedente)}.`,
    };
  }

  // ─ Lineal: mercaderías / servicios / alquileres ─
  const alicuota  = alicuotaFor(concepto, p.config);
  const excedente  = baseImponible;
  const retencion  = round2(excedente * alicuota / 100);
  return {
    ...base,
    metodo:       "lineal",
    minimo,
    baseImponible,
    excedente,
    alicuota,
    retencion,
    netoPagar:    round2(basePago - retencion),
    corresponde:  true,
    estado:       "warn",
    motivo: `Acumulado (${pesos(acumuladoTotal)}) supera el mínimo (${pesos(minimo)}). Retención: ${alicuota}% sobre excedente de ${pesos(excedente)}.`,
  };
}

// ─── Helpers de presentación ──────────────────────────────────

export function fmtRetenciónResumen(r: RetenciónResult): string {
  if (!r.corresponde) return "No corresponde retención";
  return `Retención ${r.alicuota}%: ${pesos(r.retencion)}`;
}
