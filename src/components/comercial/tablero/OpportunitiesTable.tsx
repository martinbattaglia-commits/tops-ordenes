"use client";

import { useMemo, useState } from "react";
import { useTableroFilters, DEFAULT_FILTERS } from "@/hooks/useTableroFilters";
import { ActiveFilterChips } from "./ActiveFilterChips";
import { DealDetailPanel } from "./DealDetailPanel";
import type { ScoredDeal } from "./DealDetailPanel";
import {
  calculateCommercialScore,
  normalizeScore,
  getSemaforoColor,
  getSuggestedAction,
  calculateWeightedForecast,
  stalenessDays,
} from "@/lib/comercial/commercial-score";
import type { SemaforoColor } from "@/lib/comercial/commercial-score";
import type { EnrichedDeal } from "@/lib/comercial/dashboard-kpis";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) => {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 1_000_000) {
    return "$ " + (v / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M";
  }
  return "$ " + v.toLocaleString("es-AR");
};

const probColor = (p: number) =>
  p >= 50 ? "text-status-success" : p <= 20 ? "text-status-danger" : "text-fg-secondary";

const semaforoClass = (c: SemaforoColor) => {
  if (c === "green") return "bg-status-success";
  if (c === "yellow") return "bg-status-warning";
  return "bg-status-danger";
};

const semaforoTitle = (c: SemaforoColor) => {
  if (c === "green") return "Prioritaria";
  if (c === "yellow") return "En seguimiento";
  return "En riesgo";
};

const scoreBadgeClass = (score: number) => {
  if (score >= 65) return "bg-status-success/20 text-status-success";
  if (score >= 35) return "bg-status-warning/20 text-status-warning";
  return "bg-status-danger/20 text-status-danger";
};

const staleColor = (days: number) => {
  if (days === Infinity) return "text-fg-muted";
  if (days < 7) return "text-status-success";
  if (days < 14) return "text-fg-secondary";
  if (days < 21) return "text-status-warning";
  return "text-status-danger";
};

const statusBadge = (status: EnrichedDeal["status"]) => {
  switch (status) {
    case "open":
      return <span className="badge badge-success"><span className="dot" />Activa</span>;
    case "won":
      return <span className="badge badge-info"><span className="dot" />Ganada</span>;
    case "lost":
      return <span className="badge badge-danger"><span className="dot" />Perdida</span>;
    case "expired":
      return <span className="badge badge-warning"><span className="dot" />Vencida</span>;
    default:
      return <span className="badge badge-muted"><span className="dot" />Otra</span>;
  }
};

