import type { NextRequest } from "next/server";
import { checkPermission } from "@/lib/rbac/check";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getBillingRuns, getBillingRunItems } from "@/lib/contabilidad/data";
import { BillingView } from "./BillingView";

export const metadata = { title: "Facturación recurrente" };
export const dynamic = "force-dynamic";

export default async function BillingPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const runId = typeof searchParams?.run === "string" ? searchParams.run : null;

  let runs, items;
  try {
    [runs, items] = await Promise.all([
      getBillingRuns(),
      runId ? getBillingRunItems(runId) : Promise.resolve([]),
    ]);
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Facturación recurrente no disponible"
        migration="0098_billing_runs"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const perm = await checkPermission(undefined as unknown as NextRequest, "contabilidad.edit");

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-fg-brand">Facturación recurrente (billing runs)</h1>
        <p className="text-sm text-fg-secondary">
          Calcula <strong>borradores</strong> de ítems desde tarifas mensuales. No emite factura ni
          contabiliza: revisá (aprobar/excluir) y generá un borrador de factura por cliente.
        </p>
      </header>

      <BillingView runs={runs} items={items} selectedRunId={runId} canWrite={perm.ok} />
    </div>
  );
}
