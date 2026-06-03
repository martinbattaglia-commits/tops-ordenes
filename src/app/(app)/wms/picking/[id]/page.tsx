import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { listPickRoute } from "@/lib/picking/picking";
import type { PhysicalLocation } from "@/lib/picking/types";
import { ORDER_STATUS_META } from "@/lib/pedidos/types";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { PickStopButton, PickOrderButton } from "../_components/PickingActions";

export const metadata = { title: "Ruta de picking · WMS" };
export const dynamic = "force-dynamic";

/** Meta visual de las 2 estados relevantes en picking (inline, como /pedidos/[id]). */
const STOP_META: Record<"reservada" | "pickeada", { label: string; color: string }> = {
  reservada: { label: "Por pickear", color: "#ea580c" },
  pickeada: { label: "Pickeado", color: "#2563eb" },
};

/** Prioridad del pedido → etiqueta visual (mayor = antes). Preparado para waves. */
function priorityMeta(p: number): { label: string; color: string } {
  if (p > 0) return { label: "Alta", color: "#dc2626" };
  if (p < 0) return { label: "Baja", color: "#9ca3af" };
  return { label: "Normal", color: "#6b7280" };
}

/** Subtexto legible de la ubicación física (jerarquía completa). */
function locationDetail(l: PhysicalLocation): string {
  return [
    l.warehouse_code,
    l.floor_code && `Piso ${l.floor_code}`,
    l.sector_code,
    l.zone_code && `Pasillo ${l.zone_code}`,
    l.rack_code && `Rack ${l.rack_code}`,
    l.rack_level != null && `Nivel ${l.rack_level}`,
    l.position_code && `Pos ${l.position_code}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default async function PickRoutePage({ params }: { params: { id: string } }) {
  let route: Awaited<ReturnType<typeof listPickRoute>>;
  try {
    route = await listPickRoute(params.id);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Ruta de picking no disponible"
        migration="0032_wms_picking"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }
  if (!route) notFound();

  // Métricas por LÍNEA (order_item) derivadas de las paradas vivas.
  const lineIds = new Set(route.stops.map((st) => st.order_item_id));
  const pendingLineIds = new Set(
    route.stops.filter((st) => st.status === "reservada").map((st) => st.order_item_id)
  );
  const totalLines = lineIds.size;
  const pendingLines = pendingLineIds.size;
  const pickedLines = totalLines - pendingLines;
  const coverage = totalLines > 0 ? Math.round((pickedLines / totalLines) * 100) : 0;
  const pendingStops = route.stops.filter((st) => st.status === "reservada").length;

  const meta = ORDER_STATUS_META[route.status];
  const pm = priorityMeta(route.priority);

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">WMS · Picking</div>
          <h1 className="page-title flex items-center gap-3">
            {route.public_id}
            <span
              className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded"
              style={{ background: `${meta.color}1a`, color: meta.color }}
            >
              {meta.label}
            </span>
            <span
              className="text-[11px] font-bold uppercase tracking-wide px-2 py-1 rounded"
              style={{ background: `${pm.color}1a`, color: pm.color }}
              title="Prioridad del pedido"
            >
              Prioridad {pm.label}
            </span>
          </h1>
          <p className="page-subtitle">{route.client_name}</p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <Link href="/wms/picking" className="btn btn-ghost btn-sm">
            <Icon name="arrow-left" size={12} /> Volver
          </Link>
          <PickOrderButton orderId={route.order_id} pending={pendingStops} />
        </div>
      </div>

      {/* KPIs (lenguaje de líneas, alineado con Pedidos) — foco en el pedido */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Líneas totales" value={String(totalLines)} index={0} />
        <Stat label="Líneas pendientes" value={String(pendingLines)} index={1} />
        <Stat label="Líneas pickeadas" value={`${pickedLines} / ${totalLines}`} index={2} />
        <Stat label="Cobertura Picking" value={`${coverage}%`} index={3} color={coverageColor(coverage)} />
      </div>

      {/* Ruta de picking */}
      <div className="nx-surface card overflow-hidden">
        <div className="px-4 py-3 border-b border-stroke-soft flex items-center justify-between">
          <h2 className="text-sm font-semibold">Ruta de picking</h2>
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded bg-bg-surface-alt text-fg-secondary">
            Recorrido por ubicación física
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Prioridad</th>
                <th>Ubicación</th>
                <th>SKU</th>
                <th>Descripción</th>
                <th>Lote</th>
                <th className="text-right">Cantidad</th>
                <th>Estado</th>
                <th className="text-right">Acción</th>
              </tr>
            </thead>
            <tbody>
              {route.stops.map((st, i) => {
                const sm = STOP_META[st.status === "pickeada" ? "pickeada" : "reservada"];
                return (
                  <tr key={st.allocation_id}>
                    <td className="tabular text-xs text-fg-muted">{i + 1}</td>
                    <td>
                      <span
                        className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                        style={{ background: `${pm.color}1a`, color: pm.color }}
                      >
                        {pm.label}
                      </span>
                    </td>
                    <td>
                      <div className="font-mono text-[11px]">{st.location.full_code ?? "—"}</div>
                      <div className="text-[10px] text-fg-muted">{locationDetail(st.location) || "Sin ubicación"}</div>
                    </td>
                    <td className="font-mono text-xs font-semibold">{st.sku}</td>
                    <td className="text-sm">{st.description}</td>
                    <td className="font-mono text-[11px] text-fg-secondary">{st.lot_number ?? "—"}</td>
                    <td className="text-right tabular">{st.quantity.toLocaleString("es-AR")}</td>
                    <td>
                      <span
                        className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                        style={{ background: `${sm.color}1a`, color: sm.color }}
                      >
                        {sm.label}
                      </span>
                    </td>
                    <td className="text-right">
                      <PickStopButton allocationId={st.allocation_id} orderId={route.order_id} status={st.status} />
                    </td>
                  </tr>
                );
              })}
              {route.stops.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center text-fg-muted py-8 text-sm">
                    Este pedido no tiene reservas para pickear.
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
