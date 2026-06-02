import { ModuleScaffold } from "@/components/shell/ModuleScaffold";

export const metadata = { title: "Packing · WMS" };

export default function PackingPage() {
  return (
    <ModuleScaffold
      eyebrow="WMS · Depósito"
      title="Packing"
      subtitle="Armado de pedidos: consolidación, embalaje y preparación para despacho."
      icon="folder"
      planned={[
        "Consolidación de ítems pickeados",
        "Armado de bultos / cajas",
        "Etiquetado del pedido",
        "Pase a estado Preparado",
      ]}
    />
  );
}
