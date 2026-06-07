import type { NextRequest } from "next/server";
import { checkPermission } from "@/lib/rbac/check";
import { getExecutiveSnapshot } from "@/lib/analytics/executive-data";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { ExecutiveDashboard } from "./ExecutiveDashboard";

export const metadata = { title: "Analytics Ejecutivo" };
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  // Guard: dashboard de Dirección. checkPermission ignora el request (param _req
  // sin uso) → seguro reusarlo en la página. analytics.view = Administración +
  // Director de Operaciones.
  const check = await checkPermission(undefined as unknown as NextRequest, "analytics.view");
  if (!check.ok) {
    return (
      <div className="p-8 max-w-xl">
        <div className="card p-6">
          <h1 className="text-lg font-bold text-fg-primary mb-2">Acceso restringido</h1>
          <p className="text-sm text-fg-muted">
            El Analytics Ejecutivo está disponible solo para Dirección y Administración.
          </p>
        </div>
      </div>
    );
  }

  let snapshot;
  try {
    snapshot = await getExecutiveSnapshot();
  } catch (e) {
    return (
      <ModuleUnavailable
        title="Analytics Ejecutivo no disponible"
        migration="ERP-A / ERP-B / WMS"
        detail={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  return (
    <div className="p-4 lg:p-8">
      <ExecutiveDashboard snapshot={snapshot} />
    </div>
  );
}
