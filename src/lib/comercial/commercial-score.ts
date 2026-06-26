import type { EnrichedDeal } from "./dashboard-kpis";

/**
 * Motor de scoring y priorización comercial del Tablero (Cockpit ejecutivo).
 * Funciones PURAS y testeables. La probabilidad es la de Clientify (foto del
 * último corte) vía `effective_probability`. "Próxima acción" no se sincroniza
 * todavía: se usa el estancamiento (días sin modificación en Clientify) como proxy.
 */

export type Severity = "critica" | "atencion" | "informativa";
export type PriorityQuadrant = "alta_prioridad" | "quick_win" | "a_trabajar" | "baja_prioridad";

export interface ScoredAlert {
  severity: Severity;
  label: string;
}

// ---- Predicados de estado -------------------------------------------------
export const isLiveOpportunity = (d: EnrichedDeal) => d.status === "open" || d.status === "other";
export const isExpiredOpportunity = (d: EnrichedDeal) => d.status === "expired";
export const isWonOpportunity = (d: EnrichedDeal) => d.status === "won";
export const isLostOpportunity = (d: EnrichedDeal) => d.status === "lost";

/** Importe sospechoso: placeholders tipo $1 (o 0) cargados mal en Clientify. */
export const hasSuspiciousAmount = (d: EnrichedDeal) => d.amount <= 1;

/** Forecast ponderado de una oportunidad (solo tiene sentido sobre vivas). */
export const calculateWeightedForecast = (d: EnrichedDeal) => (d.amount * d.effective_probability) / 100;

/** Días sin movimiento (modificación en Clientify). Proxy de "trabada / sin próxima acción". */
export function stalenessDays(d: EnrichedDeal, today: Date): number {
  if (!d.modified_src) return Infinity;
  return Math.floor((today.getTime() - new Date(d.modified_src).getTime()) / 86_400_000);
}

/** ¿La fecha estimada de cierre ya pasó? (solo aplica a vivas) */
export function isOverdue(d: EnrichedDeal, today: Date): boolean {
  return Boolean(d.expected_close && new Date(d.expected_close + "T12:00:00") < today);
}

const STALE_DAYS = 21;
const NO_HORIZON = new Set(["A definir", "", null as unknown as string, undefined as unknown as string]);
const hasHorizon = (d: EnrichedDeal) => Boolean(d.overlay_horizonte) && !NO_HORIZON.has(d.overlay_horizonte as string);

// ---- Factores del score ---------------------------------------------------
function horizonFactor(d: EnrichedDeal): number {
  switch (d.overlay_horizonte) {
    case "Esta semana": return 1.5;
    case "15 días": return 1.3;
    case "30 días": return 1.15;
    case "60 días": return 1.0;
    case "90 días": return 0.9;
    case "+90 días": return 0.8;
    default: return 0.7; // "A definir" / sin horizonte penaliza
  }
}

function stageFactor(d: EnrichedDeal): number {
  const s = (d.stage ?? "").toLowerCase();
  if (s.includes("negoci")) return 1.35;
  if (s.includes("alta prob") || s.includes("visita")) return 1.4;
  if (s.includes("propuesta")) return 1.25;
  if (s.includes("reuni")) return 1.1;
  if (s.includes("contact")) return 1.0;
  if (s.includes("nuevo") || s.includes("lead")) return 0.85;
  return 1.0;
}

function recencyFactor(d: EnrichedDeal, today: Date): number {
  const days = stalenessDays(d, today);
  if (days < 7) return 1.1;
  if (days < STALE_DAYS) return 1.0;
  if (days < 45) return 0.85;
  return 0.7; // mucho tiempo sin movimiento
}

/**
 * Score comercial (a mayor, más prioritario para cerrar). Combina importe,
 * probabilidad, horizonte, etapa y recencia, con penalizaciones por vencimiento
 * e importe sospechoso. Devuelve un número absoluto (sirve para ordenar).
 */
