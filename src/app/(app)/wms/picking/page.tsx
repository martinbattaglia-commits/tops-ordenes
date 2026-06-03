import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listPickQueue } from "@/lib/picking/picking";
import type { PickQueueRow } from "@/lib/picking/types";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { fmtDate } from "@/lib/utils";
import { PickOrderButton } from "./_components/PickingActions";

export const metadata = { title: "Picking · WMS" };
export const dynamic = "force-dynamic";

function s(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

export default async function PickingPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  let queue: PickQueueRow[];
  try {
    queue = await listPickQueue();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Picking no disponible"
        migration="0032_wms_picking"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const fCliente = s(searchParams.cliente);
  const rows = queue.filter(
    (o) => !fCliente || o.client_name.toLowerCase().includes(fCliente.toLowerCase())
  );
  const hasFilters = Boolean(fCliente);

  const pedidosEnCola = queue.length;
  const pendientes = queue.reduce((a, o) => a + o.pending_stops, 0);
  const pickeadas = queue.reduce((a, o) => a + o.picked_stops, 0);
  const listos = queue.filter((o) => o.fully_picked).length;

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">WMS · Depósito</div>
          <h1 className="page-title">Picking</h1>
          <p className="page-subtitle">
            Preparación de pedidos: recorrido por posición física y confirmación de cantidades por SKU y lote.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Pedidos en cola" value={pedidosEnCola} sub="en preparación" index={0} />
        <Stat label="Paradas pendientes" value={pendientes} sub="por pickear" index={1} />
        <Stat label="Paradas pickeadas" value={pickeadas} sub="retiradas" index={2} />
        <Stat label="Listos para empacar" value={listos} sub="pedidos completos" index={3} />
      </div>

      {/* Filtro (GET, server-side) */}
      <form method="get" className="flex flex-wrap items-end gap-2 mb-4">
        <label className="flex flex-col gap-1">
          <span className="kpi-label">Cliente</span>
          <input name="cliente" defaultValue={fCliente} className="input" placeholder="Filtrar por cliente…" />
        </label>
        <button type="submit" className="btn btn-primary btn-sm">
          <Icon name="filter" size={12} /> Filtrar
        </button>
        {hasFilters && (
          <Link href="/wms/picking" className="btn btn-ghost btn-sm">
            <Icon name="x" size={12} /> Limpiar
          </Link>
        )}
      </form>

      <div className="nx-surface card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>N°</th>
                <th>Cliente</th>
                <th className="text-right">Progreso</th>
                <th className="text-right">Pendientes</th>
                <th>Estado</th>
                <th>Fecha solicitada</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.order_id}>
                  <td className="font-mono text-xs font-semibold">
                    <Link href={`/wms/picking/${o.order_id}`} className="hover:underline">{o.public_id}</Link>
                  </td>
                  <td className="text-sm">{o.client_name}</td>
                  <td className="text-right tabular text-sm">
                    {o.picked_stops}<span className="text-fg-muted"> / {o.total_stops}</span>
                  </td>
                  <td className="text-right tabular text-sm">{o.pending_stops}</td>
                  <td>
                    {o.fully_picked ? (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                        style={{ background: "#0d94881a", color: "#0d9488" }}>Listo</span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                        style={{ background: "#2563eb1a", color: "#2563eb" }}>En ruta</span>
                    )}
                  </td>
                  <td className="text-xs">{o.requested_date ? fmtDate(o.requested_date) : "—"}</td>
                  <td>
                    <div className="flex items-center justify-end gap-1.5">
                      <Link href={`/wms/picking/${o.order_id}`} className="btn btn-ghost btn-sm">
                        <Icon name="eye" size={12} /> Abrir
                      </Link>
                      <PickOrderButton orderId={o.order_id} pending={o.pending_stops} />
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-fg-muted py-8 text-sm">
                    {hasFilters
                      ? "Sin pedidos para los filtros aplicados."
                      : "No hay pedidos en preparación para pickear."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, index }: { label: string; value: number; sub: string; index: number }) {
  return (
    <div style={{ animationDelay: `${index * 45}ms` }} className="nx-surface nx-stagger card p-5">
      <div className="kpi-label">{label}</div>
      <div className="text-2xl font-bold tabular leading-none mt-1 text-fg-brand">{value}</div>
      <div className="text-[11px] text-fg-muted mt-1">{sub}</div>
    </div>
  );
}
