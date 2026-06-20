import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getPeriodosParaCierre } from "@/lib/contabilidad/data";
import { CierreView } from "./CierreView";

export const metadata = { title: "Cierre de períodos" };
export const dynamic = "force-dynamic";

export default async function CierrePage() {
  let periodos;
  try {
    periodos = await getPeriodosParaCierre();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Cierre contable no disponible"
        migration="0095_accounting_closing"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-fg-brand">Cierre de períodos contables</h1>
        <p className="text-sm text-fg-secondary">
          Estado de cada período y simulación de refundición de resultados. La simulación es{" "}
          <strong>read-only</strong> (no modifica datos). El cierre real se ejecuta vía RPC
          <code className="font-mono"> acc_execute_closing</code> (requiere confirmación y permiso
          <code className="font-mono"> contabilidad.admin</code>).
        </p>
      </header>

      {periodos.length === 0 ? (
        <div className="card p-8 text-sm text-fg-secondary">
          Aún no hay períodos contables. Se crean automáticamente al generar asientos.
        </div>
      ) : (
        <CierreView periodos={periodos} />
      )}
    </div>
  );
}
