import { fmtCurrency } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getTarifasVigentes, getTarifasVencidas } from "@/lib/contabilidad/data";

export const metadata = { title: "Tarifas por cliente" };
export const dynamic = "force-dynamic";

export default async function TarifasPage() {
  let vigentes, vencidas;
  try {
    [vigentes, vencidas] = await Promise.all([getTarifasVigentes(), getTarifasVencidas()]);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Tarifas no disponibles"
        migration="0097_customer_service_rates"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  return (
    <div className="p-4 lg:p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-fg-brand">Tarifas por cliente</h1>
        <p className="text-sm text-fg-secondary">
          Matriz de tarifas (cliente × servicio) con vigencia. Sin solapamientos activos (enforced en DB).
        </p>
      </header>

      <section className="card overflow-x-auto">
        <div className="px-4 py-2 border-b border-border-subtle font-semibold text-fg-brand">
          Vigentes ({vigentes.length})
        </div>
        {vigentes.length === 0 ? (
          <div className="p-6 text-sm text-fg-secondary">Sin tarifas vigentes.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted border-b border-border-subtle">
                <th className="p-3">Cliente</th>
                <th className="p-3">Servicio</th>
                <th className="p-3 text-right">Precio</th>
                <th className="p-3 text-right">IVA %</th>
                <th className="p-3">Frecuencia</th>
                <th className="p-3">Desde</th>
                <th className="p-3">Hasta</th>
              </tr>
            </thead>
            <tbody>
              {vigentes.map((r) => (
                <tr key={r.rateId} className="border-b border-border-subtle/50">
                  <td className="p-3">{r.cliente}</td>
                  <td className="p-3"><span className="font-mono text-xs text-fg-muted">{r.servicioCode}</span> {r.servicio}</td>
                  <td className="p-3 text-right">{fmtCurrency(r.unitPrice)}</td>
                  <td className="p-3 text-right">{r.vatRate}</td>
                  <td className="p-3 text-fg-muted">{r.billingFrequency}</td>
                  <td className="p-3">{r.validFrom}</td>
                  <td className="p-3">{r.validTo ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card overflow-x-auto">
        <div className="px-4 py-2 border-b border-border-subtle font-semibold text-fg-brand">
          Vencidas / a renovar ({vencidas.length})
        </div>
        {vencidas.length === 0 ? (
          <div className="p-6 text-sm text-status-success">✓ No hay tarifas vencidas.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted border-b border-border-subtle">
                <th className="p-3">Cliente</th>
                <th className="p-3">Servicio</th>
                <th className="p-3 text-right">Precio</th>
                <th className="p-3">Venció</th>
              </tr>
            </thead>
            <tbody>
              {vencidas.map((r) => (
                <tr key={r.rateId} className="border-b border-border-subtle/50">
                  <td className="p-3">{r.cliente}</td>
                  <td className="p-3"><span className="font-mono text-xs text-fg-muted">{r.servicioCode}</span> {r.servicio}</td>
                  <td className="p-3 text-right">{fmtCurrency(r.unitPrice)}</td>
                  <td className="p-3 text-status-warning">{r.validTo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
