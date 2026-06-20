import type { NextRequest } from "next/server";
import { checkPermission } from "@/lib/rbac/check";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { getComprobantesSinAsiento } from "@/lib/contabilidad/data";
import { ComprobantesView } from "./ComprobantesView";

export const metadata = { title: "Pendientes de contabilizar" };
export const dynamic = "force-dynamic";

export default async function ComprobantesPage() {
  let rows;
  try {
    rows = await getComprobantesSinAsiento();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Comprobantes pendientes no disponibles"
        migration="0086_accounting_reports"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  const perm = await checkPermission(undefined as unknown as NextRequest, "contabilidad.create");
  const canPost = perm.ok;

  return (
    <div className="p-4 lg:p-8">
      <ComprobantesView rows={rows} canPost={canPost} />
    </div>
  );
}
