"use client";

import { useMemo } from "react";
import { useTableroFilters, scrollToSection } from "@/hooks/useTableroFilters";
import { Icon } from "@/components/Icon";
import { CountUp } from "@/components/CountUp";
import type { Kpis, EnrichedDeal } from "@/lib/comercial/dashboard-kpis";
import type { Deltas } from "@/lib/comercial/dashboard-data";
import { calculateCommercialScore, normalizeScore, getSemaforoColor } from "@/lib/comercial/commercial-score";

// ─── Formatting ───────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  Math.abs(n) >= 1_000_000
    ? "$ " + (n / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + "M"
    : "$ " + Math.round(n || 0).toLocaleString("es-AR");

// ─── Delta chip ───────────────────────────────────────────────────────────────

function DeltaChip({ value }: { value: number }) {
  if (value === 0) return null;
  const positive = value > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${
        positive ? "text-status-success" : "text-status-danger"
      }`}
    >
      {positive ? "▲" : "▼"} {fmt(Math.abs(value))}
    </span>
  );
}

// ─── Single KPI card ─────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  subtitle?: string;
  value: React.ReactNode;
  valueClass?: string;
  delta?: number;
  onClick?: () => void;
  tooltip?: string;
  animDelay?: number;
}

function KpiCard({
  label,
  subtitle,
  value,
  valueClass = "text-fg-primary",
  delta,
  onClick,
  tooltip,
  animDelay = 0,
}: KpiCardProps) {
  const clickable = Boolean(onClick);

  const handleKey = (e: React.KeyboardEvent) => {
    if (onClick && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className={`card card-pad flex flex-col gap-2 nx-lift ${
        clickable
          ? "cursor-pointer hover:border-fg-brand/40 transition-colors focus-visible:ring-2 focus-visible:ring-fg-brand/60 outline-none"
          : ""
      }`}
      style={{ animationDelay: `${animDelay}ms` }}
      onClick={onClick}
      onKeyDown={handleKey}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={tooltip}
    >
      <span className="kpi-label">{label}</span>

      <div className={`kpi-value ${valueClass}`}>{value}</div>

      {delta !== undefined && delta !== 0 && (
        <div className="mt-0.5">
          <DeltaChip value={delta} />
        </div>
      )}

      {subtitle && (
        <p className="text-fg-muted text-xs leading-snug">{subtitle}</p>
      )}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ExecutiveSummaryProps {
  kpis: Kpis;
  deals: EnrichedDeal[];
  deltas?: Deltas | null;
  lastSync?: string | null;
  syncStatus?: { status: string; errors: number } | null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ExecutiveSummary({ kpis, deals, deltas }: ExecutiveSummaryProps) {
  const { applyFilter } = useTableroFilters();

  // Count "hot" deals: normalizeScore >= 65 means getSemaforoColor === 'green'
  const hotCount = useMemo(() => {
    const today = new Date();
    const rawScores = deals.map((d) => calculateCommercialScore(d, today));
    return deals.filter((_, idx) => {
      const norm = normalizeScore(rawScores, rawScores[idx]);
      return getSemaforoColor(norm) === "green";
    }).length;
  }, [deals]);

  // Data quality %
  const dataQualityPct = useMemo(() => {
    if (!kpis.dataQuality || kpis.dataQuality.total === 0) return 0;
    const fields = kpis.dataQuality.completeness;
    if (!fields.length) return 0;
    return Math.round(fields.reduce((a, f) => a + f.pct, 0) / fields.length);
  }, [kpis.dataQuality]);

  // Ticket promedio
  const ticketAvg = kpis.liveCount > 0 ? kpis.activePipeline / kpis.liveCount : 0;

  // Navigation helpers
  const goToOpps = (partial: Partial<Parameters<typeof applyFilter>[0]>) => {
    applyFilter(partial);
    scrollToSection("opportunities-table");
  };

  return (
    <section className="flex flex-col gap-3 md:gap-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
        Resumen ejecutivo comercial
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 nx-stagger">

        {/* ── Row 1: Pipeline Health ── */}
        <KpiCard
          label="Pipeline activo"
          subtitle="valor bruto de oportunidades vivas"
          value={<CountUp to={kpis.activePipeline} format="currency" />}
          delta={deltas?.active}
          animDelay={0}
          tooltip="Suma de importes de todas las oportunidades vivas en Clientify"
        />

        <KpiCard
          label="Forecast ponderado"
          subtitle="valor esperado (monto × probabilidad)"
          value={<CountUp to={kpis.forecast} format="currency" />}
          valueClass="text-status-success"
          delta={deltas?.forecast}
          animDelay={40}
          tooltip="Σ (importe × probabilidad de cierre) de todas las oportunidades vivas"
        />

        <KpiCard
          label="Concreción esperada"
          subtitle="% de probabilidad de cierre ponderado por monto"
          value={
            <span>
              {kpis.weightedConcretion.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%
            </span>
          }
          valueClass="text-status-info"
          animDelay={80}
          tooltip="Forecast ÷ Pipeline activo — refleja la probabilidad media ponderada por importe"
        />

        {/* ── Row 2: Opportunities ── */}
        <KpiCard
          label="Oportunidades vivas"
          subtitle={`${kpis.liveCount} en cartera activa`}
          value={<CountUp to={kpis.liveCount} format="int" />}
          valueClass="text-fg-brand"
          onClick={() => goToOpps({ status: "active" })}
          animDelay={120}
          tooltip="Haz clic para filtrar las oportunidades activas en la tabla"
        />

        <KpiCard
          label="Oportunidades calientes"
          subtitle="score en tercio superior de la cartera"
          value={<CountUp to={hotCount} format="int" />}
          valueClass="text-status-success"
          onClick={() => goToOpps({ score: "hot" })}
          animDelay={160}
          tooltip="Deals con score comercial en el tercio superior (semáforo verde)"
        />

        <KpiCard
          label="Ganado este mes"
          subtitle="monto total ganado"
          value={<CountUp to={kpis.wonAmount} format="currency" />}
          valueClass="text-status-success"
          animDelay={200}
          tooltip="Suma de oportunidades marcadas como ganadas en Clientify"
        />

        {/* ── Row 3: Alerts ── */}
        <KpiCard
          label="Sin próxima acción"
          subtitle="sin movimiento ≥ 21 días"
          value={<CountUp to={kpis.noActionCount} format="int" />}
          valueClass={kpis.noActionCount > 0 ? "text-status-danger" : "text-fg-muted"}
          onClick={kpis.noActionCount > 0 ? () => goToOpps({ no_action: true }) : undefined}
          animDelay={240}
          tooltip={
            kpis.noActionCount > 0
              ? "Haz clic para ver las oportunidades sin actividad en los últimos 21 días"
              : "Todas las oportunidades tienen actividad reciente"
          }
        />

        <KpiCard
          label="Seguimiento vencido"
          subtitle="cierre estimado ya pasó"
          value={<CountUp to={kpis.overdueCount} format="int" />}
          valueClass={kpis.overdueCount > 0 ? "text-status-danger" : "text-fg-muted"}
          onClick={kpis.overdueCount > 0 ? () => goToOpps({ overdue: true }) : undefined}
          animDelay={280}
          tooltip={
            kpis.overdueCount > 0
              ? "Haz clic para ver las oportunidades con fecha de cierre vencida"
              : "Sin oportunidades con seguimiento vencido"
          }
        />

        <KpiCard
          label="Oportunidades estancadas"
          subtitle="sin actividad ≥ 14 días"
          value={<CountUp to={kpis.stagnantCount} format="int" />}
          valueClass={kpis.stagnantCount > 0 ? "text-status-warning" : "text-fg-muted"}
          onClick={kpis.stagnantCount > 0 ? () => goToOpps({ stagnant: true }) : undefined}
          animDelay={320}
          tooltip={
            kpis.stagnantCount > 0
              ? "Haz clic para ver las oportunidades estancadas (≥14 días sin actividad)"
              : "No hay oportunidades estancadas"
          }
        />

        {/* ── Row 4: Quality ── */}
        <KpiCard
          label="Ticket promedio"
          subtitle="promedio por oportunidad viva"
          value={<CountUp to={ticketAvg} format="currency" />}
          animDelay={360}
          tooltip="Pipeline activo dividido por la cantidad de oportunidades vivas"
        />

        <KpiCard
          label="Prob. promedio"
          subtitle="media simple de la cartera viva"
          value={<span>{kpis.avgProbability}%</span>}
          valueClass="text-status-info"
          animDelay={400}
          tooltip="Promedio simple de la probabilidad de cierre de todas las oportunidades vivas"
        />

        <KpiCard
          label="Calidad de datos"
          subtitle="completitud de campos clave"
          value={<span>{dataQualityPct}%</span>}
          valueClass={
            dataQualityPct >= 80
              ? "text-status-success"
              : dataQualityPct >= 50
              ? "text-status-warning"
              : "text-status-danger"
          }
          onClick={() => scrollToSection("data-quality-block")}
          animDelay={440}
          tooltip="Haz clic para ver el detalle de completitud de datos"
        />
      </div>
    </section>
  );
}
