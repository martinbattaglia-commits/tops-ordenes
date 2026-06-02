import { ModuleScaffold } from "@/components/shell/ModuleScaffold";

export const metadata = { title: "Recepciones · WMS" };

export default function RecepcionesPage() {
  return (
    <ModuleScaffold
      eyebrow="WMS · Depósito"
      title="Recepciones"
      subtitle="Ingreso de mercadería al depósito: registro, control y ubicación de la entrada."
      icon="download"
      planned={[
        "Alta de recepción por cliente",
        "Detalle de SKU, lote y vencimiento ingresados",
        "Asignación de ubicación física",
        "Historial de recepciones",
      ]}
    />
  );
}
