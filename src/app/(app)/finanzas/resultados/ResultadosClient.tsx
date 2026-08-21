"use client";

import React, { useState } from "react";
import { FinanzasHeader } from "@/components/finanzas/FinanzasHeader";
import { PnLView } from "@/components/finanzas/PnLView";
import type { FinanceCurrency, ProfitAndLossStatement, AccountGroupPosition } from "@/lib/finanzas/types";

interface ResultadosClientProps {
  pnlArs: ProfitAndLossStatement;
  pnlUsd: ProfitAndLossStatement;
  accountPositions: AccountGroupPosition[];
}

export function ResultadosClient({ pnlArs, pnlUsd, accountPositions }: ResultadosClientProps) {
  const [currency, setCurrency] = useState<FinanceCurrency>("ARS");

  const activePnl = currency === "ARS" ? pnlArs : pnlUsd;

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
      <FinanzasHeader
        title="Resultados y Rentabilidad"
        subtitle="Estado de Resultados Gerencial (P&L), EBITDA operativo y rentabilidad por línea de negocio basada en datos reales."
        currentCurrency={currency}
        onCurrencyChange={setCurrency}
        accountPositions={accountPositions}
      />

      <PnLView pnl={activePnl} currency={currency} />
    </div>
  );
}
