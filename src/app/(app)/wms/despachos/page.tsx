import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listDispatchQueue } from "@/lib/dispatch/dispatch";
import type { DispatchQueueRow } from "@/lib/dispatch/types";
import { SHIPMENT_STATUS_META } from "@/lib/dispatch/types";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Despachos · WMS" };
export const dynamic = "force-dynamic";

function s(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

export default async function DespachosPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  let queue: DispatchQueueRow[];
  try {
    queue = await listDispatchQueue();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Despachos no disponible"
        migration="0035_wms_dispatch"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const fCliente = s(searchParams.cliente);
  const rows = queue.filter(
    (o) => !fCliente || o.client_name.toLowerCase().includes(fCliente.toLowerCase())
  );
  const hasFilters = Boolean(fCliente);

  const listos = queue.filter((o) => o.ready).length;
  const enTransito = queue.filter((o) => o.status === "despachado").length;
  const bultosCerrados = queue.reduce((a, o) => a + o.closed_units, 0);
  const conAbiertos = queue.filter((o) => o.open_units > 0).length;

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">WMS · Depósito</div>
          <h1 className="page-title">Despachos</h1>
          <p className="page-subtitle">
            Salida de mercadería del depósito: egreso real (descuento de stock + lote FEFO) y entrega.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Listos para despachar" value={listos} sub="preparados · bultos cerrados" index={0} />
        <Stat label="En tránsito" value={enTransito} sub="despachados sin entregar" index={1} />
        <Stat label="Bultos cerrados" value={bultosCerrados} sub="en cola" index={2} />
        <Stat label="Con bultos abiertos" value={conAbiertos} sub="bloquean el despacho" index={3} />
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
          <Link href="/wms/despachos" className="btn btn-ghost btn-sm">
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
                <th className="text-right">Bultos</th>
                <th>Estado</th>
                <th>Despacho</th>
                <th>Fecha solicitada</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const sm = o.shipment ? SHIPMENT_STATUS_META[o.shipment.status] : null;
                return (
                  <tr key={o.order_id}>
                    <td className="font-mono text-xs font-semibold">
                      <Link href={`/wms/despachos/${o.order_id}`} className="hover:underline">{o.public_id}</Link>
                    </td>
                    <td className="text-sm">{o.client_name}</td>
                    <td className="text-right tabular text-sm">
                      {o.closed_units}
                      <span className="text-fg-muted"> / {o.total_units}</span>
                      {o.open_units > 0 && (
                        <span className="text-status-warning" title="bultos abiertos"> · {o.open_units} abiertos</span>
                      )}
                    </td>
                    <td>
                      {o.ready ? (
                        <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                          style={{ background: "#0d94881a", color: "#0d9488" }}>Listo</span>
                      ) : o.status === "despachado" ? (
                        <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                          style={{ background: "#7c3aed1a", color: "#7c3aed" }}>En tránsito</span>
                      ) : o.status === "entregado" ? (
                        <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                          style={{ background: "#16a34a1a", color: "#16a34a" }}>Entregado</span>
                      ) : (
                        <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                          style={{ background: "#ea580c1a", color: "#ea580c" }}>Sin cerrar</span>
                      )}
                    </td>
                    <td className="font-mono text-[11px]">
                      {o.shipment ? (
                        <span style={{ color: sm?.color }}>{o.shipment.public_id}</span>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </td>
                    <td className="text-xs">{o.requested_date ? fmtDate(o.requested_date) : "—"}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1.5">
                        <Link href={`/wms/despachos/${o.order_id}`} className="btn btn-ghost btn-sm">
                          <Icon name="eye" size={12} /> Abrir
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-fg-muted py-8 text-sm">
                    {hasFilters
                      ? "Sin pedidos para los filtros aplicados."
                      : "No hay pedidos preparados ni despachos en tránsito."}
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
