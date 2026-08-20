"use client";

import { Icon } from "@/components/Icon";
import type { WaWindowInfo } from "@/lib/whatsapp/window24h";

export function Wa24hWindowIndicator({
  windowInfo,
  handoverState,
  onToggleHandover,
  handoverPending = false,
  handoverError,
  onOpenTemplateModal,
}: {
  windowInfo: WaWindowInfo;
  handoverState?: "BOT_ACTIVE" | "PAUSED_HUMAN";
  onToggleHandover?: () => void;
  handoverPending?: boolean;
  handoverError?: string | null;
  onOpenTemplateModal?: () => void;
}) {
  const isAmber = windowInfo.status === "amber_warning";
  const isRed = windowInfo.status === "red_locked";

  if (!isAmber && !isRed && !handoverState) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5 px-4 py-2 border-b border-stroke-soft bg-bg-surface text-xs">
      {/* Handover state badge */}
      {handoverState && (
        <div className={`flex items-center justify-between gap-2 rounded px-3 py-1.5 font-medium ${
          handoverState === "PAUSED_HUMAN"
            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
            : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
        }`}>
          <div className="flex items-center gap-1.5">
            <Icon
              name={handoverState === "PAUSED_HUMAN" ? "user" : "sparkle"}
              size={14}
              className={handoverState === "PAUSED_HUMAN" ? "text-blue-500" : "text-emerald-500"}
            />
            <span>
              {handoverState === "PAUSED_HUMAN"
                ? "Conversación tomada — Max está pausado"
                : "Max está activo como filtro inicial"}
            </span>
          </div>
          {onToggleHandover && (
            <button
              type="button"
              onClick={onToggleHandover}
              disabled={handoverPending}
              className="text-[11px] font-semibold underline hover:opacity-80"
              title={handoverState === "PAUSED_HUMAN"
                ? "Reactivar respuesta automática de Max"
                : "Tomar la conversación y pausar a Max"}
            >
              {handoverPending
                ? "Guardando…"
                : handoverState === "PAUSED_HUMAN"
                  ? "Reactivar Max"
                  : "Tomar conversación / Pausar Max"}
            </button>
          )}
        </div>
      )}

      {handoverError && (
        <p role="alert" className="text-[11px] font-medium text-tops-red">
          No se pudo cambiar el estado de Max: {handoverError}
        </p>
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
