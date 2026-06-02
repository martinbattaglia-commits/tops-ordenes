import { ModuleScaffold } from "@/components/shell/ModuleScaffold";

export const metadata = { title: "Movimientos · WMS" };

export default function MovimientosPage() {
  return (
    <ModuleScaffold
      eyebrow="WMS · Depósito"
      title="Movimientos"
      subtitle="Historial completo de movimientos de stock: ingresos, egresos, reubicaciones y ajustes."
      icon="refresh"
      planned={[
        "Registro append-only de cada movimiento",
        "Tipos: ingreso · egreso · reubicación · ajuste",
        "Trazabilidad por SKU, lote y posición",
        "Filtros por cliente, fecha y tipo",
      ]}
    />
  );
}