const fmtDate = (s: string | null | undefined) => {
  if (!s) return "—";
  try {
    return new Date(s + "T12:00:00").toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return s;
  }
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface OpportunitiesTableProps {
  /** Pre-filtered + pre-sorted deals from TableroShell */
  deals: EnrichedDeal[];
  /** Full dataset for populating filter option lists */
  allDeals: EnrichedDeal[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OpportunitiesTable({ deals, allDeals }: OpportunitiesTableProps) {
  const today = useMemo(() => new Date(), []);
  const { filters, setFilter, clearAll, activeCount } = useTableroFilters();
  const [selectedDeal, setSelectedDeal] = useState<ScoredDeal | null>(null);
  const [search, setSearch] = useState("");

  // ── Filter option lists from allDeals ──
  const pipelines = useMemo(() => {
    const set = new Set<string>();
    for (const d of allDeals) if (d.pipeline) set.add(d.pipeline);
    return Array.from(set).sort();
  }, [allDeals]);

  const stages = useMemo(() => {
    const set = new Set<string>();
    for (const d of allDeals) if (d.stage) set.add(d.stage);
    return Array.from(set).sort();
  }, [allDeals]);

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const d of allDeals) {
      if (d.deal_source) set.add(d.deal_source);
    }
    return Array.from(set).sort();
  }, [allDeals]);

  // ── Score computation — normalize against full dataset so percentiles are stable ──
  const allRawScores = useMemo(() => allDeals.map((d) => calculateCommercialScore(d, today)), [allDeals, today]);

  const scoredDeals = useMemo<ScoredDeal[]>(
    () =>
      deals.map((d) => {
        const rawScore = calculateCommercialScore(d, today);
        const normalizedScore = normalizeScore(allRawScores, rawScore);
        const semaforoColor = getSemaforoColor(normalizedScore);
        const staleDays = stalenessDays(d, today);
        return {
          ...d,
          _score: normalizedScore,
          _staleDays: staleDays,
          _semaforoColor: semaforoColor,
          _suggestedAction: getSuggestedAction(d, today),
          _weightedForecast: calculateWeightedForecast(d),
        };
      }),
    [deals, allRawScores, today]
  );

  // ── Client-side search filter (title/company) ──
  const displayDeals = useMemo(() => {
    if (!search.trim()) return scoredDeals;
    const q = search.toLowerCase();
    return scoredDeals.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        (d.company_name ?? "").toLowerCase().includes(q) ||
        (d.contact_name ?? "").toLowerCase().includes(q)
    );
  }, [scoredDeals, search]);

  return (
    <section id="opportunities-table" className="space-y-3">
      {/* ── Active filter chips ── */}
      {activeCount > 0 && (
        <ActiveFilterChips
          filters={filters}
          setFilter={setFilter}
          clearAll={clearAll}
          activeCount={activeCount}
        />
      )}

      {/* ── Filter bar ── */}
      <div className="card card-pad flex flex-col gap-3">
        {/* Row 1: search + dropdowns + sort */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar empresa, oportunidad…"
            className="rounded-lg border border-stroke-soft bg-bg-surface px-3 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-tops-blue-700/40 w-52"
          />

          {/* Pipeline */}
          <select
            value={filters.pipeline}
            onChange={(e) => setFilter("pipeline", e.target.value)}
            className="rounded-lg border border-stroke-soft bg-bg-surface px-2 py-1.5 text-sm text-fg-primary focus:outline-none"
          >
            <option value="">Pipeline: Todos</option>
            {pipelines.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          {/* Stage */}
          <select
            value={filters.stage}
            onChange={(e) => setFilter("stage", e.target.value)}
            className="rounded-lg border border-stroke-soft bg-bg-surface px-2 py-1.5 text-sm text-fg-primary focus:outline-none"
          >
            <option value="">Etapa: Todas</option>
            {stages.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {/* Source */}
          <select
            value={filters.source}
            onChange={(e) => setFilter("source", e.target.value)}
            className="rounded-lg border border-stroke-soft bg-bg-surface px-2 py-1.5 text-sm text-fg-primary focus:outline-none"
          >
            <option value="">Fuente: Todas</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value="Sin fuente">Sin fuente</option>
          </select>

          {/* Sort */}
          <select
            value={filters.sort}
            onChange={(e) => setFilter("sort", e.target.value as typeof filters.sort)}
            className="rounded-lg border border-stroke-soft bg-bg-surface px-2 py-1.5 text-sm text-fg-primary focus:outline-none ml-auto"
          >
            <option value="score">Ordenar: Score</option>
            <option value="amount">Ordenar: Importe</option>
            <option value="forecast">Ordenar: Forecast</option>
            <option value="probability">Ordenar: Probabilidad</option>
            <option value="modified">Ordenar: Última act.</option>
            <option value="days_stagnant">Ordenar: Días estancado</option>
          </select>
        </div>

        {/* Row 2: score tier + status + boolean toggles + counter */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* Score tier */}
          <select
            value={filters.score}
            onChange={(e) => setFilter("score", e.target.value as typeof filters.score)}
            className="rounded-lg border border-stroke-soft bg-bg-surface px-2 py-1.5 text-sm text-fg-primary focus:outline-none"
          >
            <option value="all">Semáforo: Todos</option>
            <option value="hot">Caliente</option>
            <option value="warm">En seguimiento</option>
            <option value="cold">En riesgo</option>
          </select>

          {/* Status tabs */}
          <div className="flex rounded-lg border border-stroke-soft overflow-hidden">
            {(
              [
                { value: "active", label: "Activas" },
                { value: "expired", label: "Vencidas" },
                { value: "won", label: "Ganadas" },
                { value: "lost", label: "Perdidas" },
                { value: "all", label: "Todas" },
              ] as const
            ).map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter("status", value)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  filters.status === value
                    ? "bg-tops-blue-700 text-white"
                    : "bg-bg-surface text-fg-secondary hover:bg-fg-primary/5"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Boolean toggles */}
          <div className="flex items-center gap-2">
            {(
              [
                { key: "no_action" as const, label: "Sin acción" },
                { key: "stagnant" as const, label: "Estancadas" },
                { key: "overdue" as const, label: "Vencidas" },
                { key: "closing_30" as const, label: "Próx. 30d" },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key, !filters[key])}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  filters[key]
                    ? "bg-tops-blue-700/15 text-tops-blue-700 ring-1 ring-tops-blue-700/30"
                    : "bg-fg-primary/5 text-fg-secondary hover:bg-fg-primary/10"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Counter */}
          <span className="ml-auto text-xs text-fg-muted font-medium tabular-nums">
            {displayDeals.length} de {allDeals.length} oportunidades
          </span>
        </div>
      </div>

      {/* ── Table ── */}
      {displayDeals.length === 0 ? (
        <div className="card card-pad flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-fg-muted">
            No hay oportunidades que coincidan con los filtros activos.
          </p>
          <button
            type="button"
            onClick={() => {
              clearAll();
              setSearch("");
            }}
            className="rounded-lg bg-fg-primary/5 px-4 py-1.5 text-sm font-medium text-fg-secondary hover:bg-fg-primary/10 transition-colors"
          >
            Limpiar filtros
          </button>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stroke-soft bg-bg-surface-alt">
                {/* Always visible */}
                <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-fg-muted w-6" title="Semáforo de score">
                  ●
                </th>
                <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-fg-muted whitespace-nowrap">
                  Score
                </th>
                <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-fg-muted whitespace-nowrap min-w-[160px]">
                  Empresa / Oportunidad
                </th>
                <th className="hidden md:table-cell px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-fg-muted whitespace-nowrap">
                  Pipeline
                </th>
                <th className="hidden md:table-cell px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-fg-muted whitespace-nowrap">
                  Etapa
                </th>
                <th className="hidden md:table-cell px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-fg-muted whitespace-nowrap">
                  Valor bruto
                </th>
                <th className="hidden md:table-cell px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-fg-muted whitespace-nowrap">
                  Valor esp.
                </th>
                <th className="px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-fg-muted whitespace-nowrap">
                  Prob%
                </th>
                <th className="hidden md:table-cell px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-fg-muted whitespace-nowrap">
                  Horizonte
                </th>
                <th className="hidden lg:table-cell px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-fg-muted whitespace-nowrap">
                  Días sin act.
                </th>
                <th className="hidden lg:table-cell px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-fg-muted whitespace-nowrap">
                  Próx. acción
                </th>
                <th className="hidden lg:table-cell px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-fg-muted whitespace-nowrap">
                  Resp.
                </th>
                <th className="hidden lg:table-cell px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-fg-muted whitespace-nowrap">
                  Fuente
                </th>
                <th className="px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-fg-muted whitespace-nowrap">
                  Estado
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stroke-soft">
              {displayDeals.map((d) => (
                <tr
                  key={d.deal_id}
                  onClick={() => setSelectedDeal(d)}
                  className="hover:bg-fg-primary/[0.03] cursor-pointer transition-colors nx-stagger"
                >
                  {/* Semáforo */}
                  <td className="px-3 py-2.5">
                    <span
                      className={`block h-2.5 w-2.5 rounded-full ${semaforoClass(d._semaforoColor!)}`}
                      title={semaforoTitle(d._semaforoColor!)}
                    />
                  </td>

                  {/* Score */}
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span
                      className={`inline-block rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums ${scoreBadgeClass(
                        d._score!
                      )}`}
                    >
                      {d._score}
                    </span>
                  </td>

                  {/* Empresa / Oportunidad */}
                  <td className="px-3 py-2.5 min-w-[160px] max-w-[220px]">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-fg-primary">
                          {d.company_name ?? d.contact_name ?? "—"}
                        </p>
                        <p className="truncate text-[11px] text-fg-muted">{d.title}</p>
                      </div>
                      {/* External link — stop propagation so row click doesn't also open panel */}
                      <a
                        href={d.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="Abrir en Clientify"
                        className="shrink-0 text-fg-muted hover:text-fg-link transition-colors"
                        aria-label="Abrir en Clientify"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </a>
                    </div>
                  </td>

                  {/* Pipeline */}
                  <td className="hidden md:table-cell px-3 py-2.5 whitespace-nowrap text-xs text-fg-secondary">
                    {d.pipeline ?? "—"}
                  </td>

                  {/* Etapa */}
                  <td className="hidden md:table-cell px-3 py-2.5 whitespace-nowrap">
                    {d.stage ? (
                      <span className="badge badge-muted">
                        <span className="dot" />
                        {d.stage}
                      </span>
                    ) : (
                      <span className="text-xs text-fg-muted">—</span>
                    )}
                  </td>

                  {/* Valor bruto */}
                  <td className="hidden md:table-cell px-3 py-2.5 whitespace-nowrap text-right font-mono text-xs">
                    {fmt(d.amount)}
                  </td>

                  {/* Valor esperado */}
                  <td className="hidden md:table-cell px-3 py-2.5 whitespace-nowrap text-right font-mono text-xs text-fg-secondary">
                    {fmt(d._weightedForecast!)}
                  </td>

                  {/* Prob% */}
                  <td className="px-3 py-2.5 whitespace-nowrap text-right">
                    <span className={`text-xs font-semibold tabular-nums ${probColor(d.effective_probability)}`}>
                      {d.effective_probability}%
                    </span>
                  </td>

                  {/* Horizonte */}
                  <td className="hidden md:table-cell px-3 py-2.5 whitespace-nowrap text-xs text-fg-secondary">
                    {d.overlay_horizonte ?? "—"}
                  </td>

                  {/* Días sin actividad */}
                  <td className="hidden lg:table-cell px-3 py-2.5 whitespace-nowrap text-right">
                    <span
                      className={`text-xs font-semibold tabular-nums ${staleColor(d._staleDays!)}`}
                    >
                      {d._staleDays === Infinity ? "—" : `${d._staleDays}d`}
                    </span>
                  </td>

                  {/* Próxima acción */}
                  <td className="hidden lg:table-cell px-3 py-2.5 max-w-[180px]">
                    <span className="block truncate text-[11px] text-fg-secondary" title={d._suggestedAction}>
                      {d._suggestedAction}
                    </span>
                  </td>

                  {/* Responsable */}
                  <td className="hidden lg:table-cell px-3 py-2.5 whitespace-nowrap text-xs text-fg-secondary">
                    {d.owner_name ?? "—"}
                  </td>

                  {/* Fuente */}
                  <td className="hidden lg:table-cell px-3 py-2.5 whitespace-nowrap text-xs text-fg-secondary">
                    {d.deal_source ?? "—"}
                  </td>

                  {/* Estado */}
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {statusBadge(d.status)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Deal Detail Panel ── */}
      <DealDetailPanel deal={selectedDeal} onClose={() => setSelectedDeal(null)} />
    </section>
  );
}
