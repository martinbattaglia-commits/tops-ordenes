import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/Icon";
import { listPackBoard } from "@/lib/packing/packing";
import { ORDER_STATUS_META } from "@/lib/pedidos/types";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { PackBoard } from "../_components/PackBoard";

export const metadata = { title: "Armado de bultos · WMS" };
export const dynamic = "force-dynamic";

/** Prioridad del pedido → etiqueta visual (mayor = antes). */
function priorityMeta(p: number): { label: string; color: string } {
  if (p > 0) return { label: "Alta", color: "#dc2626" };
  if (p < 0) return { label: "Baja", color: "#9ca3af" };
  return { label: "Normal", color: "#6b7280" };
}

export default async function PackRoutePage({ params }: { params: { id: string } }) {
  let board: Awaited<ReturnType<typeof listPackBoard>>;
  try {
    board = await listPackBoard(params.id);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Armado de bultos no disponible"
        migration="0033_wms_packing"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }
  if (!board) notFound();

  // KPIs por LÍNEA (D1), derivadas del tablero (alcance de packing = pickeado/empacado).
  const pendingLineIds = new Set(board.pending_stops.map((s) => s.order_item_id));
  const unitLineIds = new Set(board.units.flatMap((u) => u.items.map((i) => i.order_item_id)));
  const allLineIds = new Set<string>([...pendingLineIds, ...unitLineIds]);
  const totalLines = allLineIds.size;
  const pendingLines = pendingLineIds.size;
  const packedLines = totalLines - pendingLines;
  const coverage = totalLines > 0 ? Math.round((packedLines / totalLines) * 100) : 0;

  const totalUnits = board.units.length;
  const closedUnits = board.units.filter((u) => u.status === "cerrada").length;

  const meta = ORDER_STATUS_META[board.status];
  const pm = priorityMeta(board.priority);

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">WMS · Packing</div>
          <h1 className="page-title flex items-center gap-3">
            {board.public_id}
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
          <p className="page-subtitle">{board.client_name}</p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <Link href="/wms/packing" className="btn btn-ghost btn-sm">
            <Icon name="arrow-left" size={12} /> Volver
          </Link>
        </div>
      </div>

      {/* KPIs (por línea + bultos) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <Stat label="Líneas totales" value={String(totalLines)} index={0} />
        <Stat label="Líneas por empacar" value={String(pendingLines)} index={1} />
        <Stat label="Líneas empacadas" value={`${packedLines} / ${totalLines}`} index={2} />
        <Stat label="Cobertura Packing" value={`${coverage}%`} index={3} color={coverageColor(coverage)} />
        <Stat label="Bultos armados" value={`${closedUnits} / ${totalUnits}`} index={4} />
      </div>

      <PackBoard
        orderId={board.order_id}
        status={board.status}
        pendingStops={board.pending_stops}
        units={board.units}
      />
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
