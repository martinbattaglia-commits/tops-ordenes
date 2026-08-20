"use client";

import React from "react";
import type { WeeklyCashflowItem, FinanceCurrency } from "@/lib/finanzas/types";
import { fmtCurrency } from "@/lib/utils";

interface Cashflow13WeeksTableProps {
  weeks: WeeklyCashflowItem[];
  currency: FinanceCurrency;
}

export function Cashflow13WeeksTable({ weeks, currency }: Cashflow13WeeksTableProps) {
  return (
    <div className="bg-white rounded-xl border border-[#DDE2EB] shadow-xs overflow-hidden">
      <div className="px-6 py-4 border-b border-[#DDE2EB] bg-[#F4F5F8] flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-[#050555]">
            Flujo de Fondos Proyectado — 13 Semanas Rodantes
          </h2>
          <p className="text-xs text-[#687087] mt-0.5">
            Proyección directa de ingresos, egresos y posición final consolidada en {currency}.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#F4F5F8] text-[#687087] font-semibold border-b border-[#DDE2EB]">
            <tr>
              <th className="py-2.5 px-3">Semana</th>
              <th className="py-2.5 px-3">Período</th>
              <th className="py-2.5 px-3 text-right">Saldo Inicial</th>
              <th className="py-2.5 px-3 text-right text-[#137333]">Ingresos (+)</th>
              <th className="py-2.5 px-3 text-right text-[#C9070D]">Egresos (-)</th>
              <th className="py-2.5 px-3 text-right">Flujo Neto</th>
              <th className="py-2.5 px-3 text-right font-bold text-[#050555]">Saldo Final</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#DDE2EB]">
            {weeks.map((w) => {
              const initBal = currency === "ARS" ? w.initialBalanceArs : w.initialBalanceUsd;
              const inflows = currency === "ARS" ? w.inflowsArs : w.inflowsUsd;
              const outflows = currency === "ARS" ? w.outflowsArs : w.outflowsUsd;
              const net = currency === "ARS" ? w.netFlowArs : w.netFlowUsd;
              const finalBal = currency === "ARS" ? w.finalBalanceArs : w.finalBalanceUsd;

              return (
                <tr key={w.weekNumber} className="hover:bg-[#F4F5F8]/60 transition-colors">
                  <td className="py-2.5 px-3 font-bold text-[#050555]">
                    Semana {w.weekNumber}
                  </td>
                  <td className="py-2.5 px-3 text-[#687087]">
                    {w.startDate.slice(5)} al {w.endDate.slice(5)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-[#687087]">
                    {fmtCurrency(initBal)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-[#137333] font-medium">
                    +{fmtCurrency(inflows)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-[#C9070D] font-medium">
                    -{fmtCurrency(outflows)}
                  </td>
                  <td className={`py-2.5 px-3 text-right tabular-nums font-semibold ${
                    net >= 0 ? "text-[#137333]" : "text-[#C9070D]"
                  }`}>
                    {net >= 0 ? "+" : ""}{fmtCurrency(net)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-bold text-[#050555] bg-[#F4F5F8]/30">
                    {fmtCurrency(finalBal)}
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
