"use client";

import { type TableroFilters, type SortKey, DEFAULT_FILTERS } from "@/hooks/useTableroFilters";

// ─── Score label helpers ──────────────────────────────────────────────────────

const SCORE_LABELS: Record<Exclude<TableroFilters["score"], "all">, string> = {
  hot: "Caliente",
  warm: "Tibio",
  cold: "Frío",
};

const STATUS_LABELS: Record<TableroFilters["status"], string> = {
  active: "Activas",
  expired: "Vencidas",
  won: "Ganadas",
  lost: "Perdidas",
  all: "Todas",
};

const SORT_LABELS: Record<SortKey, string> = {
  score: "Score",
  amount: "Importe",
  forecast: "Forecast",
  probability: "Probabilidad",
  modified: "Última mod.",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChipDef {
  key: keyof TableroFilters;
  label: string;
  /** The default/empty value — clearing sets this */
  defaultValue: TableroFilters[keyof TableroFilters];
}

interface Props {
  filters: TableroFilters;
  setFilter: <K extends keyof TableroFilters>(key: K, value: TableroFilters[K]) => void;
  clearAll: () => void;
  activeCount: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ActiveFilterChips({ filters, setFilter, clearAll, activeCount }: Props) {
  if (activeCount === 0) return null;

  const chips: Array<{ label: string; onClear: () => void }> = [];

  if (filters.pipeline) {
    chips.push({
      label: `Pipeline: ${filters.pipeline}`,
      onClear: () => setFilter("pipeline", DEFAULT_FILTERS.pipeline),
    });
  }

  if (filters.stage) {
    chips.push({
      label: `Etapa: ${filters.stage}`,
      onClear: () => setFilter("stage", DEFAULT_FILTERS.stage),
    });
  }

  if (filters.source) {
    chips.push({
      label: `Fuente: ${filters.source}`,
      onClear: () => setFilter("source", DEFAULT_FILTERS.source),
    });
  }

  if (filters.score !== "all") {
    chips.push({
      label: `Score: ${SCORE_LABELS[filters.score]}`,
      onClear: () => setFilter("score", DEFAULT_FILTERS.score),
    });
  }

  if (filters.status !== "active") {
    chips.push({
      label: `Estado: ${STATUS_LABELS[filters.status]}`,
      onClear: () => setFilter("status", DEFAULT_FILTERS.status),
    });
  }

  if (filters.no_action) {
    chips.push({
      label: "Sin acción",
      onClear: () => setFilter("no_action", false),
    });
  }

  if (filters.stagnant) {
    chips.push({
      label: "Estancadas",
      onClear: () => setFilter("stagnant", false),
    });
  }

  if (filters.overdue) {
    chips.push({
      label: "Vencidas",
      onClear: () => setFilter("overdue", false),
    });
  }

  if (filters.closing_30) {
    chips.push({
      label: "Cierre en 30 días",
      onClear: () => setFilter("closing_30", false),
    });
  }

  if (filters.sort !== "score") {
    chips.push({
      label: `Orden: ${SORT_LABELS[filters.sort]}`,
      onClear: () => setFilter("sort", DEFAULT_FILTERS.sort),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <span
          key={chip.label}
          className="inline-flex items-center gap-1 rounded-full bg-tops-blue-700/10 px-2.5 py-1 text-xs font-medium text-tops-blue-700 ring-1 ring-tops-blue-700/20"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.onClear}
            aria-label={`Quitar filtro: ${chip.label}`}
            className="ml-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-tops-blue-700/60 hover:bg-tops-blue-700/20 hover:text-tops-blue-700 transition-colors"
          >
            ×
          </button>
        </span>
      ))}

      <button
        type="button"
        onClick={clearAll}
        className="ml-1 text-xs text-fg-muted underline underline-offset-2 hover:text-fg-secondary transition-colors"
      >
        Limpiar filtros
      </button>
    </div>
  );
}
