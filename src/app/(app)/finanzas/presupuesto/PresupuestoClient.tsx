"use client";

import React, { useState } from "react";
import { FinanzasHeader } from "@/components/finanzas/FinanzasHeader";
import { BudgetPlanView } from "@/components/finanzas/BudgetPlanView";
import type { FinanceCurrency, FinanceVersion, FinanceCategory, FinanceAssumption } from "@/lib/finanzas/types";

interface PresupuestoClientProps {
  initialVersions: FinanceVersion[];
  initialActiveVersion: FinanceVersion | null;
  initialCategories: FinanceCategory[];
  sampleAssumptions: FinanceAssumption[];
}

export function PresupuestoClient({
  initialVersions,
  initialActiveVersion,
  initialCategories,
  sampleAssumptions,
}: PresupuestoClientProps) {
  const [currency, setCurrency] = useState<FinanceCurrency>("ARS");

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
      <FinanzasHeader
        title="Planificación y Presupuesto"
        subtitle="Versionado presupuestario (v2026-A, Reforecast), matriz de drivers y supuestos financieros."
        currentCurrency={currency}
        onCurrencyChange={setCurrency}
      />

      <BudgetPlanView
        categories={initialCategories}
        currency={currency}
      />
    </div>
  );
}
