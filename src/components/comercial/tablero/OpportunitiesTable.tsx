"use client";

import { useMemo, useState, useTransition } from "react";
import { upsertDealOverlay } from "@/lib/comercial/overlay-actions";
import {
  calculateCommercialScore,
  calculateWeightedForecast,
  getSuggestedAction,
  getOpportunityAlert,
  getOpportunityPriority,
  hasSuspiciousAmount,
  isLiveOpportunity,
  isExpiredOpportunity,
  stalenessDays,
} from "@/lib/comercial/commercial-score";
import type { EnrichedDeal } from "@/lib/comercial/dashboard-kpis";

// ─── Constantes ──────────────────────────────────────────────────────────────

const HORIZONTES = [
  "Esta semana",
  "15 días",
  "30 días",
  "60 días",
  "90 días",
  "+90 días",
  "A definir",
] as const;

// ─── Helpers de formato ───────────────────────────────────────────────────────

const fmt = (n: number) => {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 1_000_000) {
    return "$ " + (v / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M";
  }
  return "$ " + v.toLocaleString("es-AR");
};

const probColor = (p: number) =>
  p >= 50
    ? "text-status-success"
    : p <= 20
    ? "text-status-danger"
    : "text-fg-secondary";

// ─── Tipos internos ───────────────────────────────────────────────────────────

type SortKey = "score" | "amount" | "forecast" | "probability" | "horizonte" | "modified";

const HORIZON_ORDER: Record<string, number> = {
  "Esta semana": 0,
  "15 días": 1,
  "30 días": 2,
  "60 días": 3,
  "90 días": 4,
  "+90 días": 5,
  "A definir": 6,
};

// ─── Componente principal ────────────────────────────────────────────────────

