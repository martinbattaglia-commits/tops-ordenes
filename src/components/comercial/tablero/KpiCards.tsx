import { Sparkline } from "@/components/charts/Sparkline";
import type { Kpis } from "@/lib/comercial/dashboard-kpis";
import type { TrendPoint } from "@/lib/comercial/dashboard-data";

const fmt = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n || 0);

export function KpiCards({ kpis, trends }: { kpis: Kpis; trends: Record<number, TrendPoint[]> }) {
  const allForecast = Object.values(trends).reduce<number[]>((acc, serie) => {
    serie.forEach((p, i) => { acc[i] = (acc[i] ?? 0) + p.forecast; });
    return acc;
  }, []);
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {/* Probabilidad de concreción: ponderada por monto (foto actual de Clientify) */}
      <div className="rounded-2xl border border-sky-300 bg-white p-4 shadow-sm dark:border-sky-700 dark:bg-slate-900">
        <div className="text-[10px] uppercase tracking-wider text-sky-600 dark:text-sky-400">Prob. de concreción</div>
        <div className="mt-1 font-mono text-2xl font-bold text-sky-600 dark:text-sky-400">
          {kpis.weightedConcretion.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%
        </div>
        <div className="mt-1 text-[11px] text-slate-500">ponderada por monto · foto de hoy</div>
      </div>

      {/* Forecast ponderado activo */}
      <div className="rounded-2xl border border-emerald-300 bg-white p-4 shadow-sm dark:border-emerald-700 dark:bg-slate-900">
        <div className="text-[10px] uppercase tracking-wider text-emerald-600">Forecast ponderado (activo)</div>
        <div className="mt-1 font-mono text-2xl font-bold text-emerald-600">{fmt(kpis.forecast)}</div>
        {allForecast.length > 1
          ? <div className="mt-2"><Sparkline data={allForecast} color="#059669" /></div>
          : <div className="mt-1 text-[11px] text-slate-500">{fmt(kpis.activePipeline)} de pipeline vivo</div>}
      </div>

      <Kpi label="Pipeline vivo" value={fmt(kpis.activePipeline)} sub={`${kpis.count} oportunidades`} />
      {kpis.overdueCount > 0 ? (
        <Kpi label="Cierre vencido" value={`${kpis.overdueCount}`} sub={`${fmt(kpis.overdueAmount)} a reactivar`} tone="danger" />
      ) : (
        <Kpi label="Ganado YTD" value={fmt(kpis.wonAmount)} sub="cerrado este año" />
      )}
      <Kpi label="Prob. promedio simple" value={`${kpis.avgProbability}%`} sub="sin ponderar por monto" />

      {kpis.byPipeline.map((p) => (
        <Kpi key={p.id} label={p.name} value={fmt(p.active)} sub={`${p.count} deals · fcast ${fmt(p.forecast)}`} />
      ))}
    </section>
  );
}

function Kpi({ label, value, sub, tone = "default" }: { label: string; value: string; sub: string; tone?: "default" | "danger" }) {
  const danger = tone === "danger";
  return (
    <div className={`rounded-2xl border bg-white p-4 shadow-sm dark:bg-slate-900 ${danger ? "border-red-300 dark:border-red-800" : "border-slate-200 dark:border-slate-800"}`}>
      <div className={`text-[10px] uppercase tracking-wider ${danger ? "text-red-600 dark:text-red-400" : "text-slate-400"}`}>{label}</div>
      <div className={`mt-1 font-mono text-xl font-bold ${danger ? "text-red-600 dark:text-red-400" : ""}`}>{value}</div>
      <div className="mt-1 text-[11px] text-slate-500">{sub}</div>
    </div>
  );
}
