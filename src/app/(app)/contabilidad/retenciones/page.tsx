import { fmtCurrency } from "@/lib/utils";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getRetencionesPracticadas, getPagosProveedorRetenciones } from "@/lib/contabilidad/data";
import { WITHHOLDING_LABEL } from "@/lib/contabilidad/types";

export const metadata = { title: "Retenciones practicadas" };
export const dynamic = "force-dynamic";

export default async function RetencionesPage() {
  let resumen, pagos;
  try {
    [resumen, pagos] = await Promise.all([
      getRetencionesPracticadas(),
      getPagosProveedorRetenciones(true),
    ]);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Retenciones practicadas no disponibles"
        migration="0088_supplier_withholdings"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const total = resumen.reduce((a, r) => a + r.importe, 0);

  return (
    <div className="p-4 lg:p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-fg-brand">Retenciones practicadas a proveedores</h1>
        <p className="text-sm text-fg-secondary">
          Retenciones practicadas al pagar (deuda fiscal a depositar), por período, tipo y
          jurisdicción. Total: {fmtCurrency(total)}.
        </p>
      </header>

      <section className="card overflow-x-auto">
        <div className="px-4 py-2 border-b border-border-subtle font-semibold text-fg-brand">
          Resumen por período / tipo
        </div>
        {resumen.length === 0 ? (
          <div className="p-8 text-sm text-fg-secondary">
            No hay retenciones registradas. Se cargan vía la RPC{" "}
            <code className="font-mono">ap_register_payment_withholdings</code>.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted border-b border-border-subtle">
                <th className="p-3">Período</th>
                <th className="p-3">Tipo</th>
                <th className="p-3">Jurisdicción</th>
                <th className="p-3 text-right">Pagos</th>
                <th className="p-3 text-right">Base imponible</th>
                <th className="p-3 text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {resumen.map((r, i) => (
                <tr key={i} className="border-b border-border-subtle/50">
                  <td className="p-3 font-medium text-fg-brand">{r.periodo}</td>
                  <td className="p-3">{WITHHOLDING_LABEL[r.withholdingType] ?? r.withholdingType}</td>
                  <td className="p-3 text-fg-muted">{r.jurisdiction || "—"}</td>
                  <td className="p-3 text-right">{r.pagos}</td>
                  <td className="p-3 text-right">{fmtCurrency(r.baseImponible)}</td>
                  <td className="p-3 text-right font-medium">{fmtCurrency(r.importe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card overflow-x-auto">
        <div className="px-4 py-2 border-b border-border-subtle font-semibold text-fg-brand">
          Pagos con retención — bruto / retención / neto
        </div>
        {pagos.length === 0 ? (
          <div className="p-8 text-sm text-fg-secondary">No hay pagos con retención.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted border-b border-border-subtle">
                <th className="p-3">Período</th>
                <th className="p-3">Pago</th>
                <th className="p-3">Proveedor</th>
                <th className="p-3 text-right">Bruto</th>
                <th className="p-3 text-right">Retenciones</th>
                <th className="p-3 text-right">Neto pagado</th>
              </tr>
            </thead>
            <tbody>
              {pagos.map((p) => (
                <tr key={p.paymentId} className="border-b border-border-subtle/50">
                  <td className="p-3">{p.periodo}</td>
                  <td className="p-3 font-mono text-xs">{p.publicId}</td>
                  <td className="p-3">{p.proveedor ?? "—"}</td>
                  <td className="p-3 text-right">{fmtCurrency(p.pagoBruto)}</td>
                  <td className="p-3 text-right">{fmtCurrency(p.retenciones)}</td>
                  <td className="p-3 text-right font-medium">{fmtCurrency(p.pagoNeto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
