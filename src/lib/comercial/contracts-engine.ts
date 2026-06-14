/**
 * contracts-engine.ts — Motor de cartera: agregados, semáforo y alertas escalonadas.
 *
 * Funciones puras (sin I/O) que replican la lógica de la maqueta oficial y el
 * Cap. 6 de la auditoría. Se usan para:
 *   · recalcular campos derivados de contratos nuevos o a un corte distinto, y
 *   · computar los KPIs/alertas que alimentan el tablero ejecutivo.
 * A la fecha de corte de la auditoría (2026-06-13) reproducen los valores `K` de la maqueta.
 */

import type {
  ContractRecord,
  ContractsAggregates,
  ContractAlert,
  ContractRiesgo,
  ContractSemaforo,
  ContractEstado,
  ContractTipo,
} from "./contracts-types";

const MS_DAY = 86_400_000;

/**
 * Estados que NO cuentan como contrato «activo»: rescindidos o sin instrumento.
 * Las relaciones en conflicto/litigio/inciertas siguen vigentes ⇒ cuentan como activas.
 */
const NON_ACTIVE_ESTADOS: ContractEstado[] = ["Rescindido", "Sin-Instrumento"];

/** Estados que NO computan facturación comprometida (sin marco vigente o sin canon cierto). */
const NON_BILLABLE_ESTADOS: ContractEstado[] = ["Rescindido", "Sin-Instrumento", "Incierto"];

/** Estados que disparan alerta roja permanente (sin instrumento vigente / litigio). */
const PERMANENT_ALERT_ESTADOS: ContractEstado[] = [
  "Sin-Instrumento",
  "Incierto",
  "Rescindido",
  "En-Litigio",
  "En-Conflicto",
];

/** Días al vencimiento desde una fecha de corte (negativo = vencido). */
export function diasAVencimiento(venc: string | null, corte: string): number | null {
  if (!venc) return null;
  const v = new Date(venc + "T00:00:00").getTime();
  const c = new Date(corte + "T00:00:00").getTime();
  return Math.round((v - c) / MS_DAY);
}

/** Meses restantes (aprox. 30,44 días/mes) desde la fecha de corte. */
export function mesesRestantes(venc: string | null, corte: string): number | null {
  const d = diasAVencimiento(venc, corte);
  return d == null ? null : Math.round((d / 30.44) * 10) / 10;
}

/**
 * Semáforo por fecha para un contrato CON vencimiento computable.
 * Para relaciones sin instrumento/indeterminadas el estado prima (ver `semaforoFor`).
 */
export function semaforoFromDays(dias: number): ContractSemaforo {
  if (dias < 0) return "Negro";
  if (dias < 30) return "Rojo";
  if (dias < 60) return "Naranja";
  if (dias <= 90) return "Amarillo";
  return "Verde";
}

// ── Niveles del motor de alertas escalonadas (Cap. 6.6) ───────────────────────

interface AlertLevelCfg {
  d: number;
  level: ContractAlert["level"];
  color: string;
  title: string;
  responsable: string;
}

/** Umbrales 90/60/30/15/7 — responsable y acción esperada por nivel. */
export const ALERT_LEVELS: AlertLevelCfg[] = [
  { d: 7, level: "7 DÍAS", color: "#D14343", title: "Aviso ejecutivo", responsable: "CEO / Dirección — acción de firma o notificación fehaciente" },
  { d: 15, level: "15 DÍAS", color: "#E0531F", title: "Aviso urgente", responsable: "Dirección — confirmar decisión y preparar instrumento" },
  { d: 30, level: "30 DÍAS", color: "#E07A1F", title: "Aviso crítico", responsable: "Gerencia Comercial — escalar; decisión renovar/rescindir" },
  { d: 60, level: "60 DÍAS", color: "#E0B400", title: "Aviso comercial", responsable: "Comercial + Cobranzas — propuesta de renovación" },
  { d: 90, level: "90 DÍAS", color: "#1F9D55", title: "Aviso preventivo", responsable: "Ejecutivo de cuenta — evaluar continuidad" },
];

/**
 * Genera las alertas activas de la cartera a una fecha de corte, ordenadas por
 * urgencia. Replica el motor de la maqueta:
 *   · estados sin instrumento vigente → alerta roja PERMANENTE;
 *   · vencidos → alerta VENCIDO (negra);
 *   · resto → primer umbral 90/60/30/15/7 que alcance.
 */
export function buildAlerts(contracts: ContractRecord[], corte: string): ContractAlert[] {
  const out: ContractAlert[] = [];
  for (const c of contracts) {
    if (PERMANENT_ALERT_ESTADOS.includes(c.estado)) {
      out.push({
        contract: c,
        level: "PERMANENTE",
        color: "#33373D",
        title: "Alerta roja permanente",
        responsable:
          "CEO + Legal — " +
          (c.estado === "Rescindido" ? "gestión post-contractual" : "regularización inmediata"),
        order: -1,
      });
      continue;
    }
    const dias = diasAVencimiento(c.venc, corte);
    if (dias == null) continue;
    if (dias < 0) {
      out.push({
        contract: c,
        level: "VENCIDO",
        color: "#33373D",
        title: "Contrato vencido",
        responsable: "CEO + Legal — bloqueo de facturación sin contrato vigente",
        order: dias,
      });
      continue;
    }
    for (const lvl of ALERT_LEVELS) {
      if (dias <= lvl.d) {
        out.push({
          contract: c,
          level: lvl.level,
          color: lvl.color,
          title: lvl.title,
          responsable: lvl.responsable,
          order: dias,
        });
        break;
      }
    }
  }
  return out.sort((a, b) => a.order - b.order);
}

