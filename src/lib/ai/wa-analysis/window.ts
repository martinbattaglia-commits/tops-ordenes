// LINK-WA-002 · E1.1 · Guarda A — CONTEXTO. Módulo PURO (sin IO).
//
// Los cuatro límites se aplican SIMULTÁNEAMENTE (resolución de Dirección):
//   · 120 mensajes máximo    · 24.000 caracteres
//   · 8.000 tokens de entrada estimados   · 6.000 tokens de salida (tope del pedido)
//
// «120 máximo» y no «120 fijos»: con la constante calibrada sobre la medición real
// (1.6), el tope que suele morder primero es el de TOKENS, así que la cantidad
// efectiva de mensajes es normalmente MENOR a 120. Esa es la consecuencia buscada
// de respetar el tope de entrada, no un defecto.
//
// Regla inviolable: **no cortar mensajes silenciosamente**. Un mensaje entra
// completo o no entra; cuando algo queda afuera, la ventana lo REPORTA con
// motivo y cifras, para que la auditoría y la UI puedan mostrarlo.
//
// Estrategia: se conserva la cola MÁS RECIENTE del hilo (lo último es lo que
// importa para proponer acciones) y se recorta hacia atrás. El orden
// cronológico, la fecha, el autor y el message_id se preservan intactos.

import type { WaMessageInput } from "./prompt";

export const CONTEXT_LIMITS = {
  maxMessages: 120,
  maxChars: 24_000,
  maxInputTokens: 8_000,
  // D-2: 6.000. Con 2.000 el JSON de 120 mensajes se cortaba en 1.990 —medido—:
  // el contrato pide clasificación + hallazgos + acciones, cada uno con citas.
  maxOutputTokens: 6_000,
} as const;

/** Overhead real del render de evidencia por mensaje: `[msg:<uuid>] (<iso>) <autor>: `. */
export const PER_MESSAGE_OVERHEAD_CHARS = 90;

/** Caracteres por token.
 *
 *  🔴 CORREGIDO tras MEDIR una corrida real. El valor anterior era 3.8 y estaba
 *  documentado como «conservador: sobreestima tokens, nunca subestima costo».
 *  Era falso: SUBESTIMÓ 2,35 veces. La ventana declaró ~5.147 tokens de entrada y
 *  el proveedor cobró 10.835 sobre los mismos 17.541 caracteres, o sea **1,62
 *  caracteres por token** — WhatsApp en español con acentos, emojis y
 *  abreviaturas tokeniza mucho peor que la prosa administrativa de la que salió
 *  aquella constante. El tope autorizado de 8.000 tokens se excedió (135,4 %) sin
 *  que nada lo detectara.
 *
 *  ✅ Valor vigente por resolución de Dirección (D-1): **1.6**.
 *  Es apenas MÁS estricto que la tasa medida (1,619), así que la estimación queda
 *  del lado seguro. Aritmética del tope, para que no haya que confiar en la palabra:
 *
 *    caracteres admitidos = (8.000 − 530) × 1.6 = 11.952
 *    cobro real esperado  = 11.952 / 1,619      =  7.383 tokens  (92 % del tope)
 *    cobro pesimista      = 11.952 / 1,62 + 530 =  7.909 tokens  (99 % del tope)
 *
 *  El escenario pesimista cuenta el andamiaje DOS veces (una dentro de la tasa
 *  agregada y otra en `PROMPT_SCAFFOLD_TOKENS`) y aun así no excede 8.000. Un valor
 *  intermedio como 2.2 NO cumplía: admitía 16.434 caracteres ≈ 10.681 tokens reales,
 *  el 133 % del tope.
 *
 *  Contrapartida aceptada: en un hilo denso como el medido —146,2 caracteres por
 *  mensaje contando el encabezado de evidencia— entran ~81 mensajes en vez de 120.
 *  Menos contexto, pero el tope autorizado se respeta de verdad.
 *
 *  Esta constante NO reemplaza al postcheck de conformidad: si un corpus tokeniza
 *  peor que el medido, el exceso lo detecta la comparación contra lo COBRADO. La
 *  estimación evita el exceso; el postcheck lo delata si igual ocurre. */
export const CHARS_PER_TOKEN = 1.6;

