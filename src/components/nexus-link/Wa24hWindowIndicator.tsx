"use client";

import { Icon } from "@/components/Icon";
import type { WaWindowInfo } from "@/lib/whatsapp/window24h";

export function Wa24hWindowIndicator({
  windowInfo,
  handoverState,
  onToggleHandover,
}: {
  windowInfo: WaWindowInfo;
  handoverState?: "BOT_ACTIVE" | "PAUSED_HUMAN";
  onToggleHandover?: () => void;
}) {
  const isAmber = windowInfo.status === "amber_warning";
  const isRed = windowInfo.status === "red_locked";

  if (!isAmber && !isRed && handoverState !== "PAUSED_HUMAN") {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 px-4 py-2 border-b border-stroke-soft bg-bg-surface-alt text-xs">
      {/* Handover state badge */}
      {handoverState === "PAUSED_HUMAN" && (
        <div className="flex items-center justify-between gap-2 rounded bg-blue-500/10 px-3 py-1.5 text-blue-600 dark:text-blue-400 font-medium">
          <div className="flex items-center gap-1.5">
            <Icon name="user" size={14} className="text-blue-500" />
            <span>Operador Humano Activo — Max Bot en estado PAUSED_HUMAN</span>
          </div>
          {onToggleHandover && (
            <button
              type="button"
              onClick={onToggleHandover}
              className="text-[11px] font-semibold underline hover:opacity-80"
              title="Reactivar respuesta automática de Max Bot"
            >
              Reactivar Max Bot
            </button>
          )}
        </div>
      )}

      {/* Amber Warning Bar (< 3h remaining) */}
      {isAmber && (
        <div className="flex items-center justify-between gap-2 rounded bg-amber-500/15 px-3 py-1.5 text-amber-700 dark:text-amber-300 font-semibold border border-amber-500/30">
          <div className="flex items-center gap-1.5">
            <Icon name="clock" size={14} className="text-amber-500 shrink-0" />
            <span>
              Quedan <strong className="font-bold">{windowInfo.formattedRemaining}</strong> en la ventana de 24h de WhatsApp.
            </span>
          </div>
          <span className="text-[10px] bg-amber-500/20 px-2 py-0.5 rounded font-mono">
            Ventana pronta a vencer
          </span>
        </div>
      )}

      {/* Red Lock Bar (Expired - 0h) */}
      {isRed && (
        <div className="flex items-center justify-between gap-2 rounded bg-tops-red/15 px-3 py-1.5 text-tops-red font-semibold border border-tops-red/30">
          <div className="flex items-center gap-1.5">
            <Icon name="lock" size={14} className="text-tops-red shrink-0" />
            <span>
              Ventana de 24h expirada. Para comunicarte debés enviar una plantillla Utility aprobada.
            </span>
          </div>
          <span className="text-[10px] bg-tops-red/20 px-2 py-0.5 rounded font-mono uppercase">
            Solo Plantilla Utility
          </span>
        </div>
      )}
    </div>
  );
}
