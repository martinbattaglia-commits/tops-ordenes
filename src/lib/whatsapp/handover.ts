/**
 * handover.ts — Protocolo de Handover y silenciamiento automático de Max Bot.
 *
 * Operadores humanos autorizados para intervención:
 *  - Martín
 *  - Cynthia
 *  - Ruth
 *  - José Luis
 *  - O perfiles autorizados en WHATSAPP_SANDBOX_OPERATOR_PROFILE_IDS.
 */

import { parseOperatorProfileIds, isOperatorAuthorized } from "./operators";

export const KNOWN_HUMAN_OPERATOR_NAMES = ["martín", "martin", "cynthia", "ruth", "josé luis", "jose luis"];

export type HandoverState = "BOT_ACTIVE" | "PAUSED_HUMAN";

/**
 * Evalúa si un actor o perfil corresponde a un operador humano reconocido.
 */
export function isHumanOperator(
  profileIdOrName: string | null | undefined,
  allowlist?: string[]
): boolean {
  if (!profileIdOrName) return false;

  const norm = profileIdOrName.trim().toLowerCase();

  // 1. Verificación por nombres de operadores humanos reconocidos por Dirección
  if (KNOWN_HUMAN_OPERATOR_NAMES.some((name) => norm.includes(name))) {
    return true;
  }

  // 2. Verificación por UUID en la allowlist de operadores
  const list = allowlist ?? parseOperatorProfileIds().ids;
  if (isOperatorAuthorized(norm, list)) {
    return true;
  }

  return false;
}

/**
 * Indica si el bot de respuestas automáticas (Max Bot) debe ser silenciado.
 */
export function shouldSilenceMaxBot(handoverState: string | null | undefined): boolean {
  return handoverState === "PAUSED_HUMAN";
}
