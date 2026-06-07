import Link from "next/link";
import { Icon } from "@/components/Icon";
import { StatusBadge } from "@/components/StatusBadge";
import { RealtimeRefresher } from "@/components/RealtimeRefresher";
import { listOrders } from "@/lib/data/orders";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import type { OrderStatus, Depot } from "@/lib/types";
import { OrdersToolbar } from "./OrdersToolbar";

export const metadata = { title: "Órdenes" };

interface PageProps {
  searchParams?: {
    status?: string;
    depot?: string;
    search?: string;
    page?: string;
  };
}

const STATUS_TABS: Array<{ key: OrderStatus | "todas"; label: string }> = [
  { key: "todas", label: "Todas" },
  { key: "FIRMADA", label: "Firmadas" },
  { key: "PENDIENTE_FIRMA", label: "Pendientes" },
  { key: "EN_CURSO", label: "En curso" },
  { key: "OBSERVADA", label: "Observadas" },
];

export default async function OrdersPage({ searchParams }: PageProps) {
  const status = (searchParams?.status as OrderStatus | "todas") ?? "todas";
  const depot = (searchParams?.depot as Depot | "todos") ?? "todos";
  const search = searchParams?.search ?? "";
  const page = Math.max(1, parseInt(searchParams?.page ?? "1", 10) || 1);
  const pageSize = 18;

  const { rows, total, counts } = await listOrders({ status, depot, search, page, pageSize });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const buildHref = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const next = { status, depot, search, page: String(page), ...patch };
    Object.entries(next).forEach(([k, v]) => {
      if (v && v !== "todas" && v !== "todos" && v !== "") params.set(k, v);
    });
    return `/orders?${params.toString()}`;
  };

  return (
    <div className="p-4 lg:p-8">
      <RealtimeRefresher />
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Historial · {total} órdenes</div>
          <h1 className="page-title">Órdenes de servicio</h1>
          <p className="page-subtitle">
            Filtros, exportación y reenvío de comprobantes. Hacé tap en una fila para ver el detalle.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/api/orders/export" className="btn btn-ghost btn-sm">
            <Icon name="export" size={14} />
            <span className="hidden sm:inline">Exportar CSV</span>
          </Link>
          <Link href="/orders/new" className="btn btn-primary btn-sm">
            <Icon name="plus" size={14} stroke={2.2} />
            <span>Nueva orden</span>
          </Link>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex overflow-x-auto -mx-1 mb-4 gap-1 p-1 bg-bg-surface-alt border border-stroke-soft rounded-lg w-fit">
        {STATUS_TABS.map((t) => (
          <Link
            key={t.key}
            href={buildHref({ status: t.key, page: "1" })}
            className={`btn btn-sm whitespace-nowrap ${
              status === t.key ? "btn-primary" : "btn-ghost border-none bg-transparent"
            }`}
          >
            {t.label}
            <span
              className={`text-[11px] font-bold ml-1 ${
                status === t.key ? "text-white/70" : "text-fg-muted"
              }`}
            >
              {t.key === "todas" ? counts.todas ?? 0 : counts[t.key] ?? 0}
            </span>
          </Link>
        ))}
      </div>

      <OrdersToolbar
        initialSearch={search}
        initialDepot={depot}
      />

      <div className="card overflow-hidden mt-4">
        <div className="hidden md:block overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Orden</th>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Depósito</th>
                <th>Servicios</th>
                <th className="text-right">Horas</th>
                <th className="text-right">Total</th>
                <th>Estado</th>
                <th>Firma</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/orders/${o.public_id}`} className="order-num">
                      {o.public_id}
                    </Link>
                  </td>
                  <td className="text-xs text-fg-secondary">{fmtDate(o.date)}</td>
                  <td className="cell-cliente">
                    {o.client?.razon ?? "—"}
                    <span className="cuit">{o.client?.cuit}</span>
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <Icon name="building" size={13} className="text-fg-muted" />
                      {o.depot === "MAGALDI" ? "Magaldi" : "Luján"}
                    </span>
                  </td>
                  <td>
                    <span className="text-xs text-fg-secondary">
                      {o.services?.slice(0, 2).map((s) => s.label).join(" · ") ?? "—"}
                      {o.services && o.services.length > 2 && (
                        <span className="text-fg-muted"> +{o.services.length - 2}</span>
                      )}
                    </span>
                  </td>
                  <td className="text-right tabular font-semibold">{o.hours} hs</td>
                  <td className="text-right tabular font-bold text-fg-brand">
                    {fmtCurrency(o.total)}
                  </td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td>
                    {o.signed_by ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-status-success">
                        <Icon name="check" size={12} stroke={2.4} />
                        {o.signed_by.split(" ")[0]}
                      </span>
                    ) : (
                      <span className="text-[11px] text-fg-muted italic">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-fg-muted">
                    No hay órdenes que coincidan con los filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-stroke-soft">
          {rows.map((o) => (
            <Link
              key={o.id}
              href={`/orders/${o.public_id}`}
              className="block p-4 active:bg-neutral-50 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="order-num text-sm">{o.public_id}</span>
                <StatusBadge status={o.status} />
              </div>
              <div className="text-sm font-semibold text-fg-primary mb-0.5">
                {o.client?.razon ?? "—"}
              </div>
              <div className="text-xs text-fg-muted font-mono mb-2">{o.client?.cuit}</div>
              <div className="flex items-center justify-between text-xs text-fg-secondary">
                <span className="inline-flex items-center gap-1">
                  <Icon name="building" size={11} />
                  {o.depot === "MAGALDI" ? "Magaldi" : "Luján"}
                </span>
                <span>{fmtDate(o.date)}</span>
                <span className="font-bold text-fg-brand tabular">{fmtCurrency(o.total)}</span>
              </div>
            </Link>
          ))}
          {rows.length === 0 && (
            <div className="text-center py-8 text-fg-muted text-sm">
              No hay órdenes que coincidan.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-stroke-soft bg-neutral-50 text-xs">
          <div className="text-fg-secondary">
            Mostrando {rows.length === 0 ? 0 : (page - 1) * pageSize + 1}–
            {(page - 1) * pageSize + rows.length} de {total}
          </div>
          <div className="flex gap-1">
            {page > 1 && (
              <Link href={buildHref({ page: String(page - 1) })} className="btn btn-ghost btn-sm">
                <Icon name="arrow-left" size={12} />
              </Link>
            )}
            <span className="btn btn-primary btn-sm pointer-events-none">{page}</span>
            {page < totalPages && (
              <Link href={buildHref({ page: String(page + 1) })} className="btn btn-ghost btn-sm">
                <Icon name="arrow-right" size={12} />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
