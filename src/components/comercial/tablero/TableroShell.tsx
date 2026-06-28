"use client";

import { useMemo, Suspense, useState } from "react";
import { useTableroFilters } from "@/hooks/useTableroFilters";
import { ExecutiveNarrative } from "./ExecutiveNarrative";
import { PipelineStatus } from "./PipelineStatus";
import { WonVsLost } from "./WonVsLost";
import { ExecutiveActions } from "./ExecutiveActions";
import { LossAnalysis } from "./LossAnalysis";
import { DataQuality } from "./DataQuality";
import { OpportunitiesTable } from "./OpportunitiesTable";
import { SyncDiagnostics } from "./SyncDiagnostics";
// Secondary (moved behind collapsible)
import { VistaDireccion } from "./VistaDireccion";
import { FunnelAnalysis } from "./FunnelAnalysis";
import { SourcePerformance } from "./SourcePerformance";
import { StagnantOpportunities } from "./StagnantOpportunities";
import { PriorityMatrix } from "./PriorityMatrix";
import { BusinessUnitDonut } from "./BusinessUnitDonut";
import { StageBars } from "./StageBars";
import { ConcretionBars } from "./ConcretionBars";
import { ForecastTrend } from "./ForecastTrend";
import { AutoInsights } from "./AutoInsights";
import { ActionPlan } from "./ActionPlan";
import { ForecastBlocks } from "./ForecastBlocks";
import { TopOpportunities } from "./TopOpportunities";
import { SyncStatus } from "./SyncStatus";
import { CountUp } from "@/components/CountUp";
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

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  Math.abs(n) >= 1_000_000
    ? "$ " + (n / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M"
    : "$ " + Math.round(n || 0).toLocaleString("es-AR");

// ─── Deal filtering ───────────────────────────────────────────────────────────

function filterDeals(deals: EnrichedDeal[], filters: ReturnType<typeof useTableroFilters>["filters"]): EnrichedDeal[] {
  const today = new Date();
  const rawScores = deals.map((d) => calculateCommercialScore(d, today));

  return deals.filter((d, idx) => {
    if (filters.pipeline && d.pipeline !== filters.pipeline) return false;
    if (filters.stage && d.stage !== filters.stage) return false;
    if (filters.source) {
      const src = d.deal_source ?? "Sin fuente";
      if (src !== filters.source) return false;
    }
    if (filters.score !== "all") {
      const normalizedScore = normalizeScore(rawScores, rawScores[idx]);
      const color = getSemaforoColor(normalizedScore);
      if (filters.score === "hot" && color !== "green") return false;
      if (filters.score === "warm" && color !== "yellow") return false;
      if (filters.score === "cold" && color !== "red") return false;
    }
    switch (filters.status) {
      case "active":    if (!isLiveOpportunity(d)) return false; break;
      case "expired":   if (!isExpiredOpportunity(d)) return false; break;
      case "won":       if (!isWonOpportunity(d)) return false; break;
      case "lost":      if (!isLostOpportunity(d)) return false; break;
    }
    if (filters.no_action) {
      if (!isLiveOpportunity(d)) return false;
      if (stalenessDays(d, today) < 21) return false;
    }
    if (filters.stagnant) {
      if (!isLiveOpportunity(d)) return false;
      if (stalenessDays(d, today) < 14) return false;
    }
    if (filters.overdue) {
      if (!isLiveOpportunity(d)) return false;
      if (!isOverdue(d, today)) return false;
    }
    if (filters.closing_30) {
      if (!isLiveOpportunity(d)) return false;
      if (!d.expected_close) return false;
      const daysTo = (new Date(d.expected_close + "T12:00:00").getTime() - today.getTime()) / 86_400_000;
      if (daysTo < 0 || daysTo > 30) return false;
    }
    return true;
  });
}

// ─── KPI card ejecutiva con deep link y hover animation ──────────────────────

interface ExecKpiProps {
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: "default" | "success" | "danger" | "info";
  href?: string;
}

function ExecKpi({ label, value, sub, accent = "default", href }: ExecKpiProps) {
  const valueColor =
    accent === "success" ? "text-status-success" :
    accent === "danger"  ? "text-status-danger"  :
    accent === "info"    ? "text-status-info"     :
    "text-fg-primary";

  const inner = (
    <>
      <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      <div className={`text-2xl font-bold tabular-nums ${valueColor} transition-transform duration-200 group-hover:scale-[1.03] origin-left`}>{value}</div>
      {sub && <span className="text-xs text-fg-muted">{sub}</span>}
      {href && (
        <span className="text-[10px] text-fg-brand opacity-0 group-hover:opacity-100 transition-opacity mt-auto pt-1">
          Ver detalle →
        </span>
      )}
    </>
  );

  const cls = `card card-pad flex flex-col gap-1.5 group transition-all duration-200 ${
    href ? "cursor-pointer hover:border-fg-brand/30 hover:shadow-md hover:-translate-y-0.5" : ""
  }`;

  if (href) {
    return <a href={href} className={cls}>{inner}</a>;
  }
  return <div className={cls}>{inner}</div>;
}

// ─── Collapsible secondary panel ─────────────────────────────────────────────

function SecondaryPanel({ children, label, defaultOpen = false }: { children: React.ReactNode; label: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-stroke-soft rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-3 bg-bg-surface text-left hover:bg-fg-primary/5 transition-colors"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14" height="14"
          viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 250ms ease",
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {/* CSS grid expansion — suave y sin salto de layout */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows 280ms ease",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <div className="border-t border-stroke-soft p-4 space-y-6 bg-bg-surface/50">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Inner shell ─────────────────────────────────────────────────────────────

function TableroShellInner({ data }: { data: TableroData }) {
  const { filters } = useTableroFilters();

  const filteredDeals = useMemo(
    () => filterDeals(data.deals, filters),
    [data.deals, filters]
  );

  const sortedDeals = useMemo(() => {
    const today = new Date();
    return [...filteredDeals].sort((a, b) => {
      switch (filters.sort) {
        case "amount":      return b.amount - a.amount;
        case "forecast":    return (b.amount * b.effective_probability) / 100 - (a.amount * a.effective_probability) / 100;
        case "probability": return b.effective_probability - a.effective_probability;
        case "modified": {
          const ta = a.modified_src ? new Date(a.modified_src).getTime() : 0;
          const tb = b.modified_src ? new Date(b.modified_src).getTime() : 0;
          return tb - ta;
        }
        case "days_stagnant": return stalenessDays(b, new Date()) - stalenessDays(a, new Date());
        case "score":
        default: return calculateCommercialScore(b, today) - calculateCommercialScore(a, today);
      }
    });
  }, [filteredDeals, filters.sort]);

  const dataQualityPct = Math.round(data.kpis.dataQuality.score);

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 md:p-8 nx-page-fade">

      {/* ── 1 · Header ejecutivo ── */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-eyebrow-sm uppercase text-fg-muted">Comercial · CRM</div>
          <h1 className="text-2xl font-bold text-fg-primary">Centro de Comando Comercial</h1>
        </div>
        <div className="text-xs text-fg-muted text-right">
          <div>Datos de Clientify</div>
          <div>
            Última sync{" "}
            {data.lastSync ? new Date(data.lastSync).toLocaleString("es-AR") : "—"}
          </div>
        </div>
      </header>

      {/* ── KPIs Ejecutivos (arriba de todo) ── */}
      <section>
        <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted mb-3">
          KPIs ejecutivos
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-5 gap-3">
          <ExecKpi
            label="Pipeline activo"
            value={<CountUp to={data.kpis.activePipeline} format="currency" />}
            sub={`${data.kpis.liveCount} oportunidades`}
            href="/comercial/pipeline"
          />
          <ExecKpi
            label="Forecast ponderado"
            value={<CountUp to={data.kpis.forecast} format="currency" />}
            sub={`${data.kpis.weightedConcretion.toFixed(1)}% concreción`}
            accent={data.kpis.weightedConcretion >= 60 ? "success" : data.kpis.weightedConcretion >= 40 ? "info" : "danger"}
            href="/comercial/pipeline"
          />
          <ExecKpi
            label="Ganado"
            value={<CountUp to={data.kpis.wonAmount} format="currency" />}
            sub={`${data.kpis.wonCount} deals`}
            accent="success"
            href="/comercial/oportunidades?status=won"
          />
          <ExecKpi
            label="Perdido"
            value={<CountUp to={data.kpis.lostAmount} format="currency" />}
            sub={`${data.kpis.lostCount} deals`}
            accent="danger"
            href="/comercial/oportunidades?status=lost"
          />
          <ExecKpi
            label="Calidad CRM"
            value={<span>{dataQualityPct}%</span>}
            sub={data.dataQuality.scoreLabel}
            accent={dataQualityPct >= 80 ? "success" : dataQualityPct >= 50 ? "info" : "danger"}
            href="#data-quality-block"
          />
        </div>
      </section>

      {/* ── Estado del Pipeline (arriba de todo, junto a KPIs) ── */}
      <PipelineStatus kpis={data.kpis} />

      {/* ── Análisis extendido (abierto por defecto) ── */}
      <SecondaryPanel label="Análisis extendido — embudo, fuentes, distribución" defaultOpen>
        <VistaDireccion
          kpis={data.kpis}
          deals={data.deals}
          forecastPeriods={data.forecastPeriods}
          actions={data.actions}
          dataQuality={data.dataQuality}
        />
        <ForecastBlocks periods={data.forecastPeriods} />
        <TopOpportunities deals={data.deals} />
        <FunnelAnalysis stages={data.funnelStages} />
        <PriorityMatrix quadrants={data.quadrants} />
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BusinessUnitDonut units={data.units} />
          <StageBars stages={data.stages} />
        </section>
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ConcretionBars bands={data.kpis.bands} />
          <ForecastTrend series={data.trendSeries} deltas={data.deltas} />
        </section>
        <SourcePerformance stats={data.sourceStats} />
        <StagnantOpportunities deals={data.deals} />
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <AutoInsights insights={data.insights} />
          <ActionPlan actions={data.actions} />
        </section>
      </SecondaryPanel>

      {/* ── 2 · Resumen Ejecutivo (narrativa auto-generada) ── */}
      <ExecutiveNarrative
        kpis={data.kpis}
        deals={data.deals}
      />

      {/* ── 5 · Ganado vs Perdido ── */}
      <WonVsLost kpis={data.kpis} deals={data.deals} />

      {/* ── 6 · Motivos de pérdida ── */}
      <LossAnalysis deals={data.deals} kpis={data.kpis} />

      {/* ── 7 · Acciones recomendadas (qué decidir hoy) ── */}
      <ExecutiveActions kpis={data.kpis} deals={data.deals} />

      {/* ── 8 · Calidad del CRM (colapsado por defecto) ── */}
      <SecondaryPanel
        label={`Oportunidades con datos incompletos (${data.dataQuality.incomplete.length})`}
      >
        <DataQuality quality={data.dataQuality} />
      </SecondaryPanel>

      {/* ── Detalle operativo (colapsado por defecto) ── */}
      <SecondaryPanel label="Ver oportunidades — tabla detallada">
        <OpportunitiesTable deals={sortedDeals} allDeals={data.deals} />
      </SecondaryPanel>

      {/* ── Panel técnico / admin (colapsado por defecto) ── */}
      <SecondaryPanel label="Panel técnico — sincronización y diagnóstico">
        <SyncStatus
          syncStatus={data.syncStatus}
          lastSync={data.lastSync}
          kpis={data.kpis}
        />
        <SyncDiagnostics
          syncStatus={data.syncStatus}
          syncHistory={data.syncHistory}
        />
      </SecondaryPanel>

    </div>
  );
}

// ─── Public export ────────────────────────────────────────────────────────────

export function TableroShell({ data, initialParams: _initialParams }: Props) {
  if (!data.configured) {
    return (
      <div className="space-y-6 p-4 md:p-8 nx-page-fade">
        <header>
          <div className="text-eyebrow-sm uppercase text-fg-muted">Comercial · CRM</div>
          <h1 className="text-2xl font-bold text-fg-primary">Centro de Comando Comercial</h1>
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
        <div className="mx-auto max-w-[1500px] space-y-5 p-4 md:p-8">
          <div className="animate-pulse space-y-5">
            <div className="h-8 w-64 rounded-lg bg-bg-surface-alt" />
            <div className="h-24 rounded-xl bg-bg-surface-alt" />
            <div className="h-32 rounded-xl bg-bg-surface-alt" />
          </div>
        </div>
      }
    >
      <TableroShellInner data={data} />
    </Suspense>
  );
}
