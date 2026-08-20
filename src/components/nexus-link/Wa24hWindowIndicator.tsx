"use client";

import { Icon } from "@/components/Icon";
import type { WaWindowInfo } from "@/lib/whatsapp/window24h";

export function Wa24hWindowIndicator({
  windowInfo,
  handoverState,
  onToggleHandover,
  onOpenTemplateModal,
}: {
  windowInfo: WaWindowInfo;
  handoverState?: "BOT_ACTIVE" | "PAUSED_HUMAN";
  onToggleHandover?: () => void;
  onOpenTemplateModal?: () => void;
}) {
  const isAmber = windowInfo.status === "amber_warning";
  const isRed = windowInfo.status === "red_locked";

  if (!isAmber && !isRed && handoverState !== "PAUSED_HUMAN") {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5 px-4 py-2 border-b border-stroke-soft bg-bg-surface text-xs">
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
        <div className="flex items-center justify-between gap-2 rounded bg-amber-950/40 text-amber-300 border border-amber-500/40 px-3 py-2 text-xs font-medium">
          <div className="flex items-center gap-2">
            <Icon name="clock" size={14} className="text-amber-400 shrink-0" />
            <span>
              Quedan <strong className="font-bold">{windowInfo.formattedRemaining}</strong> para responderle
            </span>
          </div>
          <span className="text-[10px] bg-amber-500/20 px-2 py-0.5 rounded font-mono text-amber-200">
            Ventana activa
          </span>
        </div>
      )}

      {/* Red Lock Bar (Expired - 0h) */}
      {isRed && (
        <div className="flex items-center justify-between gap-2 rounded bg-rose-950/60 text-rose-200 border border-rose-500/50 px-3 py-2 text-xs font-medium">
          <div className="flex items-center gap-2 min-w-0">
            <Icon name="lock" size={14} className="text-rose-400 shrink-0" />
            <span className="truncate">
              La ventana de 24 h se cerró hace {windowInfo.formattedRemaining.replace("Expirada (hace ", "").replace(")", "")}. Sólo podés enviarle una plantilla aprobada por Meta
            </span>
          </div>
          {onOpenTemplateModal && (
            <button
              type="button"
              onClick={onOpenTemplateModal}
              className="btn btn-nexus btn-sm shrink-0 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs px-3"
            >
              Enviar plantilla
            </button>
          )}
        </div>
      )}
    </div>
  );
}
