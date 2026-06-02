import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listInventory } from "@/lib/wms/data";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Inventario · WMS" };
export const dynamic = "force-dynamic";

export default async function InventarioPage() {
  let rows: Awaited<ReturnType<typeof listInventory>>;
  try {
    rows = await listInventory();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Inventario no disponible"
        migration="0024_wms_inventory"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">WMS · Depósito</div>
          <h1 className="page-title">Inventario</h1>
          <p className="page-subtitle">
            Stock de mercadería de terceros con trazabilidad por lote, vencimiento
            y ubicación física en el Digital Twin.
          </p>
        </div>
        <Link href="/wms" className="btn btn-ghost btn-sm mt-1">
          <Icon name="arrow-left" size={12} /> Dashboard
        </Link>
      </div>

      <div className="nx-surface card overflow-hidden">
        <div className="px-4 py-3 border-b border-stroke-soft">
          <h2 className="text-sm font-semibold">Stock cargado</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Descripción</th>
                <th>Cliente</th>
                <th>Lote</th>
                <th>Vencimiento</th>
                <th className="text-right">Stock</th>
                <th>Ubicación física</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs font-semibold">{r.sku}</td>
                  <td className="text-sm">{r.description}</td>
                  <td className="text-xs text-fg-secondary">{r.client_name}</td>
                  <td className="font-mono text-[11px] text-fg-secondary">
                    {r.lot_count > 1 ? `${r.lot_count} lotes` : r.lot_number ?? "—"}
                  </td>
                  <td className="text-xs">{r.expiration_date ? fmtDate(r.expiration_date) : "—"}</td>
                  <td className="text-right tabular font-semibold text-fg-brand">
                    {r.stock_available.toLocaleString("es-AR")}
                    {r.stock_reserved > 0 && (
                      <div className="text-[10px] text-status-warning font-normal">
                        {r.stock_reserved.toLocaleString("es-AR")} reservado
                      </div>
                    )}
                  </td>
                  <td>
                    {r.position_id ? (
                      <Link
                        href={`/operaciones/mapa-inteligente?pos=${r.position_id}`}
                        className="btn btn-ghost btn-sm"
                        title={r.position_full_code ?? undefined}
                      >
                        <Icon name="pin" size={12} />
                        <span className="font-mono text-[11px]">
                          {r.position_full_code ?? "Ver ubicación física"}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-xs text-fg-muted">Sin ubicar</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-fg-muted py-8 text-sm">
                    Aún no hay inventario cargado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-fg-muted mt-4">
        El botón <strong>Ver ubicación física</strong> abre el{" "}
        <Link href="/operaciones/mapa-inteligente" className="underline">
          Mapa Inteligente
        </Link>{" "}
        resaltando la posición (<code className="font-mono text-[11px]">?pos=&lt;id&gt;</code>).
      </p>
    </div>
  );
}
