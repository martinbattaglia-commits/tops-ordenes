/**
 * window24h.ts — Cálculos de la ventana de atención de 24 horas de WhatsApp Business API.
 *
 * Reglas:
 *  - Verde (green_open): > 3h restantes en la ventana.
 *  - Ámbar (amber_warning): <= 3h y > 0h restantes. Muestra barra preventiva de tiempo.
 *  - Rojo (red_locked): <= 0h restantes (expirada). Muestra candado rojo y fuerza selector de plantillas Utility.
 */

export type WaWindowStatus = "green_open" | "amber_warning" | "red_locked";

export interface WaWindowInfo {
  status: WaWindowStatus;
  remainingMs: number;
  hoursRemaining: number;
  formattedRemaining: string;
  isExpired: boolean;
  isWarning: boolean;
}

const WA_WINDOW_DURATION_MS = 24 * 60 * 60 * 1000; // 24 horas
const AMBER_THRESHOLD_MS = 3 * 60 * 60 * 1000;     // 3 horas

export function calculateWa24hWindow(
  lastCustomerMessageAt: string | Date | null | undefined,
  nowDate: Date = new Date()
): WaWindowInfo {
  if (!lastCustomerMessageAt) {
    // Sin mensaje previo del cliente => Asumir ventana abierta por omisión
    return {
      status: "green_open",
      remainingMs: WA_WINDOW_DURATION_MS,
      hoursRemaining: 24,
      formattedRemaining: "24h 0m",
      isExpired: false,
      isWarning: false,
    };
  }

  const lastMs = typeof lastCustomerMessageAt === "string"
    ? new Date(lastCustomerMessageAt).getTime()
    : lastCustomerMessageAt.getTime();

  const nowMs = nowDate.getTime();
  const elapsedMs = nowMs - lastMs;
  const remainingMs = WA_WINDOW_DURATION_MS - elapsedMs;

  if (remainingMs <= 0) {
    return {
      status: "red_locked",
      remainingMs: 0,
      hoursRemaining: 0,
      formattedRemaining: "Expirada (0h 0m)",
      isExpired: true,
      isWarning: false,
    };
  }

  const remainingMinutesTotal = Math.floor(remainingMs / (60 * 1000));
  const hours = Math.floor(remainingMinutesTotal / 60);
  const mins = remainingMinutesTotal % 60;
  const formattedRemaining = `${hours}h ${mins}m`;

  if (remainingMs <= AMBER_THRESHOLD_MS) {
    return {
      status: "amber_warning",
      remainingMs,
      hoursRemaining: hours + mins / 60,
      formattedRemaining,
      isExpired: false,
      isWarning: true,
    };
  }

  return {
    status: "green_open",
    remainingMs,
    hoursRemaining: hours + mins / 60,
    formattedRemaining,
    isExpired: false,
    isWarning: false,
  };
}

/**
 * Gestor de borradores en memoria (Cero pérdida de texto ante expiración).
 */
const draftStore = new Map<string, string>();

export const draftManager = {
  getDraft(conversationId: string): string {
    return draftStore.get(conversationId) ?? "";
  },
  setDraft(conversationId: string, text: string): void {
    if (!text.trim()) {
      draftStore.delete(conversationId);
    } else {
      draftStore.set(conversationId, text);
    }
  },
  clearDraft(conversationId: string): void {
    draftStore.delete(conversationId);
  },
};
