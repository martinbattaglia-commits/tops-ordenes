/**
 * contracts-types.ts — Tipos del módulo «CRM Comercial → Contratos».
 *
 * Modelo conceptual de la Auditoría Contractual (Entregable 6 · Fase 6) y la maqueta
 * oficial HTML. Las claves cortas (`n`, `canon`, `venc`, …) replican la maqueta para
 * mantener trazabilidad 1:1 entre el documento, el seed y la UI. La capa de datos
 * (`contracts-data.ts`) mapea las columnas de `public.contracts` (migración 0076) a
 * esta forma; la maqueta es la fuente de verdad visual.
 */

/** Unidad de negocio. */
export type ContractTipo = "ANMAT" | "Cargas Generales";

/** Nivel de riesgo contractual (Entregable 4 de la auditoría). */
export type ContractRiesgo = "Bajo" | "Medio" | "Alto" | "Crítico";

/**
 * Semáforo de vencimiento (Cap. 2 · Cap. 6 de la auditoría):
 * Verde >90d · Amarillo 60–90 · Naranja 30–60 · Rojo <30 · Negro vencido/sin instrumento
 * · Azul plazo indeterminado · Gris estado incierto (sin fecha computable).
 */
export type ContractSemaforo =
  | "Verde"
  | "Amarillo"
  | "Naranja"
  | "Rojo"
  | "Negro"
  | "Gris"
  | "Azul";

/** Estado vigente reconstruido del contrato (catálogo `contract_status`). */
export type ContractEstado =
  | "Vigente"
  | "Vigente-Indet"
  | "Renov-No-Instrumentada"
  | "En-Conflicto"
  | "En-Litigio"
  | "Sin-Instrumento"
  | "Incierto"
  | "Rescindido";

/** Moneda del canon. */
export type ContractMoneda = "ARS" | "USD";

/**
 * Un registro de cartera (forma de la maqueta). Campos derivados (`dias_venc`,
 * `meses_rest`, `semaforo`) vienen calculados a la fecha de corte de la auditoría;
 * el motor (`contracts-engine.ts`) los recalcula para datos nuevos o cortes distintos.
 */
export interface ContractRecord {
  /** Razón social / identificación de la contraparte. */
  n: string;
  /** CUIT (o `s/d` cuando no surge de la documentación). */
  cuit: string;
  tipo: ContractTipo;
  /** Canon mensual a valor documentado; `null` si no surge instrumento. */
  canon: number | null;
  mon: ContractMoneda;
  /** Superficie contratada en m² (`null` si no consta). */
  m2: number | null;
  /** Ubicación / depósito asignado. */
  ubic: string;
  /** Fecha de inicio (ISO `YYYY-MM-DD`) o `null`. */
  ini: string | null;
  /** Fecha de vencimiento (ISO) o `null` (indeterminado / sin instrumento). */
  venc: string | null;
  /** Renovación automática pactada. */
  renov: boolean;
  riesgo: ContractRiesgo;
  estado: ContractEstado;
  /** Canon a valor histórico de origen (el vigente por índice es superior). */
  desact: boolean;
  /** Hallazgos de auditoría. */
  hall: string;
  /** Días al vencimiento a la fecha de corte (negativo = vencido; `null` = sin fecha). */
  dias_venc: number | null;
  /** Meses restantes a la fecha de corte (`null` = sin fecha). */
  meses_rest: number | null;
  semaforo: ContractSemaforo;
  /** Etiqueta legible del semáforo. */
  semaforo_label: string;
  /** Fecha de firma (texto, tal como surge del instrumento). */
  firma: string;
  /** Plazo pactado (texto: «24 m», «indet.»). */
  plazo: string;
  /** Preaviso pactado (texto: «60 días»). */
  preaviso: string;
  /** Índice y frecuencia de ajuste (texto: «CEDOL trimestral»). */
  ajuste: string;
  /** Recomendación de la auditoría. */
  reco: string;
  /** Penalidad por rescisión anticipada. */
  pen: string;
}

