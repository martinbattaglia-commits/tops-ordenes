import { listClients, listOperators } from "@/lib/data/orders";
import { loadServicePricing } from "@/lib/data/service-pricing";
import NewOrderWizard from "./NewOrderWizard";
import OperationalOrderWizard from "./OperationalOrderWizard";
import { getDepotManagerBoot } from "@/lib/rbac/boot-permissions";
import { notFound } from "next/navigation";

export const metadata = { title: "Nueva orden" };
export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const manager = await getDepotManagerBoot();
  const [clients, operators, pricing] = await Promise.all([
    listClients("create"),
    listOperators(),
    loadServicePricing(),
  ]);
  if (manager.restricted) {
    if (!manager.authorized || !manager.depot || !manager.siteLabel) notFound();
    return <OperationalOrderWizard
      clients={clients}
      operators={operators.filter((operator) => operator.depot === manager.depot)}
      catalog={pricing.catalog}
      depot={manager.depot as "MAGALDI" | "LUJAN"}
      siteLabel={manager.siteLabel}
    />;
  }
  return (
    <NewOrderWizard
      clients={clients}
      operators={operators}
      catalog={pricing.catalog}
      pricing={pricing}
    />
  );
}
