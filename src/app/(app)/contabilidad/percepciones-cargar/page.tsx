import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getCustomerInvoicesParaPercepciones } from "@/lib/contabilidad/data";
import { PercepcionForm } from "./PercepcionForm";

export const metadata = { title: "Cargar percepciones de venta" };
export const dynamic = "force-dynamic";

export default async function PercepcionesCargarPage() {
  let invoices;
  try {
    invoices = await getCustomerInvoicesParaPercepciones();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Carga de percepciones no disponible"
        migration="0087_sales_other_taxes"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-fg-brand">Cargar percepciones de venta</h1>
        <p className="text-sm text-fg-secondary">
          Registra el desglose de percepciones/otros tributos de una factura de venta (por tipo y
          jurisdicción). No modifica el IVA débito ni la cabecera; el detalle alimenta las DDJJ y el
          desglose contable.
        </p>
      </header>

      <PercepcionForm invoices={invoices} />
    </div>
  );
}
