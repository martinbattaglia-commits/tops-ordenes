"use client";

import React, { useState, useMemo } from "react";
import { Icon } from "@/components/Icon";
import type { FinanceUnifiedTransaction, FinanceCurrency } from "@/lib/finanzas/types";
import { isProgrammedTransaction, sortOperationalTransactions } from "@/lib/finanzas/engine";
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
          filtered.map((tx) => {
            const isProgrammed = isProgrammedTransaction(tx);

            return (
              <div
                key={tx.id}
                onClick={() => onSelectTransaction?.(tx)}
                className={`p-4 hover:bg-bg-surface-alt flex items-center justify-between cursor-pointer transition-colors ${
                  isProgrammed ? "bg-amber-500/[0.02]" : ""
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                      isProgrammed
                        ? "bg-amber-500/10 text-amber-600 border border-amber-400/40 dark:bg-amber-950/40 dark:text-amber-400"
                        : tx.direction === "ingreso"
                        ? "bg-emerald-50 text-status-success dark:bg-emerald-950/60 dark:text-emerald-400"
                        : tx.direction === "egreso"
                        ? "bg-rose-50 text-tops-red dark:bg-rose-950/60 dark:text-rose-400"
                        : "bg-blue-50 text-tops-blue-700 dark:bg-blue-950/60 dark:text-blue-400"
                    }`}
                  >
                    {isProgrammed ? (
                      <Icon name="clock" className="w-4 h-4" />
                    ) : tx.direction === "ingreso" ? (
                      "↓"
                    ) : tx.direction === "egreso" ? (
                      "↑"
                    ) : (
                      "⇄"
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-fg-primary flex items-center gap-1.5 flex-wrap">
                      <span>{tx.concept}</span>
                      {tx.counterpart && (
                        <span className="text-fg-muted font-normal">· {tx.counterpart}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-fg-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span>{fmtDate(tx.date)}</span>
                      <span>·</span>
                      <span>{tx.accountName} ({tx.accountGroup})</span>
                      <span>·</span>
                      <span>{tx.categoryName}</span>
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div
                    className={`text-sm font-bold tabular-nums flex items-center justify-end gap-1 ${
                      isProgrammed
                        ? "text-amber-600 dark:text-amber-400"
                        : tx.direction === "ingreso"
                        ? "text-status-success"
                        : "text-tops-red"
                    }`}
                  >
                    {isProgrammed && (
                      <Icon name="clock" className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    )}
                    <span>
                      {tx.direction === "ingreso" ? "+" : tx.direction === "egreso" ? "-" : ""}
                      {currency === "ARS"
                        ? fmtCurrency(tx.amount)
                        : `U$S ${tx.amount.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`}
                    </span>
                  </div>
                  <div className="mt-1">
                    <span
                      className={`text-[9px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1 uppercase tracking-wider ${
                        isProgrammed
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-400/30"
                          : "bg-emerald-500/10 text-status-success dark:text-emerald-400 border border-emerald-400/30"
                      }`}
                    >
                      {isProgrammed ? (
                        <Icon name="clock" className="w-2.5 h-2.5" />
                      ) : (
                        <Icon name="check" className="w-2.5 h-2.5" />
                      )}
                      {tx.status}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
