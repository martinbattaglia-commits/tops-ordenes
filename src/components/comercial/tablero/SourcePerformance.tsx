"use client";

import type { SourceStats } from "@/lib/comercial/dashboard-kpis";
import { useTableroFilters, scrollToSection } from "@/hooks/useTableroFilters";

// ─── fmt helper ──────────────────────────────────────────────────────────────

const fmt = (n: number) => {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 1_000_000)
    return "$ " + (v / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M";
  return "$ " + v.toLocaleString("es-AR");
};

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  stats: SourceStats[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SourcePerformance({ stats }: Props) {
  const { applyFilter } = useTableroFilters();

  // Check if most deals have no source (> 60% "Sin fuente")
  const total = stats.reduce((a, s) => a + s.count, 0);
  const sinFuente = stats.find((s) => s.source === "Sin fuente");
  const sinFuenteCount = sinFuente?.count ?? 0;
  const sinFuentePct = total > 0 ? Math.round(((sinFuente?.count ?? 0) / total) * 100) : 0;
  const mostlyEmpty = total > 0 && sinFuenteCount / total > 0.6;

  // Sort: "Sin fuente" always last, rest by totalAmount desc (already sorted from groupBySource)
  const sorted = [
    ...stats.filter((s) => s.source !== "Sin fuente"),
    ...stats.filter((s) => s.source === "Sin fuente"),
  ];

  const handleRowClick = (source: string) => {
    applyFilter({ source });
    scrollToSection("opportunities-table");
  };

  if (!stats.length || total === 0) {
    return (
      <section id="source-performance-block" className="space-y-4">
        <header>
          <h2 className="text-xl font-bold text-fg-primary">Rendimiento por canal / fuente</h2>
          <p className="text-sm text-fg-muted">No solo cuántos leads, sino cuáles son los mejores</p>
        </header>
        <div className="card card-pad">
          <p className="text-sm text-fg-muted">No hay datos de fuente disponibles.</p>
        </div>
      </section>
    );
  }

  return (
    <section id="source-performance-block" className="space-y-4">
      <header>
        <h2 className="text-xl font-bold text-fg-primary">Rendimiento por canal / fuente</h2>
        <p className="text-sm text-fg-muted">No solo cuántos leads, sino cuáles son los mejores</p>
      </header>

      {/* Warning banner when most deals have no source */}
      {mostlyEmpty && (
        <div className="card card-pad border-l-4 border-status-warning bg-status-warning/5 text-sm text-fg-secondary space-y-1">
          <p className="font-semibold text-status-warning">Datos de fuente incompletos</p>
          <p>
            La fuente de origen no está completa en Clientify.{" "}
            <strong>{sinFuentePct}%</strong> de oportunidades sin fuente declarada.
            Completar el campo &ldquo;Fuente&rdquo; en cada deal para activar el análisis de canal.
          </p>
        </div>
      )}

      {/* Main table */}
      <div className="card card-pad overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-stroke-soft text-xs text-fg-muted uppercase tracking-wide">
              <th className="py-2 px-2 text-left">Fuente</th>
              <th className="py-2 px-2 text-right">Oportunidades</th>
              <th className="py-2 px-2 text-right hidden sm:table-cell">Valor bruto</th>
              <th className="py-2 px-2 text-right hidden md:table-cell">Valor esp.</th>
              <th className="py-2 px-2 text-right hidden md:table-cell">Ticket prom.</th>
              <th className="py-2 px-2 text-right hidden lg:table-cell">Prob. prom.</th>
              <th className="py-2 px-2 text-right hidden lg:table-cell">Ganadas</th>
              <th className="py-2 px-2 text-right hidden lg:table-cell">Perdidas</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((stat) => {
              const isSinFuente = stat.source === "Sin fuente";
              return (
                <tr
                  key={stat.source}
                  className={`border-b border-stroke-soft last:border-0 transition-colors ${
                    isSinFuente
                      ? "opacity-60"
                      : "hover:bg-fg-primary/5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tops-blue-600 focus-visible:ring-inset"
                  }`}
                  title={isSinFuente ? undefined : "Click para filtrar por esta fuente"}
                  onClick={isSinFuente ? undefined : () => handleRowClick(stat.source)}
                  onKeyDown={isSinFuente ? undefined : (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleRowClick(stat.source); } }}
                  role={isSinFuente ? undefined : "button"}
                  tabIndex={isSinFuente ? undefined : 0}
                  aria-label={isSinFuente ? undefined : `Filtrar por fuente: ${stat.source}`}
                >
                  {/* Fuente */}
                  <td className="py-2.5 px-2 font-medium text-fg-primary">
                    {stat.source}
                    {!isSinFuente && (
                      <span className="ml-1 text-xs text-fg-brand opacity-0 group-hover:opacity-100">↗</span>
                    )}
                  </td>

                  {/* Oportunidades */}
                  <td className="py-2.5 px-2 text-right tabular-nums text-fg-primary font-semibold">
                    {stat.count > 0 ? stat.count : "—"}
                  </td>

                  {/* Valor bruto */}
                  <td className="py-2.5 px-2 text-right hidden sm:table-cell tabular-nums text-fg-primary">
                    {stat.totalAmount > 0 ? fmt(stat.totalAmount) : "—"}
                  </td>

                  {/* Valor esp. */}
                  <td className="py-2.5 px-2 text-right hidden md:table-cell tabular-nums text-fg-secondary">
                    {stat.weightedAmount > 0 ? fmt(stat.weightedAmount) : "—"}
                  </td>

                  {/* Ticket prom. */}
                  <td className="py-2.5 px-2 text-right hidden md:table-cell tabular-nums text-fg-secondary">
                    {stat.ticketAvg > 0 ? fmt(stat.ticketAvg) : "—"}
                  </td>

                  {/* Prob. prom. */}
                  <td className="py-2.5 px-2 text-right hidden lg:table-cell tabular-nums">
                    {stat.count > 0 ? (
                      <span
                        className={
                          stat.avgProbability >= 50
                            ? "text-status-success font-semibold"
                            : stat.avgProbability >= 25
                            ? "text-status-warning font-semibold"
                            : "text-status-danger font-semibold"
                        }
                      >
                        {stat.avgProbability}%
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>

                  {/* Ganadas */}
                  <td className="py-2.5 px-2 text-right hidden lg:table-cell tabular-nums text-status-success font-medium">
                    {stat.wonCount > 0 ? stat.wonCount : "—"}
                  </td>

                  {/* Perdidas */}
                  <td className="py-2.5 px-2 text-right hidden lg:table-cell tabular-nums text-status-danger font-medium">
                    {stat.lostCount > 0 ? stat.lostCount : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Footer hint */}
        <div className="mt-3 pt-3 border-t border-stroke-soft text-xs text-fg-muted">
          Click en una fila para filtrar oportunidades por esa fuente
        </div>
      </div>
    </section>
  );
}
