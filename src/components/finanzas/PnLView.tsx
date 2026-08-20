"use client";

import React from "react";
import { Icon } from "@/components/Icon";
import type { ProfitAndLossStatement, FinanceCurrency } from "@/lib/finanzas/types";
import { fmtCurrency } from "@/lib/utils";

interface PnLViewProps {
  pnl: ProfitAndLossStatement;
  currency: FinanceCurrency;
}

export function PnLView({ pnl, currency }: PnLViewProps) {
  return (
    <div className="space-y-6">
      {/* Resumen Superior */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 bg-white rounded-xl border border-[#DDE2EB] shadow-xs">
          <span className="text-xs font-semibold text-[#687087] uppercase tracking-wider block mb-1">
            Ventas Totales
          </span>
          <div className="text-2xl font-bold text-[#050555]">
            {fmtCurrency(pnl.ingresos.total)}
          </div>
          <p className="text-xs text-[#687087] mt-1">Facturación consolidada {pnl.period}</p>
        </div>

        <div className="p-5 bg-white rounded-xl border border-[#DDE2EB] shadow-xs">
          <span className="text-xs font-semibold text-[#687087] uppercase tracking-wider block mb-1">
            Margen Bruto
          </span>
          <div className="text-2xl font-bold text-[#137333]">
            {fmtCurrency(pnl.margenBruto)}
          </div>
          <p className="text-xs text-[#137333] font-medium mt-1">
            {pnl.margenBrutoPorcentaje}% sobre ventas
          </p>
        </div>

        <div className="p-5 bg-white rounded-xl border border-[#DDE2EB] shadow-xs">
          <span className="text-xs font-semibold text-[#687087] uppercase tracking-wider block mb-1">
            EBITDA Operativo
          </span>
          <div className={`text-2xl font-bold ${pnl.ebitda >= 0 ? "text-[#137333]" : "text-[#C9070D]"}`}>
            {fmtCurrency(pnl.ebitda)}
          </div>
          <p className="text-xs text-[#687087] font-medium mt-1">
            {pnl.ebitdaPorcentaje}% margen EBITDA
          </p>
        </div>
      </div>

      {/* Tabla Detallada de Estado de Resultados */}
      <div className="bg-white rounded-xl border border-[#DDE2EB] shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-[#DDE2EB] bg-[#F4F5F8] flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-[#050555]">
              Estado de Resultados (P&L Gerencial)
            </h2>
            <p className="text-xs text-[#687087]">
              Comparativo Real vs Presupuesto del Período en {currency}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F4F5F8] text-[#687087] font-semibold border-b border-[#DDE2EB]">
              <tr>
                <th className="py-2.5 px-4">Concepto / Categoría</th>
                <th className="py-2.5 px-3 text-right">Real</th>
                <th className="py-2.5 px-3 text-right">Presupuesto</th>
                <th className="py-2.5 px-4 text-right">Variación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DDE2EB]">
              {/* Sección Ingresos */}
              <tr className="bg-[#F4F5F8]/70 font-bold text-[#050555]">
                <td colSpan={4} className="py-2.5 px-4">
                  1. INGRESOS POR VENTAS & SERVICIOS
                </td>
              </tr>
              {pnl.ingresos.byCategory.map((cat) => (
                <tr key={cat.code} className="hover:bg-[#F4F5F8]/40">
                  <td className="py-2 px-6 text-[#111331]">{cat.name}</td>
                  <td className="py-2 px-3 text-right font-medium text-[#111331]">{fmtCurrency(cat.amount)}</td>
                  <td className="py-2 px-3 text-right text-[#687087]">{fmtCurrency(cat.budgetAmount)}</td>
                  <td className={`py-2 px-4 text-right font-medium ${cat.variance >= 0 ? "text-[#137333]" : "text-[#C9070D]"}`}>
                    {cat.variance >= 0 ? "+" : ""}{fmtCurrency(cat.variance)}
                  </td>
                </tr>
              ))}
              <tr className="bg-[#F4F5F8]/40 font-bold border-t border-b border-[#DDE2EB]">
                <td className="py-2.5 px-4 text-[#050555]">Total Ingresos</td>
                <td className="py-2.5 px-3 text-right text-[#050555]">{fmtCurrency(pnl.ingresos.total)}</td>
                <td className="py-2.5 px-3 text-right text-[#687087]">—</td>
                <td className="py-2.5 px-4 text-right text-[#137333]">100.0%</td>
              </tr>

              {/* Sección Costos Directos */}
              <tr className="bg-[#F4F5F8]/70 font-bold text-[#050555]">
                <td colSpan={4} className="py-2.5 px-4">
                  2. COSTOS DIRECTOS DE OPERACIÓN
                </td>
              </tr>
              {pnl.costosDirectos.byCategory.map((cat) => (
                <tr key={cat.code} className="hover:bg-[#F4F5F8]/40">
                  <td className="py-2 px-6 text-[#111331]">{cat.name}</td>
                  <td className="py-2 px-3 text-right font-medium text-[#C9070D]">-{fmtCurrency(cat.amount)}</td>
                  <td className="py-2 px-3 text-right text-[#687087]">-{fmtCurrency(cat.budgetAmount)}</td>
                  <td className={`py-2 px-4 text-right font-medium ${cat.variance <= 0 ? "text-[#137333]" : "text-[#C9070D]"}`}>
                    {cat.variance > 0 ? "+" : ""}{fmtCurrency(cat.variance)}
                  </td>
                </tr>
              ))}
              <tr className="bg-[#F4F5F8]/40 font-bold border-t border-b border-[#DDE2EB]">
                <td className="py-2.5 px-4 text-[#050555]">Margen Bruto Operativo</td>
                <td className="py-2.5 px-3 text-right text-[#137333] font-bold">{fmtCurrency(pnl.margenBruto)}</td>
                <td className="py-2.5 px-3 text-right text-[#687087]">—</td>
                <td className="py-2.5 px-4 text-right text-[#137333]">{pnl.margenBrutoPorcentaje}%</td>
              </tr>

              {/* Sección Gastos Operativos */}
              <tr className="bg-[#F4F5F8]/70 font-bold text-[#050555]">
                <td colSpan={4} className="py-2.5 px-4">
                  3. GASTOS DE ADMINISTRACIÓN Y ESTRUCTURA
                </td>
              </tr>
              {pnl.gastosOperativos.byCategory.map((cat) => (
                <tr key={cat.code} className="hover:bg-[#F4F5F8]/40">
                  <td className="py-2 px-6 text-[#111331]">{cat.name}</td>
                  <td className="py-2 px-3 text-right font-medium text-[#C9070D]">-{fmtCurrency(cat.amount)}</td>
                  <td className="py-2 px-3 text-right text-[#687087]">-{fmtCurrency(cat.budgetAmount)}</td>
                  <td className={`py-2 px-4 text-right font-medium ${cat.variance <= 0 ? "text-[#137333]" : "text-[#C9070D]"}`}>
                    {cat.variance > 0 ? "+" : ""}{fmtCurrency(cat.variance)}
                  </td>
                </tr>
              ))}

              {/* Resultado EBITDA */}
              <tr className="bg-[#050555] text-white font-bold text-sm">
                <td className="py-3 px-4">EBITDA CONSOLIDADO</td>
                <td className="py-3 px-3 text-right">{fmtCurrency(pnl.ebitda)}</td>
                <td className="py-3 px-3 text-right opacity-70">—</td>
                <td className="py-3 px-4 text-right">{pnl.ebitdaPorcentaje}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
