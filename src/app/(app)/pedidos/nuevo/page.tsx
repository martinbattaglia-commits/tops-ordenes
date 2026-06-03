import Link from "next/link";
import { Icon } from "@/components/Icon";
import { NewOrderForm } from "./NewOrderForm";

export const metadata = { title: "Nuevo pedido · Pedidos" };

export default function NuevoPedidoPage() {
  return (
    <div className="p-4 lg:p-8 nx-page-fade">
      <div className="page-header">
        <div>
          <div className="eyebrow-tiny">Pedidos · Logística</div>
          <h1 className="page-title">Nuevo pedido</h1>
          <p className="page-subtitle">
            Cargá cabecera y líneas. El pedido nace en <strong>borrador</strong>; luego se revisa,
            se envía a pendiente y se reserva stock.
          </p>
        </div>
        <Link href="/pedidos" className="btn btn-ghost btn-sm mt-1">
          <Icon name="arrow-left" size={12} /> Volver
        </Link>
      </div>
      <NewOrderForm />
    </div>
  );
}