export function calculateCommercialScore(d: EnrichedDeal, today: Date): number {
  if (!isLiveOpportunity(d)) return 0;
  const base = d.amount * (d.effective_probability / 100);
  let score = base * horizonFactor(d) * stageFactor(d) * recencyFactor(d, today);
  if (isOverdue(d, today)) score *= 0.5;          // vencida penaliza
  if (hasSuspiciousAmount(d)) score *= 0.01;      // $1 casi no puntúa
  return Math.round(score);
}

/** Cuadrante de la matriz de prioridad (importe × probabilidad). `amountSplit` = umbral de importe alto. */
export function getOpportunityPriority(d: EnrichedDeal, amountSplit: number): PriorityQuadrant {
  const hiAmount = d.amount >= amountSplit;
  const hiProb = d.effective_probability >= 50;
  if (hiAmount && hiProb) return "alta_prioridad";
  if (!hiAmount && hiProb) return "quick_win";
  if (hiAmount && !hiProb) return "a_trabajar";
  return "baja_prioridad";
}

/** Alerta más relevante de una oportunidad, con severidad (o null si está sana). */
export function getOpportunityAlert(d: EnrichedDeal, today: Date): ScoredAlert | null {
  const hi = d.amount >= 1_000_000;
  if (hasSuspiciousAmount(d)) return { severity: "critica", label: "Importe sospechoso ($1): revisar carga" };
  if (isExpiredOpportunity(d)) return { severity: "atencion", label: "Marcada vencida en Clientify" };
  if (isOverdue(d, today) && hi) return { severity: "critica", label: "Cierre vencido de alto valor" };
  if (isOverdue(d, today)) return { severity: "atencion", label: "Cierre estimado vencido" };
  if (hi && d.effective_probability <= 20) return { severity: "atencion", label: "Alto valor con baja probabilidad" };
  if (d.effective_probability >= 50 && !hasHorizon(d)) return { severity: "atencion", label: "Alta probabilidad sin horizonte" };
  if (isLiveOpportunity(d) && stalenessDays(d, today) >= STALE_DAYS)
    return { severity: "atencion", label: `Sin movimiento hace ${stalenessDays(d, today)} días` };
  return null;
}

export function normalizeScore(rawScores: number[], rawScore: number): number {
  if (!rawScores.length) return 0;
  const sorted = [...rawScores].sort((a, b) => a - b);
  const rank = sorted.filter((s) => s <= rawScore).length;
  return Math.round((rank / sorted.length) * 100);
}

export type SemaforoColor = "green" | "yellow" | "red";

export function getSemaforoColor(normalizedScore: number): SemaforoColor {
  if (normalizedScore >= 65) return "green";
  if (normalizedScore >= 35) return "yellow";
  return "red";
}

export function getSemaforoLabel(color: SemaforoColor): string {
  if (color === "green") return "Prioritaria";
  if (color === "yellow") return "En seguimiento";
  return "En riesgo";
}

/** Recomendación accionable por oportunidad (basada en reglas, no IA). */
export function getSuggestedAction(d: EnrichedDeal, today: Date): string {
  if (hasSuspiciousAmount(d)) return "Corregir importe en Clientify";
  if (isExpiredOpportunity(d) || isOverdue(d, today)) return "Reactivar / revisar vencimiento";
  if (d.effective_probability >= 50 && !hasHorizon(d)) return "Definir horizonte de cierre";
  const s = (d.stage ?? "").toLowerCase();
  if (s.includes("propuesta")) return "Enviar seguimiento de propuesta";
  if (d.effective_probability >= 70) return "Priorizar cierre / pedir confirmación";
  if (s.includes("contact") && d.effective_probability <= 25) return "Contactar y calificar";
  if (isLiveOpportunity(d) && stalenessDays(d, today) >= STALE_DAYS) return "Reactivar (sin movimiento)";
  return "Avanzar a la próxima etapa";
}
