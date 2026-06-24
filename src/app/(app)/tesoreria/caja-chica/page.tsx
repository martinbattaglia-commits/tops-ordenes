import { fmtCurrency, fmtDate, fmtDateTime } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { listPeriodos, getResumen, listMovimientos } from "@/lib/tesoreria/caja-chica/data";
import {
  monthlyGasto,
  categoriaDistribution,
  distinctCategorias,
  filterMovimientos,
  conciliacionTone,
} from "@/lib/tesoreria/caja-chica/dashboard-logic";
import { ConciliacionBanner } from "@/components/tesoreria/caja-chica/ConciliacionBanner";
import { GastoMensualChart } from "@/components/tesoreria/caja-chica/GastoMensualChart";
import { CategoriaDonut } from "@/components/tesoreria/caja-chica/CategoriaDonut";

export const metadata = { title: "Caja Chica" };
export const dynamic = "force-dynamic";

type SP = { [k: string]: string | string[] | undefined };
const one = (sp: SP, k: string): string | undefined => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);

function KpiCard({ label, value, tone, sub }: { label: string; value: string; tone?: "ok" | "bad" | "warn" | "neutral"; sub?: string }) {
  const color =
    tone === "ok" ? "text-status-success" : tone === "bad" ? "text-tops-red" : tone === "warn" ? "text-status-warning" : "text-fg-brand";
  return (
    <div className="card p-5">
      <div className="text-eyebrow-sm uppercase text-fg-muted">{label}</div>
      <div className={`text-2xl lg:text-3xl font-bold tabular -tracking-[0.01em] ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-fg-muted mt-1">{sub}</div>}
    </div>
  );
}

export default async function CajaChicaPage({ searchParams }: { searchParams: SP }) {
  try {
    const periodos = await listPeriodos();
    const periodo = Number(one(searchParams, "periodo")) || periodos[0] || new Date().getFullYear();
    const [resumen, movs] = await Promise.all([getResumen(periodo), listMovimientos(periodo)]);

    const categorias = distinctCategorias(movs);
    const barras = monthlyGasto(movs);
    const dist = categoriaDistribution(movs);
    const tone = conciliacionTone(resumen);

    const cat = one(searchParams, "cat");
    const desde = one(searchParams, "desde");
    const hasta = one(searchParams, "hasta");
    const filtrados = filterMovimientos(movs, { categoria: cat, desde, hasta });

    const saldoExcel = resumen?.saldo_excel ?? null;
    const saldoCalc = resumen?.saldo_calculado ?? 0;
    const delta = resumen?.saldo_delta ?? null;
    const ctrl = "border border-stroke-soft rounded-md px-2 py-1 text-sm bg-transparent";

    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Finanzas · Tesorería</div>
            <h1 className="page-title">Caja Chica</h1>
            <p className="page-subtitle">
              Espejo de la planilla de Drive (solapa {periodo}). Los saldos se derivan en la base (vistas);
              Nexus no modifica el Excel.
            </p>
          </div>
        </div>

        <ConciliacionBanner resumen={resumen} tone={tone} />

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <KpiCard label="Saldo planilla" value={saldoExcel == null ? "—" : fmtCurrency(saldoExcel)} tone={saldoExcel != null && saldoExcel <= 0 ? "bad" : "ok"} />
          <KpiCard label="Saldo calculado" value={fmtCurrency(saldoCalc)} tone={saldoCalc <= 0 ? "bad" : "ok"} />
          <KpiCard label="Delta conciliación" value={delta == null ? "—" : fmtCurrency(delta)} tone={delta != null && delta !== 0 ? "warn" : "ok"} />
          <KpiCard label="Movimientos" value={String(resumen?.movimientos ?? 0)} tone="neutral" />
          <KpiCard label="Última sync" value={resumen?.ultima_sync ? fmtDateTime(resumen.ultima_sync) : "—"} tone="neutral" sub={resumen?.last_status ?? "sin sync"} />
        </div>

        <form method="get" className="card p-4 mb-6 flex flex-wrap items-end gap-3">
          <label className="text-xs text-fg-muted flex flex-col gap-1">
            Período
            <select name="periodo" defaultValue={String(periodo)} className={ctrl}>
              {(periodos.length ? periodos : [periodo]).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-fg-muted flex flex-col gap-1">
            Categoría
            <select name="cat" defaultValue={cat ?? ""} className={ctrl}>
              <option value="">Todas</option>
              {categorias.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-fg-muted flex flex-col gap-1">
            Desde
            <input type="date" name="desde" defaultValue={desde ?? ""} className={ctrl} />
          </label>
          <label className="text-xs text-fg-muted flex flex-col gap-1">
            Hasta
            <input type="date" name="hasta" defaultValue={hasta ?? ""} className={ctrl} />
          </label>
          <button type="submit" className="btn btn-primary btn-sm">Aplicar</button>
          <a href="/tesoreria/caja-chica" className="btn btn-sm">Limpiar</a>
        </form>

        <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)" }}>
          <GastoMensualChart data={barras} />
          <CategoriaDonut slices={dist} />
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Movimientos</h2>
            <span className="text-xs text-fg-muted tabular">{filtrados.length} de {movs.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fg-muted border-b">
                  <th className="py-1 pr-2">Fecha</th>
                  <th className="py-1 pr-2">Concepto</th>
                  <th className="py-1 pr-2">Categoría</th>
                  <th className="py-1 pr-2 text-right">Importe</th>
                  <th className="py-1">Dirección</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((m) => (
                  <tr key={m.id} className="border-t">
                    <td className="py-2 pr-2 whitespace-nowrap text-fg-secondary">{m.tx_date ? fmtDate(m.tx_date) : m.tx_date_raw || "—"}</td>
                    <td className="py-2 pr-2">{m.concepto}</td>
                    <td className="py-2 pr-2">
                      <span className="inline-block rounded-pill bg-neutral-100 text-fg-secondary px-2 py-0.5 text-[11px]">{m.categoria}</span>
                    </td>
                    <td className={`py-2 pr-2 text-right tabular whitespace-nowrap ${m.direction === "acreditado" ? "text-status-success" : "text-tops-red"}`}>
                      {m.direction === "acreditado" ? "+" : "−"}
                      {fmtCurrency(m.importe)}
                    </td>
                    <td className="py-2">
                      <span className={`rounded-pill px-2 py-0.5 text-[10px] uppercase font-bold ${m.direction === "acreditado" ? "bg-status-success text-white" : "bg-tops-red text-white"}`}>
                        {m.direction}
                      </span>
                    </td>
                  </tr>
                ))}
                {filtrados.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-fg-muted text-sm">
                      {movs.length === 0 ? "Aún no hay datos sincronizados para este ejercicio." : "Sin movimientos para los filtros aplicados."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Caja Chica no disponible"
        migration="0082_cash_box_foundation"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }
}
