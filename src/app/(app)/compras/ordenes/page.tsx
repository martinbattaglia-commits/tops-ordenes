import Link from "next/link";
import { Icon } from "@/components/Icon";
import { PoStatusBadge } from "@/components/compras/PoStatusBadge";
import { listPurchaseOrders } from "@/lib/compras/data";
import { fmtCurrency, fmtCurrencyShort, fmtDate, truncate } from "@/lib/compras/format";
import type { PoStatus } from "@/lib/types-po";
import type { Depot } from "@/lib/types";
import { OrdersToolbar } from "./OrdersToolbar";

export const metadata = { title: "Compras · Órdenes" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams?: {
    status?: string;
    depot?: string;
    search?: string;
    page?: string;
  };
}

const TABS: Array<{ key: PoStatus | "todas"; label: string }> = [
  { key: "todas", label: "Todas" },
  { key: "enviada", label: "Enviadas" },
  { key: "firmada", label: "Firmadas" },
  { key: "pendiente", label: "Pendientes" },
  { key: "conciliada", label: "Conciliadas" },
  { key: "borrador", label: "Borradores" },
];

export default async function OrdenesComprasPage({ searchParams }: PageProps) {
  const status = (searchParams?.status as PoStatus | "todas") ?? "todas";
  const depot = (searchParams?.depot as Depot | "todos") ?? "todos";
  const search = searchParams?.search ?? "";
  const page = Math.max(1, parseInt(searchParams?.page ?? "1", 10) || 1);
  const pageSize = 18;

  const { rows, total, counts, sumTotal } = await listPurchaseOrders({
    status,
    depot,
    search,
    page,
    pageSize,
  });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const href = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const next = { status, depot, search, page: String(page), ...patch };
    Object.entries(next).forEach(([k, v]) => {
      if (v && v !== "todas" && v !== "todos" && v !== "") params.set(k, v);
    });
    return `/compras/ordenes?${params.toString()}`;
  };

  return (
    <div className="p-4 md:p-7 lg:p-8">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Historial · {total} OC</div>
          <h1 className="page-title">Órdenes de Compra</h1>
          <p className="page-subtitle">
            Filtros y exportación de comprobantes firmados por José Luis Battaglia.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/api/compras/export" className="btn btn-ghost btn-sm">
            <Icon name="export" size={14} />
            <span className="hidden sm:inline">Exportar CSV</span>
          </Link>
          <Link href="/compras/nueva" className="btn btn-danger btn-sm">
            <Icon name="plus" size={14} stroke={2.2} />
            <span>Nueva OC</span>
          </Link>
        </div>
      </div>

      {/* Tabs estado */}
      <div className="flex overflow-x-auto -mx-1 mb-4 gap-1 p-1 bg-white border border-stroke-soft rounded-lg w-fit max-w-full">
        {TABS.map((t) => {
          const c = t.key === "todas" ? counts.todas ?? 0 : counts[t.key] ?? 0;
          const active = status === t.key;
          return (
            <Link
              key={t.key}
              href={href({ status: t.key, page: "1" })}
              className={`btn btn-sm whitespace-nowrap ${
                active ? "btn-primary" : "btn-ghost border-none bg-transparent"
              }`}
            >
              {t.label}
              <span
                className={`text-[11px] font-bold ml-1 tabular ${
                  active ? "text-white/70" : "text-fg-muted"
                }`}
              >
                {c}
              </span>
            </Link>
          );
        })}
      </div>

      <OrdersToolbar
        initialSearch={search}
        initialDepot={depot}
        resultCount={rows.length}
        sumTotal={sumTotal}
      />

      <div className="card overflow-hidden mt-4">
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-12">
                  <input type="checkbox" aria-label="Seleccionar todas" />
                </th>
                <th>Orden</th>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>Categoría</th>
                <th className="text-right">Items</th>
                <th className="text-right">Total</th>
                <th>Estado</th>
                <th className="w-16">Firma</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <input type="checkbox" aria-label="Seleccionar OC" />
                  </td>
                  <td>
                    <Link href={`/compras/ordenes/${o.public_id}`} className="order-num">
                      {o.public_id}
                    </Link>
                  </td>
                  <td className="text-xs text-fg-secondary">{fmtDate(o.date)}</td>
                  <td className="cell-cliente">
                    {o.vendor?.razon ?? "—"}
                    <span className="cuit">{o.vendor?.cuit}</span>
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 text-xs text-fg-secondary">
                      <Icon name="tag" size={12} className="text-fg-muted" />
                      {o.vendor?.categoria ?? o.categoria ?? "—"}
                    </span>
                  </td>
                  <td className="text-right tabular text-xs text-fg-secondary">
                    {o.items?.length ?? 0}
                  </td>
                  <td className="text-right tabular font-bold text-fg-brand">
                    {fmtCurrency(o.total)}
                  </td>
                  <td>
                    <PoStatusBadge status={o.status} />
                  </td>
                  <td>
                    {o.signed_by ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-status-success font-bold">
                        <Icon name="check" size={11} stroke={2.4} />
                        JL
                      </span>
                    ) : (
                      <span className="text-[11px] text-fg-muted italic">—</span>
                    )}
                  </td>
                  <td>
                    <Icon name="menu-dots" size={14} className="text-fg-muted" />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-10 text-fg-muted">
                    No hay OC con esos filtros.
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
              href={`/compras/ordenes/${o.public_id}`}
              className="block p-4 active:bg-neutral-50 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[11px] text-fg-muted font-bold">
                  {o.public_id}
                </span>
                <PoStatusBadge status={o.status} />
              </div>
              <div className="text-sm font-bold text-fg-primary mb-0.5">
                {truncate(o.vendor?.razon ?? "—", 36)}
              </div>
              <div className="text-xs text-fg-muted font-mono mb-2">{o.vendor?.cuit}</div>
              <div className="flex items-center justify-between text-xs text-fg-secondary">
                <span>{fmtDate(o.date)}</span>
                <span className="font-bold text-fg-brand tabular text-sm">
                  {fmtCurrency(o.total)}
                </span>
              </div>
            </Link>
          ))}
          {rows.length === 0 && (
            <div className="text-center py-10 text-fg-muted text-sm">
              No hay OC con esos filtros.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-stroke-soft bg-neutral-50 text-xs">
          <div className="text-fg-secondary">
            Mostrando {rows.length === 0 ? 0 : (page - 1) * pageSize + 1}–
            {(page - 1) * pageSize + rows.length} de {total} ·{" "}
            <span className="font-bold text-fg-brand tabular">
              {fmtCurrencyShort(sumTotal)}
            </span>
          </div>
          <div className="flex gap-1">
            {page > 1 && (
              <Link href={href({ page: String(page - 1) })} className="btn btn-ghost btn-sm">
                <Icon name="arrow-left" size={12} />
              </Link>
            )}
            <span className="btn btn-primary btn-sm pointer-events-none">{page}</span>
            {page < totalPages && (
              <Link href={href({ page: String(page + 1) })} className="btn btn-ghost btn-sm">
                <Icon name="arrow-right" size={12} />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
