import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getBillableServices } from "@/lib/contabilidad/data";

export const metadata = { title: "Servicios facturables" };
export const dynamic = "force-dynamic";

export default async function ServiciosPage() {
  let rows;
  try {
    rows = await getBillableServices();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Servicios facturables no disponibles"
        migration="0096_billable_services"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-fg-brand">Servicios facturables</h1>
        <p className="text-sm text-fg-secondary">
          {rows.length} servicios. Catálogo fiscal (IVA, cuenta contable y centro de costo por defecto),
          independiente del catálogo operativo de OS.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="card p-8 text-sm text-fg-secondary">Sin servicios cargados.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-fg-muted border-b border-border-subtle">
                <th className="p-3">Código</th>
                <th className="p-3">Servicio</th>
                <th className="p-3">Tipo</th>
                <th className="p-3">Unidad</th>
                <th className="p-3 text-right">IVA %</th>
                <th className="p-3 text-center">Activo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border-subtle/50">
                  <td className="p-3 font-mono text-xs text-fg-secondary">{r.code}</td>
                  <td className="p-3">{r.name}</td>
                  <td className="p-3 text-fg-muted">{r.serviceType}</td>
                  <td className="p-3">{r.unit}</td>
                  <td className="p-3 text-right">{r.defaultVatRate}</td>
                  <td className="p-3 text-center">{r.isActive ? "✓" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
