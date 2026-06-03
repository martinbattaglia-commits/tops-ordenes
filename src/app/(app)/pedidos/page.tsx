import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listOrders } from "@/lib/pedidos/orders";
import { ORDER_STATUS_META, type OrderRow, type LogisticsOrderStatus } from "@/lib/pedidos/types";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { fmtDate } from "@/lib/utils";
import { OrderRowActions } from "./_components/OrderRowActions";

export const metadata = { title: "Pedidos Logísticos" };
export const dynamic = "force-dynamic";

function s(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

const STATUSES: LogisticsOrderStatus[] = [
  "borrador", "pendiente", "en_preparacion", "preparado", "despachado", "entregado", "cancelado",
];

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  let all: OrderRow[];
  try {
    all = await listOrders();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Pedidos no disponibles"
        migration="0030_logistics_orders · 0031_pedidos_functions"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const fCliente = s(searchParams.cliente);
  const fEstado = s(searchParams.estado);
  const rows = all.filter(
    (o) =>
      (!fCliente || o.client_name.toLowerCase().includes(fCliente.toLowerCase())) &&
      (!fEstado || o.status === fEstado)
  );
  const count = (st: LogisticsOrderStatus) => all.filter((o) => o.status === st).length;
  const hasFilters = Boolean(fCliente || fEstado);

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Pedidos · Logística</div>
          <h1 className="page-title">Pedidos Logísticos</h1>
          <p className="page-subtitle">
            Operación logística del cliente (3PL): de borrador a entrega, con reserva FEFO de stock.
          </p>
        </div>
        <Link href="/pedidos/nuevo" className="btn btn-primary btn-sm mt-1">
          <Icon name="plus" size={14} stroke={2.2} /> Nuevo pedido
        </Link>
      </div>

      {/* KPIs (sobre todos los pedidos) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <Stat label="Total" value={all.length} sub="todos" index={0} />
        <Stat label="Pendientes" value={count("pendiente")} sub="por reservar" index={1} />
        <Stat label="En preparación" value={count("en_preparacion")} sub="con reserva" index={2} />
        <Stat label="Preparados" value={count("preparado")} sub="listos" index={3} />
        <Stat label="Cancelados" value={count("cancelado")} sub="anulados" index={4} />
      </div>

      {/* Filtros (GET, server-side) */}
      <form method="get" className="flex flex-wrap items-end gap-2 mb-4">
        <label className="flex flex-col gap-1">
          <span className="kpi-label">Cliente</span>
          <input name="cliente" defaultValue={fCliente} className="input" placeholder="Filtrar por cliente…" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="kpi-label">Estado</span>
          <select name="estado" defaultValue={fEstado} className="input">
            <option value="">Todos</option>
            {STATUSES.map((st) => (
              <option key={st} value={st}>{ORDER_STATUS_META[st].label}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary btn-sm">
          <Icon name="filter" size={12} /> Filtrar
        </button>
        {hasFilters && (
          <Link href="/pedidos" className="btn btn-ghost btn-sm">
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
                <th>Estado</th>
                <th className="text-right">Reservadas</th>
                <th>Fecha</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const meta = ORDER_STATUS_META[o.status];
                return (
                  <tr key={o.id}>
                    <td className="font-mono text-xs font-semibold">
                      <Link href={`/pedidos/${o.id}`} className="hover:underline">{o.public_id}</Link>
                    </td>
                    <td className="text-sm">{o.client_name}</td>
                    <td>
                      <span
                        className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                        style={{ background: `${meta.color}1a`, color: meta.color }}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td className="text-right tabular text-sm">
                      {o.reserved_count}<span className="text-fg-muted"> / {o.item_count}</span>
                    </td>
                    <td className="text-xs">{fmtDate(o.created_at)}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1.5">
                        <Link href={`/pedidos/${o.id}`} className="btn btn-ghost btn-sm">
                          <Icon name="eye" size={12} /> Ver
                        </Link>
                        <OrderRowActions id={o.id} status={o.status} />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-fg-muted py-8 text-sm">
                    {hasFilters ? "Sin pedidos para los filtros aplicados." : "Aún no hay pedidos cargados."}
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
