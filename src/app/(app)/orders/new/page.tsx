import { listClients, listOperators } from "@/lib/data/orders";
import { loadServicePricing } from "@/lib/data/service-pricing";
import NewOrderWizard from "./NewOrderWizard";

export const metadata = { title: "Nueva orden" };
export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const [clients, operators, pricing] = await Promise.all([
    listClients("create"),
    listOperators(),
    loadServicePricing(),
  ]);
  return (
    <NewOrderWizard
      clients={clients}
      operators={operators}
      catalog={pricing.catalog}
      pricing={pricing}
    />
  );
}
