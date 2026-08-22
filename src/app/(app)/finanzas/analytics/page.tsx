import React from "react";
import { getExecutiveSnapshot } from "@/lib/analytics/executive-data";
import { ModuleUnavailable } from "@/components/shell/ModuleUnavailable";
import { ExecutiveDashboard } from "@/app/(app)/analytics/ExecutiveDashboard";

export const metadata = { title: "Analytics Ejecutivo · Finanzas" };
export const dynamic = "force-dynamic";

export default async function FinanzasAnalyticsPage() {
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
