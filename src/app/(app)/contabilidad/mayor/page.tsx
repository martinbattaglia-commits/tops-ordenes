import { canAccess } from "@/lib/rbac/guard";
import { AccesoRestringido } from "@/components/shell/AccesoRestringido";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { listChartOfAccounts } from "@/lib/erp/accounting-data";
import type { ChartAccount } from "@/lib/erp/types";
import { getLibroMayor } from "@/lib/contabilidad/data";
import type { LibroMayorFilters, LibroMayorRow } from "@/lib/contabilidad/types";
import { fmtMoney } from "@/lib/utils";
import { SimulationBanner } from "../_components/SimulationBanner";

export const metadata = { title: "Libro Mayor" };
export const dynamic = "force-dynamic";

function firstOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function LibroMayorPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  if (!(await canAccess("contabilidad.view"))) {
    return <AccesoRestringido modulo="Contabilidad · Libro Mayor" />;
  }

  const sp = searchParams ?? {};
  const pick = (k: string): string | null => {
    const v = sp[k];
    return typeof v === "string" && v.length > 0 ? v : null;
  };

  const filters: LibroMayorFilters = {
    accountId: pick("cuenta"),
    desde: pick("desde") ?? firstOfYear(),
    hasta: pick("hasta") ?? todayStr(),
  };

  let cuentas: ChartAccount[];
  let rows: LibroMayorRow[];
  try {
    [cuentas, rows] = await Promise.all([
      listChartOfAccounts({ postableOnly: true }),
      getLibroMayor(filters),
    ]);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Libro Mayor no disponible"
        migration="0084_accounting_views"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const cuentaSel = cuentas.find((c) => c.id === filters.accountId) ?? null;

  return (
    <div className="p-4 lg:p-8">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Contabilidad · F6</div>
          <h1 className="page-title">Libro Mayor</h1>
          <p className="page-subtitle">
            Movimientos y saldo acumulado por cuenta imputable.
          </p>
        </div>
      </div>

      <SimulationBanner />

      <form method="get" className="card mb-4 flex flex-wrap items-end gap-3" style={{ padding: "12px 16px" }}>
        <label className="text-xs text-fg-muted" style={{ minWidth: 260 }}>
          Cuenta
          <select name="cuenta" defaultValue={filters.accountId ?? ""} className="input block mt-1 w-full">
            <option value="">Elegir cuenta…</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>{c.code} · {c.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-fg-muted">
          Desde
          <input type="date" name="desde" defaultValue={filters.desde} className="input block mt-1" />
        </label>
        <label className="text-xs text-fg-muted">
          Hasta
          <input type="date" name="hasta" defaultValue={filters.hasta} className="input block mt-1" />
        </label>
        <button type="submit" className="btn btn-ghost btn-sm">Consultar</button>
      </form>

      {!cuentaSel ? (
        <div className="card" style={{ padding: "24px" }}>
          <p className="text-sm text-fg-muted">Elegí una cuenta imputable para ver su mayor.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="card" style={{ padding: "24px" }}>
          <p className="text-sm text-fg-muted">
            La cuenta <strong>{cuentaSel.code} · {cuentaSel.name}</strong> no registra
            movimientos en el rango elegido. El motor contable nunca posteó
            (modo SIMULACIÓN, comportamiento esperado).
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
            <span className="text-sm font-semibold text-fg-primary">
              {cuentaSel.code} · {cuentaSel.name}
            </span>
            <span className="text-xs text-fg-muted"> · {rows.length} movimientos</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 680 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border, #e5e7eb)", textAlign: "left" }}>
                  <th style={{ padding: "10px 12px", width: 110 }}>Fecha</th>
                  <th style={{ padding: "10px 12px", width: 90 }}>Asiento</th>
                  <th style={{ padding: "10px 12px" }}>Detalle</th>
                  <th style={{ padding: "10px 12px", width: 130, textAlign: "right" }}>Debe</th>
                  <th style={{ padding: "10px 12px", width: 130, textAlign: "right" }}>Haber</th>
                  <th style={{ padding: "10px 12px", width: 150, textAlign: "right" }}>Saldo acumulado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.entry_id}-${r.entry_number}-${r.saldo_acumulado}`} style={{ borderBottom: "1px solid var(--border-soft, #f1f3f5)" }}>
                    <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums" }}>{r.entry_date}</td>
                    <td style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums" }} className="text-fg-muted">Nº {r.entry_number}</td>
                    <td style={{ padding: "8px 12px" }}>{r.linea_descripcion ?? "—"}</td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {(r.debit ?? 0) > 0 ? fmtMoney(r.debit) : ""}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {(r.credit ?? 0) > 0 ? fmtMoney(r.credit) : ""}
                    </td>
                    <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                      {fmtMoney(r.saldo_acumulado)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-fg-muted" style={{ padding: "8px 12px" }}>
            El saldo acumulado es histórico (desde el origen del libro), no por ejercicio.
          </p>
        </div>
      )}
    </div>
  );
}
