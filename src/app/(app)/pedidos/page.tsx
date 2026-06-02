import { ModuleScaffold } from "@/components/shell/ModuleScaffold";

export const metadata = { title: "Pedidos Logísticos" };

/**
 * Tablero de Pedidos Logísticos (operación logística del cliente / 3PL).
 * Concepto distinto de Órdenes de Servicio (/orders, gestión interna TOPS).
 * Los estados se manejarán como filtros del tablero (?estado=...) en la fase
 * de lógica; acá solo queda la estructura.
 */
export default function PedidosPage() {
  return (
    <ModuleScaffold
      eyebrow="Pedidos · Logística"
      title="Pedidos Logísticos"
      subtitle="Operación logística del cliente: tablero de pedidos por estado, de extremo a extremo. Distinto de Órdenes de Servicio (gestión interna)."
      icon="package"
      planned={[
        "Estados: Pendiente · En preparación · Preparado · Despachado · Entregado · Cancelado",
        "Tablero filtrable por estado (?estado=…)",
        "Vínculo Pedido → Picking → SKU → Ubicación física",
        "Trazabilidad de extremo a extremo del pedido",
      ]}
    />
  );
}
