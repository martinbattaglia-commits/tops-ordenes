import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listLots, getExpiryKpis, type LotFilters } from "@/lib/wms/lots";
import { EXPIRY_STATUS_META, type LotInventoryRow } from "@/lib/wms/types";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Lotes · WMS" };
export const dynamic = "force-dynamic";

function s(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

export default async function LotesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const filters: LotFilters = {
    cliente: s(searchParams.cliente) || null,
    sku: s(searchParams.sku) || null,
    lote: s(searchParams.lote) || null,
  };

  let rows: LotInventoryRow[];
  try {
    rows = await listLots(filters);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Lotes no disponibles"
        migration="0024_wms_inventory"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const kpis = getExpiryKpis(rows);
  const hasFilters = Boolean(filters.cliente || filters.sku || filters.lote);

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">WMS · Depósito</div>
          <h1 className="page-title">Lotes</h1>
          <p className="page-subtitle">
            Trazabilidad por lote: origen, vencimiento, cantidad y ubicación física.
            Orden <strong>FEFO</strong> (First Expired First Out).
          </p>
        </div>
        <Link href="/wms/vencimientos" className="btn btn-ghost btn-sm mt-1">
          <Icon name="clock" size={12} /> Vencimientos
        </Link>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <Stat label="Total de lotes" value={kpis.totalLotes} sub="en el listado" index={0} />
        <Stat label="Próximos a vencer" value={kpis.proximosAVencer} sub="≤ 180 días" index={1} />
        <Stat label="Vencidos" value={kpis.vencidos} sub="ya vencidos" index={2} />
        <Stat label="Clientes afectados" value={kpis.clientesAfectados} sub="con riesgo" index={3} />
        <Stat label="Unidades comprometidas" value={kpis.unidadesComprometidas} sub="vencido + próximo" index={4} />
      </div>

      {/* Filtros (GET form · server-side, sin JS) */}
      <form method="get" className="flex flex-wrap items-end gap-2 mb-4">
        <Field name="cliente" label="Cliente" value={filters.cliente} />
        <Field name="sku" label="SKU" value={filters.sku} />
        <Field name="lote" label="Lote" value={filters.lote} />
        <button type="submit" className="btn btn-primary btn-sm">
          <Icon name="filter" size={12} /> Filtrar
        </button>
        {hasFilters && (
          <Link href="/wms/lotes" className="btn btn-ghost btn-sm">
            <Icon name="x" size={12} /> Limpiar
          </Link>
        )}
      </form>

      <div className="nx-surface card overflow-hidden">
        <div className="px-4 py-3 border-b border-stroke-soft flex items-center justify-between">
          <h2 className="text-sm font-semibold">Lotes en stock</h2>
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded bg-bg-surface-alt text-fg-secondary">
            Orden FEFO
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>SKU</th>
                <th>Descripción</th>
                <th>Lote</th>
                <th>Vencimiento</th>
                <th className="text-right">Cantidad</th>
                <th>Ubicación física</th>
                <th>Estado</th>
                <th className="text-right">Días</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.lot_id}>
                  <td className="text-xs text-fg-secondary">{r.client_name}</td>
                  <td className="font-mono text-xs font-semibold">{r.sku}</td>
                  <td className="text-sm">{r.description}</td>
                  <td className="font-mono text-[11px] text-fg-secondary">{r.lot_number || "—"}</td>
                  <td className="text-xs">{r.expiration_date ? fmtDate(r.expiration_date) : "—"}</td>
                  <td className="text-right tabular font-semibold text-fg-brand">
                    {r.quantity.toLocaleString("es-AR")}
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
                          {r.position_full_code ?? "Ver ubicación"}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-xs text-fg-muted">Sin ubicar</span>
                    )}
                  </td>
                  <td>
                    {(() => {
                      const b = lotEstadoBadge(r);
                      return (
                        <span
                          className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                          style={{ background: `${b.color}1a`, color: b.color }}
                        >
                          {b.label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="text-right tabular text-xs">
                    <span style={r.expiry_status ? { color: EXPIRY_STATUS_META[r.expiry_status].color } : undefined}>
                      {r.days_left == null ? "—" : r.days_left}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center text-fg-muted py-8 text-sm">
                    {hasFilters ? "Sin lotes para los filtros aplicados." : "Aún no hay lotes cargados."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-fg-muted mt-4">
        La <strong>Cantidad</strong> refleja la acumulación de ingresos por lote; el descuento por
        egreso/despacho se habilita en una fase posterior (FASE 9D). Trazabilidad ANMAT en{" "}
        <Link href="/wms/vencimientos" className="underline">Vencimientos</Link>.
      </p>
    </div>
  );
}

/**
 * Badge de estado del lote: reutiliza la clasificación ANMAT del semáforo
 * (Vencido · Crítico · Próximo · A vigilar) y rotula "Activo" cuando el lote
 * está vigente (>180 días) o no tiene vencimiento.
 */
function lotEstadoBadge(r: LotInventoryRow): { label: string; color: string } {
  if (r.expiry_status && r.expiry_status !== "verde") {
    const m = EXPIRY_STATUS_META[r.expiry_status];
    return { label: m.label, color: m.color };
  }
  return { label: "Activo", color: EXPIRY_STATUS_META.verde.color };
}

function Field({ name, label, value }: { name: string; label: string; value: string | null | undefined }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="kpi-label">{label}</span>
      <input name={name} defaultValue={value ?? ""} className="input" placeholder={`Filtrar por ${label.toLowerCase()}…`} />
    </label>
  );
}

function Stat({ label, value, sub, index }: { label: string; value: number; sub: string; index: number }) {
  return (
    <div style={{ animationDelay: `${index * 45}ms` }} className="nx-surface nx-stagger card p-5">
      <div className="kpi-label">{label}</div>
      <div className="text-2xl font-bold tabular leading-none mt-1 text-fg-brand">
        {value.toLocaleString("es-AR")}
      </div>
      <div className="text-[11px] text-fg-muted mt-1">{sub}</div>
    </div>
  );
}
