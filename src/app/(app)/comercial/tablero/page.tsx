import { getTableroData } from "@/lib/comercial/dashboard-data";
import { ExecutiveSummary } from "@/components/comercial/tablero/ExecutiveSummary";
import { TopOpportunities } from "@/components/comercial/tablero/TopOpportunities";
import { PriorityMatrix } from "@/components/comercial/tablero/PriorityMatrix";
import { BusinessUnitDonut } from "@/components/comercial/tablero/BusinessUnitDonut";
import { StageBars } from "@/components/comercial/tablero/StageBars";
import { ConcretionBars } from "@/components/comercial/tablero/ConcretionBars";
import { ForecastTrend } from "@/components/comercial/tablero/ForecastTrend";
import { CommercialAlerts } from "@/components/comercial/tablero/CommercialAlerts";
import { AutoInsights } from "@/components/comercial/tablero/AutoInsights";
import { ActionPlan } from "@/components/comercial/tablero/ActionPlan";
import { OpportunitiesTable } from "@/components/comercial/tablero/OpportunitiesTable";
import { SyncStatus } from "@/components/comercial/tablero/SyncStatus";

export const metadata = { title: "Tablero Comercial · Clientify" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TableroPage() {
  const data = await getTableroData();

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
    <div className="mx-auto max-w-[1500px] space-y-6 p-4 md:p-8 nx-page-fade">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-eyebrow-sm uppercase text-fg-muted">Comercial · CRM</div>
          <h1 className="text-2xl font-bold text-fg-primary">Cockpit comercial</h1>
        </div>
        <div className="text-xs text-fg-muted">
          Foto de Clientify · última sync {data.lastSync ? new Date(data.lastSync).toLocaleString("es-AR") : "—"}
        </div>
      </header>

      {/* 1 · Resumen ejecutivo */}
      <ExecutiveSummary kpis={data.kpis} deltas={data.deltas} lastSync={data.lastSync} syncStatus={data.syncStatus} />

      {/* 2 · Top oportunidades a cerrar */}
      <TopOpportunities deals={data.topOpps} />

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

      {/* 7 · Detalle operativo */}
      <OpportunitiesTable deals={data.deals} />

      {/* 8 · Transparencia de datos */}
      <SyncStatus syncStatus={data.syncStatus} lastSync={data.lastSync} kpis={data.kpis} />
    </div>
  );
}
