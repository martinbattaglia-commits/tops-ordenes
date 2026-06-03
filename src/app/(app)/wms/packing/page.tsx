import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listPackQueue } from "@/lib/packing/packing";
import type { PackQueueRow } from "@/lib/packing/types";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { fmtDate } from "@/lib/utils";
import { PackOrderButton } from "./_components/PackingActions";

export const metadata = { title: "Packing · WMS" };
export const dynamic = "force-dynamic";

function s(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

export default async function PackingPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  let queue: PackQueueRow[];
  try {
    queue = await listPackQueue();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Packing no disponible"
        migration="0033_wms_packing"
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
  const porEmpacar = queue.reduce((a, o) => a + o.pending_stops, 0);
  const lineasEmpacadas = queue.reduce((a, o) => a + o.packed_lines, 0);
  const preparados = queue.filter((o) => o.fully_packed).length;

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">WMS · Depósito</div>
          <h1 className="page-title">Packing</h1>
          <p className="page-subtitle">
            Armado de bultos: consolidación de lo pickeado en unidades logísticas y pase a Preparado.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Pedidos en cola" value={pedidosEnCola} sub="en preparación" index={0} />
        <Stat label="Paradas por empacar" value={porEmpacar} sub="pickeadas" index={1} />
        <Stat label="Líneas empacadas" value={lineasEmpacadas} sub="acumulado" index={2} />
        <Stat label="Pedidos preparados" value={preparados} sub="listos para despacho" index={3} />
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
          <Link href="/wms/packing" className="btn btn-ghost btn-sm">
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
                <th className="text-right">Por empacar</th>
                <th>Estado</th>
                <th>Fecha solicitada</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.order_id}>
                  <td className="font-mono text-xs font-semibold">
                    <Link href={`/wms/packing/${o.order_id}`} className="hover:underline">{o.public_id}</Link>
                  </td>
                  <td className="text-sm">{o.client_name}</td>
                  <td className="text-right tabular text-sm">
                    {o.packed_lines}<span className="text-fg-muted"> / {o.line_count}</span>
                  </td>
                  <td className="text-right tabular text-sm">{o.pending_stops}</td>
                  <td>
                    {o.fully_packed ? (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                        style={{ background: "#0d94881a", color: "#0d9488" }}>Preparado</span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                        style={{ background: "#ea580c1a", color: "#ea580c" }}>Armando</span>
                    )}
                  </td>
                  <td className="text-xs">{o.requested_date ? fmtDate(o.requested_date) : "—"}</td>
                  <td>
                    <div className="flex items-center justify-end gap-1.5">
                      <Link href={`/wms/packing/${o.order_id}`} className="btn btn-ghost btn-sm">
                        <Icon name="eye" size={12} /> Abrir
                      </Link>
                      {o.open_units === 0 && <PackOrderButton orderId={o.order_id} pending={o.pending_stops} />}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-fg-muted py-8 text-sm">
                    {hasFilters
                      ? "Sin pedidos para los filtros aplicados."
                      : "No hay pedidos pendientes de empacar."}
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
