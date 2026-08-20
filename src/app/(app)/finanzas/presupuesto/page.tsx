import React from "react";
import { PresupuestoClient } from "./PresupuestoClient";
import type { FinanceAssumption } from "@/lib/finanzas/types";
import { listFinanceVersions, getActiveFinanceVersion, listFinanceCategories } from "@/lib/finanzas/data";

export const dynamic = "force-dynamic";

export default async function PresupuestoPage() {
  const [versions, activeVersion, categories] = await Promise.all([
    listFinanceVersions(),
    getActiveFinanceVersion(),
    listFinanceCategories(),
  ]);

  const sampleAssumptions: FinanceAssumption[] = [
    { id: "1", version_id: "v1", driver_key: "inflation_monthly", name: "Inflación Mensual Base", category: "macro", unit: "%", source: "REM BCRA", value: 3.8, period: "2026", notes: null, created_at: "", updated_at: "" },
    { id: "2", version_id: "v1", driver_key: "fx_usd_ars", name: "Dólar Mayorista BNA", category: "macro", unit: "ARS/USD", source: "BNA", value: 1340, period: "2026", notes: null, created_at: "", updated_at: "" },
    { id: "3", version_id: "v1", driver_key: "gasoil_price", name: "Gasoil YPF Ruta", category: "costos", unit: "ARS/Litro", source: "YPF", value: 1180, period: "2026", notes: null, created_at: "", updated_at: "" },
  ];

  return (
    <PresupuestoClient
      initialVersions={versions}
      initialActiveVersion={activeVersion}
      initialCategories={categories}
      sampleAssumptions={sampleAssumptions}
    />
  );
}
