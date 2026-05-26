import { listClientsHybrid } from "@/lib/data/clients";
import { env } from "@/lib/env";
import ClientsView from "./ClientsView";

export const metadata = { title: "Clientes" };

// Forzamos render dinámico — Clientify y Supabase no son cacheables a build.
export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const result = await listClientsHybrid({ pageSize: 100 });

  return (
    <div className="p-4 lg:p-8">
      <ClientsView
        initialRows={result.rows}
        initialSource={result.source}
        initialWarning={result.warning}
        clientifyConfigured={env.clientify.configured}
      />
    </div>
  );
}
