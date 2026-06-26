"use client";

import { useMemo, Suspense } from "react";
import { useTableroFilters } from "@/hooks/useTableroFilters";
import { ExecutiveSummary } from "./ExecutiveSummary";
import { TopOpportunities } from "./TopOpportunities";
import { FunnelAnalysis } from "./FunnelAnalysis";
import { SourcePerformance } from "./SourcePerformance";
import { StagnantOpportunities } from "./StagnantOpportunities";
import { DataQuality } from "./DataQuality";
import { PriorityMatrix } from "./PriorityMatrix";
import { BusinessUnitDonut } from "./BusinessUnitDonut";
import { StageBars } from "./StageBars";
import { ConcretionBars } from "./ConcretionBars";
import { ForecastTrend } from "./ForecastTrend";
import { CommercialAlerts } from "./CommercialAlerts";
import { ForecastBlocks } from "./ForecastBlocks";
import { AutoInsights } from "./AutoInsights";
import { ActionPlan } from "./ActionPlan";
import { OpportunitiesTable } from "./OpportunitiesTable";
import { SyncStatus } from "./SyncStatus";
import {
  calculateCommercialScore,
  normalizeScore,
  getSemaforoColor,
  stalenessDays,
  isOverdue,
  isLiveOpportunity,
  isExpiredOpportunity,
  isWonOpportunity,
  isLostOpportunity,
} from "@/lib/comercial/commercial-score";
import type { TableroData } from "@/lib/comercial/dashboard-data";
import type { EnrichedDeal } from "@/lib/comercial/dashboard-kpis";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  data: TableroData;
  initialParams?: Record<string, string | string[]>;
}

// ─── Deal filtering ───────────────────────────────────────────────────────────

function filterDeals(deals: EnrichedDeal[], filters: ReturnType<typeof useTableroFilters>["filters"]): EnrichedDeal[] {
  const today = new Date();

  // Pre-compute raw scores for semáforo normalization
  const rawScores = deals.map((d) => calculateCommercialScore(d, today));

  return deals.filter((d, idx) => {
    // ── pipeline ──
    if (filters.pipeline && d.pipeline !== filters.pipeline) return false;

    // ── stage ──
    if (filters.stage && d.stage !== filters.stage) return false;

    // ── source ──
    if (filters.source) {
      const src = d.deal_source ?? "Sin fuente";
      if (src !== filters.source) return false;
    }

    // ── score (semáforo) ──
    if (filters.score !== "all") {
      const normalizedScore = normalizeScore(rawScores, rawScores[idx]);
      const color = getSemaforoColor(normalizedScore);
      if (filters.score === "hot" && color !== "green") return false;
      if (filters.score === "warm" && color !== "yellow") return false;
      if (filters.score === "cold" && color !== "red") return false;
    }

    // ── status ──
    switch (filters.status) {
      case "active":
        if (!isLiveOpportunity(d)) return false;
        break;
      case "expired":
        if (!isExpiredOpportunity(d)) return false;
        break;
      case "won":
        if (!isWonOpportunity(d)) return false;
        break;
      case "lost":
        if (!isLostOpportunity(d)) return false;
        break;
      case "all":
        // No filter
        break;
    }

    // ── no_action: stale >= 21 days ──
    if (filters.no_action) {
      if (!isLiveOpportunity(d)) return false;
      if (stalenessDays(d, today) < 21) return false;
    }

    // ── stagnant: stale >= 14 days ──
    if (filters.stagnant) {
      if (!isLiveOpportunity(d)) return false;
      if (stalenessDays(d, today) < 14) return false;
    }

    // ── overdue ──
    if (filters.overdue) {
      if (!isLiveOpportunity(d)) return false;
      if (!isOverdue(d, today)) return false;
    }

    // ── closing_30: expected_close within 30 days ──
    if (filters.closing_30) {
      if (!isLiveOpportunity(d)) return false;
      if (!d.expected_close) return false;
      const daysTo = (new Date(d.expected_close + "T12:00:00").getTime() - today.getTime()) / 86_400_000;
      if (daysTo < 0 || daysTo > 30) return false;
    }

    return true;
  });
}

// ─── Inner shell (uses hook — must be inside Suspense) ───────────────────────

