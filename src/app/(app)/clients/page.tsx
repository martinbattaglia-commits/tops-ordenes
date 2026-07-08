import { listClientsHybrid } from "@/lib/data/clients";
import { env } from "@/lib/env";
import ClientsView from "./ClientsView";
import { listChartOfAccounts } from "@/lib/erp/accounting-data";
import type { ChartAccount } from "@/lib/erp/types";

export const metadata = { title: "Clientes" };

// Forzamos render dinámico — Clientify y Supabase no son cacheables a build.
export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const result = await listClientsHybrid({ pageSize: 100 });
  // Cuentas de ingreso para imputación de ventas (degrada a [] si no hay catálogo).
  let accounts: ChartAccount[] = [];
  try {
    accounts = await listChartOfAccounts({ types: ["ingreso"], postableOnly: true });
  } catch {
    accounts = [];
  }

  return (
    <div className="p-4 lg:p-8">
      <ClientsView
        initialRows={result.rows}
        initialSource={result.source}
        initialWarning={result.warning}
        clientifyConfigured={env.clientify.configured}
        accounts={accounts}
      />
    </div>
  );
}
