import Link from "next/link";
import { Icon } from "@/components/Icon";
import { CountUp } from "@/components/CountUp";
import { getWmsDashboard } from "@/lib/wms/data";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";

export const metadata = { title: "Dashboard WMS" };
export const dynamic = "force-dynamic";

export default async function WmsDashboardPage() {
  // warehouse_positions (0020) / inventory_items (0024) pueden no estar
  // aplicados todavía. Degradar con gracia en vez de romper el shell.
  let kpis: Awaited<ReturnType<typeof getWmsDashboard>>;
  try {
    kpis = await getWmsDashboard();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="WMS no disponible"
        migration="0020_wms_physical_model · 0024_wms_inventory"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const ocupPct =
    kpis.posicionesTotal > 0
      ? Math.round((kpis.posicionesOcupadas / kpis.posicionesTotal) * 100)
      : 0;

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">WMS · Depósito</div>
          <h1 className="page-title">Dashboard WMS</h1>
          <p className="page-subtitle">
            Administración de inventario de terceros. Ocupación física calculada
            contra el Digital Twin de depósitos.
          </p>
        </div>
        <Link href="/wms/inventario" className="btn btn-primary btn-sm mt-1">
          <Icon name="package" size={14} />
          <span>Ver inventario</span>
        </Link>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Stock total" value={kpis.stockTotal} sub="unidades disponibles" index={0} />
        <Stat label="Clientes activos" value={kpis.clientesActivos} sub="depositantes con stock" index={1} />
        <Stat label="Posiciones ocupadas" value={kpis.posicionesOcupadas} sub={`de ${kpis.posicionesTotal} totales`} index={2} />
        <Stat label="Posiciones disponibles" value={kpis.posicionesDisponibles} sub="libres en depósito" index={3} />
      </div>

      {/* Ocupación */}
      <div className="nx-surface card card-pad mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="kpi-label">Ocupación del Digital Twin</div>
          <div className="text-sm font-bold text-fg-brand tabular">{ocupPct}%</div>
        </div>
        <div className="h-2 rounded-full bg-bg-surface-alt overflow-hidden">
          <div
            className="h-full rounded-full bg-tops-red transition-all"
            style={{ width: `${ocupPct}%` }}
          />
        </div>
        <p className="text-xs text-fg-muted mt-2">
          {kpis.posicionesOcupadas} de {kpis.posicionesTotal} posiciones con stock asignado.
        </p>
      </div>

      <p className="text-xs text-fg-muted">
        Recepciones, movimientos, picking, packing y despachos se habilitan en
        sprints posteriores. La estructura física vive en el{" "}
        <Link href="/operaciones/mapa-inteligente" className="underline">
          Mapa Inteligente
        </Link>
        .
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  index = 0,
}: {
  label: string;
  value: number;
  sub: string;
  index?: number;
}) {
  return (
    <div style={{ animationDelay: `${index * 45}ms` }} className="nx-surface nx-stagger card p-5">
      <div className="kpi-label">{label}</div>
      <div className="text-2xl font-bold tabular leading-none mt-1 text-fg-brand">
        <CountUp to={value} format="int" />
      </div>
      <div className="text-[11px] text-fg-muted mt-1">{sub}</div>
    </div>
  );
}
