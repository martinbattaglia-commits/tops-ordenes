import React from "react";
import { ResultadosClient } from "./ResultadosClient";
import {
  getConsolidatedAccountPositions,
  getUnifiedFinanceTransactions,
  listFinanceCategories,
} from "@/lib/finanzas/data";
import { buildProfitAndLoss } from "@/lib/finanzas/engine";

export const dynamic = "force-dynamic";

export default async function ResultadosPage() {
  const [positions, transactions, categories] = await Promise.all([
    getConsolidatedAccountPositions(),
    getUnifiedFinanceTransactions(),
    listFinanceCategories().catch(() => []),
  ]);

  const currentPeriod = new Date().toISOString().slice(0, 7);

  const realPnlTransactionsArs = transactions
    .filter((t) => t.currency === "ARS")
    .map((t) => ({
      categoryCode: t.categoryName,
      categoryName: t.categoryName,
      categoryType: t.direction === "ingreso" ? ("ingreso" as const) : ("egreso" as const),
      amount: t.amount,
    }));

  const realPnlTransactionsUsd = transactions
    .filter((t) => t.currency === "USD")
    .map((t) => ({
      categoryCode: t.categoryName,
      categoryName: t.categoryName,
      categoryType: t.direction === "ingreso" ? ("ingreso" as const) : ("egreso" as const),
      amount: t.amount,
    }));

  const realBudgetLines = categories.map((c) => ({
    categoryCode: c.code,
    amount: 0,
  }));

  const pnlArs = buildProfitAndLoss(currentPeriod, "ARS", realPnlTransactionsArs, realBudgetLines);
  const pnlUsd = buildProfitAndLoss(currentPeriod, "USD", realPnlTransactionsUsd, realBudgetLines);

  return (
    <ResultadosClient
      pnlArs={pnlArs}
      pnlUsd={pnlUsd}
      accountPositions={positions}
    />
  );
}
