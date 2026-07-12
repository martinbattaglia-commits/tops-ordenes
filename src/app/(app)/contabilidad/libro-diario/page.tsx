import { canAccess } from "@/lib/rbac/guard";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getLibroDiario } from "@/lib/contabilidad/data";
import { SOURCE_TYPE_LABEL, type LibroDiarioFilters, type LibroDiarioRow } from "@/lib/contabilidad/types";
import { fmtMoney } from "@/lib/utils";
import { SimulationBanner } from "../_components/SimulationBanner";

export const metadata = { title: "Libro Diario" };
export const dynamic = "force-dynamic";

function firstOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function LibroDiarioPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  if (!(await canAccess("contabilidad.view"))) {
    return <AccesoRestringido modulo="Contabilidad · Libro Diario" />;
  }

  const sp = searchParams ?? {};
  const pick = (k: string): string | null => {
    const v = sp[k];
    return typeof v === "string" && v.length > 0 ? v : null;
  };

  const filters: LibroDiarioFilters = {
    desde: pick("desde") ?? firstOfYear(),
    hasta: pick("hasta") ?? todayStr(),
    sourceType: pick("source"),
  };

  let rows: LibroDiarioRow[];
  try {
    rows = await getLibroDiario(filters);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Libro Diario no disponible"
        migration="0084_accounting_views"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  // Agrupar líneas por asiento para render con cabecera de asiento.
  const asientos: Array<{ key: string; head: LibroDiarioRow; lines: LibroDiarioRow[] }> = [];
  for (const r of rows) {
    const last = asientos[asientos.length - 1];
    if (last && last.key === r.entry_id) last.lines.push(r);
    else asientos.push({ key: r.entry_id, head: r, lines: [r] });
  }

  return (
    <div className="p-4 lg:p-8">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Contabilidad · F6</div>
          <h1 className="page-title">Libro Diario</h1>
          <p className="page-subtitle">
            Asientos posteados con trazabilidad al comprobante de origen
            ({rows.length === 0 ? "sin movimientos" : `${asientos.length} asientos · ${rows.length} líneas`}).
          </p>
        </div>
      </div>

      <SimulationBanner />

      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3" style={{ padding: "12px 16px" }}>
        <label className="text-xs text-fg-muted">
          Desde
          <input type="date" name="desde" defaultValue={filters.desde} className="input block mt-1" />
        </label>
        <label className="text-xs text-fg-muted">
          Hasta
          <input type="date" name="hasta" defaultValue={filters.hasta} className="input block mt-1" />
        </label>
        <label className="text-xs text-fg-muted">
          Comprobante
          <select name="source" defaultValue={filters.sourceType ?? ""} className="input block mt-1">
            <option value="">Todos</option>
            {Object.entries(SOURCE_TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-ghost btn-sm">Filtrar</button>
      </form>

      {asientos.length === 0 ? (
        <div className="card" style={{ padding: "24px" }}>
          <p className="text-sm text-fg-muted">
            El Libro Diario está vacío: el motor contable nunca posteó un asiento
            (modo SIMULACIÓN, comportamiento esperado). Los comprobantes que el motor
            asentaría al activarse están en{" "}
            <a href="/contabilidad/comprobantes-sin-asiento" className="text-fg-link underline">
              Comprobantes sin asiento
            </a>.
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border, #e5e7eb)", textAlign: "left" }}>
                  <th style={{ padding: "10px 12px", width: 90 }}>Cuenta</th>
                  <th style={{ padding: "10px 12px" }}>Detalle</th>
                  <th style={{ padding: "10px 12px", width: 130, textAlign: "right" }}>Debe</th>
                  <th style={{ padding: "10px 12px", width: 130, textAlign: "right" }}>Haber</th>
                  <th style={{ padding: "10px 12px", width: 140 }}>Centro de costo</th>
                </tr>
              </thead>
              <tbody>
                {asientos.map((a) => (
                  <AsientoGroup key={a.key} head={a.head} lines={a.lines} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function AsientoGroup({ head, lines }: { head: LibroDiarioRow; lines: LibroDiarioRow[] }) {
  const totalDebe = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
  const totalHaber = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
  return (
    <>
      <tr style={{ background: "var(--surface-2, #f9fafb)" }}>
        <td colSpan={5} style={{ padding: "8px 12px", fontSize: 12 }}>
          <span className="font-semibold text-fg-primary">Asiento Nº {head.entry_number}</span>
          <span className="text-fg-muted"> · {head.entry_date} · {SOURCE_TYPE_LABEL[head.source_type] ?? head.source_type}</span>
          {head.asiento_descripcion && <span className="text-fg-muted"> · {head.asiento_descripcion}</span>}
          <span className="text-fg-muted"> · estado: {head.status}</span>
        </td>
      </tr>
      {lines.map((l) => (
        <tr key={`${l.entry_id}-${l.line_no}`} style={{ borderBottom: "1px solid var(--border-soft, #f1f3f5)" }}>
          <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums" }} className="text-fg-muted">
            {l.cuenta_codigo}
          </td>
          <td style={{ padding: "8px 12px", paddingLeft: (l.credit ?? 0) > 0 ? 32 : 12 }}>
            {l.cuenta_nombre}
            {l.linea_descripcion && <span className="text-xs text-fg-muted"> — {l.linea_descripcion}</span>}
          </td>
          <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {(l.debit ?? 0) > 0 ? fmtMoney(l.debit) : ""}
          </td>
          <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {(l.credit ?? 0) > 0 ? fmtMoney(l.credit) : ""}
          </td>
          <td style={{ padding: "8px 12px" }} className="text-xs text-fg-muted">
            {l.centro_costo ?? "—"}
          </td>
        </tr>
      ))}
      <tr style={{ borderBottom: "1px solid var(--border, #e5e7eb)" }}>
        <td colSpan={2} style={{ padding: "6px 12px", fontSize: 12, textAlign: "right" }} className="text-fg-muted">
          Totales del asiento
        </td>
        <td style={{ padding: "6px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
          {fmtMoney(totalDebe)}
        </td>
        <td style={{ padding: "6px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
          {fmtMoney(totalHaber)}
        </td>
        <td />
      </tr>
    </>
  );
}
