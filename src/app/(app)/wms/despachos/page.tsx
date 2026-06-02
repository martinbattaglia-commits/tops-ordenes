import { ModuleScaffold } from "@/components/shell/ModuleScaffold";

export const metadata = { title: "Despachos · WMS" };

export default function DespachosPage() {
  return (
    <ModuleScaffold
      eyebrow="WMS · Depósito"
      title="Despachos"
      subtitle="Salida de mercadería del depósito: confirmación de despacho y descuento de stock."
      icon="truck"
      planned={[
        "Pedidos preparados listos para salir",
        "Confirmación de despacho",
        "Descuento de stock y registro de movimiento",
        "Vínculo a Tracking de flota para la entrega",
      ]}
    />
  );
}
