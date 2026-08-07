import "server-only";
import { env } from "@/lib/env";
import { CONTEXT_LIMITS } from "./wa-analysis/window";

// LINK-WA-002 · estado EFECTIVO de la IA para mostrarlo en la interfaz.
//
// POR QUÉ EXISTE
// La bandeja de sugerencias decía «provider mock (determinista, costo cero)» con
// un texto FIJO, heredado de E1. En el Draft con `AI_PROVIDER=gemini` la pantalla
// seguía anunciando mock, y el operador no podía distinguir una corrida real de
// una simulada — que es exactamente lo que el smoke debía probar. Un texto que no
// está atado al dato miente en silencio.
//
// Este módulo produce la ÚNICA fuente de verdad para esa pantalla, leída del
// entorno del servidor en cada request.
//
// 🔒 FRONTERA: `server-only`. Devuelve un objeto CERRADO con cinco campos
// públicos y nada más. Ninguna clave, ningún secreto, ni el objeto `env`
// completo, cruzan al cliente. Lo garantiza `runtime-status.test.ts`.

/** Lo único que la UI necesita saber. Serializable y sin secretos. */
export interface AiRuntimeStatus {
  /** Kill-switch: AI_ENABLED. Gobierna el Copilot conversacional. */
  enabled: boolean;
  /** LINK-WA-002 · ⏸️ El analizador estructurado de WhatsApp está en PAUSA.
   *  Es un estado distinto de `enabled`: el Copilot puede estar operativo y el
   *  analizador pausado a la vez, que es exactamente el cierre resuelto por
   *  Dirección. La UI lo lee de acá y NUNCA de un literal propio. */
  waAnalysisStandby: boolean;
  /** Provider efectivo: 'mock' | 'gemini' | 'anthropic' | 'openai'. */
  provider: string;
  /** Modelo efectivo del provider. */
  model: string;
  /** Corridas por día y usuario. */
  dailyLimit: number;
  /** Tope mensual global en USD (compartido con el Copilot conversacional). */
  monthlyBudgetUsd: number;
  /** true cuando el análisis es simulado y no cuesta nada. */
  isMock: boolean;
  /** Topes de la ventana de contexto (guarda A de E1.1). */
  maxMessages: number;
  maxChars: number;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export function getAiRuntimeStatus(): AiRuntimeStatus {
  const provider = env.ai.provider;
  return {
    enabled: env.ai.enabled,
    // Se informa el estado EFECTIVO, no la intención: pausado mientras el
    // kill-switch específico no esté explícitamente habilitado.
    waAnalysisStandby: !env.ai.waAnalysisEnabled,
    provider,
    model: env.ai.model,
    dailyLimit: env.ai.limits.requestsPerDay,
    monthlyBudgetUsd: env.ai.limits.monthlyBudgetUsd,
    isMock: provider === "mock",
    maxMessages: CONTEXT_LIMITS.maxMessages,
    maxChars: CONTEXT_LIMITS.maxChars,
    maxInputTokens: CONTEXT_LIMITS.maxInputTokens,
    maxOutputTokens: CONTEXT_LIMITS.maxOutputTokens,
  };
}

/** Nombre legible del modelo, sin inventar marcas que el entorno no declaró. */
export function providerLabel(s: AiRuntimeStatus): string {
  if (s.isMock) return "simulado (mock)";
  if (s.provider === "gemini") return `Gemini · ${s.model}`;
  if (s.provider === "anthropic") return `Anthropic · ${s.model}`;
  return `${s.provider} · ${s.model}`;
}

/** Qué significa, en términos de costo, el provider vigente. */
export function costLabel(s: AiRuntimeStatus): string {
  return s.isMock
    ? "determinista, costo cero"
    : "costo real medido y auditado por corrida";
}