/** Agregados del tablero ejecutivo (KPIs + distribuciones). */
export interface ContractsAggregates {
  total: number;
  anmat: number;
  cg: number;
  /** Contratos activos (no rescindidos / sin instrumento / inciertos). */
  activos: number;
  /** Facturación mensual comprometida ARS (contratos activos). */
  factArs: number;
  /** Facturación mensual comprometida USD (contratos activos). */
  factUsd: number;
  factArsAnual: number;
  factUsdAnual: number;
  /** Facturación mensual a valor histórico no trazable (palanca de recupero). */
  factArsDesact: number;
  /** Cantidad de cánones a valor histórico. */
  nDesact: number;
  /** m² contratados (excluye relaciones rescindidas). */
  m2Total: number;
  /** Contratos que vencen en ≤180 días. */
  prox180: number;
  criticos: number;
  riesgos: Record<ContractRiesgo, number>;
  semaforos: Partial<Record<ContractSemaforo, number>>;
  estados: Partial<Record<ContractEstado, number>>;
}

/** Nivel de alerta escalonada (motor de vencimientos · Cap. 6.6). */
export type AlertLevel =
  | "PERMANENTE"
  | "VENCIDO"
  | "7 DÍAS"
  | "15 DÍAS"
  | "30 DÍAS"
  | "60 DÍAS"
  | "90 DÍAS";

/** Alerta materializada para un contrato. */
export interface ContractAlert {
  contract: ContractRecord;
  level: AlertLevel;
  /** Color de la alerta (semáforo del nivel). */
  color: string;
  /** Tipo de aviso (p. ej. «Aviso crítico»). */
  title: string;
  /** Responsable y acción esperada. */
  responsable: string;
  /** Orden de prioridad (menor = más urgente). */
  order: number;
}

/**
 * Origen operativo de los datos servidos al módulo.
 * `drive` = sincronizado desde Google Drive (fuente de verdad operativa);
 * `db` = persistido en Supabase (p. ej. carga inicial, aún sin sincronizar);
 * `audit` = carga inicial auditada en memoria (fallback, base no disponible).
 */
export type ContractsSource = "drive" | "db" | "audit";

/** Resultado de la capa de datos para el workspace. */
export interface ContractsPortfolio {
  items: ContractRecord[];
  aggregates: ContractsAggregates;
  alerts: ContractAlert[];
  source: ContractsSource;
  /** Fecha de corte usada para los cálculos derivados (ISO). */
  corte: string;
  /** Estado de la sincronización con Google Drive. */
  sync: import("./contracts-sync/types").ContractsSyncSummary;
}

// ── Metadatos de presentación (colores de la maqueta oficial) ─────────────────

export const SEMAFORO_META: Record<ContractSemaforo, { color: string; label: string }> = {
  Verde: { color: "#1F9D55", label: "> 90 días" },
  Amarillo: { color: "#E0B400", label: "60–90 días" },
  Naranja: { color: "#E07A1F", label: "30–60 días" },
  Rojo: { color: "#D14343", label: "< 30 días" },
  Negro: { color: "#33373D", label: "Vencido / sin instrumento" },
  Gris: { color: "#8A94A6", label: "Estado incierto" },
  Azul: { color: "#2E6FB0", label: "Plazo indeterminado" },
};

export const RIESGO_META: Record<ContractRiesgo, { color: string }> = {
  Bajo: { color: "#1F9D55" },
  Medio: { color: "#E0B400" },
  Alto: { color: "#E07A1F" },
  Crítico: { color: "#D14343" },
};

export const TIPO_META: Record<ContractTipo, { color: string; short: string }> = {
  ANMAT: { color: "#15406B", short: "ANMAT" },
  "Cargas Generales": { color: "#C8A24B", short: "C.G." },
};

/** Etiqueta legible del estado (reemplaza guiones por espacios). */
export function estadoLabel(estado: ContractEstado): string {
  return estado.replace(/-/g, " ");
}

/** Formato de canon mensual con símbolo de moneda y marca de desactualización. */
export function formatCanon(c: Pick<ContractRecord, "canon" | "mon" | "desact">): string {
  if (c.canon == null) return "—";
  const sym = c.mon === "USD" ? "US$" : "$";
  return sym + Math.round(c.canon).toLocaleString("es-AR") + (c.desact ? " *" : "");
}

/** Formato de fecha ISO → dd/mm/aaaa (o «—»). */
export function formatFecha(iso: string | null): string {
  return iso ? iso.split("-").reverse().join("/") : "—";
}
