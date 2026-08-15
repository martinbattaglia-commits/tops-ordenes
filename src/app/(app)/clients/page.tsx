import { ClientsAccessDeniedError, listClients } from "@/lib/data/clients";
import ClientsView from "./ClientsView";
import { listChartOfAccounts } from "@/lib/erp/accounting-data";
import type { ChartAccount } from "@/lib/erp/types";

export const metadata = { title: "Clientes" };

// Render dinámico: la lista sale de Supabase bajo la sesión del usuario y la
// RLS decide qué ve cada uno, así que no puede quedar horneada en el build.
export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  let result: Awaited<ReturnType<typeof listClients>>;
  try {
    // `listClients` autentica y exige clientes.view ANTES de toda lectura.
    // La lista ya no se obtiene con service_role.
    result = await listClients({ pageSize: 100 });
  } catch (error) {
    if (error instanceof ClientsAccessDeniedError) {
      return (
        <div className="p-4 lg:p-8">
          <div className="card p-6 max-w-xl">
            <h1 className="text-lg font-bold text-fg-primary">Acceso restringido</h1>
            <p className="text-sm text-fg-secondary mt-2">
              Se requiere el permiso <span className="font-mono">clientes.view</span> para
              consultar el registro maestro.
            </p>
          </div>
        </div>
      );
    }
    throw error;
  }
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
        accounts={accounts}
      />
    </div>
  );
}
