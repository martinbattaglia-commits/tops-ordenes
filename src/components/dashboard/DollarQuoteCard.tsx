import { Icon } from "@/components/Icon";
import { fmtArs, fmtHoraAr, resolveFxCardKind, type FxCardKind } from "@/lib/fx/format";
import type { FxStatus } from "@/lib/fx/parse";

/**
 * KPI del dólar Banco Nación (venta) para el banner del Cockpit. Componente
 * presentacional y reutilizable: recibe la cotización ya resuelta por props y
 * NO consulta ninguna fuente. Chip "dark premium" con tratamiento propio
 * (fondo oscuro fijo) para verse integrado en light y dark, igual que el
 * Command Center.
 *
 * Estados: loading · loaded · stale (último dato) · unavailable (no disponible).
 * Accesible: `role="group"` + `aria-label`, estado nunca comunicado sólo por
 * color (siempre hay texto), y las animaciones respetan `prefers-reduced-motion`.
 */
export interface DollarQuoteCardProps {
  /** Venta (ask). null → estado no disponible. */
  sell: number | null;
  /** Compra (bid). Opcional; hoy no se muestra pero queda en el contrato. */
  buy?: number | null;
  source?: string;
  pair?: string;
  updatedAt?: string | null;
  stale?: boolean;
  error?: boolean;
  loading?: boolean;
  status?: FxStatus;
  className?: string;
}

const KIND_THEME: Record<
  FxCardKind,
  { accent: string; dot: string; glow: string; iconWrap: string; pulse: boolean }
> = {
  loaded: {
    accent: "text-emerald-300",
    dot: "bg-emerald-400",
    glow: "rgba(16,185,129,0.16)",
    iconWrap: "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30",
    pulse: false,
  },
  stale: {
    accent: "text-amber-300",
    dot: "bg-amber-400",
    glow: "rgba(245,180,30,0.14)",
    iconWrap: "bg-amber-400/15 text-amber-300 ring-amber-400/30",
    pulse: true,
  },
  unavailable: {
    accent: "text-white/70",
    dot: "bg-red-400",
    glow: "rgba(148,163,184,0.10)",
    iconWrap: "bg-white/10 text-white/70 ring-white/15",
    pulse: true,
  },
  loading: {
    accent: "text-white/40",
    dot: "bg-white/30",
    glow: "rgba(148,163,184,0.08)",
    iconWrap: "bg-white/10 text-white/40 ring-white/10",
    pulse: true,
  },
};

function footerText(kind: FxCardKind, hora: string | null): string {
  switch (kind) {
    case "loaded":
      return hora ? `Actualizado ${hora}` : "Actualizado";
    case "stale":
      return hora ? `Último dato · ${hora}` : "Último dato disponible";
    case "unavailable":
      return "No disponible · Reintentando";
    case "loading":
      return "Actualizando…";
  }
}

export function DollarQuoteCard({
  sell,
  source = "Banco Nación",
  pair = "USD / ARS",
  updatedAt,
  stale,
  error,
  loading,
  status,
  className,
}: DollarQuoteCardProps) {
  const kind = resolveFxCardKind({ loading, error, sell, status, stale });
  const theme = KIND_THEME[kind];
  const hora = fmtHoraAr(updatedAt);
  const valueLabel = kind === "loaded" || kind === "stale" ? (sell != null ? fmtArs(sell) : null) : null;

  const ariaLabel =
    valueLabel != null
      ? `Dólar ${source}, venta ${valueLabel}${hora ? `, actualizado ${hora}` : ""}${kind === "stale" ? " (último dato disponible)" : ""}`
      : `Dólar ${source}, cotización de venta no disponible`;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`relative overflow-hidden rounded-xl border border-white/10 shadow-sm ${className ?? ""}`}
      style={{ background: "linear-gradient(160deg, rgba(10,14,24,0.98), rgba(13,22,38,0.94))" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(120% 120% at 100% 0%, ${theme.glow}, transparent 60%)` }}
      />
      <div className="relative flex flex-col gap-2 px-4 py-3">
        {/* Header: label fuente + dolar + estado */}
        <div className="flex items-center gap-2">
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ring-1 ${theme.iconWrap}`}>
            <Icon name="wallet" size={15} />
          </span>
          <span className={`text-[11px] font-black uppercase tracking-[0.16em] ${theme.accent}`}>
            Dólar BNA
          </span>
          <span
            aria-hidden
            className={`ml-auto h-2 w-2 shrink-0 rounded-full ${theme.dot} ${theme.pulse ? "motion-safe:animate-pulse" : ""}`}
          />
        </div>

        {/* Par */}
        <div className="text-[11px] font-semibold uppercase tracking-wide text-white/45">{pair}</div>

        {/* Valor principal */}
        {kind === "loading" ? (
          <div className="h-7 w-28 rounded bg-white/10 motion-safe:animate-pulse" aria-hidden />
        ) : valueLabel != null ? (
          <div className="text-2xl font-black leading-none tabular-nums text-white">{valueLabel}</div>
        ) : (
          <div className="text-lg font-bold leading-none text-white/70">Sin dato</div>
        )}

        {/* Sub-label */}
        <div className="text-[11px] font-semibold text-white/55">Venta · {source}</div>

        {/* Footer: estado + badge fuente */}
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className={`text-[10px] font-medium ${kind === "unavailable" ? "text-white/60" : "text-white/50"}`}>
            {footerText(kind, hora)}
          </span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/70 ring-1 ring-white/10">
            Fuente BNA
          </span>
        </div>
      </div>
    </div>
  );
}
