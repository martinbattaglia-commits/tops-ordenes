"use client";

import React, { useState } from "react";
import { Icon } from "@/components/Icon";
import type { FinanceCategory, FinanceCurrency } from "@/lib/finanzas/types";
import { fmtCurrency } from "@/lib/utils";

interface BudgetPlanViewProps {
  categories: FinanceCategory[];
  currency: FinanceCurrency;
}

export function BudgetPlanView({ categories, currency }: BudgetPlanViewProps) {
  const [selectedScenario, setSelectedScenario] = useState("base");

  const multiplier = selectedScenario === "optimista" ? 1.15 : selectedScenario === "pesimista" ? 0.85 : 1.0;

  return (
    <div className="space-y-6">
      {/* Controles de Escenario Presupuestario */}
      <div className="p-4 bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-tops-blue-700/10 dark:bg-blue-950/60 flex items-center justify-center text-tops-blue-700 dark:text-blue-400">
            <Icon name="trend-up" className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-fg-primary uppercase tracking-wider">
              Planificación Operativa y Escenarios
            </h3>
            <p className="text-xs text-fg-muted">
              Modelado de supuestos por rubro y volumen proyectado ({currency}).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-muted font-semibold">Escenario:</span>
          <div className="inline-flex rounded-lg border border-stroke-soft bg-bg-surface-alt p-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => setSelectedScenario("pesimista")}
              className={`px-3 py-1 rounded transition-all ${
                selectedScenario === "pesimista"
                  ? "bg-bg-surface text-tops-red shadow-2xs font-bold"
                  : "text-fg-muted hover:text-fg-primary"
              }`}
            >
              Pesimista (-15%)
            </button>
            <button
              type="button"
              onClick={() => setSelectedScenario("base")}
              className={`px-3 py-1 rounded transition-all ${
                selectedScenario === "base"
                  ? "bg-bg-surface text-tops-blue-700 dark:text-blue-400 shadow-2xs font-bold"
                  : "text-fg-muted hover:text-fg-primary"
              }`}
            >
              Base (Plan Oficial)
            </button>
            <button
              type="button"
              onClick={() => setSelectedScenario("optimista")}
              className={`px-3 py-1 rounded transition-all ${
                selectedScenario === "optimista"
                  ? "bg-bg-surface text-status-success shadow-2xs font-bold"
                  : "text-fg-muted hover:text-fg-primary"
              }`}
            >
              Optimista (+15%)
            </button>
          </div>
        </div>
      </div>

      {/* Grilla de Presupuesto Anual */}
      <div className="bg-bg-surface rounded-xl border border-stroke-soft shadow-2xs overflow-hidden transition-colors">
        <div className="px-6 py-4 border-b border-stroke-soft bg-bg-surface-alt flex items-center justify-between">
          <h2 className="text-sm font-bold text-fg-primary">
            Rubros Analíticos y Asignación Presupuestaria
          </h2>
          <span className="text-xs font-bold text-tops-blue-700 dark:text-blue-400 bg-tops-blue-700/10 dark:bg-blue-950/60 px-2 py-0.5 rounded">
            Plan Oficial
          </span>
        </div>

        {categories.length === 0 ? (
          <div className="p-12 text-center text-fg-muted space-y-2">
            <Icon name="report" className="w-8 h-8 text-fg-muted mx-auto mb-2" />
            <div className="text-xs font-bold text-fg-primary">Sin categorías presupuestarias configuradas</div>
            <p className="text-[11px] text-fg-muted max-w-sm mx-auto">
              El plan de cuentas analítico se cargará desde las categorías activas en Supabase.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-bg-surface-alt text-fg-muted font-bold border-b border-stroke-soft uppercase text-[10px]">
                <tr>
                  <th className="py-2.5 px-4">Rubro Analítico</th>
                  <th className="py-2.5 px-3">Tipo</th>
                  <th className="py-2.5 px-3 text-right">Ene</th>
                  <th className="py-2.5 px-3 text-right">Feb</th>
                  <th className="py-2.5 px-3 text-right">Mar</th>
                  <th className="py-2.5 px-3 text-right">Abr</th>
                  <th className="py-2.5 px-3 text-right">May</th>
                  <th className="py-2.5 px-3 text-right">Jun</th>
                  <th className="py-2.5 px-4 text-right font-bold text-fg-primary">Total Anual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stroke-soft">
                {categories.map((c) => {
                  const baseMonthly = 0;
                  const annual = baseMonthly * 12 * multiplier;

                  return (
                    <tr key={c.id} className="hover:bg-bg-surface-alt transition-colors">
                      <td className="py-2.5 px-4 font-bold text-fg-primary">
                        {c.name}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          c.category_type === "ingreso"
                            ? "bg-emerald-50 text-status-success dark:bg-emerald-950/60 dark:text-emerald-400"
                            : "bg-rose-50 text-tops-red dark:bg-rose-950/60 dark:text-rose-400"
                        }`}>
                          {c.category_type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-fg-muted">{baseMonthly > 0 ? fmtCurrency(baseMonthly) : "—"}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-fg-muted">{baseMonthly > 0 ? fmtCurrency(baseMonthly) : "—"}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-fg-muted">{baseMonthly > 0 ? fmtCurrency(baseMonthly) : "—"}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-fg-muted">{baseMonthly > 0 ? fmtCurrency(baseMonthly) : "—"}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-fg-muted">{baseMonthly > 0 ? fmtCurrency(baseMonthly) : "—"}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums text-fg-muted">{baseMonthly > 0 ? fmtCurrency(baseMonthly) : "—"}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums font-bold text-fg-primary bg-bg-surface-alt/40">
                        {annual > 0 ? fmtCurrency(annual) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
