import { fmtCurrency } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getMayor, getPlanCuentas } from "@/lib/contabilidad/data";
import type { MayorRow } from "@/lib/contabilidad/types";

export const metadata = { title: "Mayor por cuenta" };
export const dynamic = "force-dynamic";

export default async function MayorPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const cuenta = typeof searchParams?.cuenta === "string" ? searchParams.cuenta : null;

  let rows: MayorRow[];
  let cuentas;
  try {
    [rows, cuentas] = await Promise.all([
      cuenta ? getMayor(cuenta) : Promise.resolve([]),
      getPlanCuentas(),
    ]);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Mayor no disponible"
        migration="0086_accounting_reports"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const imputables = cuentas.filter((c) => c.isPostable);

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-fg-brand">Mayor por cuenta</h1>
        <p className="text-sm text-fg-secondary">Movimientos de una cuenta con saldo acumulado.</p>
      </header>

      <form className="card p-4 flex flex-wrap items-end gap-3" method="get">
        <label className="text-sm">
          <span className="block text-fg-muted mb-1">Cuenta</span>
          <select
            name="cuenta"
            defaultValue={cuenta ?? ""}
            className="border border-border-subtle rounded px-3 py-2 min-w-[280px]"
          >
            <option value="">— Elegí una cuenta —</option>
            {imputables.map((c) => (
              <option key={c.id} value={c.code}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-primary px-4 py-2 rounded">
          Ver mayor
        </button>
      </form>

      {!cuenta ? (
        <div className="card p-8 text-sm text-fg-secondary">Seleccioná una cuenta para ver su mayor.</div>
      ) : rows.length === 0 ? (
        <div className="card p-8 text-sm text-fg-secondary">Sin movimientos para {cuenta}.</div>
      ) : (
        <div className="card overflow-x-auto">
          <div className="px-4 py-2 border-b border-border-subtle font-semibold text-fg-brand">
            {rows[0].cuentaCodigo} · {rows[0].cuentaNombre}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted border-b border-border-subtle">
                <th className="p-3">Fecha</th>
                <th className="p-3">Asiento</th>
                <th className="p-3">Detalle</th>
                <th className="p-3 text-right">Debe</th>
                <th className="p-3 text-right">Haber</th>
                <th className="p-3 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-border-subtle/40">
                  <td className="p-3">{r.entryDate}</td>
                  <td className="p-3">N° {r.entryNumber ?? "—"}</td>
                  <td className="p-3 text-fg-secondary">{r.lineaDescripcion}</td>
                  <td className="p-3 text-right">{r.debit ? fmtCurrency(r.debit) : ""}</td>
                  <td className="p-3 text-right">{r.credit ? fmtCurrency(r.credit) : ""}</td>
                  <td className="p-3 text-right font-medium">{fmtCurrency(r.saldoAcumulado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
