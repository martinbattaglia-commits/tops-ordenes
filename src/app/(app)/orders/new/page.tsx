import { listClients, listOperators } from "@/lib/data/orders";
import { SERVICES_CATALOG } from "@/lib/services-catalog";
import NewOrderWizard from "./NewOrderWizard";

export const metadata = { title: "Nueva orden" };

export default async function NewOrderPage() {
  const [clients, operators] = await Promise.all([listClients(), listOperators()]);
  return (
    <NewOrderWizard
      clients={clients}
      operators={operators}
      catalog={SERVICES_CATALOG}
    />
  );
}
