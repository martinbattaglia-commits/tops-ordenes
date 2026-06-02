import { ModuleScaffold } from "@/components/shell/ModuleScaffold";

export const metadata = { title: "Vencimientos · WMS" };

export default function VencimientosPage() {
  return (
    <ModuleScaffold
      eyebrow="WMS · Compliance ANMAT"
      title="Vencimientos"
      subtitle="Alertas de vencimiento de mercadería con criterio ANMAT: próximos a vencer y vencidos."
      icon="clock"
      planned={[
        "Semáforo de vencimientos (vencido / crítico / próximo)",
        "Filtro por cliente, SKU y lote",
        "Ubicación física del stock por vencer",
        "Exportación para gestión ANMAT",
      ]}
    />
  );
}
