"use client";

import React, { useState } from "react";
import { Icon } from "@/components/Icon";
import type { FinanceVersion, FinanceAssumption, FinanceCategory, FinanceCurrency } from "@/lib/finanzas/types";
import { fmtCurrency } from "@/lib/utils";

interface BudgetPlanViewProps {
  versions: FinanceVersion[];
  activeVersion: FinanceVersion | null;
  categories: FinanceCategory[];
  assumptions: FinanceAssumption[];
  currency: FinanceCurrency;
}

export function BudgetPlanView({
  versions,
  activeVersion,
  categories,
  assumptions,
  currency,
}: BudgetPlanViewProps) {
  const [selectedVersionId, setSelectedVersionId] = useState<string>(activeVersion?.id || versions[0]?.id || "");
  const currentVer = versions.find((v) => v.id === selectedVersionId) || activeVersion;

  return (
    <div className="space-y-6">
      {/* Header de Versión y Acciones */}
      <div className="p-5 bg-white rounded-xl border border-[#DDE2EB] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#687087]">
              Planificación Presupuestaria
            </span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
              currentVer?.status === "approved" ? "bg-[#E6F4EA] text-[#137333]" :
              currentVer?.status === "in_review" ? "bg-amber-100 text-amber-800" :
              "bg-gray-100 text-gray-700"
            }`}>
              {currentVer?.status || "Draft"}
            </span>
          </div>
          <h2 className="text-xl font-bold text-[#050555] mt-1">
            {currentVer?.name || "Presupuesto 2026"}
          </h2>
          <p className="text-xs text-[#687087]">
            Vigencia: {currentVer?.valid_from} al {currentVer?.valid_to}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedVersionId}
            onChange={(e) => setSelectedVersionId(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-[#DDE2EB] bg-white font-medium text-[#111331] focus:outline-none focus:ring-2 focus:ring-[#214576]"
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.code} - {v.name} ({v.status})
              </option>
            ))}
          </select>

          <button
            type="button"
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#050555] text-white hover:bg-[#214576] transition-colors"
          >
            + Nueva Versión / Reforecast
          </button>
        </div>
      </div>

      {/* Grid de Drivers y Parámetros */}
      <div className="bg-white rounded-xl border border-[#DDE2EB] shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-[#DDE2EB] bg-[#F4F5F8] flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#050555] flex items-center gap-2">
            <Icon name="calculator" className="w-4 h-4 text-[#214576]" /> Drivers y Parámetros Operativos
          </h3>
          <span className="text-xs text-[#687087]">
            {assumptions.length} drivers configurados
          </span>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 bg-[#F4F5F8]/60 rounded-lg border border-[#DDE2EB]">
            <span className="text-[11px] font-semibold text-[#687087] uppercase block">Inflación Proyectada Mensual</span>
            <div className="text-lg font-bold text-[#111331] mt-1">3.8%</div>
            <span className="text-[10px] text-[#687087]">Fuente: REM BCRA</span>
          </div>
          <div className="p-4 bg-[#F4F5F8]/60 rounded-lg border border-[#DDE2EB]">
            <span className="text-[11px] font-semibold text-[#687087] uppercase block">Tipo de Cambio USD Oficial</span>
            <div className="text-lg font-bold text-[#111331] mt-1">$ 1.340,00</div>
            <span className="text-[10px] text-[#687087]">Fuente: BNA Divisa</span>
          </div>
          <div className="p-4 bg-[#F4F5F8]/60 rounded-lg border border-[#DDE2EB]">
            <span className="text-[11px] font-semibold text-[#687087] uppercase block">Tarifa Promedio Flete M3</span>
            <div className="text-lg font-bold text-[#111331] mt-1">$ 48.500</div>
            <span className="text-[10px] text-[#687087]">Cargas Generales</span>
          </div>
          <div className="p-4 bg-[#F4F5F8]/60 rounded-lg border border-[#DDE2EB]">
            <span className="text-[11px] font-semibold text-[#687087] uppercase block">Costo Gasoil / Litro Base</span>
            <div className="text-lg font-bold text-[#111331] mt-1">$ 1.180,00</div>
            <span className="text-[10px] text-[#687087]">YPF Mayorista</span>
          </div>
        </div>
      </div>

      {/* Grid de Presupuesto Mensual por Categoría */}
      <div className="bg-white rounded-xl border border-[#DDE2EB] shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-[#DDE2EB] bg-[#F4F5F8] flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#050555]">
            Matriz de Presupuesto Anual ({currency})
          </h3>
          <span className="text-xs text-[#687087]">
            Consolidado por rubros analíticos
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F4F5F8] text-[#687087] font-semibold border-b border-[#DDE2EB]">
              <tr>
                <th className="py-2.5 px-4">Rubro / Categoría</th>
                <th className="py-2.5 px-3">Tipo</th>
                <th className="py-2.5 px-3 text-right">Ene-26</th>
                <th className="py-2.5 px-3 text-right">Feb-26</th>
                <th className="py-2.5 px-3 text-right">Mar-26</th>
                <th className="py-2.5 px-3 text-right">Abr-26</th>
                <th className="py-2.5 px-3 text-right">May-26</th>
                <th className="py-2.5 px-3 text-right">Jun-26</th>
                <th className="py-2.5 px-4 text-right font-bold text-[#050555]">Total Anual</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DDE2EB]">
              {categories.map((cat) => {
                const baseMonthly = cat.category_type === "ingreso" ? 18500000 : 4200000;
                const annual = baseMonthly * 12;

                return (
                  <tr key={cat.id} className="hover:bg-[#F4F5F8]/50">
                    <td className="py-2.5 px-4 font-medium text-[#111331]">{cat.name}</td>
                    <td className="py-2.5 px-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        cat.category_type === "ingreso" ? "bg-[#E6F4EA] text-[#137333]" : "bg-[#FBE9EA] text-[#C9070D]"
                      }`}>
                        {cat.category_type}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-[#687087]">{fmtCurrency(baseMonthly)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-[#687087]">{fmtCurrency(baseMonthly * 1.03)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-[#687087]">{fmtCurrency(baseMonthly * 1.06)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-[#687087]">{fmtCurrency(baseMonthly * 1.09)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-[#687087]">{fmtCurrency(baseMonthly * 1.12)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-[#687087]">{fmtCurrency(baseMonthly * 1.15)}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-bold text-[#050555] bg-[#F4F5F8]/30">
                      {fmtCurrency(annual)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
