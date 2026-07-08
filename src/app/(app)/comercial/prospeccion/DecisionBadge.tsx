"use client";

const PILL = "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold";
const DOT = "h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70";

export function DecisionBadge({ decision }: { decision: string }) {
  switch (decision) {
    case "import":
      return (
        <span className={`${PILL} bg-emerald-500/10 text-emerald-400`}>
          <span className={DOT} />
          Excelente
        </span>
      );
    case "review":
      return (
        <span className={`${PILL} bg-amber-500/10 text-amber-400`}>
          <span className={DOT} />
          Revisar
        </span>
      );
    case "discard":
      return (
        <span className={`${PILL} bg-red-500/10 text-red-400`}>
          <span className={DOT} />
          Descartar
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-full bg-bg-surface-alt px-3 py-1 text-xs font-semibold text-fg-muted">
          {decision}
        </span>
      );
  }
}
