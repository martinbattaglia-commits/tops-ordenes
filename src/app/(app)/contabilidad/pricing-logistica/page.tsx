import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getOrdenesPricing, getBillableServices } from "@/lib/contabilidad/data";
import { PricingView } from "./PricingView";

export const metadata = { title: "Pricing de órdenes logísticas" };
export const dynamic = "force-dynamic";

export default async function PricingLogisticaPage() {
  let orders, services;
  try {
    [orders, services] = await Promise.all([getOrdenesPricing(), getBillableServices()]);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Pricing logístico no disponible"
        migration="0099_logistics_pricing"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-fg-brand">Pricing de órdenes logísticas</h1>
        <p className="text-sm text-fg-secondary">
          Simulación <strong>read-only</strong>. Las órdenes no tienen cliente/servicio/tarifa mapeados,
          por eso casi todas son “no priceable”. Elegí un servicio para simular un precio (no modifica datos).
        </p>
      </header>

      {orders.length === 0 ? (
        <div className="card p-8 text-sm text-fg-secondary">No hay órdenes despachadas/entregadas para evaluar.</div>
      ) : (
        <PricingView orders={orders} services={services.filter((s) => s.isActive)} />
      )}
    </div>
  );
}
