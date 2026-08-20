import React from "react";
import { FinanzasResumenClient } from "./FinanzasResumenClient";
import { getConsolidatedAccountPositions } from "@/lib/finanzas/data";
import { buildProfitAndLoss } from "@/lib/finanzas/engine";

export const dynamic = "force-dynamic";

export default async function FinanzasResumenPage() {
  const positions = await getConsolidatedAccountPositions();

  const demoTransactions = [
    { categoryCode: "ING_FLETES", categoryName: "Ingresos por Fletes y Distribución", categoryType: "ingreso" as const, costCenterLine: "cargas_generales" as const, amount: 48500000 },
    { categoryCode: "ING_LOG_FARMACIA", categoryName: "Ingresos Logística Farmacéutica ANMAT", categoryType: "ingreso" as const, costCenterLine: "anmat" as const, amount: 32400000 },
    { categoryCode: "ING_ALMACEN", categoryName: "Ingresos por Almacenamiento y M2", categoryType: "ingreso" as const, costCenterLine: "almacenamiento" as const, amount: 14200000 },
    { categoryCode: "EGR_COMBUSTIBLE", categoryName: "Combustible y Peajes", categoryType: "egreso" as const, costCenterLine: "cargas_generales" as const, amount: 16500000, isCostOfService: true },
    { categoryCode: "EGR_SUELDOS", categoryName: "Sueldos y Cargas Sociales", categoryType: "egreso" as const, costCenterLine: "cargas_generales" as const, amount: 28400000 },
    { categoryCode: "EGR_MANTENIMIENTO", categoryName: "Mantenimiento de Flota", categoryType: "egreso" as const, costCenterLine: "distribucion" as const, amount: 7200000, isCostOfService: true },
    { categoryCode: "EGR_ALQUILERES", categoryName: "Alquileres de Depósitos", categoryType: "egreso" as const, costCenterLine: "almacenamiento" as const, amount: 6500000 },
    { categoryCode: "EGR_IMPUESTOS", categoryName: "Impuestos y Tasas", categoryType: "egreso" as const, costCenterLine: "corporativo" as const, amount: 8900000 },
  ];

  const demoBudget = [
    { categoryCode: "ING_FLETES", amount: 45000000 },
    { categoryCode: "ING_LOG_FARMACIA", amount: 30000000 },
    { categoryCode: "ING_ALMACEN", amount: 15000000 },
    { categoryCode: "EGR_COMBUSTIBLE", amount: 15000000 },
    { categoryCode: "EGR_SUELDOS", amount: 27000000 },
    { categoryCode: "EGR_MANTENIMIENTO", amount: 6500000 },
    { categoryCode: "EGR_ALQUILERES", amount: 6500000 },
    { categoryCode: "EGR_IMPUESTOS", amount: 8500000 },
  ];

  const pnlArs = buildProfitAndLoss("2026-08", "ARS", demoTransactions, demoBudget);
  const pnlUsd = buildProfitAndLoss("2026-08", "USD", [], []);

  return (
    <FinanzasResumenClient
      accountPositions={positions}
      pnlArs={pnlArs}
      pnlUsd={pnlUsd}
    />
  );
}
