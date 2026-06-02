import Link from "next/link";
import { Icon } from "@/components/Icon";
import { listExpiries, getExpiryKpis, type LotFilters } from "@/lib/wms/lots";
import {
  EXPIRY_STATUS_META,
  EXPIRY_THRESHOLDS,
  type ExpiryThresholds,
  type ExpiryStatus,
  type LotInventoryRow,
} from "@/lib/wms/types";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Vencimientos · WMS" };
export const dynamic = "force-dynamic";

function s(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

/** Lee overrides de umbrales del query (?rojo=&naranja=&amarillo=); default ANMAT. */
function parseThresholds(sp: Record<string, string | string[] | undefined>): ExpiryThresholds {
  const num = (k: string, d: number) => {
    const n = Number(s(sp[k]));
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    rojo: num("rojo", EXPIRY_THRESHOLDS.rojo),
    naranja: num("naranja", EXPIRY_THRESHOLDS.naranja),
    amarillo: num("amarillo", EXPIRY_THRESHOLDS.amarillo),
  };
}

const ORDER: ExpiryStatus[] = ["vencido", "rojo", "naranja", "amarillo", "verde"];

export default async function VencimientosPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const filters: LotFilters = {
    cliente: s(searchParams.cliente) || null,
    sku: s(searchParams.sku) || null,
    lote: s(searchParams.lote) || null,
  };
  const thresholds = parseThresholds(searchParams);

  let rows: LotInventoryRow[];
  try {
    rows = await listExpiries(filters, thresholds);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Vencimientos no disponibles"
        migration="0024_wms_inventory"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const kpis = getExpiryKpis(rows);
  const hasFilters = Boolean(filters.cliente || filters.sku || filters.lote);

  // Querystring para el export (conserva filtros + umbrales)
  const qs = new URLSearchParams();
  if (filters.cliente) qs.set("cliente", filters.cliente);
  if (filters.sku) qs.set("sku", filters.sku);
  if (filters.lote) qs.set("lote", filters.lote);
  qs.set("rojo", String(thresholds.rojo));
  qs.set("naranja", String(thresholds.naranja));
  qs.set("amarillo", String(thresholds.amarillo));

  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">WMS · Compliance ANMAT</div>
          <h1 className="page-title">Vencimientos</h1>
          <p className="page-subtitle">
            Control de vencimiento con criterio ANMAT. Semáforo por días restantes.
            Orden <strong>FEFO</strong> (First Expired First Out).
          </p>
        </div>
        <a href={`/wms/vencimientos/export?${qs.toString()}`} className="btn btn-primary btn-sm mt-1">
          <Icon name="download" size={14} /> Exportar CSV
        </a>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-4">
        <Stat label="Total de lotes" value={kpis.totalLotes} sub="con vencimiento" index={0} />
        <Stat label="Próximos a vencer" value={kpis.proximosAVencer} sub="≤ 180 días" index={1} />
        <Stat label="Vencidos" value={kpis.vencidos} sub="ya vencidos" index={2} />
        <Stat label="Clientes afectados" value={kpis.clientesAfectados} sub="con riesgo" index={3} />
        <Stat label="Unidades comprometidas" value={kpis.unidadesComprometidas} sub="vencido + próximo" index={4} />
      </div>

      {/* Leyenda del semáforo */}
      <div className="flex flex-wrap gap-2 mb-4">
        {ORDER.map((st) => {
          const m = EXPIRY_STATUS_META[st];
          return (
            <span key={st} className="inline-flex items-center gap-1.5 text-[11px] text-fg-secondary">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: m.color }} />
              {m.label} <span className="text-fg-muted">({m.rango})</span>
            </span>
          );
        })}
      </div>

      {/* Filtros */}
      <form method="get" className="flex flex-wrap items-end gap-2 mb-4">
        <Field name="cliente" label="Cliente" value={filters.cliente} />
        <Field name="sku" label="SKU" value={filters.sku} />
        <Field name="lote" label="Lote" value={filters.lote} />
        <button type="submit" className="btn btn-primary btn-sm">
          <Icon name="filter" size={12} /> Filtrar
        </button>
        {hasFilters && (
          <Link href="/wms/vencimientos" className="btn btn-ghost btn-sm">
            <Icon name="x" size={12} /> Limpiar
          </Link>
        )}
      </form>

      <div className="nx-surface card overflow-hidden">
        <div className="px-4 py-3 border-b border-stroke-soft flex items-center justify-between">
          <h2 className="text-sm font-semibold">Lotes con vencimiento</h2>
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded bg-bg-surface-alt text-fg-secondary">
            Orden FEFO
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th></th>
                <th>Cliente</th>
                <th>SKU</th>
                <th>Descripción</th>
                <th>Lote</th>
                <th>Vencimiento</th>
                <th className="text-right">Días</th>
                <th className="text-right">Cantidad</th>
                <th>Ubicación física</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const meta = r.expiry_status ? EXPIRY_STATUS_META[r.expiry_status] : null;
                return (
                  <tr key={r.lot_id}>
                    <td>
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full"
                        style={{ background: meta?.color ?? "#9ca3af" }}
                        title={meta?.label}
                      />
                    </td>
                    <td className="text-xs text-fg-secondary">{r.client_name}</td>
                    <td className="font-mono text-xs font-semibold">{r.sku}</td>
                    <td className="text-sm">{r.description}</td>
                    <td className="font-mono text-[11px] text-fg-secondary">{r.lot_number || "—"}</td>
                    <td className="text-xs">{r.expiration_date ? fmtDate(r.expiration_date) : "—"}</td>
                    <td className="text-right tabular text-xs font-semibold" style={meta ? { color: meta.color } : undefined}>
                      {r.days_left == null ? "—" : r.days_left}
                    </td>
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
                      {meta && (
                        <span
                          className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded"
                          style={{ background: `${meta.color}1a`, color: meta.color }}
                        >
                          {meta.label}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center text-fg-muted py-8 text-sm">
                    {hasFilters ? "Sin lotes para los filtros aplicados." : "No hay lotes con vencimiento cargados."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-fg-muted mt-4">
        Umbrales configurables por query: <code className="font-mono text-[11px]">?rojo=30&amp;naranja=90&amp;amarillo=180</code>.
        La <strong>Cantidad</strong> es la acumulación de ingresos por lote; el descuento por egreso/despacho llega en FASE 9D.
      </p>
    </div>
  );
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
