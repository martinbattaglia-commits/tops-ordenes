"use client";

import Link from "next/link";
import { Kpis, EnrichedDeal } from "@/lib/comercial/dashboard-kpis";

interface Props {
  kpis: Kpis;
  deals: EnrichedDeal[];
}

const fmt = (n: number): string =>
  Math.abs(n) >= 1_000_000
    ? "$ " + (n / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M"
    : "$ " + Math.round(n || 0).toLocaleString("es-AR");

const fmtPct = (n: number): string => n.toFixed(1) + "%";

// ─── Mini stat row ────────────────────────────────────────────────────────────

function Stat({ label, value, accent }: { label: string; value: string; accent?: "success" | "danger" }) {
  return (
    <div className="flex justify-between items-baseline gap-2">
      <span className="text-xs text-fg-muted uppercase tracking-wide">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${
        accent === "success" ? "text-status-success" :
        accent === "danger"  ? "text-status-danger"  :
        "text-fg-primary"
      }`}>{value}</span>
    </div>
  );
}

export function WonVsLost({ kpis }: Props) {
  const total = kpis.wonCount + kpis.lostCount;
  const wonRate  = total > 0 ? (kpis.wonCount  / total) * 100 : 0;
  const lostRate = total > 0 ? (kpis.lostCount / total) * 100 : 0;
  const wonAvg   = kpis.wonCount  > 0 ? kpis.wonAmount  / kpis.wonCount  : 0;
  const lostAvg  = kpis.lostCount > 0 ? kpis.lostAmount / kpis.lostCount : 0;

  // Proportion bar widths (px-safe)
  const wonBarW  = total > 0 ? `${(kpis.wonCount  / total) * 100}%` : "0%";
  const lostBarW = total > 0 ? `${(kpis.lostCount / total) * 100}%` : "0%";

  return (
    <div className="card card-pad space-y-5">
      <h2 className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">
        Ganado vs. Perdido
      </h2>

      {/* ── Proporción visual ── */}
      <div className="space-y-2">
        <div className="flex h-3 rounded-full overflow-hidden gap-px">
          <div className="bg-status-success transition-all" style={{ width: wonBarW }} title={`Ganado: ${fmtPct(wonRate)}`} />
          <div className="bg-status-danger  transition-all" style={{ width: lostBarW }} title={`Perdido: ${fmtPct(lostRate)}`} />
        </div>
        <div className="flex justify-between text-[10px] text-fg-muted">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-status-success inline-block" />
            Ganado {fmtPct(wonRate)}
          </span>
          <span className="flex items-center gap-1">
            Perdido {fmtPct(lostRate)}
            <span className="w-2 h-2 rounded-full bg-status-danger inline-block" />
          </span>
        </div>
      </div>

      {/* ── Columnas ganado / perdido ── */}
      <div className="grid grid-cols-2 gap-4">

        {/* Ganado */}
        <Link
          href="/comercial/oportunidades?status=won"
          className="group rounded-xl border border-stroke-soft p-4 space-y-3 hover:border-status-success/40 hover:bg-status-success/5 transition-all duration-200 cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-status-success" />
            <span className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">Ganado</span>
          </div>
          <div className="text-3xl font-bold text-status-success leading-none tabular-nums group-hover:scale-[1.02] transition-transform origin-left">
            {fmt(kpis.wonAmount)}
          </div>
          <div className="space-y-1.5">
            <Stat label="Deals" value={String(kpis.wonCount)} />
            <Stat label="Ticket prom." value={kpis.wonCount > 0 ? fmt(wonAvg) : "—"} />
            <Stat label="Tasa de cierre" value={fmtPct(wonRate)} accent="success" />
          </div>
        </Link>

        {/* Perdido */}
        <Link
          href="/comercial/oportunidades?status=lost"
          className="group rounded-xl border border-stroke-soft p-4 space-y-3 hover:border-status-danger/40 hover:bg-status-danger/5 transition-all duration-200 cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-status-danger" />
            <span className="text-xs font-semibold text-fg-secondary uppercase tracking-wide">Perdido</span>
          </div>
          <div className="text-3xl font-bold text-status-danger leading-none tabular-nums group-hover:scale-[1.02] transition-transform origin-left">
            {fmt(kpis.lostAmount)}
          </div>
          <div className="space-y-1.5">
            <Stat label="Deals" value={String(kpis.lostCount)} />
            <Stat label="Ticket prom." value={kpis.lostCount > 0 ? fmt(lostAvg) : "—"} />
            <Stat label="Tasa de pérdida" value={fmtPct(lostRate)} accent="danger" />
          </div>
        </Link>

      </div>

      {total === 0 && (
        <p className="text-sm text-fg-muted text-center py-2">Sin datos de cierre en el período.</p>
      )}
    </div>
  );
}