/** ¿Cuenta como contrato activo (con instrumento vigente, aunque en conflicto)? */
function isActive(c: ContractRecord): boolean {
  return !NON_ACTIVE_ESTADOS.includes(c.estado);
}

/** ¿Suma a la facturación comprometida? */
function isBillable(c: ContractRecord): boolean {
  return !NON_BILLABLE_ESTADOS.includes(c.estado);
}

/**
 * Computa los agregados del tablero a partir de la cartera. A la fecha de corte
 * de la auditoría coincide con los valores `K` de la maqueta (validado en QA).
 */
export function computeAggregates(contracts: ContractRecord[], corte: string): ContractsAggregates {
  const riesgos: Record<ContractRiesgo, number> = { Bajo: 0, Medio: 0, Alto: 0, Crítico: 0 };
  const semaforos: Partial<Record<ContractSemaforo, number>> = {};
  const estados: Partial<Record<ContractEstado, number>> = {};

  let anmat = 0;
  let cg = 0;
  let activos = 0;
  let factArs = 0;
  let factUsd = 0;
  let factArsDesact = 0;
  let nDesact = 0;
  let m2Total = 0;
  let prox180 = 0;
  let criticos = 0;

  for (const c of contracts) {
    riesgos[c.riesgo] += 1;
    semaforos[c.semaforo] = (semaforos[c.semaforo] ?? 0) + 1;
    estados[c.estado] = (estados[c.estado] ?? 0) + 1;

    if (c.tipo === "ANMAT") anmat += 1;
    else cg += 1;

    if (c.riesgo === "Crítico") criticos += 1;

    if (isActive(c)) activos += 1;

    // m² contratados: excluye relaciones rescindidas (no ocupan superficie vigente).
    if (c.estado !== "Rescindido" && c.m2) m2Total += c.m2;

    if (isBillable(c) && c.canon) {
      if (c.mon === "ARS") factArs += c.canon;
      else factUsd += c.canon;
    }
    if (c.desact && c.canon && c.mon === "ARS") {
      factArsDesact += c.canon;
      nDesact += 1;
    }

    const dias = diasAVencimiento(c.venc, corte);
    if (dias != null && dias >= 0 && dias <= 180) prox180 += 1;
  }

  return {
    total: contracts.length,
    anmat,
    cg,
    activos,
    factArs,
    factUsd,
    factArsAnual: factArs * 12,
    factUsdAnual: factUsd * 12,
    factArsDesact,
    nDesact,
    m2Total: Math.round(m2Total * 100) / 100,
    prox180,
    criticos,
    riesgos,
    semaforos,
    estados,
  };
}

/** Agrupación por estado para el donut «Contratos por estado» (4 grupos de la maqueta). */
export type EstadoGroup = "Vigente" | "Próximo a vencer" | "Crítico/Vencido" | "Indeterminado";

export function estadoGroupFor(semaforo: ContractSemaforo): EstadoGroup {
  if (semaforo === "Verde") return "Vigente";
  if (semaforo === "Amarillo" || semaforo === "Naranja") return "Próximo a vencer";
  if (semaforo === "Rojo" || semaforo === "Negro") return "Crítico/Vencido";
  return "Indeterminado";
}

/** Distribución por grupo de estado (para el donut). Mantiene el orden de la maqueta. */
export function estadoGroupDistribution(contracts: ContractRecord[]): Record<EstadoGroup, number> {
  const acc: Record<EstadoGroup, number> = {
    Vigente: 0,
    "Próximo a vencer": 0,
    "Crítico/Vencido": 0,
    Indeterminado: 0,
  };
  for (const c of contracts) acc[estadoGroupFor(c.semaforo)] += 1;
  return acc;
}

/** Facturación ARS comprometida por unidad de negocio (contratos activos). */
export function facturacionPorTipo(contracts: ContractRecord[]): Record<ContractTipo, number> {
  const acc: Record<ContractTipo, number> = { ANMAT: 0, "Cargas Generales": 0 };
  for (const c of contracts) {
    if (c.mon === "ARS" && c.canon && isBillable(c)) acc[c.tipo] += c.canon;
  }
  return acc;
}

/** Vencimientos por mes en una ventana de N meses desde el corte (timeline del tablero). */
export function vencimientosPorMes(
  contracts: ContractRecord[],
  corte: string,
  months = 13,
): { label: string; key: string; count: number }[] {
  const MES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const base = new Date(corte + "T00:00:00");
  const out: { label: string; key: string; count: number }[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    const count = contracts.filter((c) => c.venc && c.venc.slice(0, 7) === key).length;
    out.push({ key, label: `${MES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, count });
  }
  return out;
}

/** Contratos de atención prioritaria (crítico o estado problemático), ordenados por urgencia. */
export function accionesPrioritarias(contracts: ContractRecord[]): ContractRecord[] {
  return contracts
    .filter(
      (c) =>
        c.riesgo === "Crítico" ||
        (["Sin-Instrumento", "En-Litigio", "En-Conflicto"] as ContractEstado[]).includes(c.estado),
    )
    .sort((a, b) => (a.dias_venc ?? 9999) - (b.dias_venc ?? 9999));
}
