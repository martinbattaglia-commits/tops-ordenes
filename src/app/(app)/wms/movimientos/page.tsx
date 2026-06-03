import { Icon } from "@/components/Icon";
import { listMovements } from "@/lib/wms/movements";
import type { MovementRow, MovementType } from "@/lib/wms/types";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Movimientos · WMS" };
export const dynamic = "force-dynamic";

const TYPE_META: Record<MovementType, { label: string; color: string }> = {
  ingreso: { label: "Ingreso", color: "#16a34a" },
  traslado: { label: "Traslado", color: "#2563eb" },
  egreso: { label: "Egreso", color: "#dc2626" },
  ajuste: { label: "Ajuste", color: "#d97706" },
};

export default async function MovimientosPage() {
  let rows: MovementRow[];
  try {
    rows = await listMovements();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Movimientos no disponibles"
        migration="0026_inventory_movements"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">WMS · Depósito</div>
          <h1 className="page-title">Movimientos</h1>
          <p className="page-subtitle">
            Historial de todos los movimientos de stock (ingresos, traslados, egresos y ajustes).
          </p>
        </div>
      </div>

      {/* Aviso de inmutabilidad */}
      <div className="nx-surface card card-pad mb-4 flex items-start gap-3 border-stroke-soft">
        <Icon name="lock" size={18} className="text-fg-brand mt-0.5 flex-shrink-0" />
        <div className="text-sm text-fg-secondary">
          <strong className="text-fg-brand">Libro de auditoría inmutable.</strong> Este historial
          es append-only: <strong>no se edita</strong> y <strong>no se elimina</strong> (garantizado
          a nivel de base de datos). Toda corrección se registra como un movimiento nuevo. Es la
          auditoría oficial del inventario.
        </div>
      </div>

      <div className="nx-surface card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>SKU</th>
                <th className="text-right">Cantidad</th>
                <th className="text-right">Antes → Después</th>
                <th>Origen → Destino</th>
                <th>Motivo / Notas</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const meta = TYPE_META[m.movement_type];
                return (
                  <tr key={m.id}>
                    <td className="text-xs whitespace-nowrap">{fmtDate(m.created_at)}</td>
                    <td>
                      <span
                        className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                        style={{ background: `${meta.color}1a`, color: meta.color }}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td className="font-mono text-xs font-semibold">{m.sku ?? "—"}</td>
                    <td className="text-right tabular">{m.quantity.toLocaleString("es-AR")}</td>
                    <td className="text-right tabular text-xs text-fg-secondary">
                      {m.before_quantity.toLocaleString("es-AR")} → {m.after_quantity.toLocaleString("es-AR")}
                    </td>
                    <td className="text-[11px] font-mono text-fg-secondary">
                      <span>{m.from_full_code ?? "externo"}</span>
                      <Icon name="arrow-right" size={10} className="inline mx-1 text-fg-muted" />
                      <span>{m.to_full_code ?? "externo"}</span>
                    </td>
                    <td className="text-xs text-fg-secondary max-w-[260px]">
                      <div>{m.reason ?? "—"}</div>
                      {m.notes && <div className="text-[11px] text-fg-muted italic">{m.notes}</div>}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-fg-muted py-8 text-sm">
                    Aún no hay movimientos registrados.
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