/** Tasa MEDIDA en el corpus real de WhatsApp (17.541 caracteres → 10.835 tokens).
 *  Se expone para que la brecha entre lo estimado y lo real sea verificable en un
 *  test, en lugar de vivir en un comentario. */
export const CHARS_PER_TOKEN_MEDIDO_WHATSAPP = 1.62;

/** Costo fijo del andamiaje del prompt (system + esquema), medido sobre el prompt real. */
export const PROMPT_SCAFFOLD_TOKENS = 530;

export type TruncationReason = "cantidad" | "caracteres" | "tokens";

/** Los cuatro topes, ya resueltos (defaults + overrides del llamador). */
export type ContextLimits = Record<keyof typeof CONTEXT_LIMITS, number>;

export interface WindowResult {
  /** Mensajes que entran, COMPLETOS y en orden cronológico ascendente. */
  included: WaMessageInput[];
  /** Cuántos quedaron afuera (los más antiguos). */
  omitted: number;
  /** Total de mensajes del hilo considerados. */
  total: number;
  chars: number;
  estimatedInputTokens: number;
  maxOutputTokens: number;
  truncated: boolean;
  /** Qué límite obligó a recortar (el primero que se alcanzó). null si no se recortó. */
  reason: TruncationReason | null;
  /** Límites EFECTIVOS de esta ventana (incluye overrides del llamador). */
  limits: ContextLimits;
}

function messageChars(m: WaMessageInput): number {
  return (m.body ?? "").length + PER_MESSAGE_OVERHEAD_CHARS;
}

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN) + PROMPT_SCAFFOLD_TOKENS;
}

/**
 * Construye la ventana aplicando los cuatro límites a la vez.
 * @param messages mensajes candidatos, en orden cronológico ascendente.
 * @param totalInThread total REAL de mensajes del hilo. Si el llamador ya trajo
 *   una cola acotada por la consulta, este número debe ser el del hilo entero:
 *   de lo contrario la ventana informaría «completa» habiendo dejado mensajes
 *   afuera en la base (recorte silencioso, prohibido por Dirección).
 */
export function buildWindow(
  messages: WaMessageInput[],
  limits: Partial<ContextLimits> = {},
  totalInThread?: number,
): WindowResult {
  const L: ContextLimits = { ...CONTEXT_LIMITS, ...limits };
  const total = Math.max(totalInThread ?? messages.length, messages.length);

  const picked: WaMessageInput[] = [];
  let chars = 0;
  let reason: TruncationReason | null = null;

  // Del más reciente hacia atrás: se preserva la cola del hilo.
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    // Límite 1 — cantidad.
    if (picked.length >= L.maxMessages) {
      reason = "cantidad";
      break;
    }
    const next = chars + messageChars(m);
    // Límite 2 — caracteres. El mensaje NO se parte: si no entra, se detiene.
    if (next > L.maxChars) {
      reason = "caracteres";
      break;
    }
    // Límite 3 — tokens estimados de entrada.
    if (estimateTokens(next) > L.maxInputTokens) {
      reason = "tokens";
      break;
    }
    picked.push(m);
    chars = next;
  }

  picked.reverse(); // vuelve a orden cronológico ascendente
  const omitted = total - picked.length;

  return {
    included: picked,
    omitted,
    total,
    chars,
    estimatedInputTokens: estimateTokens(chars),
    maxOutputTokens: L.maxOutputTokens,
    truncated: omitted > 0,
    reason: omitted > 0 ? (reason ?? "cantidad") : null,
    limits: L,
  };
}

/** Línea humana para auditoría y UI: nunca un recorte silencioso. */
export function describeWindow(w: WindowResult): string {
  if (!w.truncated) {
    return `Ventana completa: ${w.included.length} mensajes · ${w.chars} caracteres · ~${w.estimatedInputTokens} tokens de entrada.`;
  }
  const porQue = {
    cantidad: `tope de ${w.limits.maxMessages} mensajes`,
    caracteres: `tope de ${w.limits.maxChars} caracteres`,
    tokens: `tope de ${w.limits.maxInputTokens} tokens de entrada`,
  }[w.reason ?? "cantidad"];
  return `Ventana TRUNCADA por ${porQue}: se analizaron los ${w.included.length} mensajes más recientes de ${w.total}; ${w.omitted} quedaron fuera · ${w.chars} caracteres · ~${w.estimatedInputTokens} tokens de entrada.`;
}
