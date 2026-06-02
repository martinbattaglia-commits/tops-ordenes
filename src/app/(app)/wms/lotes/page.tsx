import { ModuleScaffold } from "@/components/shell/ModuleScaffold";

export const metadata = { title: "Lotes · WMS" };

export default function LotesPage() {
  return (
    <ModuleScaffold
      eyebrow="WMS · Depósito"
      title="Lotes"
      subtitle="Trazabilidad por lote: origen, vencimiento y ubicación de cada lote en stock."
      icon="tag-alt"
      planned={[
        "Listado de lotes por cliente y SKU",
        "Fecha de vencimiento y estado",
        "Posiciones físicas asociadas",
        "Trazabilidad completa de movimientos del lote",
      ]}
    />
  );
}
