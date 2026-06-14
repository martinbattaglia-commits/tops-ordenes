import { getContractsPortfolio } from "@/lib/comercial/contracts-data";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { ContratosWorkspace } from "./ContratosWorkspace";

export const metadata = { title: "Contratos · CRM Comercial" };
export const dynamic = "force-dynamic";

export default async function ContratosPage() {
  try {
    const portfolio = await getContractsPortfolio();
    return <ContratosWorkspace portfolio={portfolio} />;
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Contratos no disponibles"
        migration="0076_crm_contracts"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }
}
