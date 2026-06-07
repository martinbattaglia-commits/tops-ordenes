import { StatusPill } from "@/components/tesoreria/ui";
import { fmtCurrency, fmtDate } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { listMovements } from "@/lib/tesoreria/data";

export const metadata = { title: "Movimientos · Tesorería" };
export const dynamic = "force-dynamic";

export default async function MovimientosPage() {
  try {
    const movements = await listMovements({ limit: 200 });

    return (
      <div className="p-4 lg:p-8 nx-page-fade">
        <div className="page-header">
          <div>
            <div className="eyebrow-tiny">Finanzas · Tesorería</div>
            <h1 className="page-title">Movimientos</h1>
            <p className="page-subtitle">Libro único de movimientos (fuente de verdad). Solo confirmados impactan saldos.</p>
          </div>
        </div>

        <div className="card p-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="py-1">Fecha</th>
                <th className="py-1">Comprobante</th>
                <th className="py-1">Tipo</th>
                <th className="py-1">Dirección</th>
                <th className="py-1 text-right">Importe</th>
                <th className="py-1">Estado</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-fg-muted">Sin movimientos.</td></tr>
              )}
              {movements.map((m) => (
                <tr key={m.id} className="border-t">
                  <td className="py-2">{fmtDate(m.date)}</td>
                  <td className="py-2 tabular">{m.public_id}</td>
                  <td className="py-2">{m.type}</td>
                  <td className="py-2">{m.direction}</td>
                  <td className="py-2 text-right tabular">{fmtCurrency(m.amount)}</td>
                  <td className="py-2"><StatusPill status={m.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  } catch (e) {
    return (
      <ModuleUnavailable title="Movimientos no disponibles" migration="0053_treasury_core" detail={e instanceof Error ? e.message : String(e)} />
    );
  }
}
