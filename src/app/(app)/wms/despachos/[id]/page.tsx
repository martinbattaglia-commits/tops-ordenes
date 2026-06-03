import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { listDispatchPanel } from "@/lib/dispatch/dispatch";
import { ORDER_STATUS_META } from "@/lib/pedidos/types";
import { SHIPMENT_STATUS_META } from "@/lib/dispatch/types";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { fmtDateTime } from "@/lib/utils";
import { DispatchActions } from "../_components/DispatchActions";

export const metadata = { title: "Despacho de pedido · WMS" };
export const dynamic = "force-dynamic";

export default async function DispatchPanelPage({ params }: { params: { id: string } }) {
  let panel: Awaited<ReturnType<typeof listDispatchPanel>>;
  try {
    panel = await listDispatchPanel(params.id);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Despacho no disponible"
        migration="0035_wms_dispatch"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }
  if (!panel) notFound();

  const totalUnits = panel.units.length;
  const totalItems = panel.units.reduce((a, u) => a + u.item_count, 0);
  const totalQty = panel.units.reduce((a, u) => a + u.total_quantity, 0);

  const meta = ORDER_STATUS_META[panel.status];
  const sm = panel.shipment ? SHIPMENT_STATUS_META[panel.shipment.status] : null;

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">WMS · Despacho</div>
          <h1 className="page-title flex items-center gap-3">
            {panel.public_id}
            <span
              className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded"
              style={{ background: `${meta.color}1a`, color: meta.color }}
            >
              {meta.label}
            </span>
            {panel.shipment && sm && (
              <span
                className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded font-mono"
                style={{ background: `${sm.color}1a`, color: sm.color }}
                title="Despacho"
              >
                {panel.shipment.public_id} · {sm.label}
              </span>
            )}
          </h1>
          <p className="page-subtitle">{panel.client_name}</p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <Link href="/wms/despachos" className="btn btn-ghost btn-sm">
            <Icon name="arrow-left" size={12} /> Volver
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Bultos" value={String(totalUnits)} index={0} />
        <Stat label="Ítems" value={String(totalItems)} index={1} />
        <Stat label="Unidades" value={totalQty.toLocaleString("es-AR")} index={2} />
        <Stat
          label="Estado despacho"
          value={panel.shipment ? sm!.label : panel.all_closed ? "Listo" : "Sin cerrar"}
          index={3}
          color={panel.shipment ? sm!.color : panel.all_closed ? "#0d9488" : "#ea580c"}
        />
      </div>

      {/* Acciones (cliente) */}
      <div className="mb-4">
        <DispatchActions
          orderId={panel.order_id}
          orderStatus={panel.status}
          allClosed={panel.all_closed}
          openUnits={panel.open_units}
          shipment={panel.shipment}
        />
      </div>

      {/* Datos del despacho */}
      {panel.shipment && (
        <div className="nx-surface card card-pad mb-4 text-sm flex flex-wrap gap-x-8 gap-y-1">
          <div><span className="kpi-label">Despachado</span> {panel.shipment.dispatched_at ? fmtDateTime(panel.shipment.dispatched_at) : "—"}</div>
          {panel.shipment.delivered_at && (
            <div><span className="kpi-label">Entregado</span> {fmtDateTime(panel.shipment.delivered_at)}</div>
          )}
          {panel.shipment.received_by_name && (
            <div><span className="kpi-label">Recibió</span> {panel.shipment.received_by_name}</div>
          )}
          {panel.shipment.carrier && (
            <div><span className="kpi-label">Transporte</span> {panel.shipment.carrier}</div>
          )}
        </div>
      )}

      {/* Bultos + contenido */}
      <div className="flex flex-col gap-3">
        {panel.units.map((u) => (
          <div key={u.id} className="nx-surface card overflow-hidden">
            <div className="px-4 py-3 border-b border-stroke-soft flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold">{u.public_id}</span>
                <span className="text-[10px] uppercase tracking-wide text-fg-muted">{u.status}</span>
              </div>
              <span className="text-[11px] text-fg-muted">
                {u.item_count} ítems · {u.total_quantity.toLocaleString("es-AR")} unidades
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Descripción</th>
                    <th>Lote previsto (FEFO)</th>
                    <th className="text-right">Cantidad</th>
                    <th>Ubicación</th>
                  </tr>
                </thead>
                <tbody>
                  {u.items.map((it) => (
                    <tr key={it.allocation_id}>
                      <td className="font-mono text-xs font-semibold">{it.sku}</td>
                      <td className="text-sm">{it.description}</td>
                      <td className="font-mono text-[11px] text-fg-secondary">{it.lot_number ?? "sin lote"}</td>
                      <td className="text-right tabular">{it.quantity.toLocaleString("es-AR")}</td>
                      <td className="font-mono text-[11px] text-fg-secondary">{it.location.full_code ?? "—"}</td>
                    </tr>
                  ))}
                  {u.items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center text-fg-muted py-4 text-xs">Bulto sin contenido.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {panel.units.length === 0 && (
          <div className="nx-surface card card-pad text-center text-fg-muted text-sm">
            El pedido no tiene bultos para despachar.
          </div>
        )}
      </div>
    </div>
  );
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
