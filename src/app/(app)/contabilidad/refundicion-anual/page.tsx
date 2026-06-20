import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getResultadoAnual } from "@/lib/contabilidad/data";
import { RefundicionView } from "./RefundicionView";

export const metadata = { title: "Refundición anual" };
export const dynamic = "force-dynamic";

export default async function RefundicionAnualPage() {
  let resultados;
  try {
    resultados = await getResultadoAnual();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Refundición anual no disponible"
        migration="0101_annual_closing"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-fg-brand">Refundición anual</h1>
        <p className="text-sm text-fg-secondary">
          Simulación del cierre del ejercicio: transfiere el Resultado del Ejercicio (3.2.02) a
          Resultados No Asignados (3.2.01). La simulación no modifica datos; la ejecución real es gateada.
        </p>
      </header>

      <RefundicionView resultados={resultados} />
    </div>
  );
}
