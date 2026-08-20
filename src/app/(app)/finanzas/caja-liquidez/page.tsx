import React from "react";
import { CajaLiquidezClient } from "./CajaLiquidezClient";
import { getConsolidatedAccountPositions, getUnifiedFinanceTransactions, listFinanceCategories, listFinanceCostCenters } from "@/lib/finanzas/data";
import { calculate13WeekCashflow } from "@/lib/finanzas/engine";

export const dynamic = "force-dynamic";

export default async function CajaLiquidezPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [accountGroups, transactions, categories, costCenters] = await Promise.all([
    getConsolidatedAccountPositions(),
    getUnifiedFinanceTransactions(),
    listFinanceCategories(),
    listFinanceCostCenters(),
  ]);

  const totalArs = accountGroups.reduce((acc, g) => acc + g.arsBalance, 0);
  const totalUsd = accountGroups.reduce((acc, g) => acc + g.usdBalance, 0);
  const initialWeeks13 = calculate13WeekCashflow(today, totalArs, totalUsd, transactions);

  return (
    <CajaLiquidezClient
      initialAccountGroups={accountGroups}
      initialTransactions={transactions}
      initialCategories={categories}
      initialCostCenters={costCenters}
      initialWeeks13={initialWeeks13}
    />
  );
}
