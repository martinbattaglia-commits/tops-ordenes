import { ModuleScaffold } from "@/components/shell/ModuleScaffold";

export const metadata = { title: "Picking · WMS" };

export default function PickingPage() {
  return (
    <ModuleScaffold
      eyebrow="WMS · Depósito"
      title="Picking"
      subtitle="Preparación de pedidos: recorrido de picking por posición física y confirmación de cantidades."
      icon="qr"
      planned={[
        "Cola de pedidos a preparar",
        "Ruta de picking ordenada por ubicación",
        "Escaneo / confirmación por SKU y lote",
        "Vínculo al pedido logístico de origen",
      ]}
    />
  );
}