function TableroShellInner({ data }: { data: TableroData }) {
  const { filters } = useTableroFilters();

  // Filter deals for the table; other sections use unfiltered data
  const filteredDeals = useMemo(
    () => filterDeals(data.deals, filters),
    [data.deals, filters]
  );

  // Sort filtered deals per URL sort param
  const sortedDeals = useMemo(() => {
    const today = new Date();
    return [...filteredDeals].sort((a, b) => {
      switch (filters.sort) {
        case "amount":
          return b.amount - a.amount;
        case "forecast":
          return (b.amount * b.effective_probability) / 100 - (a.amount * a.effective_probability) / 100;
        case "probability":
          return b.effective_probability - a.effective_probability;
        case "modified": {
          const ta = a.modified_src ? new Date(a.modified_src).getTime() : 0;
          const tb = b.modified_src ? new Date(b.modified_src).getTime() : 0;
          return tb - ta;
        }
        case "days_stagnant":
          return stalenessDays(b, today) - stalenessDays(a, today);
        case "score":
        default:
          return calculateCommercialScore(b, today) - calculateCommercialScore(a, today);
      }
    });
  }, [filteredDeals, filters.sort]);

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 p-4 md:p-8 nx-page-fade">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-eyebrow-sm uppercase text-fg-muted">Comercial · CRM</div>
          <h1 className="text-2xl font-bold text-fg-primary">Cockpit comercial</h1>
        </div>
        <div className="text-xs text-fg-muted">
          Foto de Clientify · última sync{" "}
          {data.lastSync ? new Date(data.lastSync).toLocaleString("es-AR") : "—"}
        </div>
      </header>

      {/* 1 · Resumen ejecutivo */}
      <ExecutiveSummary
        kpis={data.kpis}
        deals={data.deals}
        deltas={data.deltas}
        lastSync={data.lastSync}
        syncStatus={data.syncStatus}
      />

      {/* 1b · Forecast por período */}
      <ForecastBlocks periods={data.forecastPeriods} />

      {/* 2 · Top oportunidades a cerrar */}
      <TopOpportunities deals={data.deals} />

      {/* 2b · Embudo comercial */}
      <FunnelAnalysis stages={data.funnelStages} />

      {/* 2c · Rendimiento por canal / fuente */}
      <SourcePerformance stats={data.sourceStats} />

      {/* 2d · Oportunidades estancadas */}
      <StagnantOpportunities deals={data.deals} />

      {/* 2e · Calidad de datos CRM */}
      <DataQuality quality={data.dataQuality} />

      {/* 3 · Matriz de prioridad */}
      <PriorityMatrix quadrants={data.quadrants} />

      {/* 4 · Distribución */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BusinessUnitDonut units={data.units} />
        <StageBars stages={data.stages} />
      </section>

      {/* 5 · Convertibilidad + tendencia */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ConcretionBars bands={data.kpis.bands} />
        <ForecastTrend series={data.trendSeries} deltas={data.deltas} />
      </section>

      {/* 6 · Inteligencia comercial */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CommercialAlerts groups={data.alertGroups} />
        <AutoInsights insights={data.insights} />
        <ActionPlan actions={data.actions} />
      </section>

      {/* 7 · Detalle operativo — URL-filtered */}
      <OpportunitiesTable deals={sortedDeals} allDeals={data.deals} />

      {/* 8 · Transparencia de datos */}
      <SyncStatus
        syncStatus={data.syncStatus}
        lastSync={data.lastSync}
        kpis={data.kpis}
      />
    </div>
  );
}

// ─── Public export (wraps inner shell in Suspense for useSearchParams) ────────

export function TableroShell({ data, initialParams: _initialParams }: Props) {
  if (!data.configured) {
    return (
      <div className="space-y-6 p-4 md:p-8 nx-page-fade">
        <header>
          <div className="text-eyebrow-sm uppercase text-fg-muted">Comercial · CRM</div>
          <h1 className="text-2xl font-bold text-fg-primary">Cockpit comercial</h1>
        </header>
        <div className="card card-pad border-status-warning/40 text-sm text-fg-secondary">
          Clientify no está configurado (<code>CLIENTIFY_API_KEY</code>). El cockpit se activa
          cuando la integración esté seteada y el cron de las 21:00 haya corrido al menos una vez.
        </div>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1500px] p-4 md:p-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-64 rounded-lg bg-bg-surface-alt" />
            <div className="h-48 rounded-xl bg-bg-surface-alt" />
            <div className="h-96 rounded-xl bg-bg-surface-alt" />
          </div>
        </div>
      }
    >
      <TableroShellInner data={data} />
    </Suspense>
  );
}
