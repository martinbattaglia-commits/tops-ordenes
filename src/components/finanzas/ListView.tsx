"use client";

import React, { useState, useMemo } from "react";
import { Icon } from "@/components/Icon";
import type { FinanceUnifiedTransaction, FinanceCurrency } from "@/lib/finanzas/types";
import { sortOperationalTransactions } from "@/lib/finanzas/engine";
import { fmtCurrency, fmtDate } from "@/lib/utils";

interface ListViewProps {
  currency: FinanceCurrency;
  transactions: FinanceUnifiedTransaction[];
  onSelectTransaction?: (tx: FinanceUnifiedTransaction) => void;
}

export function ListView({
  currency,
  transactions,
  onSelectTransaction,
}: ListViewProps) {
  const [searchTerm, setSearchTerm] = useState("");

  const sortedTransactions = useMemo(() => {
    return sortOperationalTransactions(transactions);
  }, [transactions]);

  const filtered = sortedTransactions.filter((tx) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (
      tx.concept.toLowerCase().includes(q) ||
      tx.counterpart?.toLowerCase().includes(q) ||
      tx.categoryName.toLowerCase().includes(q) ||
      tx.accountName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs overflow-hidden transition-colors">
      <div className="p-4 border-b border-stroke-soft bg-bg-surface-alt flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Icon name="search" className="absolute left-3 top-2.5 w-4 h-4 text-fg-muted" />
          <input
            type="text"
            placeholder="Buscar por concepto o cuenta..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-stroke-soft bg-bg-surface text-fg-primary focus:outline-none focus:ring-2 focus:ring-tops-blue-700 dark:focus:ring-blue-400 placeholder:text-fg-muted"
          />
        </div>
        <div className="text-xs text-fg-muted font-semibold">
          {filtered.length} ítems en vista lista
        </div>
      </div>

      <div className="divide-y divide-stroke-soft">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-fg-muted text-xs">
            No se encontraron transacciones.
          </div>
        ) : (
          filtered.map((tx) => (
            <div
              key={tx.id}
              onClick={() => onSelectTransaction?.(tx)}
              className="p-4 hover:bg-bg-surface-alt flex items-center justify-between cursor-pointer transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                  tx.direction === "ingreso" ? "bg-emerald-50 text-status-success dark:bg-emerald-950/60 dark:text-emerald-400" :
                  tx.direction === "egreso" ? "bg-rose-50 text-tops-red dark:bg-rose-950/60 dark:text-rose-400" :
                  "bg-blue-50 text-tops-blue-700 dark:bg-blue-950/60 dark:text-blue-400"
                }`}>
                  {tx.direction === "ingreso" ? "↓" : tx.direction === "egreso" ? "↑" : "⇄"}
                </div>
                <div>
                  <div className="text-xs font-bold text-fg-primary">{tx.concept}</div>
                  <div className="text-[11px] text-fg-muted mt-0.5">
                    {fmtDate(tx.date)} · {tx.accountName} ({tx.accountGroup}) · {tx.categoryName}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className={`text-sm font-bold tabular-nums ${
                  tx.direction === "ingreso" ? "text-status-success" : "text-tops-red"
                }`}>
                  {tx.direction === "ingreso" ? "+" : tx.direction === "egreso" ? "-" : ""}
                  {currency === "ARS" ? fmtCurrency(tx.amount) : `U$S ${tx.amount.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`}
                </div>
                <div className="text-[10px] text-fg-muted font-medium uppercase">
                  {tx.status}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