export function OpportunitiesTable({ deals }: { deals: EnrichedDeal[] }) {
  const today = useMemo(() => new Date(), []);

  // --- Controles de filtro ---
  const [search, setSearch] = useState("");
  const [filterPipeline, setFilterPipeline] = useState("Todas");
  const [filterStage, setFilterStage] = useState("Todas");
  const [filterStatus, setFilterStatus] = useState<"Activas" | "Vencidas" | "Todas">("Todas");
  const [onlyHighPriority, setOnlyHighPriority] = useState(false);
  const [onlyClosingSoon, setOnlyClosingSoon] = useState(false);
  const [onlySuspicious, setOnlySuspicious] = useState(false);
  const [onlyNoAction, setOnlyNoAction] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("score");

  // --- Opciones únicas de filtros derivadas de los deals ---
  const pipelines = useMemo(() => {
    const set = new Set<string>();
    for (const d of deals) if (d.pipeline) set.add(d.pipeline);
    return Array.from(set).sort();
  }, [deals]);

  const stages = useMemo(() => {
    const set = new Set<string>();
    for (const d of deals) if (d.stage) set.add(d.stage);
    return Array.from(set).sort();
  }, [deals]);

  // Mediana de importes de oportunidades vivas (para split de alta_prioridad)
  const amountSplit = useMemo(() => {
    const live = deals.filter(isLiveOpportunity).map((d) => d.amount).sort((a, b) => a - b);
    if (!live.length) return 0;
    const mid = Math.floor(live.length / 2);
    return live.length % 2 === 0 ? (live[mid - 1] + live[mid]) / 2 : live[mid];
  }, [deals]);

  // --- Filas filtradas y ordenadas ---
  const rows = useMemo(() => {
    let filtered = deals.filter((d) => {
      // Búsqueda por título (cliente)
      if (search && !d.title.toLowerCase().includes(search.toLowerCase())) return false;
      // Unidad (pipeline)
      if (filterPipeline !== "Todas" && d.pipeline !== filterPipeline) return false;
      // Etapa
      if (filterStage !== "Todas" && d.stage !== filterStage) return false;
      // Estado
      if (filterStatus === "Activas" && !isLiveOpportunity(d)) return false;
      if (filterStatus === "Vencidas" && !isExpiredOpportunity(d)) return false;
      // Toggle: alta prioridad
      if (onlyHighPriority && getOpportunityPriority(d, amountSplit) !== "alta_prioridad") return false;
      // Toggle: próximas a cerrar (≤30 días)
      if (onlyClosingSoon) {
        if (!d.expected_close) return false;
        const daysToClose = Math.ceil(
          (new Date(d.expected_close + "T12:00:00").getTime() - today.getTime()) / 86_400_000
        );
        if (daysToClose < 0 || daysToClose > 30) return false;
      }
      // Toggle: importe sospechoso
      if (onlySuspicious && !hasSuspiciousAmount(d)) return false;
      // Toggle: sin próxima acción (viva + ≥21 días estancada)
      if (onlyNoAction && !(isLiveOpportunity(d) && stalenessDays(d, today) >= 21)) return false;
      return true;
    });

    // Ordenamiento
    filtered = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "score":
          return calculateCommercialScore(b, today) - calculateCommercialScore(a, today);
        case "amount":
          return b.amount - a.amount;
        case "forecast":
          return calculateWeightedForecast(b) - calculateWeightedForecast(a);
        case "probability":
          return b.effective_probability - a.effective_probability;
        case "horizonte": {
          const ha = HORIZON_ORDER[a.overlay_horizonte ?? "A definir"] ?? 6;
          const hb = HORIZON_ORDER[b.overlay_horizonte ?? "A definir"] ?? 6;
          return ha - hb;
        }
        case "modified": {
          const ta = a.modified_src ? new Date(a.modified_src).getTime() : 0;
          const tb = b.modified_src ? new Date(b.modified_src).getTime() : 0;
          return tb - ta;
        }
      }
    });

    return filtered;
  }, [
    deals,
    search,
    filterPipeline,
    filterStage,
    filterStatus,
    onlyHighPriority,
    onlyClosingSoon,
    onlySuspicious,
    onlyNoAction,
    sortBy,
    amountSplit,
    today,
  ]);

  return (
    <div className="flex flex-col gap-3 md:gap-4">
      {/* ── Barra de controles ── */}
      <div className="card card-pad flex flex-col gap-3">
        {/* Fila 1: buscador + selects */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente…"
            className="rounded-lg border border-stroke-soft bg-bg-surface px-3 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-tops-blue-700/40 w-48"
          />
          <select
            value={filterPipeline}
            onChange={(e) => setFilterPipeline(e.target.value)}
            className="rounded-lg border border-stroke-soft bg-bg-surface px-2 py-1.5 text-sm text-fg-primary focus:outline-none"
          >
            <option>Todas</option>
            {pipelines.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select
            value={filterStage}
            onChange={(e) => setFilterStage(e.target.value)}
            className="rounded-lg border border-stroke-soft bg-bg-surface px-2 py-1.5 text-sm text-fg-primary focus:outline-none"
          >
            <option>Todas</option>
            {stages.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as "Activas" | "Vencidas" | "Todas")}
            className="rounded-lg border border-stroke-soft bg-bg-surface px-2 py-1.5 text-sm text-fg-primary focus:outline-none"
          >
            <option>Todas</option>
            <option>Activas</option>
            <option>Vencidas</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="rounded-lg border border-stroke-soft bg-bg-surface px-2 py-1.5 text-sm text-fg-primary focus:outline-none ml-auto"
          >
            <option value="score">Ordenar: Score comercial</option>
            <option value="amount">Ordenar: Importe</option>
            <option value="forecast">Ordenar: Forecast ponderado</option>
            <option value="probability">Ordenar: Probabilidad</option>
            <option value="horizonte">Ordenar: Horizonte</option>
            <option value="modified">Ordenar: Última actualización</option>
          </select>
        </div>
        {/* Fila 2: toggles + contador */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-1.5 cursor-pointer text-sm text-fg-secondary select-none">
            <input
              type="checkbox"
              checked={onlyHighPriority}
              onChange={(e) => setOnlyHighPriority(e.target.checked)}
              className="rounded accent-tops-blue-700"
            />
            Alta prioridad
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-sm text-fg-secondary select-none">
            <input
              type="checkbox"
              checked={onlyClosingSoon}
              onChange={(e) => setOnlyClosingSoon(e.target.checked)}
              className="rounded accent-tops-blue-700"
            />
            Próximas a cerrar
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-sm text-fg-secondary select-none">
            <input
              type="checkbox"
              checked={onlySuspicious}
              onChange={(e) => setOnlySuspicious(e.target.checked)}
              className="rounded accent-tops-blue-700"
            />
            Importe sospechoso
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer text-sm text-fg-secondary select-none">
            <input
              type="checkbox"
              checked={onlyNoAction}
              onChange={(e) => setOnlyNoAction(e.target.checked)}
              className="rounded accent-tops-blue-700"
            />
            Sin próxima acción
          </label>
          <span className="ml-auto text-xs text-fg-muted font-medium tabular-nums">
            {rows.length} de {deals.length} oportunidades
          </span>
        </div>
      </div>

      {/* ── Tabla ── */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stroke-soft bg-bg-surface-alt">
                {[
                  "Cliente",
                  "Etapa",
                  "Importe",
                  "Prob.",
                  "Forecast",
                  "Score",
                  "Horizonte ★",
                  "Próx. acción",
                  "Alerta",
                  "Observaciones ★",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-fg-muted whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stroke-soft">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-sm text-fg-muted">
                    No hay oportunidades que coincidan con los filtros aplicados.
                  </td>
                </tr>
              ) : (
                rows.map((d, i) => (
                  <OpportunityRow key={d.deal_id} d={d} today={today} index={i} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Fila editable ───────────────────────────────────────────────────────────

function OpportunityRow({
  d,
  today,
  index,
}: {
  d: EnrichedDeal;
  today: Date;
  index: number;
}) {
  const [hor, setHor] = useState(d.overlay_horizonte ?? "A definir");
  const [obs, setObs] = useState(d.overlay_observaciones ?? "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  type Patch = Omit<Parameters<typeof upsertDealOverlay>[0], "dealId">;

  const save = (patch: Patch) =>
    start(async () => {
      const res = await upsertDealOverlay({ dealId: d.deal_id, ...patch });
      if (!res.ok) {
        // Revertir al valor del servidor si el guardado falla
        setHor(d.overlay_horizonte ?? "A definir");
        setObs(d.overlay_observaciones ?? "");
        setErr(res.error ?? "No se pudo guardar");
      } else {
        setErr(null);
      }
    });

  const score = calculateCommercialScore(d, today);
  const forecast = calculateWeightedForecast(d);
  const action = getSuggestedAction(d, today);
  const alert = getOpportunityAlert(d, today);
  const suspicious = hasSuspiciousAmount(d);

  return (
    <tr
      className="hover:bg-bg-surface-alt transition-colors nx-stagger"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* Cliente */}
      <td className="px-4 py-3 min-w-[160px]">
        <a
          href={d.href}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-fg-primary hover:text-fg-link hover:underline"
        >
          {d.title}
        </a>
        {(d.company_name || d.contact_name) && (
          <div className="text-[11px] text-fg-muted mt-0.5">
            {d.company_name ?? d.contact_name}
          </div>
        )}
        {d.pipeline && (
          <div className="text-[10px] text-fg-muted">{d.pipeline}</div>
        )}
        {err && (
          <div className="mt-1 text-[10px] text-status-danger" title={err}>
            ⚠ {err}
          </div>
        )}
      </td>

      {/* Etapa */}
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="badge badge-muted">
          <span className="dot" />
          {d.stage ?? "—"}
        </span>
      </td>

      {/* Importe */}
      <td className="px-4 py-3 whitespace-nowrap text-right font-mono">
        <span>{fmt(d.amount)}</span>
        {suspicious && (
          <span className="badge badge-danger ml-1 text-[10px]">
            <span className="dot" />
            $1?
          </span>
        )}
      </td>

      {/* Probabilidad (solo lectura, viene de Clientify) */}
      <td className="px-4 py-3 whitespace-nowrap">
        <span className={`font-mono text-sm font-semibold ${probColor(d.effective_probability)}`}>
          {d.effective_probability}%
        </span>
        <span className="ml-1 text-[10px] text-fg-muted">Clientify</span>
      </td>

      {/* Forecast ponderado */}
      <td className="px-4 py-3 whitespace-nowrap text-right font-mono text-fg-secondary">
        {fmt(forecast)}
      </td>

      {/* Score comercial */}
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="font-mono text-sm font-semibold text-fg-brand">
          {score.toLocaleString("es-AR")}
        </span>
      </td>

      {/* Horizonte (editable) */}
      <td className="px-4 py-3 whitespace-nowrap">
        <select
          value={hor}
          onChange={(e) => {
            setHor(e.target.value);
            save({ horizonte: e.target.value });
          }}
          disabled={pending}
          className="rounded-lg border border-stroke-soft bg-bg-surface px-2 py-1 text-xs text-fg-primary focus:outline-none disabled:opacity-60"
        >
          {HORIZONTES.map((h) => (
            <option key={h}>{h}</option>
          ))}
        </select>
      </td>

      {/* Próxima acción sugerida */}
      <td className="px-4 py-3 min-w-[160px]">
        <span className="text-xs text-fg-secondary">{action}</span>
      </td>

      {/* Alerta */}
      <td className="px-4 py-3 whitespace-nowrap">
        {alert ? (
          <AlertBadge severity={alert.severity} label={alert.label} />
        ) : (
          <span className="text-xs text-fg-muted">—</span>
        )}
      </td>

      {/* Observaciones (editable, guarda onBlur) */}
      <td className="px-4 py-3 min-w-[200px]">
        <input
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          onBlur={() => save({ observaciones: obs })}
          placeholder="Notas…"
          disabled={pending}
          className="w-full rounded-lg border border-stroke-soft bg-bg-surface px-2 py-1 text-xs text-fg-primary placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-tops-blue-700/40 disabled:opacity-60"
        />
      </td>
    </tr>
  );
}

// ─── Badge de alerta ──────────────────────────────────────────────────────────

function AlertBadge({
  severity,
  label,
}: {
  severity: "critica" | "atencion" | "informativa";
  label: string;
}) {
  const cls =
    severity === "critica"
      ? "badge-danger"
      : severity === "atencion"
      ? "badge-warning"
      : "badge-info";
  return (
    <span className={`badge ${cls}`} title={label}>
      <span className="dot" />
      {label}
    </span>
  );
}
