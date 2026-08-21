"use client";

import React from "react";
import type { WeeklyCashflowItem, FinanceCurrency } from "@/lib/finanzas/types";
import { fmtCurrency } from "@/lib/utils";

interface Cashflow13WeeksTableProps {
  weeks: WeeklyCashflowItem[];
  currency: FinanceCurrency;
}

export function Cashflow13WeeksTable({ weeks, currency }: Cashflow13WeeksTableProps) {
  const formatMoney = (val: number) => {
    return currency === "ARS"
      ? fmtCurrency(val)
      : `U$S ${val.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs overflow-hidden transition-colors">
      <div className="px-6 py-4 border-b border-stroke-soft bg-bg-surface-alt flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-fg-primary">
            Flujo de Fondos Proyectado — 13 Semanas Rodantes
          </h2>
          <p className="text-xs text-fg-muted mt-0.5">
            Evolución semanal de saldos iniciales, ingresos, egresos y posición final ({currency}).
          </p>
        </div>
        <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-tops-blue-700/10 text-tops-blue-700 dark:bg-blue-950/60 dark:text-blue-400">
          Semana 1 a 13
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-bg-surface-alt text-fg-muted font-bold border-b border-stroke-soft uppercase text-[10px]">
            <tr>
              <th className="py-3 px-4">Semana</th>
              <th className="py-3 px-4">Período</th>
              <th className="py-3 px-4 text-right">Saldo Inicial</th>
              <th className="py-3 px-4 text-right text-status-success">Ingresos (+)</th>
              <th className="py-3 px-4 text-right text-tops-red">Egresos (-)</th>
              <th className="py-3 px-4 text-right">Flujo Neto</th>
              <th className="py-3 px-4 text-right font-bold text-tops-blue-700 dark:text-blue-400">Saldo Final Proyectado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stroke-soft">
            {weeks.map((w) => {
              const init = currency === "ARS" ? w.initialBalanceArs : w.initialBalanceUsd;
              const inflows = currency === "ARS" ? w.inflowsArs : w.inflowsUsd;
              const outflows = currency === "ARS" ? w.outflowsArs : w.outflowsUsd;
              const net = currency === "ARS" ? w.netFlowArs : w.netFlowUsd;
              const final = currency === "ARS" ? w.finalBalanceArs : w.finalBalanceUsd;

              return (
                <tr key={w.weekNumber} className="hover:bg-bg-surface-alt transition-colors">
                  <td className="py-3 px-4 font-bold text-fg-primary">
                    {w.weekLabel}
                  </td>
                  <td className="py-3 px-4 text-fg-muted text-[11px] whitespace-nowrap">
                    {w.startDate} al {w.endDate}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums font-medium text-fg-secondary">
                    {formatMoney(init)}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums font-semibold text-status-success">
                    +{formatMoney(inflows)}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums font-semibold text-tops-red">
                    -{formatMoney(outflows)}
                  </td>
                  <td className={`py-3 px-4 text-right tabular-nums font-bold ${net >= 0 ? "text-status-success" : "text-tops-red"}`}>
                    {net >= 0 ? "+" : ""}{formatMoney(net)}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums font-bold text-tops-blue-700 dark:text-blue-400">
                    {formatMoney(final)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
