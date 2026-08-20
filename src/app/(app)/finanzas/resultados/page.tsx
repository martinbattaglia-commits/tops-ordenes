"use client";

import React, { useState, useEffect } from "react";
import { FinanzasHeader } from "@/components/finanzas/FinanzasHeader";
import { PnLView } from "@/components/finanzas/PnLView";
import type { FinanceCurrency, ProfitAndLossStatement } from "@/lib/finanzas/types";
import { buildProfitAndLoss } from "@/lib/finanzas/engine";

export default function ResultadosPage() {
  const [currency, setCurrency] = useState<FinanceCurrency>("ARS");
  const [pnl, setPnl] = useState<ProfitAndLossStatement | null>(null);

  useEffect(() => {
    const demoTransactions = [
      { categoryCode: "ING_FLETES", categoryName: "Ingresos por Fletes y Distribución", categoryType: "ingreso" as const, costCenterLine: "cargas_generales" as const, amount: 48500000 },
      { categoryCode: "ING_LOG_FARMACIA", categoryName: "Ingresos Logística Farmacéutica ANMAT", categoryType: "ingreso" as const, costCenterLine: "anmat" as const, amount: 32400000 },
      { categoryCode: "ING_ALMACEN", categoryName: "Ingresos por Almacenamiento y M2", categoryType: "ingreso" as const, costCenterLine: "almacenamiento" as const, amount: 14200000 },
      { categoryCode: "ING_SERVICIOS_ESP", categoryName: "Servicios Especiales", categoryType: "ingreso" as const, costCenterLine: "distribucion" as const, amount: 6800000 },
      { categoryCode: "EGR_COMBUSTIBLE", categoryName: "Combustible y Peajes", categoryType: "egreso" as const, costCenterLine: "cargas_generales" as const, amount: 16500000, isCostOfService: true },
      { categoryCode: "EGR_SUELDOS", categoryName: "Sueldos y Cargas Sociales", categoryType: "egreso" as const, costCenterLine: "cargas_generales" as const, amount: 28400000 },
      { categoryCode: "EGR_MANTENIMIENTO", categoryName: "Mantenimiento de Flota", categoryType: "egreso" as const, costCenterLine: "distribucion" as const, amount: 7200000, isCostOfService: true },
      { categoryCode: "EGR_SEGUROS", categoryName: "Seguros y Pólizas", categoryType: "egreso" as const, costCenterLine: "cargas_generales" as const, amount: 3800000, isCostOfService: true },
      { categoryCode: "EGR_ALQUILERES", categoryName: "Alquileres de Depósitos", categoryType: "egreso" as const, costCenterLine: "almacenamiento" as const, amount: 6500000 },
      { categoryCode: "EGR_IMPUESTOS", categoryName: "Impuestos y Tasas", categoryType: "egreso" as const, costCenterLine: "corporativo" as const, amount: 8900000 },
      { categoryCode: "EGR_HONORARIOS", categoryName: "Honorarios y Asesoría", categoryType: "egreso" as const, costCenterLine: "corporativo" as const, amount: 2400000 },
      { categoryCode: "EGR_SERVICIOS", categoryName: "Servicios Públicos", categoryType: "egreso" as const, costCenterLine: "corporativo" as const, amount: 1800000 },
    ];

    const demoBudget = [
      { categoryCode: "ING_FLETES", amount: 45000000 },
      { categoryCode: "ING_LOG_FARMACIA", amount: 30000000 },
      { categoryCode: "ING_ALMACEN", amount: 15000000 },
      { categoryCode: "ING_SERVICIOS_ESP", amount: 5000000 },
      { categoryCode: "EGR_COMBUSTIBLE", amount: 15000000 },
      { categoryCode: "EGR_SUELDOS", amount: 27000000 },
      { categoryCode: "EGR_MANTENIMIENTO", amount: 6500000 },
      { categoryCode: "EGR_SEGUROS", amount: 3500000 },
      { categoryCode: "EGR_ALQUILERES", amount: 6500000 },
      { categoryCode: "EGR_IMPUESTOS", amount: 8500000 },
      { categoryCode: "EGR_HONORARIOS", amount: 2200000 },
      { categoryCode: "EGR_SERVICIOS", amount: 1600000 },
    ];

    const res = buildProfitAndLoss("2026-08", currency, demoTransactions, demoBudget);
    setPnl(res);
  }, [currency]);

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
      <FinanzasHeader
        title="Resultados y Rentabilidad"
        subtitle="Estado de Resultados Gerencial (P&L), EBITDA operativo y rentabilidad por línea de negocio."
        currentCurrency={currency}
        onCurrencyChange={setCurrency}
      />

      {pnl && <PnLView pnl={pnl} currency={currency} />}
    </div>
  );
}
