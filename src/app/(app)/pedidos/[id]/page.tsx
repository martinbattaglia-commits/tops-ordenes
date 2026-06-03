import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { getOrder } from "@/lib/pedidos/orders";
import { listAllocations } from "@/lib/pedidos/allocations";
import { getLotInventory } from "@/lib/wms/lots";
import {
  ORDER_STATUS_META,
  ORDER_ITEM_STATUS_META,
  type AllocStatus,
} from "@/lib/pedidos/types";
import type { LotInventoryRow } from "@/lib/wms/types";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { OrderDetailActions, ReleaseAllocationButton } from "./_components/OrderDetailActions";
import { EditOrderForm } from "./EditOrderForm";

export const metadata = { title: "Pedido · Pedidos" };
export const dynamic = "force-dynamic";

const ALLOC_COLOR: Record<AllocStatus, string> = {
  reservada: "#16a34a",
  pickeada: "#2563eb",
  empacada: "#0d9488",
  despachada: "#7c3aed",
  liberada: "#6b7280",
};

export default async function PedidoDetailPage({ params }: { params: { id: string } }) {
  let detail: Awaited<ReturnType<typeof getOrder>>;
  try {
    detail = await getOrder(params.id);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Pedido no disponible"
        migration="0030_logistics_orders · 0031_pedidos_functions"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }
  if (!detail) notFound();
  const { order, items } = detail;

  const allocations = await listAllocations(order.id);
  const skuById = new Map(items.map((it) => [it.id, it.sku]));

  // Visualización FEFO: cola de lotes por SKU del pedido (reutiliza capa 9A).
  const skus = Array.from(new Set(items.map((it) => it.sku)));
  const fefoBySku = new Map<string, LotInventoryRow[]>();
  await Promise.all(
    skus.map(async (sku) => {
      const lots = await getLotInventory({ filters: { cliente: order.client_name, sku } });
      fefoBySku.set(sku, lots);
    })
  );

  const meta = ORDER_STATUS_META[order.status];
  const isBorrador = order.status === "borrador";

  // Resumen de cobertura del pedido
  const unitsReq = items.reduce((s, it) => s + it.quantity_requested, 0);
  const unitsAlloc = items.reduce((s, it) => s + it.quantity_allocated, 0);
  const reservedLines = items.filter((it) => it.status === "reservado").length;
  const covTotal = unitsReq > 0 ? Math.round((unitsAlloc / unitsReq) * 100) : 0;

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Pedidos · Logística</div>
          <h1 className="page-title flex items-center gap-3">
            {order.public_id}
            <span
              className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded"
              style={{ background: `${meta.color}1a`, color: meta.color }}
            >
              {meta.label}
            </span>
          </h1>
          <p className="page-subtitle">{order.client_name}{order.customer_ref ? ` · Ref ${order.customer_ref}` : ""}</p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <Link href="/pedidos" className="btn btn-ghost btn-sm"><Icon name="arrow-left" size={12} /> Volver</Link>
          <OrderDetailActions id={order.id} status={order.status} />
        </div>
      </div>

      {/* Cabecera */}
      <div className="nx-surface card card-pad mb-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
        <Field label="Cliente" value={order.client_name} />
        <Field label="Ref. cliente" value={order.customer_ref ?? "—"} />
        <Field label="Prioridad" value={String(order.priority)} />
        <Field label="Fecha solicitada" value={order.requested_date ? fmtDate(order.requested_date) : "—"} />
        <Field label="Creado" value={fmtDate(order.created_at)} />
        {order.notes && <div className="sm:col-span-2 lg:col-span-3"><Field label="Notas" value={order.notes} /></div>}
      </div>

      {/* Resumen de cobertura */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <Stat label="Líneas totales" value={String(items.length)} index={0} />
        <Stat label="Líneas reservadas" value={`${reservedLines} / ${items.length}`} index={1} />
        <Stat label="Unidades solicitadas" value={unitsReq.toLocaleString("es-AR")} index={2} />
        <Stat label="Unidades reservadas" value={unitsAlloc.toLocaleString("es-AR")} index={3} />
        <Stat label="Cobertura total" value={`${covTotal}%`} index={4} color={coverageColor(covTotal)} />
      </div>

      {/* Edición (solo borrador) */}
      {isBorrador && <EditOrderForm order={order} items={items} />}

      {/* Líneas */}
      <div className="nx-surface card overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-stroke-soft"><h2 className="text-sm font-semibold">Líneas</h2></div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>SKU</th><th>Descripción</th>
                <th className="text-right">Solicitado</th>
                <th className="text-right">Reservado</th>
                <th className="text-right">Cobertura</th>
                <th>Estado</th><th>Lote exigido</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const im = ORDER_ITEM_STATUS_META[it.status];
                const pct = it.quantity_requested > 0
                  ? Math.round((it.quantity_allocated / it.quantity_requested) * 100) : 0;
                const c = coverageColor(pct);
                return (
                  <tr key={it.id}>
                    <td className="font-mono text-xs font-semibold">{it.sku}</td>
                    <td className="text-sm">{it.description}</td>
                    <td className="text-right tabular">{it.quantity_requested.toLocaleString("es-AR")}</td>
                    <td className="text-right tabular font-semibold text-fg-brand">{it.quantity_allocated.toLocaleString("es-AR")}</td>
                    <td className="text-right">
                      <span className="text-[10px] font-bold tabular px-2 py-1 rounded"
                        style={{ background: `${c}1a`, color: c }}>{pct}%</span>
                    </td>
                    <td>
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                        style={{ background: `${im.color}1a`, color: im.color }}>{im.label}</span>
                    </td>
                    <td className="text-xs text-fg-muted">{it.lot_constraint ?? "—"}</td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr><td colSpan={6} className="text-center text-fg-muted py-6 text-sm">Sin líneas.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reservas (trazabilidad) */}
      <div className="nx-surface card overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-stroke-soft"><h2 className="text-sm font-semibold">Reservas · trazabilidad</h2></div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>SKU</th><th>Lote</th>
                <th className="text-right">Cantidad</th>
                <th>Estado</th><th>Reservado</th><th>Liberado</th>
                <th className="text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {allocations.map((a) => (
                <tr key={a.id}>
                  <td className="font-mono text-xs font-semibold">{skuById.get(a.order_item_id) ?? "—"}</td>
                  <td className="font-mono text-[11px] text-fg-secondary">{a.lot_number ?? "—"}</td>
                  <td className="text-right tabular">{a.quantity.toLocaleString("es-AR")}</td>
                  <td>
                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                      style={{ background: `${ALLOC_COLOR[a.status]}1a`, color: ALLOC_COLOR[a.status] }}>{a.status}</span>
                  </td>
                  <td className="text-xs">{fmtDateTime(a.reserved_at)}</td>
                  <td className="text-xs">{a.released_at ? fmtDateTime(a.released_at) : "—"}</td>
                  <td className="text-right">
                    {a.status === "reservada" && <ReleaseAllocationButton allocationId={a.id} orderId={order.id} />}
                  </td>
                </tr>
              ))}
              {allocations.length === 0 && (
                <tr><td colSpan={7} className="text-center text-fg-muted py-6 text-sm">Aún no hay reservas. Usá “Reservar stock”.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Visualización FEFO por SKU */}
      <div className="nx-surface card overflow-hidden">
        <div className="px-4 py-3 border-b border-stroke-soft flex items-center justify-between">
          <h2 className="text-sm font-semibold">Cola FEFO (stock disponible por SKU)</h2>
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded bg-bg-surface-alt text-fg-secondary">First Expired First Out</span>
        </div>
        <div className="p-4 flex flex-col gap-4">
          {skus.map((sku) => {
            const lots = fefoBySku.get(sku) ?? [];
            return (
              <div key={sku}>
                <div className="text-xs font-mono font-semibold mb-1">{sku}</div>
                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead>
                      <tr><th>Lote</th><th>Vencimiento</th><th className="text-right">Cantidad (lote)</th><th>Ubicación</th></tr>
                    </thead>
                    <tbody>
                      {lots.map((l) => (
                        <tr key={l.lot_id}>
                          <td className="font-mono text-[11px]">{l.lot_number || "—"}</td>
                          <td className="text-xs">{l.expiration_date ? fmtDate(l.expiration_date) : "—"}</td>
                          <td className="text-right tabular">{l.quantity.toLocaleString("es-AR")}</td>
                          <td className="font-mono text-[11px] text-fg-secondary">{l.position_full_code ?? "—"}</td>
                        </tr>
                      ))}
                      {lots.length === 0 && (
                        <tr><td colSpan={4} className="text-center text-fg-muted py-4 text-xs">Sin lotes para {order.client_name} · {sku}.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="kpi-label">{label}</div>
      <div className="text-sm mt-0.5">{value}</div>
    </div>
  );
}

/** Color del badge de cobertura: 100% verde · parcial naranja · 0 gris. */
function coverageColor(pct: number): string {
  if (pct >= 100) return "#16a34a";
  if (pct > 0) return "#ea580c";
  return "#6b7280";
}

function Stat({ label, value, index, color }: { label: string; value: string; index: number; color?: string }) {
  return (
    <div style={{ animationDelay: `${index * 45}ms` }} className="nx-surface nx-stagger card p-5">
      <div className="kpi-label">{label}</div>
      <div
        className={`text-2xl font-bold tabular leading-none mt-1 ${color ? "" : "text-fg-brand"}`}
        style={color ? { color } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
