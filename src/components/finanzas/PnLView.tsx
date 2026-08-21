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
        <div className="p-5 bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs transition-colors">
          <span className="text-xs font-bold text-fg-muted uppercase tracking-wider block mb-1">
            Ventas Totales
          </span>
          <div className="text-2xl font-bold text-fg-primary">
            {fmtCurrency(pnl.ingresos.total)}
          </div>
          <p className="text-xs text-fg-muted mt-1">Facturación consolidada {pnl.period}</p>
        </div>

        <div className="p-5 bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs transition-colors">
          <span className="text-xs font-bold text-fg-muted uppercase tracking-wider block mb-1">
            Margen Bruto
          </span>
          <div className="text-2xl font-bold text-status-success">
            {fmtCurrency(pnl.margenBruto)}
          </div>
          <p className="text-xs text-status-success font-medium mt-1">
            {pnl.margenBrutoPorcentaje}% sobre ventas
          </p>
        </div>

        <div className="p-5 bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs transition-colors">
          <span className="text-xs font-bold text-fg-muted uppercase tracking-wider block mb-1">
            EBITDA Operativo
          </span>
          <div className={`text-2xl font-bold ${pnl.ebitda >= 0 ? "text-status-success" : "text-tops-red"}`}>
            {fmtCurrency(pnl.ebitda)}
          </div>
          <p className="text-xs text-fg-muted font-medium mt-1">
            {pnl.ebitdaPorcentaje}% margen EBITDA
          </p>
        </div>
      </div>

      {/* Tabla Detallada de Estado de Resultados */}
      <div className="bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs overflow-hidden transition-colors">
        <div className="px-6 py-4 border-b border-stroke-soft bg-bg-surface-alt flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-fg-primary">
              Estado de Resultados (P&L Gerencial)
            </h2>
            <p className="text-xs text-fg-muted">
              Comparativo Real vs Presupuesto del Período en {currency}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-bg-surface-alt text-fg-muted font-bold border-b border-stroke-soft uppercase text-[10px]">
              <tr>
                <th className="py-2.5 px-4">Concepto / Categoría</th>
                <th className="py-2.5 px-3 text-right">Real</th>
                <th className="py-2.5 px-3 text-right">Presupuesto</th>
                <th className="py-2.5 px-4 text-right">Variación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stroke-soft">
              {/* Sección Ingresos */}
              <tr className="bg-bg-surface-alt/70 font-bold text-fg-primary">
                <td colSpan={4} className="py-2.5 px-4">
                  1. INGRESOS POR VENTAS & SERVICIOS
                </td>
              </tr>
              {pnl.ingresos.byCategory.map((cat) => (
                <tr key={cat.code} className="hover:bg-bg-surface-alt/40">
                  <td className="py-2 px-6 text-fg-primary font-medium">{cat.name}</td>
                  <td className="py-2 px-3 text-right font-bold text-fg-primary">{fmtCurrency(cat.amount)}</td>
                  <td className="py-2 px-3 text-right text-fg-muted">{fmtCurrency(cat.budgetAmount)}</td>
                  <td className={`py-2 px-4 text-right font-bold ${cat.variance >= 0 ? "text-status-success" : "text-tops-red"}`}>
                    {cat.variance >= 0 ? "+" : ""}{fmtCurrency(cat.variance)}
                  </td>
                </tr>
              ))}
              <tr className="bg-bg-surface-alt/40 font-bold border-t border-b border-stroke-soft">
                <td className="py-2.5 px-4 text-fg-primary">Total Ingresos</td>
                <td className="py-2.5 px-3 text-right text-fg-primary">{fmtCurrency(pnl.ingresos.total)}</td>
                <td className="py-2.5 px-3 text-right text-fg-muted">—</td>
                <td className="py-2.5 px-4 text-right text-status-success">100.0%</td>
              </tr>

              {/* Sección Costos Directos */}
              <tr className="bg-bg-surface-alt/70 font-bold text-fg-primary">
                <td colSpan={4} className="py-2.5 px-4">
                  2. COSTOS DIRECTOS DE OPERACIÓN
                </td>
              </tr>
              {pnl.costosDirectos.byCategory.map((cat) => (
                <tr key={cat.code} className="hover:bg-bg-surface-alt/40">
                  <td className="py-2 px-6 text-fg-primary font-medium">{cat.name}</td>
                  <td className="py-2 px-3 text-right font-bold text-tops-red">-{fmtCurrency(cat.amount)}</td>
                  <td className="py-2 px-3 text-right text-fg-muted">-{fmtCurrency(cat.budgetAmount)}</td>
                  <td className={`py-2 px-4 text-right font-bold ${cat.variance <= 0 ? "text-status-success" : "text-tops-red"}`}>
                    {cat.variance > 0 ? "+" : ""}{fmtCurrency(cat.variance)}
                  </td>
                </tr>
              ))}
              <tr className="bg-bg-surface-alt/40 font-bold border-t border-b border-stroke-soft">
                <td className="py-2.5 px-4 text-fg-primary">Margen Bruto Operativo</td>
                <td className="py-2.5 px-3 text-right text-status-success font-bold">{fmtCurrency(pnl.margenBruto)}</td>
                <td className="py-2.5 px-3 text-right text-fg-muted">—</td>
                <td className="py-2.5 px-4 text-right text-status-success">{pnl.margenBrutoPorcentaje}%</td>
              </tr>

              {/* Sección Gastos Operativos */}
              <tr className="bg-bg-surface-alt/70 font-bold text-fg-primary">
                <td colSpan={4} className="py-2.5 px-4">
                  3. GASTOS DE ADMINISTRACIÓN Y ESTRUCTURA
                </td>
              </tr>
              {pnl.gastosOperativos.byCategory.map((cat) => (
                <tr key={cat.code} className="hover:bg-bg-surface-alt/40">
                  <td className="py-2 px-6 text-fg-primary font-medium">{cat.name}</td>
                  <td className="py-2 px-3 text-right font-bold text-tops-red">-{fmtCurrency(cat.amount)}</td>
                  <td className="py-2 px-3 text-right text-fg-muted">-{fmtCurrency(cat.budgetAmount)}</td>
                  <td className={`py-2 px-4 text-right font-bold ${cat.variance <= 0 ? "text-status-success" : "text-tops-red"}`}>
                    {cat.variance > 0 ? "+" : ""}{fmtCurrency(cat.variance)}
                  </td>
                </tr>
              ))}

              {/* Resultado EBITDA */}
              <tr className="bg-tops-blue-900 text-white font-bold text-sm">
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
