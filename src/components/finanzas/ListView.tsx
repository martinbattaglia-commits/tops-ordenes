"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import type { FinanceUnifiedTransaction, FinanceCurrency } from "@/lib/finanzas/types";
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
  // Agrupar por fecha
  const groupsByDate = new Map<string, FinanceUnifiedTransaction[]>();
  for (const tx of transactions) {
    const list = groupsByDate.get(tx.date) || [];
    list.push(tx);
    groupsByDate.set(tx.date, list);
  }

  const sortedDates = Array.from(groupsByDate.keys()).sort();

  return (
    <div className="space-y-6">
      {sortedDates.length === 0 ? (
        <div className="p-8 text-center bg-white rounded-xl border border-[#DDE2EB] text-[#687087]">
          No hay movimientos registrados para el período seleccionado.
        </div>
      ) : (
        sortedDates.map((dateStr) => {
          const dayTxs = groupsByDate.get(dateStr) || [];
          const dayNet = dayTxs.reduce((acc, t) => {
            if (t.direction === "ingreso") return acc + t.amount;
            if (t.direction === "egreso") return acc - t.amount;
            return acc;
          }, 0);

          return (
            <div key={dateStr} className="bg-white rounded-xl border border-[#DDE2EB] shadow-xs overflow-hidden">
              {/* Header de fecha */}
              <div className="flex items-center justify-between px-5 py-3 bg-[#F4F5F8] border-b border-[#DDE2EB]">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-[#050555]">
                    {fmtDate(dateStr)}
                  </span>
                  <span className="text-xs text-[#687087]">
                    ({dayTxs.length} {dayTxs.length === 1 ? "movimiento" : "movimientos"})
                  </span>
                </div>

                <div className="text-xs font-semibold">
                  <span className="text-[#687087] mr-1">Neto del día:</span>
                  <span className={dayNet >= 0 ? "text-[#137333]" : "text-[#C9070D]"}>
                    {dayNet >= 0 ? "+" : ""}{fmtCurrency(dayNet)}
                  </span>
                </div>
              </div>

              {/* Lista de movimientos */}
              <div className="divide-y divide-[#DDE2EB]">
                {dayTxs.map((tx) => {
                  let badgeBg = "bg-[#E6F4EA] text-[#137333]";
                  if (tx.direction === "egreso") badgeBg = "bg-[#FBE9EA] text-[#C9070D]";
                  if (tx.direction === "transferencia") badgeBg = "bg-[#E9EEF5] text-[#214576]";

                  return (
                    <div
                      key={tx.id}
                      onClick={() => onSelectTransaction?.(tx)}
                      className="flex items-center justify-between p-4 hover:bg-[#F4F5F8] cursor-pointer transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${badgeBg}`}>
                          {tx.direction === "ingreso" ? "+" : tx.direction === "egreso" ? "-" : "⇄"}
                        </div>

                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-[#111331]">
                              {tx.concept}
                            </span>
                            {tx.counterpart && (
                              <span className="text-xs text-[#687087]">· {tx.counterpart}</span>
                            )}
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-[#E9EEF5] text-[#214576]">
                              {tx.categoryName}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 text-xs text-[#687087] mt-1">
                            <span>Cuenta: {tx.accountName}</span>
                            <span>•</span>
                            <span className="capitalize">{tx.status}</span>
                            <span>•</span>
                            <span className="font-medium text-[#050555]">
                              {tx.isReal ? "Hecho Tesorería" : "Proyección Finanzas"}
                            </span>
                            {tx.certainty && (
                              <span className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                                tx.certainty === "alta" ? "bg-emerald-50 text-emerald-700" :
                                tx.certainty === "media" ? "bg-amber-50 text-amber-700" :
                                "bg-rose-50 text-rose-700"
                              }`}>
                                Certeza {tx.certainty}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="text-right pl-4">
                        <div className={`text-base font-bold tabular-nums ${
                          tx.direction === "ingreso" ? "text-[#137333]" :
                          tx.direction === "egreso" ? "text-[#C9070D]" :
                          "text-[#214576]"
                        }`}>
                          {tx.direction === "ingreso" ? "+" : tx.direction === "egreso" ? "-" : ""}
                          {fmtCurrency(tx.amount)}
                        </div>
                        <div className="text-[10px] text-[#687087] uppercase font-medium">
                          {tx.currency}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
