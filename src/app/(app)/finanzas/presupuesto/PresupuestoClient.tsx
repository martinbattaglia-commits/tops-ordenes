"use client";

import React, { useState } from "react";
import { FinanzasHeader } from "@/components/finanzas/FinanzasHeader";
import { BudgetPlanView } from "@/components/finanzas/BudgetPlanView";
import type { FinanceCurrency, FinanceVersion, FinanceCategory, AccountGroupPosition } from "@/lib/finanzas/types";

interface PresupuestoClientProps {
  initialVersions: FinanceVersion[];
  initialActiveVersion: FinanceVersion | null;
  initialCategories: FinanceCategory[];
  accountPositions: AccountGroupPosition[];
}

export function PresupuestoClient({
  initialVersions,
  initialActiveVersion,
  initialCategories,
  accountPositions,
}: PresupuestoClientProps) {
  const [currency, setCurrency] = useState<FinanceCurrency>("ARS");

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
      <FinanzasHeader
        title="Planificación y Presupuesto"
        subtitle="Versionado presupuestario oficial, matriz de drivers y supuestos financieros basados en registros de Supabase."
        currentCurrency={currency}
        onCurrencyChange={setCurrency}
        accountPositions={accountPositions}
      />

      <BudgetPlanView
        categories={initialCategories}
        currency={currency}
      />
    </div>
  );
}
